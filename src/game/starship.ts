import { type Vec2, v2 } from '../core/math';
import type { Camera } from '../render/camera';
import { type Rgba, lerpColor, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import type { ShapeBatch } from '../render/shapeBatch';
import { CORE, END_Y, LANE_CX, T, TOP_Y, edgeQuad, hash, plate, spanAt } from './floor';
import { field } from './fields';

/**
 * 星舰甲板：一艘巨舰的背脊，船头朝上（虫群从船头方向压过来），全速往前飞。
 *
 *   甲板      顺着航向排的长条装甲板，每列接缝错开；排气格栅、检修舱盖、铆钉带、小传感球
 *   中轴      一条凹下去的能量导管，从船头通到水晶核心，青色光脉冲一节节往船尾流
 *   横梁      隔一段一道微微隆起的结构肋，带灯
 *   护栏      通道两边一道矮护栏，栏上的灯从船头往船尾依次追着亮
 *   船舷      护栏外面是几层往下弯的船壳，最外沿挂航行灯（左舷红、右舷绿）
 *   引擎      后部两侧各一个引擎舱，尾部喷着闪烁的尾焰
 *   涂装      船头箭头、巨大的舷号、防线前的红白警示线、停机坪上围着核心的引导环
 *   速度感    船外拉成长线、高速往后掠的星光；甲板上掠过的气流线
 *
 * 不复用金属平台和行星地表的任何画法。全部在地面层上画，不描边。
 */

/** 通道外还有多宽的船舷（往下弯的那几层）。 */
export const HULL_SIDE = 90;

const VOID = rgb(4, 6, 14);
const SEAM = rgb(20, 24, 34);
const PLATES = [rgb(78, 86, 104), rgb(70, 78, 96), rgb(86, 94, 112), rgb(74, 80, 98)];
const HANGAR = [rgb(60, 66, 80), rgb(56, 62, 76), rgb(64, 70, 84)];
const HULL_BANDS = [rgb(62, 68, 86), rgb(46, 52, 68), rgb(32, 36, 50)];
const RAIL = rgb(120, 128, 146);
const CYAN = rgb(110, 220, 255);
const AMBER = rgb(255, 170, 60);
const PAINT = rgba(226, 232, 240, 120);
const RED = rgb(220, 60, 60);

/** 甲板板材：一列宽 COL，每块长度不一。 */
const COL = 40;
/** 横向结构肋所在的 y。 */
const RIBS = [130, 290, 590, 850];
/** 船舷从通道边往外，每一层的外沿（离通道边多远）和下沉多少。 */
const SIDE_STEPS: [number, number][] = [
  [0, 0],
  [26, -6],
  [56, -18],
  [HULL_SIDE, -36],
];
/** 后部停机坪从哪一行开始。 */
const HANGAR_Y = 540;

type PlateKind = 'plain' | 'vent' | 'hatch' | 'bolts' | 'sensor';
interface Plate {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  color: Rgba;
  kind: PlateKind;
}

const plateCache = new Map<string, Plate[]>();

/** 排板：通道里每一列从船头往船尾一块接一块，长度 60~140；列与列之间起点错开，接缝不对齐。 */
function buildPlates(): Plate[] {
  const wide = field().wide;
  const out: Plate[] = [];
  const cols = Math.ceil(wide / COL);
  for (let k = -cols; k < cols; k++) {
    const x0 = LANE_CX + k * COL;
    let y = TOP_Y - Math.floor(hash(k, 3) * 4) * T;
    let j = 0;
    while (y < HANGAR_Y) {
      const len = Math.min(60 + Math.floor(hash(k + 40, j) * 5) * T, HANGAR_Y - y);
      const r = hash(k * 7 + 3, j * 11 + 5);
      const kind: PlateKind = r < 0.6 ? 'plain' : r < 0.72 ? 'bolts' : r < 0.82 ? 'vent' : r < 0.91 ? 'hatch' : 'sensor';
      out.push({ x0, x1: x0 + COL, y0: y, y1: y + len, color: PLATES[Math.floor(hash(j, k + 9) * PLATES.length)], kind });
      y += len;
      j++;
    }
  }
  return out;
}

export function drawStarship(s: ShapeBatch, cam: Camera, time: number): void {
  let plates = plateCache.get(field().id);
  if (!plates) {
    plates = buildPlates();
    plateCache.set(field().id, plates);
  }
  const W = cam.viewWidth;
  const H = cam.viewHeight;
  const top = cam.screenToWorld(0, -60).y;
  const bottom = cam.screenToWorld(0, H + 80).y;

  s.rect(v2(W / 2, H / 2), W + 4, H + 4, 0, VOID, 0);
  drawStarStreaks(s, cam, time);

  const y0 = Math.max(TOP_Y - T, Math.floor(top / T) * T);
  const y1 = Math.min(END_Y, bottom);
  drawHullSides(s, cam, time, y0, y1);
  drawNacelles(s, cam, time);

  // 甲板底色（接缝色）：板材往里缩一点，缝就露出来。
  for (let y = y0; y < y1; y += T) {
    const [a0, b0] = spanAt(y);
    const [a1, b1] = spanAt(y + T);
    edgeQuad(s, cam, a0, b0, y, a1, b1, y + T, SEAM, 10);
  }
  for (const p of plates) {
    if (p.y1 < top || p.y0 > bottom) continue;
    drawPlate(s, cam, p, time);
  }
  drawHangar(s, cam, time, top, bottom);
  drawPaint(s, cam);
  drawConduit(s, cam, time, top, bottom);
  for (const ry of RIBS) if (ry > top - 10 && ry < bottom + 10) drawRib(s, cam, ry, time);
  drawRails(s, cam, time, y0, y1);
  drawSpeedLines(s, cam, time, top, bottom);
}

// ------------------------------------------------------------------ 船外

/** 星光被拉成长线、往船尾（画面下方）掠过去：越近越快、越长、越亮。屏幕空间。 */
function drawStarStreaks(s: ShapeBatch, cam: Camera, time: number): void {
  const W = cam.viewWidth;
  const H = cam.viewHeight;
  const o = cam.worldToScreen(0, 0);
  for (let i = 0; i < 150; i++) {
    const near = hash(i, 51);
    const speed = 120 + near * near * 900;
    const len = 2 + near * near * 46;
    const span = H + len + 20;
    const x = (((hash(i, 52) * (W + 200) + o.x * (0.05 + near * 0.15)) % (W + 200)) + W + 200) % (W + 200) - 100;
    const y = ((hash(i, 53) * span + time * speed) % span) - len - 10;
    const c = hash(i, 54) < 0.25 ? rgb(170, 200, 255) : hash(i, 54) < 0.35 ? rgb(255, 220, 190) : rgb(230, 236, 255);
    const a = Math.round(60 + near * 170);
    s.bar(v2(x, y), v2(x, y + len), Math.max(1, near * 1.6), rgba(c.r, c.g, c.b, a), 1 + near * 0.5);
  }
}

/**
 * 船舷：通道边往外几层船壳，一层比一层低、一层比一层暗，读出"往下弯"。每 40 一道横缝；
 * 最外沿隔一段一盏航行灯，左舷红、右舷绿，一闪一闪。
 */
function drawHullSides(s: ShapeBatch, cam: Camera, time: number, y0: number, y1: number): void {
  const g = cam.grain;
  for (let y = y0; y < y1; y += T) {
    const [a0, b0] = spanAt(y);
    const [a1, b1] = spanAt(y + T);
    for (const side of [-1, 1]) {
      const e0 = side < 0 ? a0 : b0;
      const e1 = side < 0 ? a1 : b1;
      for (let i = 0; i + 1 < SIDE_STEPS.length; i++) {
        const [d0, z0] = SIDE_STEPS[i];
        const [d1, z1] = SIDE_STEPS[i + 1];
        s.quad(
          cam.worldToScreenZ(e0 + side * d0, y, z0),
          cam.worldToScreenZ(e0 + side * d1, y, z1),
          cam.worldToScreenZ(e1 + side * d1, y + T, z1),
          cam.worldToScreenZ(e1 + side * d0, y + T, z0),
          HULL_BANDS[i],
          5 + i * 0.01,
        );
        // 横缝。
        if (Math.round(y / T) % 2 === 0) {
          s.bar(cam.worldToScreenZ(e0 + side * d0, y, z0), cam.worldToScreenZ(e0 + side * d1, y, z1), Math.max(1, g * 0.5), rgba(10, 12, 20, 120), 5.05 + i * 0.01);
        }
      }
      // 外沿的航行灯。
      const k = Math.round(y / T);
      if (k % 4 === 0 && e0 === e1) {
        const [dd, zz] = SIDE_STEPS[SIDE_STEPS.length - 1];
        const at = cam.worldToScreenZ(e0 + side * (dd - 3), y + T / 2, zz + 1);
        const on = Math.sin(time * 3 + k * 0.7) > 0.2;
        const c = side < 0 ? RED : rgb(70, 220, 110);
        if (on) s.ellipse(at, g * 6, g * 6 * Projection.groundSquash, 0, rgba(c.r, c.g, c.b, 50), 5.3);
        s.rect(at, Math.max(1.5, g * 2), Math.max(1.5, g * 2), 0, on ? c : lerpColor(c, rgb(0, 0, 0), 0.6), 5.31);
      }
    }
  }
}

/**
 * 引擎舱：后部两侧各一根粗圆筒，半埋在船舷上。圆筒按上半圈分几条色带画出明暗；
 * 舱身几道深色加强箍；船尾那一端是喷口，往后喷闪烁的尾焰。
 */
function drawNacelles(s: ShapeBatch, cam: Camera, time: number): void {
  const wide = field().wide;
  const r = 24;
  const zc = 6;
  const ny0 = 600;
  const ny1 = 872;
  for (const side of [-1, 1]) {
    const nx = LANE_CX + side * (wide + 54);
    // 地上的影子（光从左上来，影子落在右下）。
    edgeQuad(s, cam, nx - r + 10, nx + r + 14, ny0 + 8, nx - r + 10, nx + r + 14, ny1 + 8, rgba(0, 0, 0, 70), 11.5, -20);
    const strips = 8;
    for (let i = 0; i < strips; i++) {
      const t0 = Math.PI - (i / strips) * Math.PI;
      const t1 = Math.PI - ((i + 1) / strips) * Math.PI;
      const nxm = Math.cos((t0 + t1) / 2);
      const nzm = Math.sin((t0 + t1) / 2);
      // 法线和左上方来的光求亮度，分四档。
      const lit = -nxm * 0.55 + nzm * 0.8;
      const base = rgb(96, 104, 124);
      const c = lit > 0.75 ? lerpColor(base, rgb(230, 236, 250), 0.35) : lit > 0.35 ? base : lit > 0 ? lerpColor(base, rgb(20, 24, 36), 0.35) : lerpColor(base, rgb(20, 24, 36), 0.6);
      const xa = nx + Math.cos(t0) * r;
      const za = zc + Math.sin(t0) * r;
      const xb = nx + Math.cos(t1) * r;
      const zb = zc + Math.sin(t1) * r;
      s.quad(cam.worldToScreenZ(xa, ny0, za), cam.worldToScreenZ(xb, ny0, zb), cam.worldToScreenZ(xb, ny1, zb), cam.worldToScreenZ(xa, ny1, za), c, 12 + i * 0.001);
      // 加强箍：几道深色的环。
      for (const ry of [640, 700, 760, 820]) {
        s.quad(cam.worldToScreenZ(xa, ry, za), cam.worldToScreenZ(xb, ry, zb), cam.worldToScreenZ(xb, ry + 6, zb), cam.worldToScreenZ(xa, ry + 6, za), lerpColor(c, rgb(10, 12, 20), 0.45), 12.1 + i * 0.001);
      }
    }
    // 舱背上一条蓝色涂装、一排灯。
    s.quad(cam.worldToScreenZ(nx - 4, ny0 + 10, zc + r), cam.worldToScreenZ(nx + 4, ny0 + 10, zc + r), cam.worldToScreenZ(nx + 4, ny1 - 10, zc + r), cam.worldToScreenZ(nx - 4, ny1 - 10, zc + r), rgb(52, 88, 168), 12.2);
    // 喷口：船尾端面朝镜头，一圈深色外环、里面发亮。
    const ring = (rad: number, z0: number): Vec2[] =>
      Array.from({ length: 12 }, (_, i) => cam.worldToScreenZ(nx + Math.cos((i / 12) * Math.PI * 2) * rad, ny1, z0 + Math.sin((i / 12) * Math.PI * 2) * rad));
    const fan = (pts: Vec2[], c: Rgba, d: number): void => {
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      for (let i = 0; i < pts.length; i++) s.quad(v2(cx, cy), pts[i], pts[(i + 1) % pts.length], pts[(i + 1) % pts.length], c, d);
    };
    fan(ring(r, zc), rgb(40, 44, 58), 12.3);
    fan(ring(r * 0.72, zc), rgb(20, 22, 32), 12.31);
    const flick = 0.75 + 0.25 * Math.sin(time * 37 + side * 5) * Math.sin(time * 23);
    fan(ring(r * 0.55 * flick, zc), rgb(150, 230, 255), 12.32);
    fan(ring(r * 0.3 * flick, zc), rgb(240, 252, 255), 12.33);
    // 尾焰：往船尾拖出去的一串光团，越远越小越淡。
    for (let k = 0; k < 9; k++) {
      const u = k / 8;
      const wob = Math.sin(time * 30 + k * 1.7 + side) * 1.5;
      const at = cam.worldToScreenZ(nx + wob, ny1 + 6 + u * 90 * flick, zc);
      const rad = r * (0.6 - u * 0.45) * cam.grain;
      const c = lerpColor(rgb(220, 248, 255), rgb(60, 120, 255), u);
      s.ellipse(at, rad, rad * 0.8, 0, rgba(c.r, c.g, c.b, Math.round(200 * (1 - u) + 30)), 12.4 + k * 0.001);
    }
  }
}

// ------------------------------------------------------------------ 甲板

/** 一块装甲板：按通道边界逐行裁剪；左、上沿亮一档，右、下沿暗一档；再按种类加细节。 */
function drawPlate(s: ShapeBatch, cam: Camera, p: Plate, time: number): void {
  const g = cam.grain;
  const c = p.color;
  const lite = lerpColor(c, rgb(255, 255, 255), 0.16);
  const dark = lerpColor(c, rgb(0, 0, 0), 0.3);
  let full = true;
  for (let y = p.y0; y < p.y1; y += T) {
    const yb = Math.min(p.y1, y + T);
    const [a0, b0] = spanAt(y);
    const [a1, b1] = spanAt(yb);
    const L0 = Math.max(p.x0 + 0.7, a0);
    const R0 = Math.min(p.x1 - 0.7, b0);
    const L1 = Math.max(p.x0 + 0.7, a1);
    const R1 = Math.min(p.x1 - 0.7, b1);
    if (R0 <= L0 + 1 && R1 <= L1 + 1) {
      full = false;
      continue;
    }
    if (L0 !== p.x0 + 0.7 || R0 !== p.x1 - 0.7 || L1 !== p.x0 + 0.7 || R1 !== p.x1 - 0.7) full = false;
    const top = y === p.y0 ? y + 0.7 : y;
    const bot = yb === p.y1 ? yb - 0.7 : yb;
    edgeQuad(s, cam, L0, R0, top, L1, R1, bot, c, 20);
  }
  if (!full) return; // 被通道边裁过的那几块只铺底色，不画细节。
  const X0 = p.x0 + 0.7;
  const X1 = p.x1 - 0.7;
  const Y0 = p.y0 + 0.7;
  const Y1 = p.y1 - 0.7;
  plate(s, cam, X0, Y0, X1, Y0 + 1, lite, 20.1);
  plate(s, cam, X0, Y0, X0 + 0.8, Y1, lite, 20.1);
  plate(s, cam, X0, Y1 - 1, X1, Y1, dark, 20.1);
  plate(s, cam, X1 - 0.8, Y0, X1, Y1, dark, 20.1);
  const cx = (X0 + X1) / 2;
  const cy = (Y0 + Y1) / 2;
  const recess = rgb(26, 30, 42);
  switch (p.kind) {
    case 'bolts':
      for (let y = Y0 + 4; y < Y1 - 2; y += 6) {
        for (const x of [X0 + 2.5, X1 - 2.5]) s.disc(cam.worldToScreen(x, y), Math.max(0.6, g * 0.6), dark, 20.2);
      }
      break;
    case 'vent': {
      // 排气格栅：一组横槽，下沿一道亮边。
      const n = Math.min(6, Math.floor((Y1 - Y0 - 10) / 5));
      const vy0 = cy - (n * 5) / 2;
      for (let i = 0; i < n; i++) {
        const y = vy0 + i * 5;
        plate(s, cam, X0 + 6, y, X1 - 6, y + 2.4, recess, 20.2);
        plate(s, cam, X0 + 6, y + 2.4, X1 - 6, y + 3, lite, 20.21);
      }
      break;
    }
    case 'hatch': {
      // 检修舱盖：内缩一圈、四角警示色、中间一个把手槽。
      plate(s, cam, X0 + 5, Y0 + 6, X1 - 5, Y1 - 6, lerpColor(c, rgb(0, 0, 0), 0.12), 20.2);
      for (const [hx, hy] of [[X0 + 5, Y0 + 6], [X1 - 9, Y0 + 6], [X0 + 5, Y1 - 10], [X1 - 9, Y1 - 10]]) plate(s, cam, hx, hy, hx + 4, hy + 4, AMBER, 20.25);
      plate(s, cam, cx - 5, cy - 1, cx + 5, cy + 1, recess, 20.3);
      break;
    }
    case 'sensor': {
      // 传感球：一圈底座、半球、一点会闪的红灯。
      const at = cam.worldToScreen(cx, cy);
      const r = 5 * g;
      s.ellipse(at, r * 1.3, r * 1.3 * Projection.groundSquash, 0, recess, 20.2);
      s.ellipse(v2(at.x, at.y - r * 0.4), r, r * 0.9, 0, rgb(120, 130, 150), 20.21);
      s.ellipse(v2(at.x - r * 0.3, at.y - r * 0.7), r * 0.4, r * 0.3, 0, rgb(200, 210, 230), 20.22);
      if (Math.sin(time * 4 + cx) > 0.6) s.disc(v2(at.x, at.y - r * 1.2), Math.max(1, g * 0.8), RED, 20.23);
      break;
    }
    default:
      break;
  }
}

/** 后部停机坪：深一档的方板、警示边、地上围着核心的一圈引导环和四个指向核心的箭头。 */
function drawHangar(s: ShapeBatch, cam: Camera, time: number, top: number, bottom: number): void {
  const g = cam.grain;
  const P = 40;
  for (let y = HANGAR_Y; y < Math.min(END_Y, bottom); y += P) {
    if (y + P < top) continue;
    for (let x = LANE_CX - field().wide; x < LANE_CX + field().wide; x += P) {
      const [a0, b0] = spanAt(y);
      const [a1, b1] = spanAt(Math.min(END_Y, y + P));
      const L0 = Math.max(x + 0.8, a0);
      const R0 = Math.min(x + P - 0.8, b0);
      const L1 = Math.max(x + 0.8, a1);
      const R1 = Math.min(x + P - 0.8, b1);
      if (R0 <= L0 + 1 || R1 <= L1 + 1) continue;
      const c = HANGAR[Math.floor(hash(x, y) * HANGAR.length)];
      edgeQuad(s, cam, L0, R0, y + 0.8, L1, R1, Math.min(END_Y, y + P) - 0.8, c, 20);
      edgeQuad(s, cam, L0, R0, y + 0.8, L0, R0, y + 1.8, lerpColor(c, rgb(255, 255, 255), 0.14), 20.1);
      // 方板四角的小黄标。
      if (L0 === x + 0.8 && R0 === x + P - 0.8) {
        for (const [hx, hy] of [[x + 3, y + 3], [x + P - 6, y + 3]]) plate(s, cam, hx, hy, hx + 3, hy + 1, AMBER, 20.2);
      }
    }
  }
  // 停机坪前沿一道黄黑警示带。
  if (top < HANGAR_Y + 10 && bottom > HANGAR_Y - 10) {
    const [a, b] = spanAt(HANGAR_Y);
    for (let x = a; x < b; x += 8) {
      plate(s, cam, x, HANGAR_Y - 2, Math.min(b, x + 4), HANGAR_Y + 2, AMBER, 20.5);
      plate(s, cam, x + 4, HANGAR_Y - 2, Math.min(b, x + 8), HANGAR_Y + 2, rgb(24, 26, 32), 20.5);
    }
  }
  // 核心引导环：两圈漆环，环上一圈慢慢转的刻度。
  if (bottom > CORE.y - 60 && top < CORE.y + 60) {
    const at = cam.worldToScreen(CORE.x, CORE.y);
    const sq = Projection.groundSquash;
    s.ellipse(at, 44 * g, 44 * g * sq, 0, rgba(110, 220, 255, 70), 20.6);
    s.ellipse(at, 41 * g, 41 * g * sq, 0, HANGAR[0], 20.61);
    s.ellipse(at, 30 * g, 30 * g * sq, 0, rgba(110, 220, 255, 40), 20.62);
    s.ellipse(at, 28.5 * g, 28.5 * g * sq, 0, HANGAR[1], 20.63);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + time * 0.3;
      const p0 = v2(at.x + Math.cos(a) * 34 * g, at.y + Math.sin(a) * 34 * g * sq);
      const p1 = v2(at.x + Math.cos(a) * 38 * g, at.y + Math.sin(a) * 38 * g * sq);
      s.bar(p0, p1, Math.max(1, g * 1.2), rgba(110, 220, 255, 150), 20.64);
    }
  }
}

