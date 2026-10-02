import { type Vec2, v2 } from '../core/math';
import type { Camera } from '../render/camera';
import { type Rgba, lerpColor, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import type { ShapeBatch } from '../render/shapeBatch';
import { drawStarship } from './starship';
import { drawSurface } from './surface';
import { field } from './fields';

/**
 * 太空平台：一条悬在深空里的金属通道，前面窄、后面的炮位区宽一些。两侧是虚空。
 *
 * 地板是一格格的金属面板（20 单位一格，2×2 拼成一个大模块），每格按种子挑一种样式：
 * 平板、对开板、防滑纹、格栅、舱盖、排风扇、灯条。全部在地面层上画，不描边。
 *
 * 通道宽窄由当前战场（fields.ts）决定；行星地表（沙漠、冰原、月面、虫巢）走 surface.ts，共用这里的边界和小工具。
 */

/** 通道中线。 */
export const LANE_CX = 330;
/** 从哪一行开始变宽（落在 20 的格线上，斜边才能逐格对齐）。 */
const WIDEN_Y = 500;
/** 平台的首尾。 */
export const TOP_Y = 0;
export const END_Y = 900;

export const T = 20;

/** 水晶核心的位置：兵营和指挥中心中间、地图中轴上（scene.ts 管它的逻辑，地形有的要围着它画）。 */
export const CORE = v2(LANE_CX, 700);

/** 某一行通道的左右边界：前方是当前战场的 narrow，过了 WIDEN_Y 放宽到 wide。 */
export function spanAt(y: number): [number, number] {
  const { narrow, wide } = field();
  // 放宽用多少行：差得越多斜边越长，不然窄通道一出口就是一道直角。取整到 20 的倍数。
  const len = Math.max(40, Math.ceil(((wide - narrow) * 0.6) / T) * T);
  const k = Math.max(0, Math.min(1, (y - WIDEN_Y) / len));
  const h = narrow + (wide - narrow) * k;
  return [LANE_CX - h, LANE_CX + h];
}

const SEAM = rgb(34, 38, 46);
const PLATES = [rgb(112, 118, 130), rgb(102, 108, 120), rgb(120, 125, 136), rgb(96, 104, 118)];
const RIM = rgb(74, 80, 94);
const HAZ_Y = rgb(220, 170, 50);
const HAZ_K = rgb(30, 30, 34);
const GLOW = rgb(110, 200, 255);
const UNDER = rgb(40, 44, 56);

type TileKind = 'plain' | 'split' | 'tread' | 'grate' | 'hatch' | 'vent' | 'strip';

interface Tile {
  ix: number;
  iy: number;
  kind: TileKind;
  color: Rgba;
  bolts: boolean;
}

export function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 面板按战场缓存：换了战场宽窄就变了，要重新排。 */
const tileCache = new Map<string, Tile[]>();

function buildTiles(): Tile[] {
  const WIDE = field().wide;
  const out: Tile[] = [];
  for (let iy = Math.floor(TOP_Y / T); iy * T < END_Y; iy++) {
    const [a, b] = spanAt(iy * T + T);
    for (let ix = Math.floor((LANE_CX - WIDE) / T); ix * T < LANE_CX + WIDE; ix++) {
      if ((ix + 1) * T <= a - T || ix * T >= b + T) continue;
      const r = hash(ix, iy);
      const kind: TileKind =
        r < 0.46 ? 'plain' : r < 0.6 ? 'split' : r < 0.72 ? 'tread' : r < 0.81 ? 'grate' : r < 0.88 ? 'hatch' : r < 0.93 ? 'vent' : 'strip';
      out.push({ ix, iy, kind, color: PLATES[Math.floor(hash(iy, ix) * PLATES.length)], bolts: hash(ix + 7, iy) < 0.5 });
    }
  }
  return out;
}

/** 星空：一块 512×512 的屏幕空间图块，按视差平铺。 */
const STARS = Array.from({ length: 140 }, (_, i) => ({
  x: hash(i, 1) * 512,
  y: hash(i, 2) * 512,
  r: 0.5 + Math.pow(hash(i, 3), 3) * 1.3,
  tw: hash(i, 4) * 6.28,
  c: hash(i, 5) < 0.2 ? rgb(255, 220, 180) : hash(i, 5) < 0.4 ? rgb(170, 200, 255) : rgb(230, 235, 255),
}));

const NEBULA = [
  { x: 120, y: 160, rx: 260, ry: 150, c: rgba(70, 40, 120, 34) },
  { x: 900, y: 420, rx: 320, ry: 170, c: rgba(30, 70, 130, 30) },
  { x: 540, y: 700, rx: 280, ry: 140, c: rgba(90, 40, 100, 26) },
  { x: 260, y: 520, rx: 180, ry: 110, c: rgba(40, 90, 140, 22) },
];

function drawVoid(s: ShapeBatch, cam: Camera, time: number): void {
  const W = cam.viewWidth;
  const H = cam.viewHeight;
  s.rect(v2(W / 2, H / 2), W + 4, H + 4, 0, rgb(7, 9, 18), 0);
  // 视差：远处的东西只跟着镜头挪一小部分。
  const o = cam.worldToScreen(0, 0);
  const px = o.x * 0.25;
  const py = o.y * 0.25;
  const wrap = (v: number, m: number): number => ((v % m) + m) % m;
  for (const n of NEBULA) {
    const x = wrap(n.x + px * 0.6, W + 600) - 300;
    const y = wrap(n.y + py * 0.6, H + 400) - 200;
    s.ellipse(v2(x, y), n.rx, n.ry, 0.3, n.c, 1);
    s.ellipse(v2(x + n.rx * 0.2, y - n.ry * 0.1), n.rx * 0.55, n.ry * 0.5, 0.3, n.c, 1.1);
  }
  for (let ty = -1; ty * 512 < H + 512; ty++) {
    for (let tx = -1; tx * 512 < W + 512; tx++) {
      for (const st of STARS) {
        const x = st.x + tx * 512 + wrap(px, 512);
        const y = st.y + ty * 512 + wrap(py, 512);
        if (x < -2 || x > W + 2 || y < -2 || y > H + 2) continue;
        const tw = 0.6 + 0.4 * Math.sin(time * 1.7 + st.tw);
        const c = lerpColor(rgb(7, 9, 18), st.c, tw);
        s.disc(v2(x, y), st.r, c, 2);
      }
    }
  }
}

/** 世界坐标（z=0 地面）上的一个轴对齐矩形。 */
export function plate(s: ShapeBatch, cam: Camera, x0: number, y0: number, x1: number, y1: number, c: Rgba, d: number, z = 0): void {
  s.quad(cam.worldToScreenZ(x0, y0, z), cam.worldToScreenZ(x1, y0, z), cam.worldToScreenZ(x1, y1, z), cam.worldToScreenZ(x0, y1, z), c, d);
}

/** 平台一条边：一行内左右边界从 y0 处的 a 线性变到 y1 处的 b。 */
export function edgeQuad(s: ShapeBatch, cam: Camera, xa0: number, xb0: number, y0: number, xa1: number, xb1: number, y1: number, c: Rgba, d: number, z = 0): void {
  s.quad(cam.worldToScreenZ(xa0, y0, z), cam.worldToScreenZ(xb0, y0, z), cam.worldToScreenZ(xb1, y1, z), cam.worldToScreenZ(xa1, y1, z), c, d);
}

/** 斜纹警示条：在 [x0,x1]×[y0,y1] 里排一串斜着的黄条，两头不出界。 */
export function hazard(s: ShapeBatch, cam: Camera, x0: number, y0: number, x1: number, y1: number, d: number): void {
  plate(s, cam, x0, y0, x1, y1, HAZ_K, d);
  const w = 2.2;
  const lean = (y1 - y0) * 0.8;
  for (let x = x0 + 0.5; x + w + lean <= x1 - 0.3; x += w * 2) {
    s.quad(cam.worldToScreenZ(x, y1, 0), cam.worldToScreenZ(x + w, y1, 0), cam.worldToScreenZ(x + w + lean, y0, 0), cam.worldToScreenZ(x + lean, y0, 0), HAZ_Y, d + 0.01);
  }
}

export function drawFloor(s: ShapeBatch, cam: Camera, time: number): void {
  if (field().theme === 'starship') {
    drawStarship(s, cam, time);
    return;
  }
  if (field().theme !== 'space') {
    drawSurface(s, cam, time);
    return;
  }
  let tiles = tileCache.get(field().id);
  if (!tiles) {
    tiles = buildTiles();
    tileCache.set(field().id, tiles);
  }
  drawVoid(s, cam, time);

  // 看得见的范围（世界 y），只画屏幕里的那几行。
  const top = cam.screenToWorld(0, -40).y;
  const bottom = cam.screenToWorld(0, cam.viewHeight + 60).y;
  const g = cam.grain;

  // 平台底下的结构：沿边缘一条悬梁、每隔 40 一个三角托架 —— 侧面看不见，靠伸出来的这些读出"悬空"。
  for (let y = Math.floor(Math.max(TOP_Y, top - 60) / T) * T; y < Math.min(END_Y, bottom + 40); y += T) {
    const [a0, b0] = spanAt(y);
    const [a1, b1] = spanAt(y + T);
    edgeQuad(s, cam, a0 - 7, a0, y, a1 - 7, a1, y + T, UNDER, 5, -5);
    edgeQuad(s, cam, b0, b0 + 7, y, b1, b1 + 7, y + T, UNDER, 5, -5);
    // 托架：每隔 40 一根往外伸、往下挂的方梁，正面暗、顶面亮一档。
    if (Math.round(y / T) % 2 === 0 && a0 === a1) {
      for (const [x, dir] of [[a0, -1], [b0, 1]] as const) {
        const xo = x + dir * 9;
        const yb = y + T / 2;
        s.quad(cam.worldToScreenZ(x, yb - 2, -4), cam.worldToScreenZ(xo, yb - 2, -4), cam.worldToScreenZ(xo, yb + 2, -4), cam.worldToScreenZ(x, yb + 2, -4), rgb(66, 72, 88), 6);
        s.quad(cam.worldToScreenZ(x, yb + 2, -4), cam.worldToScreenZ(xo, yb + 2, -4), cam.worldToScreenZ(xo, yb + 2, -14), cam.worldToScreenZ(x, yb + 2, -22), rgb(36, 40, 52), 6.1);
        s.disc(cam.worldToScreenZ(xo - dir * 1.5, yb + 2, -6), Math.max(0.8, g * 0.9), rgba(255, 150, 60, 200), 6.2);
      }
    }
  }
  // 平台尾端正对镜头的那一面墙。
  {
    const [a, b] = spanAt(END_Y);
    s.quad(cam.worldToScreenZ(a, END_Y, 0), cam.worldToScreenZ(b, END_Y, 0), cam.worldToScreenZ(b, END_Y, -30), cam.worldToScreenZ(a, END_Y, -30), rgb(58, 62, 74), 7);
  }

  // 接缝底色：整条平台先铺一层深色，面板往里缩一点，缝就露出来了。
  for (let y = Math.floor(Math.max(TOP_Y, top - T) / T) * T; y < Math.min(END_Y, bottom); y += T) {
    const [a0, b0] = spanAt(y);
    const [a1, b1] = spanAt(y + T);
    edgeQuad(s, cam, a0, b0, y, a1, b1, y + T, SEAM, 10);
  }

  for (const t of tiles) {
    const x0 = t.ix * T;
    const y0 = t.iy * T;
    if (y0 > bottom || y0 + T < top) continue;
    drawTile(s, cam, t, x0, y0, time, g);
  }

  // 防线前的警戒线、两条靠边的黄色导向线。
  const [la, lb] = spanAt(450);
  hazard(s, cam, la + 8, 446, lb - 8, 451, 30);
  for (let y = Math.floor(Math.max(TOP_Y, top) / 40) * 40; y < Math.min(440, bottom); y += 40) {
    const [a, b] = spanAt(y);
    plate(s, cam, a + 14, y + 6, a + 15.5, y + 30, rgba(220, 180, 70, 150), 29);
    plate(s, cam, b - 15.5, y + 6, b - 14, y + 30, rgba(220, 180, 70, 150), 29);
  }

  // 边框：加高的一圈护边，上面一道亮边、隔一段一块警示条、一盏灯。
  for (let y = Math.floor(Math.max(TOP_Y, top - T) / T) * T; y < Math.min(END_Y, bottom); y += T) {
    const [a0, b0] = spanAt(y);
    const [a1, b1] = spanAt(y + T);
    const k = Math.round(y / T);
    for (const side of [-1, 1]) {
      const e0 = side < 0 ? a0 : b0;
      const e1 = side < 0 ? a1 : b1;
      const i0 = e0 - side * 6;
      const i1 = e1 - side * 6;
      edgeQuad(s, cam, Math.min(e0, i0), Math.max(e0, i0), y, Math.min(e1, i1), Math.max(e1, i1), y + T, RIM, 31, 1.6);
      // 护边的外沿亮线和内侧的投影。
      edgeQuad(s, cam, e0 - side * 1, e0, y, e1 - side * 1, e1, y + T, rgb(150, 156, 170), 31.1, 1.6);
      edgeQuad(s, cam, Math.min(i0, i0 - side * 1.5), Math.max(i0, i0 - side * 1.5), y, Math.min(i1, i1 - side * 1.5), Math.max(i1, i1 - side * 1.5), y + T, rgba(0, 0, 0, 70), 30.5);
      if (k % 4 === 1 && e0 === e1) hazard(s, cam, Math.min(e0, i0) + 0.6, y + 4, Math.max(e0, i0) - 0.6, y + 16, 31.2);
      if (k % 4 === 3 && e0 === e1) {
        const at = cam.worldToScreenZ((e0 + i0) / 2, y + T / 2, 1.6);
        const pulse = 0.6 + 0.4 * Math.sin(time * 2.2 + k * 0.9);
        s.ellipse(at, g * 7, g * 7 * Projection.groundSquash, 0, rgba(110, 200, 255, Math.round(40 * pulse)), 31.3);
        s.rect(at, g * 2.6, g * 2.6 * Projection.groundSquash, 0, lerpColor(rgb(40, 70, 100), GLOW, pulse), 31.4);
      }
    }
  }
}

function drawTile(s: ShapeBatch, cam: Camera, t: Tile, x0: number, y0: number, time: number, g: number): void {
  const x1 = x0 + T;
  const y1 = y0 + T;
  // 和平台边界求交：斜边那几格裁成梯形。
  const [a0, b0] = spanAt(y0);
  const [a1, b1] = spanAt(y1);
  const L0 = Math.max(x0, a0);
  const L1 = Math.max(x0, a1);
  const R0 = Math.min(x1, b0);
  const R1 = Math.min(x1, b1);
  if (R0 <= L0 + 1 && R1 <= L1 + 1) return;
  const clipped = L0 !== x0 || L1 !== x0 || R0 !== x1 || R1 !== x1;
  // 模块缝：每 2×2 一个大模块，模块之间的缝宽一些。
  const gl = t.ix % 2 === 0 ? 1 : 0.4;
  const gr = t.ix % 2 === 1 ? 1 : 0.4;
  const gt = t.iy % 2 === 0 ? 1 : 0.4;
  const gb = t.iy % 2 === 1 ? 1 : 0.4;
  const c = t.color;
  if (clipped) {
    edgeQuad(s, cam, L0 + gl, R0 - gr, y0 + gt, L1 + gl, R1 - gr, y1 - gb, c, 20);
    return;
  }
  const X0 = x0 + gl;
  const X1 = x1 - gr;
  const Y0 = y0 + gt;
  const Y1 = y1 - gb;
  plate(s, cam, X0, Y0, X1, Y1, c, 20);
  // 倒角：上沿、左沿亮一档，下沿、右沿暗一档（光从左上来）。
  const lite = lerpColor(c, rgb(255, 255, 255), 0.18);
  const dark = lerpColor(c, rgb(0, 0, 0), 0.25);
  plate(s, cam, X0, Y0, X1, Y0 + 1, lite, 20.1);
  plate(s, cam, X0, Y0, X0 + 0.8, Y1, lite, 20.1);
  plate(s, cam, X0, Y1 - 1, X1, Y1, dark, 20.1);
  plate(s, cam, X1 - 0.8, Y0, X1, Y1, dark, 20.1);
  const cx = (X0 + X1) / 2;
  const cy = (Y0 + Y1) / 2;
  const recess = rgb(30, 34, 42);

  switch (t.kind) {
    case 'split': {
      const vertical = (t.ix + t.iy) % 2 === 0;
      if (vertical) {
        plate(s, cam, cx - 0.4, Y0 + 1, cx + 0.4, Y1 - 1, SEAM, 20.2);
        plate(s, cam, cx + 0.4, Y0 + 1, cx + 1.1, Y1 - 1, lite, 20.2);
      } else {
        plate(s, cam, X0 + 1, cy - 0.4, X1 - 1, cy + 0.4, SEAM, 20.2);
        plate(s, cam, X0 + 1, cy + 0.4, X1 - 1, cy + 1.2, lite, 20.2);
      }
      break;
    }
    case 'tread': {
      // 防滑纹：错开排的小凸条。
      const bump = lerpColor(c, rgb(255, 255, 255), 0.12);
      const sh = lerpColor(c, rgb(0, 0, 0), 0.2);
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const bx = X0 + 2.5 + i * 4.2 + (j % 2) * 2;
          const by = Y0 + 2.8 + j * 4;
          if (bx + 2.4 > X1 - 1) continue;
          plate(s, cam, bx, by + 0.6, bx + 2.4, by + 1.4, sh, 20.2);
          plate(s, cam, bx, by, bx + 2.4, by + 0.8, bump, 20.3);
        }
      }
      break;
    }
    case 'grate': {
      plate(s, cam, X0 + 2.5, Y0 + 2.5, X1 - 2.5, Y1 - 2.5, recess, 20.2);
      plate(s, cam, X0 + 2.5, Y1 - 3.2, X1 - 2.5, Y1 - 2.5, lerpColor(c, rgb(0, 0, 0), 0.4), 20.25);
      for (let i = 0; i < 6; i++) {
        const gx = X0 + 3.6 + i * 2.25;
        plate(s, cam, gx, Y0 + 2.5, gx + 0.9, Y1 - 2.5, lerpColor(c, recess, 0.35), 20.3);
      }
      break;
    }
    case 'hatch': {
      plate(s, cam, X0 + 2, Y0 + 2, X1 - 2, Y1 - 2, lerpColor(c, rgb(0, 0, 0), 0.12), 20.2);
      hazard(s, cam, X0 + 2, Y0 + 2, X1 - 2, Y0 + 4.2, 20.25);
      hazard(s, cam, X0 + 2, Y1 - 4.2, X1 - 2, Y1 - 2, 20.25);
      plate(s, cam, cx - 3, cy - 0.8, cx + 3, cy + 0.8, recess, 20.3); // 把手槽
      break;
    }
    case 'vent': {
      const at = cam.worldToScreenZ(cx, cy, 0);
      const r = 7 * g;
      s.ellipse(at, r * 1.08, r * 1.08 * Projection.groundSquash, 0, lerpColor(c, rgb(0, 0, 0), 0.35), 20.2);
      s.ellipse(at, r, r * Projection.groundSquash, 0, recess, 20.25);
      // 排风扇：三片叶子慢慢转。
      for (let k = 0; k < 3; k++) {
        const a = time * 2.4 + (k * Math.PI * 2) / 3 + t.ix;
        const tip = v2(at.x + Math.cos(a) * r * 0.85, at.y + Math.sin(a) * r * 0.85 * Projection.groundSquash);
        s.bar(at, tip, Math.max(1, r * 0.35), rgb(80, 86, 98), 20.3);
      }
      s.disc(at, Math.max(1, r * 0.22), rgb(130, 136, 148), 20.35);
      break;
    }
    case 'strip': {
      const pulse = 0.55 + 0.45 * Math.sin(time * 1.6 + t.iy * 0.7);
      plate(s, cam, X0 + 2, cy - 1.4, X1 - 2, cy + 1.4, recess, 20.2);
      plate(s, cam, X0 + 3, cy - 0.6, X1 - 3, cy + 0.6, lerpColor(rgb(40, 70, 100), GLOW, pulse), 20.3);
      const at: Vec2 = cam.worldToScreenZ(cx, cy, 0);
      s.ellipse(at, (T / 2) * g, 3 * g * Projection.groundSquash, 0, rgba(110, 200, 255, Math.round(30 * pulse)), 20.35);
      break;
    }
    default:
      break;
  }
  if (t.bolts && t.kind !== 'vent') {
    const bolt = lerpColor(c, rgb(0, 0, 0), 0.35);
    for (const [bx, by] of [[X0 + 1.8, Y0 + 1.8], [X1 - 1.8, Y0 + 1.8], [X0 + 1.8, Y1 - 1.8], [X1 - 1.8, Y1 - 1.8]]) {
      s.disc(cam.worldToScreenZ(bx, by, 0), Math.max(0.6, g * 0.6), bolt, 20.4);
    }
  }
}
