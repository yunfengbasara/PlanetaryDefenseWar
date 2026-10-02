import { v2 } from '../core/math';
import type { Camera } from '../render/camera';
import { type Rgba, lerpColor, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import type { ShapeBatch } from '../render/shapeBatch';
import { END_Y, LANE_CX, T, TOP_Y, edgeQuad, hash, plate, spanAt } from './floor';
import { type Theme, field } from './fields';

/**
 * 行星地表：沙漠、冰原、月面、虫巢。和太空平台同一套通道边界（spanAt），换一身皮。
 *
 *   通道外    大块的起伏（沙丘 / 雪堆 / 陨石坑 / 菌毯肉丘）、小纹理、零星的大件（石柱 / 冰棱 / 巨石 / 卵囊）
 *   通道边    一溜岩块（冰块 / 碎石 / 甲壳骨刺），像崖脚
 *   通道里    压实的路面：斑块、碎石、裂纹、车辙
 *   防线      一排掩体（沙袋 / 压雪的沙袋 / 金属挡板）
 *   后方      地坪，坦克、高射炮、兵营都落在上面
 *   最上面    风沙 / 落雪 / 孢子
 *
 * 四种地表是同一套画法、不同的 SurfaceStyle。没有虚空，底色就是地面；全部在地面层上画，不描边。
 */

type Blob = 'dune' | 'drift' | 'crater' | 'mound';
type Ripple = 'sand' | 'wind' | 'pit' | 'vein';
type Outcrop = 'mesa' | 'spire' | 'boulder' | 'sac';
type Barrier = 'bag' | 'snowbag' | 'plate';
type Weather = 'dust' | 'snow' | 'spore' | 'none';

interface SurfaceStyle {
  base: Rgba;
  light: Rgba;
  dark: Rgba;
  /** 小纹理的亮、暗两色。 */
  rippleHi: Rgba;
  rippleLo: Rgba;
  road: Rgba;
  /** 路面上一块块的斑。 */
  patch: Rgba;
  crack: Rgba;
  rock: Rgba;
  rockLight: Rgba;
  rockDark: Rgba;
  shadow: Rgba;
  pad: Rgba[];
  seam: Rgba;
  paint: Rgba;
  bag: Rgba;
  bagDark: Rgba;
  blob: Blob;
  ripple: Ripple;
  outcrop: Outcrop;
  barrier: Barrier;
  weather: Weather;
  tracks: boolean;
}

const STYLES: Record<Exclude<Theme, 'space' | 'starship' | 'highland'>, SurfaceStyle> = {
  desert: {
    base: rgb(214, 172, 116),
    light: rgb(234, 200, 146),
    dark: rgb(186, 140, 90),
    rippleHi: rgba(250, 222, 170, 80),
    rippleLo: rgba(150, 104, 60, 60),
    road: rgb(176, 136, 92),
    patch: rgb(196, 156, 106),
    crack: rgba(110, 72, 44, 140),
    rock: rgb(150, 98, 68),
    rockLight: rgb(190, 132, 90),
    rockDark: rgb(100, 64, 48),
    shadow: rgba(90, 50, 24, 80),
    pad: [rgb(170, 162, 146), rgb(160, 153, 138), rgb(178, 170, 154)],
    seam: rgb(118, 108, 94),
    paint: rgb(226, 170, 52),
    bag: rgb(178, 152, 104),
    bagDark: rgb(132, 108, 72),
    blob: 'dune',
    ripple: 'sand',
    outcrop: 'mesa',
    barrier: 'bag',
    weather: 'dust',
    tracks: true,
  },
  ice: {
    base: rgb(222, 232, 242),
    light: rgb(246, 250, 255),
    dark: rgb(186, 204, 224),
    rippleHi: rgba(255, 255, 255, 120),
    rippleLo: rgba(150, 176, 206, 70),
    road: rgb(176, 196, 214),
    patch: rgb(150, 196, 230),
    crack: rgba(90, 130, 170, 150),
    rock: rgb(150, 196, 226),
    rockLight: rgb(214, 238, 255),
    rockDark: rgb(92, 134, 178),
    shadow: rgba(70, 100, 150, 70),
    pad: [rgb(124, 136, 152), rgb(116, 128, 144), rgb(132, 144, 160)],
    seam: rgb(78, 88, 104),
    paint: rgb(240, 120, 60),
    bag: rgb(150, 140, 112),
    bagDark: rgb(108, 100, 80),
    blob: 'drift',
    ripple: 'wind',
    outcrop: 'spire',
    barrier: 'snowbag',
    weather: 'snow',
    tracks: true,
  },
  moon: {
    base: rgb(150, 150, 154),
    light: rgb(184, 184, 188),
    dark: rgb(112, 112, 118),
    rippleHi: rgba(196, 196, 200, 110),
    rippleLo: rgba(80, 80, 88, 110),
    road: rgb(132, 132, 138),
    patch: rgb(122, 122, 128),
    crack: rgba(70, 70, 78, 130),
    rock: rgb(128, 128, 134),
    rockLight: rgb(176, 176, 182),
    rockDark: rgb(84, 84, 92),
    shadow: rgba(20, 20, 30, 110),
    pad: [rgb(196, 198, 204), rgb(186, 188, 196), rgb(204, 206, 212)],
    seam: rgb(110, 112, 122),
    paint: rgb(80, 150, 230),
    bag: rgb(170, 172, 180),
    bagDark: rgb(110, 112, 122),
    blob: 'crater',
    ripple: 'pit',
    outcrop: 'boulder',
    barrier: 'plate',
    weather: 'none',
    tracks: true,
  },
  hive: {
    // 菌毯偏暗红褐，别和紫色的虫子糊在一起。
    base: rgb(76, 40, 44),
    light: rgb(110, 62, 62),
    dark: rgb(52, 26, 32),
    rippleHi: rgba(170, 230, 90, 110),
    rippleLo: rgba(34, 14, 20, 150),
    road: rgb(104, 80, 72),
    patch: rgb(122, 96, 84),
    crack: rgba(40, 20, 22, 160),
    rock: rgb(132, 92, 88),
    rockLight: rgb(186, 146, 132),
    rockDark: rgb(76, 46, 46),
    shadow: rgba(20, 6, 10, 110),
    pad: [rgb(92, 96, 108), rgb(84, 88, 100), rgb(100, 104, 116)],
    seam: rgb(46, 48, 58),
    paint: rgb(240, 150, 50),
    bag: rgb(120, 124, 136),
    bagDark: rgb(66, 70, 80),
    blob: 'mound',
    ripple: 'vein',
    outcrop: 'sac',
    barrier: 'plate',
    weather: 'spore',
    tracks: false,
  },
};

/** 底座从哪一行开始铺地坪（通道放宽之后）。 */
const PAD_Y = 540;

export function drawSurface(s: ShapeBatch, cam: Camera, time: number): void {
  const theme = field().theme;
  if (theme === 'space' || theme === 'starship' || theme === 'highland') return;
  const st = STYLES[theme];
  const W = cam.viewWidth;
  const H = cam.viewHeight;
  const g = cam.grain;
  const sq = Projection.groundSquash;
  s.rect(v2(W / 2, H / 2), W + 4, H + 4, 0, st.base, 0);

  const top = cam.screenToWorld(0, -60).y;
  const bottom = cam.screenToWorld(0, H + 80).y;
  const left = cam.screenToWorld(-60, 0).x;
  const right = cam.screenToWorld(W + 60, 0).x;
  /** 离通道够远（不压到路面上）。 */
  const outside = (x: number, y: number, r: number): boolean => {
    const [a, b] = spanAt(y);
    return x + r < a - 10 || x - r > b + 10;
  };

  // 小纹理：满地都有，路面会盖掉通道里那一截。
  for (let cy = Math.floor(top / 26); cy * 26 < bottom; cy++) {
    for (let cx = Math.floor(left / 46); cx * 46 < right; cx++) {
      const r = hash(cx * 3 + 1, cy * 5 + 2);
      if (r < 0.35) continue;
      const x = cx * 46 + hash(cx, cy) * 30;
      const y = cy * 26 + hash(cy, cx) * 14;
      const at = cam.worldToScreen(x, y);
      ripple(s, st, at, r, g, sq, time, cx + cy);
    }
  }

  // 大块起伏：只在通道外面。
  for (let cy = Math.floor(top / 110) - 1; cy * 110 < bottom + 110; cy++) {
    for (let cx = Math.floor(left / 150) - 1; cx * 150 < right + 150; cx++) {
      const x = cx * 150 + hash(cx + 11, cy) * 90;
      const y = cy * 110 + hash(cx, cy + 13) * 60;
      const rx = 50 + hash(cx + 3, cy + 7) * 50;
      const ry = 22 + hash(cx + 5, cy + 1) * 16;
      if (!outside(x, y, rx * 0.8)) continue;
      const at = cam.worldToScreen(x, y);
      blob(s, st, at, rx * g, ry * g * sq, 2 + at.y / 1e5, time, cx * 7 + cy);
    }
  }

  // 通道路面：压实的地面，每格一点点色差。
  for (let y = Math.floor(Math.max(TOP_Y, top) / T) * T; y < Math.min(END_Y, bottom); y += T) {
    const [a0, b0] = spanAt(y);
    const [a1, b1] = spanAt(y + T);
    edgeQuad(s, cam, a0, b0, y, a1, b1, y + T, st.road, 4);
    // 路肩：靠崖脚那一溜颜色更深（阴影）。
    edgeQuad(s, cam, a0, a0 + 14, y, a1, a1 + 14, y + T, rgba(0, 0, 0, 34), 4.1);
    edgeQuad(s, cam, b0 - 8, b0, y, b1 - 8, b1, y + T, rgba(0, 0, 0, 22), 4.1);
    for (let x = Math.ceil((a0 + 10) / T) * T; x < b0 - 10; x += T) {
      const ix = Math.round(x / T);
      const iy = Math.round(y / T);
      const r = hash(ix + 101, iy + 37);
      if (r < 0.25) {
        plate(s, cam, x + 2, y + 2, x + T - 2, y + T - 2, lerpColor(st.road, st.patch, 0.5 + r * 2), 4.2);
        // 冰面：一道斜的反光。
        if (st.blob === 'drift' && r < 0.12) {
          const c = cam.worldToScreen(x + 10, y + 10);
          s.bar(v2(c.x - 5 * g, c.y + 2 * g), v2(c.x + 5 * g, c.y - 2 * g), Math.max(1, g * 0.8), rgba(255, 255, 255, 150), 4.25);
        }
      } else if (r < 0.36) {
        // 碎石：两三颗。
        for (let k = 0; k < 3; k++) {
          const px = x + 3 + hash(ix, iy + k) * 14;
          const py = y + 3 + hash(iy, ix + k) * 14;
          const pr = (0.8 + hash(ix + k, iy) * 1.2) * g;
          const at = cam.worldToScreen(px, py);
          s.ellipse(v2(at.x, at.y + pr * 0.4), pr * 1.1, pr * 0.7, 0, st.shadow, 4.3);
          s.ellipse(at, pr, pr * 0.7, 0, lerpColor(st.rock, st.road, 0.3), 4.31);
        }
      } else if (r < 0.43 && y < 440) {
        // 裂纹。
        const c = cam.worldToScreen(x + 10, y + 10);
        const k = hash(ix, iy) * 6.28;
        for (let j = 0; j < 3; j++) {
          const a = k + j * 2.1;
          s.bar(c, v2(c.x + Math.cos(a) * 6 * g, c.y + Math.sin(a) * 6 * g * sq), Math.max(0.8, g * 0.5), st.crack, 4.3);
        }
      }
    }
  }
  // 车辙：两道深色的履带印，从后方一直压到防线前面。
  if (st.tracks) {
    for (const off of [-74, -60, 60, 74]) {
      const x = LANE_CX + off;
      const y0 = Math.max(TOP_Y, top);
      const y1 = Math.min(PAD_Y, bottom);
      if (y1 > y0) plate(s, cam, x - 2, y0, x + 2, y1, rgba(0, 0, 0, 34), 4.5);
    }
  }
  // 虫巢：路面上爬着几条发光的脉络。
  if (st.ripple === 'vein') {
    for (let y = Math.floor(Math.max(TOP_Y, top) / 60) * 60; y < Math.min(PAD_Y - 20, bottom); y += 60) {
      const [a, b] = spanAt(y);
      const x0 = a + 20 + hash(y, 3) * (b - a - 40);
      const p0 = cam.worldToScreen(x0, y);
      const p1 = cam.worldToScreen(x0 + (hash(y, 5) - 0.5) * 50, y + 50);
      const pulse = 0.5 + 0.5 * Math.sin(time * 2 + y * 0.05);
      s.bar(p0, p1, Math.max(1, g * 1.6), rgba(40, 18, 40, 150), 4.6);
      s.bar(p0, p1, Math.max(1, g * 0.7), rgba(170, 230, 90, Math.round(60 + 80 * pulse)), 4.61);
    }
  }

  // 后方地坪：40×40 一块，斜边那几块裁成梯形。
  const P = 40;
  for (let y = Math.max(PAD_Y, Math.floor(top / P) * P); y < Math.min(END_Y - 20, bottom); y += P) {
    const [a0, b0] = spanAt(y);
    const [a1, b1] = spanAt(y + P);
    edgeQuad(s, cam, a0 + 14, b0 - 14, y, a1 + 14, b1 - 14, y + P, st.seam, 5);
    for (let x = LANE_CX - field().wide; x < LANE_CX + field().wide; x += P) {
      const L0 = Math.max(x, a0 + 14);
      const R0 = Math.min(x + P, b0 - 14);
      const L1 = Math.max(x, a1 + 14);
      const R1 = Math.min(x + P, b1 - 14);
      if (R0 <= L0 + 2 || R1 <= L1 + 2) continue;
      const c = st.pad[Math.floor(hash(x, y) * st.pad.length)];
      edgeQuad(s, cam, L0 + 0.8, R0 - 0.8, y + 0.8, L1 + 0.8, R1 - 0.8, y + P - 0.8, c, 5.1);
      edgeQuad(s, cam, L0 + 0.8, R0 - 0.8, y + 0.8, L0 + 0.8, R0 - 0.8, y + 2, lerpColor(c, rgb(255, 255, 255), 0.18), 5.2);
      // 油污、积沙 / 积雪。
      const r = hash(x + 5, y + 9);
      if (r < 0.2) {
        const at = cam.worldToScreen(x + 12 + r * 60, y + 20);
        s.ellipse(at, 7 * g, 4 * g * sq, 0.4, rgba(30, 26, 22, 50), 5.3);
      } else if (r > 0.86) {
        const at = cam.worldToScreen(x + 20, y + 30);
        s.ellipse(at, 14 * g, 5 * g * sq, 0, st.base, 5.3);
      }
    }
  }
  // 地坪上的导向线。
  if (bottom > PAD_Y) {
    const [a, b] = spanAt(PAD_Y + 10);
    plate(s, cam, a + 16, PAD_Y + 4, b - 16, PAD_Y + 6, st.paint, 5.4);
    plate(s, cam, LANE_CX - 1.5, PAD_Y + 10, LANE_CX + 1.5, Math.min(END_Y - 30, PAD_Y + 140), st.paint, 5.4);
  }

  barrier(s, cam, st);

  // 崖脚：通道两边一溜岩块，大小错落。
  for (let y = Math.floor(Math.max(TOP_Y, top - 20) / 12) * 12; y < Math.min(END_Y, bottom + 20); y += 12) {
    const [a, b] = spanAt(y);
    for (const [edge, dir] of [[a, -1], [b, 1]] as const) {
      const k = hash(Math.round(y / 12), dir + 5);
      const r = 4 + k * 7;
      const x = edge + dir * (r * 0.5 + hash(Math.round(y), dir) * 4);
      const yy = y + hash(dir, Math.round(y)) * 6;
      rock(s, cam, st, x, yy, r, 8 + y / 1e4);
      // 虫巢的崖脚隔一段戳出一根骨刺。
      if (st.outcrop === 'sac' && k > 0.78) spike(s, cam, x + dir * 3, yy, 10 + k * 8, dir, 8.5 + y / 1e4);
    }
  }

  // 零星的大件：通道外。
  for (let cy = Math.floor(top / 170) - 1; cy * 170 < bottom + 170; cy++) {
    for (let cx = Math.floor(left / 190) - 1; cx * 190 < right + 190; cx++) {
      if (hash(cx + 41, cy + 17) < 0.45) continue;
      const x = cx * 190 + hash(cx, cy + 3) * 120;
      const y = cy * 170 + hash(cx + 9, cy) * 100;
      const r = 12 + hash(cx + 2, cy + 2) * 14;
      if (!outside(x, y, r * 1.6)) continue;
      const h = 18 + hash(cy, cx) * 26;
      const d = 8 + y / 1e4;
      if (st.outcrop === 'mesa') mesa(s, cam, st, x, y, r, h, d);
      else if (st.outcrop === 'spire') iceSpires(s, cam, st, x, y, r, h, d, cx * 13 + cy);
      else if (st.outcrop === 'boulder') rock(s, cam, st, x, y, r * 1.1, d);
      else sacs(s, cam, st, x, y, r, d, time, cx * 13 + cy);
    }
  }

  weather(s, st, cam, time, top, bottom, left, right);
}

// ------------------------------------------------------------------ 小纹理、大块起伏

function ripple(s: ShapeBatch, st: SurfaceStyle, at: { x: number; y: number }, r: number, g: number, sq: number, time: number, seed: number): void {
  const len = 10 + r * 14;
  switch (st.ripple) {
    case 'sand':
      s.ellipse(v2(at.x, at.y + g * 0.8), len * g, 1.6 * g * sq, -0.12, st.rippleLo, 1);
      s.ellipse(at, len * g, 1.3 * g * sq, -0.12, st.rippleHi, 1.1);
      break;
    case 'wind':
      // 冰原：被风吹出来的细长雪痕。
      s.ellipse(at, len * 1.4 * g, 0.9 * g * sq, 0.08, st.rippleHi, 1.1);
      s.ellipse(v2(at.x + 3 * g, at.y + 1.6 * g), len * g, 0.8 * g * sq, 0.08, st.rippleLo, 1);
      break;
    case 'pit': {
      // 月面：小坑，上沿暗、下沿亮（光从左上来，坑里背光的是上半边）。
      const rr = (1.6 + r * 3.4) * g;
      s.ellipse(v2(at.x, at.y + rr * 0.25), rr * 1.15, rr * 0.75 * sq, 0, st.rippleHi, 1);
      s.ellipse(at, rr, rr * 0.62 * sq, 0, st.rippleLo, 1.1);
      break;
    }
    case 'vein': {
      // 虫巢：暗色的筋络，偶尔一点荧光。
      const a = r * 6.28;
      const p1 = v2(at.x + Math.cos(a) * len * g, at.y + Math.sin(a) * len * g * sq);
      s.bar(at, p1, Math.max(1, g * 1.1), st.rippleLo, 1);
      if (r > 0.85) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 2.5 + seed);
        s.disc(p1, Math.max(1, g * 1.4), rgba(170, 230, 90, Math.round(80 + 120 * pulse)), 1.1);
      }
      break;
    }
  }
}