/** 甲板涂装：船头的航向箭头、巨大的舷号「07」、防线前的红白警示线。漆面有磨损（随机缺块）。 */
function drawPaint(s: ShapeBatch, cam: Camera): void {
  // 航向箭头：一排人字形，指向船头。
  for (const ay of [40, 70]) {
    for (const dx of [-60, 60]) {
      const x = LANE_CX + dx;
      s.quad(cam.worldToScreen(x - 14, ay + 10), cam.worldToScreen(x, ay), cam.worldToScreen(x, ay + 5), cam.worldToScreen(x - 14, ay + 15), PAINT, 21);
      s.quad(cam.worldToScreen(x, ay), cam.worldToScreen(x + 14, ay + 10), cam.worldToScreen(x + 14, ay + 15), cam.worldToScreen(x, ay + 5), PAINT, 21);
    }
  }
  // 舷号「07」：一个点 7 个单位见方，磨掉的点不画。
  const DIGITS: Record<string, string[]> = {
    '0': ['111', '101', '101', '101', '111'],
    '7': ['111', '001', '010', '010', '010'],
  };
  const cell = 7;
  const nx0 = LANE_CX - 150;
  const ny0 = 190;
  ['0', '7'].forEach((ch, i) => {
    DIGITS[ch].forEach((row, r) => {
      for (let c = 0; c < 3; c++) {
        if (row[c] !== '1') continue;
        const x = nx0 + (i * 4 + c) * cell;
        const y = ny0 + r * cell;
        if (hash(x, y) < 0.12) continue;
        plate(s, cam, x + 0.5, y + 0.5, x + cell - 0.5, y + cell - 0.5, PAINT, 21);
      }
    });
  });
  // 防线前的红白警示线。
  const [a, b] = spanAt(448);
  for (let x = a + 6, i = 0; x < b - 6; x += 10, i++) {
    plate(s, cam, x, 445, Math.min(b - 6, x + 10), 450, i % 2 === 0 ? rgba(220, 60, 60, 210) : rgba(236, 236, 240, 200), 21);
  }
}

