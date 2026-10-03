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
 * 以 center 为中心写一串字。先在四周垫一圈 shadow（一个点宽）当描边，读数压在什么背景上都看得清。
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