function blob(s: ShapeBatch, st: SurfaceStyle, at: { x: number; y: number }, rx: number, ry: number, d: number, time: number, seed: number): void {
  switch (st.blob) {
    case 'dune':
    case 'drift':
    case 'mound':
      s.ellipse(v2(at.x + rx * 0.12, at.y + ry * 0.35), rx, ry, 0, st.dark, d);
      s.ellipse(v2(at.x, at.y), rx * 0.92, ry * 0.85, 0, lerpColor(st.base, st.light, 0.35), d + 0.001);
      s.ellipse(v2(at.x - rx * 0.2, at.y - ry * 0.3), rx * 0.5, ry * 0.36, 0, st.light, d + 0.002);
      // 肉丘顶上开一个会喘气的孔。
      if (st.blob === 'mound' && hash(seed, 9) < 0.5) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 1.8 + seed);
        s.ellipse(v2(at.x + rx * 0.1, at.y), rx * 0.18 * (0.8 + 0.2 * pulse), ry * 0.2, 0, rgb(40, 14, 36), d + 0.003);
        s.ellipse(v2(at.x + rx * 0.1, at.y), rx * 0.1, ry * 0.1, 0, rgba(170, 230, 90, Math.round(90 + 110 * pulse)), d + 0.004);
      }
      break;
    case 'crater': {
      // 陨石坑：外圈隆起的坑沿（亮）、坑里（暗，上半边背光更暗）、坑底。
      s.ellipse(v2(at.x, at.y + ry * 0.12), rx * 1.08, ry * 1.1, 0, st.light, d);
      s.ellipse(at, rx * 0.92, ry * 0.9, 0, st.dark, d + 0.001);
      s.ellipse(v2(at.x + rx * 0.06, at.y + ry * 0.16), rx * 0.8, ry * 0.72, 0, lerpColor(st.dark, st.base, 0.55), d + 0.002);
      s.ellipse(v2(at.x + rx * 0.2, at.y + ry * 0.3), rx * 0.42, ry * 0.3, 0, lerpColor(st.base, st.light, 0.3), d + 0.003);
      break;
    }
  }
}