/** 中轴能量导管：一道凹槽从船头通到核心，槽底一条暗青光，一节节亮的脉冲往船尾（核心）流。 */
function drawConduit(s: ShapeBatch, cam: Camera, time: number, top: number, bottom: number): void {
  const g = cam.grain;
  const y0 = Math.max(TOP_Y, top);
  const y1 = Math.min(CORE.y - 40, bottom);
  if (y1 <= y0) return;
  plate(s, cam, LANE_CX - 5, y0, LANE_CX + 5, y1, rgb(14, 18, 28), 22);
  plate(s, cam, LANE_CX - 5, y0, LANE_CX - 4, y1, rgb(110, 118, 136), 22.1);
  plate(s, cam, LANE_CX + 4, y0, LANE_CX + 5, y1, rgb(40, 44, 58), 22.1);
  plate(s, cam, LANE_CX - 1.2, y0, LANE_CX + 1.2, y1, rgba(110, 220, 255, 90), 22.2);
  // 脉冲：从船头往核心走，速度快一点，显得船在全速运转。
  const L = CORE.y - 40 - TOP_Y;
  for (let k = 0; k < 8; k++) {
    const y = TOP_Y + ((k * (L / 8) + time * 240) % L);
    if (y < y0 - 10 || y > y1 + 10) continue;
    const at = cam.worldToScreen(LANE_CX, y);
    s.ellipse(at, 7 * g, 14 * g * Projection.groundSquash, 0, rgba(110, 220, 255, 60), 22.3);
    s.ellipse(at, 1.8 * g, 7 * g * Projection.groundSquash, 0, rgb(220, 250, 255), 22.31);
  }
  // 槽上每隔 60 一道横跨的压条（导管的卡箍）。
  for (let y = Math.ceil(y0 / 60) * 60; y < y1; y += 60) plate(s, cam, LANE_CX - 7, y, LANE_CX + 7, y + 3, rgb(96, 104, 122), 22.4);
}

