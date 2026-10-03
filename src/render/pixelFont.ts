import { v2 } from '../core/math';
import type { Rgba } from './color';
import type { ShapeBatch } from './shapeBatch';

/**
 * 3×5 的像素数字：战场里要写数字（核心血量）的地方用它，一个点画成一个小方块，和画面同一套像素网格。
 * 只有 0~9、"/" 和 "+"，够用再加。
 */
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '/': ['001', '001', '010', '100', '100'],
  '+': ['000', '010', '111', '010', '000'],
};

/** 一串字有多宽（缓冲像素）。px 是一个点画多大，字间空一个点。 */
export function pixelTextWidth(text: string, px: number): number {
  return text.length * 4 * px - px;
}

/**
 * 以 center 为中心写一串字。先在四周垫一圈 shadow（一个点宽）当描边，读数压在什么背景上都看得清
 * （字缝和"0"的内孔也会被填上，整串字像压在一块底牌上）。
 */
export function drawPixelText(s: ShapeBatch, text: string, center: { x: number; y: number }, px: number, color: Rgba, shadow: Rgba, depth: number): void {
  const w = pixelTextWidth(text, px);
  const x0 = Math.round(center.x - w / 2);
  const y0 = Math.round(center.y - (5 * px) / 2);
  for (const pass of [0, 1]) {
    for (let i = 0; i < text.length; i++) {
      const g = GLYPHS[text[i]];
      if (!g) continue;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (g[r][c] !== '1') continue;
          const x = x0 + (i * 4 + c) * px + px / 2;
          const y = y0 + r * px + px / 2;
          if (pass === 0) s.rect(v2(x, y), px * 3, px * 3, 0, shadow, depth);
          else s.rect(v2(x, y), px, px, 0, color, depth + 0.01);
        }
      }
    }
  }
}

/**
 * 带一圈细描边的字（飘字用）：每个点画成 px×px，描边只有 1 个缓冲像素宽，而且只描外轮廓 —— 从四周往里灌，
 * 灌得到的空白里挨着笔画的才描，"0""8"的内孔、字和字之间留出的缝都还看得见，不会糊成一块底牌。
 * 同一行连着的像素合成一个矩形画，一串字也就几十个矩形。
 */
export function drawOutlinedText(s: ShapeBatch, text: string, center: { x: number; y: number }, px: number, color: Rgba, edge: Rgba, depth: number): void {
  const gap = px + 1;
  const tw = text.length * 3 * px + (text.length - 1) * gap;
  const th = 5 * px;
  // 四周各留 1 像素给描边。
  const W = tw + 2;
  const H = th + 2;
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < text.length; i++) {
    const g = GLYPHS[text[i]];
    if (!g) continue;
    const ox = 1 + i * (3 * px + gap);
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++) {
        if (g[r][c] !== '1') continue;
        for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) ink[(1 + r * px + yy) * W + ox + c * px + xx] = 1;
      }
  }
  // 外面：从边框往里灌，碰到笔画就停。
  const out = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const k = stack.pop()!;
    if (out[k] || ink[k]) continue;
    out[k] = 1;
    const x = k % W;
    if (x > 0) stack.push(k - 1);
    if (x < W - 1) stack.push(k + 1);
    if (k >= W) stack.push(k - W);
    if (k < W * (H - 1)) stack.push(k + W);
  }
  const isEdge = (x: number, y: number): boolean => {
    const k = y * W + x;
    if (!out[k]) return false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && ink[ny * W + nx]) return true;
      }
    return false;
  };
  const x0 = Math.round(center.x - W / 2);
  const y0 = Math.round(center.y - H / 2);
  const runs = (test: (x: number, y: number) => boolean, c: Rgba, d: number): void => {
    for (let y = 0; y < H; y++) {
      let start = -1;
      for (let x = 0; x <= W; x++) {
        const on = x < W && test(x, y);
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          s.rect(v2(x0 + (start + x) / 2, y0 + y + 0.5), x - start, 1, 0, c, d);
          start = -1;
        }
      }
    }
  };
  runs(isEdge, edge, depth);
  runs((x, y) => ink[y * W + x] === 1, color, depth + 0.01);
}