// ------------------------------------------------------------------ 防线掩体

function barrier(s: ShapeBatch, cam: Camera, st: SurfaceStyle): void {
  const g = cam.grain;
  const [a, b] = spanAt(448);
  if (st.barrier === 'plate') {
    // 金属挡板：一块块立着的板，顶面亮一档，正面暗，之间留缝。
    for (let x = a + 14; x + 14 < b - 12; x += 16) {
      const p0 = cam.worldToScreenZ(x, 448, 0);
      const p1 = cam.worldToScreenZ(x + 14, 448, 0);
      const q0 = cam.worldToScreenZ(x, 448, 5);
      const q1 = cam.worldToScreenZ(x + 14, 448, 5);
      s.quad(p0, p1, q1, q0, st.bagDark, 30);
      const r0 = cam.worldToScreenZ(x, 445, 5);
      const r1 = cam.worldToScreenZ(x + 14, 445, 5);
      s.quad(r0, r1, q1, q0, st.bag, 30.01);
      s.bar(v2(q0.x + g, q0.y + g * 1.5), v2(q1.x - g, q1.y + g * 1.5), Math.max(1, g * 0.6), st.paint, 30.02);
    }
    return;
  }
  // 沙袋：两层错开。冰原的沙袋顶上压一层雪。
  for (let layer = 0; layer < 2; layer++) {
    for (let x = a + 14 + layer * 4.5; x < b - 14; x += 9) {
      const at = cam.worldToScreenZ(x, 448, layer * 2.6);
      s.ellipse(v2(at.x, at.y + g * 1.2), 4.8 * g, 2.4 * g, 0, st.bagDark, 30 + layer);
      s.ellipse(at, 4.6 * g, 2.2 * g, 0, st.bag, 30.01 + layer);
      const cap = st.barrier === 'snowbag' && layer === 1 ? rgb(244, 248, 255) : lerpColor(st.bag, rgb(255, 240, 200), 0.3);
      s.ellipse(v2(at.x - g * 0.5, at.y - g * 0.9), (st.barrier === 'snowbag' && layer === 1 ? 3.8 : 2.4) * g, 1.1 * g, 0, cap, 30.02 + layer);
    }
  }
}