/** 横向结构肋：微微隆起的一道横梁，顶面亮、朝镜头的那一面暗，顶上一排灯。 */
function drawRib(s: ShapeBatch, cam: Camera, y: number, time: number): void {
  const g = cam.grain;
  const [a, b] = spanAt(y);
  const z = 2.2;
  s.quad(cam.worldToScreenZ(a, y - 4, z), cam.worldToScreenZ(b, y - 4, z), cam.worldToScreenZ(b, y + 4, z), cam.worldToScreenZ(a, y + 4, z), rgb(104, 112, 130), 23);
  s.quad(cam.worldToScreenZ(a, y + 4, z), cam.worldToScreenZ(b, y + 4, z), cam.worldToScreenZ(b, y + 4, 0), cam.worldToScreenZ(a, y + 4, 0), rgb(46, 52, 66), 23.01);
  plate(s, cam, a, y + 4, b, y + 7, rgba(0, 0, 0, 60), 22.9);
  for (let x = a + 20, i = 0; x < b - 10; x += 40, i++) {
    const on = Math.sin(time * 2 + i * 0.9 + y) > -0.3;
    const at = cam.worldToScreenZ(x, y, z);
    if (on) s.ellipse(at, g * 4, g * 2.2, 0, rgba(255, 170, 60, 60), 23.1);
    s.rect(at, Math.max(1.5, g * 2), Math.max(1, g * 1.2), 0, on ? AMBER : rgb(90, 60, 30), 23.11);
  }
}