// ------------------------------------------------------------------ 岩块、大件

/** 一块岩石：地上一圈影子、暗底、本体、左上角高光。 */
function rock(s: ShapeBatch, cam: Camera, st: SurfaceStyle, x: number, y: number, r: number, d: number): void {
  const g = cam.grain;
  const sq = Projection.groundSquash;
  const base = cam.worldToScreenZ(x, y, 0);
  s.ellipse(v2(base.x + r * 0.35 * g, base.y + r * 0.2 * g), r * 1.15 * g, r * 0.7 * g * sq, 0, st.shadow, d);
  s.ellipse(base, r * g, r * 0.72 * g * sq, 0, st.rockDark, d + 0.001);
  const mid = cam.worldToScreenZ(x, y, r * 0.45);
  s.ellipse(mid, r * 0.88 * g, r * 0.66 * g, 0, st.rock, d + 0.002);
  const hi = cam.worldToScreenZ(x - r * 0.25, y - r * 0.15, r * 0.7);
  s.ellipse(hi, r * 0.48 * g, r * 0.32 * g, -0.3, st.rockLight, d + 0.003);
}

/** 风蚀石柱：一摞越往上越小的岩层，顶上一块亮面，地上拖一道影子。 */
function mesa(s: ShapeBatch, cam: Camera, st: SurfaceStyle, x: number, y: number, r: number, h: number, d: number): void {
  const g = cam.grain;
  const sq = Projection.groundSquash;
  const foot = cam.worldToScreenZ(x, y, 0);
  s.ellipse(v2(foot.x + r * 0.9 * g, foot.y + r * 0.25 * g), r * 1.6 * g, r * 0.6 * g * sq, 0, st.shadow, d);
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const z = (h * i) / layers;
    const rr = r * (1 - i * 0.08);
    const at = cam.worldToScreenZ(x, y, z);
    const top = cam.worldToScreenZ(x, y, z + h / layers);
    const band: Rgba = i % 2 === 0 ? st.rockDark : lerpColor(st.rockDark, st.rock, 0.5);
    s.rect(v2(at.x, (at.y + top.y) / 2), rr * 2 * g, at.y - top.y, 0, band, d + i * 0.01);
    s.ellipse(at, rr * g, rr * 0.6 * g * sq, 0, band, d + i * 0.01 + 0.001);
  }
  const cap = cam.worldToScreenZ(x, y, h);
  s.ellipse(cap, r * 0.76 * g, r * 0.76 * 0.6 * g * sq, 0, st.rock, d + 0.1);
  s.ellipse(v2(cap.x - r * 0.15 * g, cap.y - r * 0.08 * g), r * 0.5 * g, r * 0.3 * g * sq, 0, st.rockLight, d + 0.11);
}