/** 通道两边的矮护栏：顶面一道亮边，栏上的灯从船头往船尾依次追着亮（速度感）。 */
function drawRails(s: ShapeBatch, cam: Camera, time: number, y0: number, y1: number): void {
  const g = cam.grain;
  for (let y = y0; y < y1; y += T) {
    const [a0, b0] = spanAt(y);
    const [a1, b1] = spanAt(y + T);
    edgeQuad(s, cam, a0, a0 + 4, y, a1, a1 + 4, y + T, RAIL, 24, 3);
    edgeQuad(s, cam, a0 + 4, a0 + 7, y, a1 + 4, a1 + 7, y + T, rgba(0, 0, 0, 60), 23.9);
    edgeQuad(s, cam, b0 - 4, b0, y, b1 - 4, b1, y + T, lerpColor(RAIL, rgb(20, 24, 36), 0.35), 24, 3);
    if (a0 === a1) {
      // 追逐灯：亮度随 (y - 时间) 走，一串光点往船尾跑。
      const k = ((((y - time * 320) % 160) + 160) % 160) / 160;
      const lum = Math.max(0, 1 - k * 4);
      for (const x of [a0 + 2, b0 - 2]) {
        const at = cam.worldToScreenZ(x, y + T / 2, 3.2);
        if (lum > 0) s.ellipse(at, g * 5, g * 3, 0, rgba(110, 220, 255, Math.round(70 * lum)), 24.1);
        s.rect(at, Math.max(1.5, g * 1.6), Math.max(1, g * 1.2), 0, lerpColor(rgb(30, 60, 80), CYAN, lum), 24.11);
      }
    }
  }
}

/** 甲板上掠过的气流线：又细又淡，飞快地往船尾划过去。 */
function drawSpeedLines(s: ShapeBatch, cam: Camera, time: number, top: number, bottom: number): void {
  const g = cam.grain;
  const wide = field().wide + HULL_SIDE;
  const span = bottom - top + 200;
  for (let i = 0; i < 36; i++) {
    const x = LANE_CX - wide + hash(i, 61) * wide * 2;
    const sp = 500 + hash(i, 62) * 500;
    const len = 30 + hash(i, 63) * 60;
    const y = top - 100 + ((hash(i, 64) * span + time * sp) % span);
    s.bar(cam.worldToScreen(x, y), cam.worldToScreen(x, y + len), Math.max(1, g * 0.6), rgba(200, 220, 255, 34), 39);
  }
}