/** 冰棱：一簇斜插在雪里的冰晶，左面亮、右面暗，脚下一圈雪。 */
function iceSpires(s: ShapeBatch, cam: Camera, st: SurfaceStyle, x: number, y: number, r: number, h: number, d: number, seed: number): void {
  const g = cam.grain;
  const sq = Projection.groundSquash;
  const foot = cam.worldToScreenZ(x, y, 0);
  s.ellipse(v2(foot.x + r * 0.8 * g, foot.y + r * 0.3 * g), r * 1.5 * g, r * 0.55 * g * sq, 0, st.shadow, d);
  const n = 3 + Math.floor(hash(seed, 1) * 3);
  for (let i = 0; i < n; i++) {
    const ox = (hash(seed, i + 2) - 0.5) * r * 1.4;
    const oy = (hash(seed + 1, i) - 0.5) * r * 0.6;
    const hh = h * (0.5 + hash(seed + 2, i) * 0.8);
    const w = r * (0.22 + hash(seed + 3, i) * 0.18);
    const lean = (hash(seed + 4, i) - 0.5) * hh * 0.5;
    const b0 = cam.worldToScreenZ(x + ox - w, y + oy, 0);
    const b1 = cam.worldToScreenZ(x + ox + w, y + oy, 0);
    const bm = cam.worldToScreenZ(x + ox, y + oy + w * 0.4, 0);
    const tip = cam.worldToScreenZ(x + ox + lean, y + oy, hh);
    const dd = d + 0.01 + (oy + r) * 0.001;
    s.quad(b0, bm, tip, tip, st.rockLight, dd);
    s.quad(bm, b1, tip, tip, st.rock, dd + 0.0001);
    s.bar(b0, tip, Math.max(1, g * 0.5), rgba(255, 255, 255, 170), dd + 0.0002);
  }
  s.ellipse(foot, r * 1.1 * g, r * 0.45 * g * sq, 0, st.light, d + 0.5);
}

/** 卵囊：一簇半透明的囊，里面一点荧光在跳。 */
function sacs(s: ShapeBatch, cam: Camera, st: SurfaceStyle, x: number, y: number, r: number, d: number, time: number, seed: number): void {
  const g = cam.grain;
  const sq = Projection.groundSquash;
  const foot = cam.worldToScreenZ(x, y, 0);
  s.ellipse(v2(foot.x + r * 0.4 * g, foot.y + r * 0.2 * g), r * 1.5 * g, r * 0.7 * g * sq, 0, st.shadow, d);
  s.ellipse(foot, r * 1.3 * g, r * 0.62 * g * sq, 0, st.dark, d + 0.001);
  const n = 3 + Math.floor(hash(seed, 1) * 3);
  for (let i = 0; i < n; i++) {
    const ox = (hash(seed, i + 2) - 0.5) * r * 1.4;
    const oy = (hash(seed + 1, i) - 0.5) * r * 0.5;
    const rr = r * (0.32 + hash(seed + 2, i) * 0.25);
    const at = cam.worldToScreenZ(x + ox, y + oy, rr * 0.8);
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2 + seed + i * 1.7);
    const dd = d + 0.01 + (oy + r) * 0.001;
    s.ellipse(at, rr * g, rr * 1.1 * g, 0, st.rockDark, dd);
    s.ellipse(v2(at.x, at.y + rr * 0.1 * g), rr * 0.82 * g, rr * 0.92 * g, 0, st.rock, dd + 0.0001);
    s.ellipse(v2(at.x, at.y + rr * 0.15 * g), rr * 0.42 * g, rr * 0.5 * g, 0, rgba(170, 230, 90, Math.round(110 + 120 * pulse)), dd + 0.0002);
    s.ellipse(v2(at.x - rr * 0.35 * g, at.y - rr * 0.45 * g), rr * 0.26 * g, rr * 0.16 * g, -0.5, st.rockLight, dd + 0.0003);
  }
}

/** 骨刺：从崖脚斜着往外戳的一根，弯向外侧。 */
function spike(s: ShapeBatch, cam: Camera, x: number, y: number, h: number, dir: number, d: number): void {
  const g = cam.grain;
  const a = cam.worldToScreenZ(x, y, 0);
  const m = cam.worldToScreenZ(x + dir * h * 0.25, y, h * 0.6);
  const t = cam.worldToScreenZ(x + dir * h * 0.6, y, h);
  s.bar(a, m, Math.max(1.5, g * 2.6), rgb(210, 196, 170), d);
  s.bar(m, t, Math.max(1, g * 1.4), rgb(232, 222, 200), d + 0.001);
}

// ------------------------------------------------------------------ 天气

function weather(s: ShapeBatch, st: SurfaceStyle, cam: Camera, time: number, top: number, bottom: number, left: number, right: number): void {
  const g = cam.grain;
  const spanX = right - left + 200;
  const spanY = bottom - top + 100;
  switch (st.weather) {
    case 'dust':
      // 风沙：几缕淡淡的沙带随风往右飘。
      for (let i = 0; i < 18; i++) {
        const y = top + hash(i, 77) * (bottom - top);
        const x = left - 100 + ((hash(i, 78) * spanX + time * (40 + hash(i, 79) * 30)) % spanX);
        s.ellipse(cam.worldToScreen(x, y), (20 + hash(i, 80) * 30) * g, 1.2 * g, 0, rgba(250, 226, 180, 46), 40);
      }
      break;
    case 'snow':
      // 落雪：斜着往右下飘。
      for (let i = 0; i < 160; i++) {
        const sp = 20 + hash(i, 81) * 25;
        const x = left - 100 + ((hash(i, 82) * spanX + time * sp * 0.6) % spanX);
        const y = top - 50 + ((hash(i, 83) * spanY + time * sp) % spanY);
        const sway = Math.sin(time * 1.3 + i) * 3;
        s.disc(cam.worldToScreen(x + sway, y), Math.max(0.7, (0.5 + hash(i, 84)) * g * 0.7), rgba(255, 255, 255, 200), 40);
      }
      break;
    case 'spore':
      // 孢子：慢慢往上飘的荧光点，一明一暗。
      for (let i = 0; i < 60; i++) {
        const x = left + hash(i, 85) * (right - left) + Math.sin(time * 0.7 + i) * 8;
        const y = bottom + 50 - ((hash(i, 86) * spanY + time * (6 + hash(i, 87) * 8)) % spanY);
        const pulse = 0.5 + 0.5 * Math.sin(time * 2 + i * 1.3);
        const at = cam.worldToScreen(x, y);
        s.disc(at, Math.max(1, g * 1.6), rgba(170, 230, 90, Math.round(30 * pulse)), 40);
        s.disc(at, Math.max(0.7, g * 0.6), rgba(210, 255, 150, Math.round(120 + 100 * pulse)), 40.01);
      }
      break;
    case 'none':
      break;
  }
}
