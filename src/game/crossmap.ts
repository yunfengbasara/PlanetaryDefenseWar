import { type Vec2, clamp, v2 } from '../core/math';
import type { Camera } from '../render/camera';
import { type Rgba, lerpColor, rgb, rgba } from '../render/color';
import type { ShapeBatch } from '../render/shapeBatch';
import { hash } from './floor';

/**
 * 十字高地：水晶核心在地图正中一座方形高台上，上下左右四条路通到地图边上，每条路接上高台的那一段
 * 是坡道。路和高台以外是走不了的崖壁乱石。虫从四条路的尽头刷出来，沿路冲上坡道。
 *
 *          北路
 *           ┃
 *   西路 ━━ ▣ ━━ 东路      ▣ = 高台（核心在正中），路接高台的一段是坡道
 *           ┃
 *          南路
 *
 * 这里是这张图的全部几何（哪里能走、地面多高、刷怪点、寻路要绕的崖壁）和地面的画法。
 * 高度是真的：高台上的单位、建筑、核心都垫高 H，坡道上线性过渡。
 */

/** 地图中心（核心所在）、四条路从中心往外多长、路的半宽、高台半宽、坡道长、高台高。 */
export const CROSS_C = v2(330, 450);
export const ARM = 450;
export const ROAD = 64;
export const PLAT = 150;
export const RAMP = 70;
export const PLAT_H = 26;

const inPlat = (x: number, y: number): boolean => Math.abs(x - CROSS_C.x) <= PLAT && Math.abs(y - CROSS_C.y) <= PLAT;
/**
 * 虫刷在画面边缘外面一点的路上，自己走进画面 —— 和单通道地图从画面上边外进来一样；镜头拉得很近时也至少离中心
 * SPAWN_MIN（不刷到高台上）。镜头拉远看得到路尽头时就刷得更远，所以路能走的长度给足（WALK_ARM）。
 */
const SPAWN_MIN = 300;
const WALK_ARM = ARM + 3000;
const inRoadNS = (x: number, y: number): boolean => Math.abs(x - CROSS_C.x) <= ROAD && Math.abs(y - CROSS_C.y) <= WALK_ARM;
const inRoadEW = (x: number, y: number): boolean => Math.abs(y - CROSS_C.y) <= ROAD && Math.abs(x - CROSS_C.x) <= WALK_ARM;

/** 能不能走（高台或者四条路上）。 */
export function crossWalkable(x: number, y: number): boolean {
  return inPlat(x, y) || inRoadNS(x, y) || inRoadEW(x, y);
}

/** 地面高度：高台上是 PLAT_H，坡道上从 PLAT_H 线性降到 0，别处是 0。 */
export function crossHeight(x: number, y: number): number {
  if (inPlat(x, y)) return PLAT_H;
  const dx = Math.abs(x - CROSS_C.x);
  const dy = Math.abs(y - CROSS_C.y);
  let t = Infinity;
  if (dx <= ROAD) t = dy - PLAT;
  else if (dy <= ROAD) t = dx - PLAT;
  if (t > 0 && t < RAMP) return PLAT_H * (1 - t / RAMP);
  return 0;
}

/** 把一个点挪回能走的地方（离它最近的那块：高台、南北路、东西路）。 */
export function crossClamp(x: number, y: number): Vec2 {
  if (crossWalkable(x, y)) return v2(x, y);
  const c = CROSS_C;
  const options = [
    v2(clamp(x, c.x - PLAT, c.x + PLAT), clamp(y, c.y - PLAT, c.y + PLAT)),
    v2(clamp(x, c.x - ROAD, c.x + ROAD), clamp(y, c.y - WALK_ARM, c.y + WALK_ARM)),
    v2(clamp(x, c.x - WALK_ARM, c.x + WALK_ARM), clamp(y, c.y - ROAD, c.y + ROAD)),
  ];
  return options.reduce((p, q) => (Math.hypot(q.x - x, q.y - y) < Math.hypot(p.x - x, p.y - y) ? q : p));
}

/** 过 (x, y) 这一行上能走的那一段（含 x 的那一段）。 */
export function crossRowSpan(_x: number, y: number): [number, number] {
  const dy = Math.abs(y - CROSS_C.y);
  if (dy <= ROAD) return [CROSS_C.x - WALK_ARM, CROSS_C.x + WALK_ARM];
  if (dy <= PLAT) return [CROSS_C.x - PLAT, CROSS_C.x + PLAT];
  return [CROSS_C.x - ROAD, CROSS_C.x + ROAD];
}

/**
 * 寻路要绕开的崖壁：四个角上各是一块 L 形的乱石区，拆成两块矩形（贴着路的那一溜、贴着高台的那一溜）。
 * 只铺到地图边上，角点不会跑到老远去。
 */
export function crossBlocks(): { x0: number; x1: number; y0: number; y1: number }[] {
  const c = CROSS_C;
  const out: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const a = [c.x + sx * ROAD, c.x + sx * ARM];
      const b = [c.y + sy * PLAT, c.y + sy * ARM];
      out.push({ x0: Math.min(a[0], a[1]), x1: Math.max(a[0], a[1]), y0: Math.min(b[0], b[1]), y1: Math.max(b[0], b[1]) });
      const a2 = [c.x + sx * PLAT, c.x + sx * ARM];
      const b2 = [c.y + sy * ROAD, c.y + sy * ARM];
      out.push({ x0: Math.min(a2[0], a2[1]), x1: Math.max(a2[0], a2[1]), y0: Math.min(b2[0], b2[1]), y1: Math.max(b2[0], b2[1]) });
    }
  }
  return out;
}

/**
 * 刷怪点：随机一条路，横向在路面里散开；放到画面边缘（view）外面一点，再往外多 back（一群一起刷时拉成一串）。
 */
export function crossSpawn(view: { l: number; t: number; r: number; b: number }, back = 0): Vec2 {
  const c = CROSS_C;
  const side = (Math.random() - 0.5) * 2 * (ROAD - 14);
  const out = (edge: number): number => Math.max(SPAWN_MIN, edge + 24) + back + Math.random() * 16;
  switch (Math.floor(Math.random() * 4)) {
    case 0:
      return v2(c.x + side, c.y - out(c.y - view.t));
    case 1:
      return v2(c.x + side, c.y + out(view.b - c.y));
    case 2:
      return v2(c.x - out(c.x - view.l), c.y + side);
    default:
      return v2(c.x + out(view.r - c.x), c.y + side);
  }
}

/** 四个坡道顶（高台边上、路口正中）：出兵建筑默认把集结点设在离自己最近的那个。 */
export function crossRampTops(): Vec2[] {
  const c = CROSS_C;
  const k = PLAT - 14;
  return [v2(c.x, c.y - k), v2(c.x, c.y + k), v2(c.x - k, c.y), v2(c.x + k, c.y)];
}

// ------------------------------------------------------------------ 画

const ROCK = rgb(60, 54, 64);
const ROCK_L = rgb(86, 78, 90);
const ROCK_D = rgb(38, 34, 44);
const ROAD_C = rgb(120, 106, 90);
const ROAD_D = rgb(96, 84, 72);
const DECK = [rgb(150, 156, 168), rgb(142, 148, 160), rgb(158, 164, 176)];
const DECK_SEAM = rgb(92, 96, 108);
const WALL = rgb(92, 96, 110);
const WALL_D = rgb(64, 66, 80);
const COPING = rgb(184, 190, 202);
const RAMP_C = rgb(126, 130, 142);
const AMBER = rgb(240, 170, 50);
const GLOW = rgb(110, 210, 255);

/** 一块地（世界坐标轴对齐矩形）画在高度 z 上。 */
function slab(s: ShapeBatch, cam: Camera, x0: number, y0: number, x1: number, y1: number, z: number, c: Rgba, d: number): void {
  s.quad(cam.worldToScreenZ(x0, y0, z), cam.worldToScreenZ(x1, y0, z), cam.worldToScreenZ(x1, y1, z), cam.worldToScreenZ(x0, y1, z), c, d);
}

/** 路在地图边缘（±ARM）外面还画多长（画面里看到的都是路，不露出空白）。 */
const ROAD_BEYOND = 2000;

export function drawCross(s: ShapeBatch, cam: Camera, time: number): void {
  const W = cam.viewWidth;
  const H = cam.viewHeight;
  const g = cam.grain;
  const c = CROSS_C;
  s.rect(v2(W / 2, H / 2), W + 4, H + 4, 0, ROCK, 0);
  const top = cam.screenToWorld(0, -60).y;
  const bottom = cam.screenToWorld(0, H + 80).y;
  const left = cam.screenToWorld(-60, 0).x;
  const right = cam.screenToWorld(W + 60, 0).x;

  // 崖壁乱石：一块块明暗不一的石头、裂缝。只在走不了的地方。
  for (let cy = Math.floor(top / 34); cy * 34 < bottom; cy++) {
    for (let cx = Math.floor(left / 40); cx * 40 < right; cx++) {
      const x = cx * 40 + hash(cx, cy) * 24;
      const y = cy * 34 + hash(cy, cx) * 18;
      if (crossWalkable(x, y) || Math.min(...[Math.abs(x - c.x) - ROAD, Math.abs(y - c.y) - ROAD]) < 8) continue;
      const r = 6 + hash(cx + 3, cy + 5) * 12;
      const at = cam.worldToScreen(x, y);
      s.ellipse(v2(at.x + r * 0.3 * g, at.y + r * 0.3 * g), r * g, r * 0.62 * g, 0, ROCK_D, 1);
      s.ellipse(at, r * 0.9 * g, r * 0.56 * g, 0, lerpColor(ROCK, ROCK_L, hash(cx, cy + 9)), 1.01);
      s.ellipse(v2(at.x - r * 0.3 * g, at.y - r * 0.2 * g), r * 0.4 * g, r * 0.24 * g, 0, ROCK_L, 1.02);
    }
  }

  // 四条路：压实的碎石土路，路沿一道暗边，中间两道车辙。路一直通到画面外（镜头拉到最远也看不到路的尽头），
  // 虫从地图边缘（±ARM）的路上出来。
  const L = ARM + ROAD_BEYOND;
  slab(s, cam, c.x - ROAD, c.y - L, c.x + ROAD, c.y + L, 0, ROAD_C, 3);
  slab(s, cam, c.x - L, c.y - ROAD, c.x + L, c.y + ROAD, 0, ROAD_C, 3);
  for (const sgn of [-1, 1]) {
    slab(s, cam, c.x + sgn * ROAD - 4, c.y - L, c.x + sgn * ROAD + 4, c.y + L, 0, ROAD_D, 3.1);
    slab(s, cam, c.x - L, c.y + sgn * ROAD - 4, c.x + L, c.y + sgn * ROAD + 4, 0, ROAD_D, 3.1);
    slab(s, cam, c.x + sgn * 22 - 2, c.y - L, c.x + sgn * 22 + 2, c.y + L, 0, rgba(70, 60, 50, 90), 3.2);
    slab(s, cam, c.x - L, c.y + sgn * 22 - 2, c.x + L, c.y + sgn * 22 + 2, 0, rgba(70, 60, 50, 90), 3.2);
  }
  // 路面碎石。
  for (let i = 0; i < 480; i++) {
    const along = (hash(i, 31) - 0.5) * 2 * (ARM + 900);
    const across = (hash(i, 32) - 0.5) * 2 * (ROAD - 6);
    const [x, y] = i % 2 ? [c.x + across, c.y + along] : [c.x + along, c.y + across];
    if (Math.abs(x - c.x) < PLAT + RAMP && Math.abs(y - c.y) < PLAT + RAMP) continue;
    if (y < top - 20 || y > bottom + 20) continue;
    s.ellipse(cam.worldToScreen(x, y), (1 + hash(i, 33) * 1.6) * g, (0.7 + hash(i, 34)) * g, 0, rgba(70, 62, 54, 160), 3.3);
  }
  // 坡道：一块块金属踏板，从高台边降到路面；东西坡道朝南那一面露出三角形的侧墙。
  const ramp = (dir: 'n' | 's' | 'w' | 'e'): void => {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const z0 = PLAT_H * (1 - t0);
      const z1 = PLAT_H * (1 - t1);
      const d0 = PLAT + RAMP * t0;
      const d1 = PLAT + RAMP * t1;
      const col = lerpColor(RAMP_C, rgb(90, 94, 106), (i % 2) * 0.25);
      let P: Vec2[];
      if (dir === 'n') P = [cam.worldToScreenZ(c.x - ROAD, c.y - d0, z0), cam.worldToScreenZ(c.x + ROAD, c.y - d0, z0), cam.worldToScreenZ(c.x + ROAD, c.y - d1, z1), cam.worldToScreenZ(c.x - ROAD, c.y - d1, z1)];
      else if (dir === 's') P = [cam.worldToScreenZ(c.x - ROAD, c.y + d0, z0), cam.worldToScreenZ(c.x + ROAD, c.y + d0, z0), cam.worldToScreenZ(c.x + ROAD, c.y + d1, z1), cam.worldToScreenZ(c.x - ROAD, c.y + d1, z1)];
      else if (dir === 'w') P = [cam.worldToScreenZ(c.x - d0, c.y - ROAD, z0), cam.worldToScreenZ(c.x - d1, c.y - ROAD, z1), cam.worldToScreenZ(c.x - d1, c.y + ROAD, z1), cam.worldToScreenZ(c.x - d0, c.y + ROAD, z0)];
      else P = [cam.worldToScreenZ(c.x + d0, c.y - ROAD, z0), cam.worldToScreenZ(c.x + d1, c.y - ROAD, z1), cam.worldToScreenZ(c.x + d1, c.y + ROAD, z1), cam.worldToScreenZ(c.x + d0, c.y + ROAD, z0)];
      s.quad(P[0], P[1], P[2], P[3], col, 5 + i * 0.001);
      // 每块踏板上一对黄色人字防滑条。
      const mid = (a: Vec2, b: Vec2): Vec2 => v2((a.x + b.x) / 2, (a.y + b.y) / 2);
      s.bar(mid(P[0], P[3]), mid(P[1], P[2]), Math.max(1, g * 1.2), rgba(240, 170, 50, 150), 5.01 + i * 0.001);
      if (dir === 'w' || dir === 'e') {
        // 南侧的三角侧墙（从坡面到地面）。
        const sx = dir === 'w' ? -1 : 1;
        s.quad(
          cam.worldToScreenZ(c.x + sx * d0, c.y + ROAD, z0),
          cam.worldToScreenZ(c.x + sx * d1, c.y + ROAD, z1),
          cam.worldToScreenZ(c.x + sx * d1, c.y + ROAD, 0),
          cam.worldToScreenZ(c.x + sx * d0, c.y + ROAD, 0),
          WALL_D,
          5.5 + i * 0.001,
        );
      }
    }
  };
  ramp('n');
  ramp('w');
  ramp('e');

  // 高台南面的墙（坡道口两边），墙脚一道影子。
  for (const [x0, x1] of [
    [c.x - PLAT, c.x - ROAD],
    [c.x + ROAD, c.x + PLAT],
  ]) {
    const y = c.y + PLAT;
    s.quad(cam.worldToScreenZ(x0, y, PLAT_H), cam.worldToScreenZ(x1, y, PLAT_H), cam.worldToScreenZ(x1, y, 0), cam.worldToScreenZ(x0, y, 0), WALL, 6);
    for (let x = x0 + 10; x < x1; x += 20) s.bar(cam.worldToScreenZ(x, y, PLAT_H - 2), cam.worldToScreenZ(x, y, 2), Math.max(1, g * 0.6), WALL_D, 6.01);
    slab(s, cam, x0, y, x1, y + 10, 0, rgba(10, 8, 14, 90), 2.5);
  }

  // 高台顶面：40×40 的甲板，接缝深一档。
  slab(s, cam, c.x - PLAT, c.y - PLAT, c.x + PLAT, c.y + PLAT, PLAT_H, DECK_SEAM, 7);
  for (let y = c.y - PLAT; y < c.y + PLAT; y += 40) {
    for (let x = c.x - PLAT; x < c.x + PLAT; x += 40) {
      const x1 = Math.min(x + 40, c.x + PLAT);
      const y1 = Math.min(y + 40, c.y + PLAT);
      const col = DECK[Math.floor(hash(x, y) * DECK.length)];
      slab(s, cam, x + 0.8, y + 0.8, x1 - 0.8, y1 - 0.8, PLAT_H, col, 7.1);
      slab(s, cam, x + 0.8, y + 0.8, x1 - 0.8, y + 1.8, PLAT_H, lerpColor(col, rgb(255, 255, 255), 0.16), 7.2);
    }
  }
  // 南坡道在高台前面（离镜头近），最后画。
  ramp('s');
  // 核心底下一圈引导环；四个坡道顶各一道黄色警戒线。
  const at = cam.worldToScreenZ(c.x, c.y, PLAT_H);
  s.ellipse(at, 46 * g, 46 * g * 0.7, 0, rgba(110, 210, 255, 60), 7.3);
  s.ellipse(at, 43 * g, 43 * g * 0.7, 0, DECK[0], 7.31);
  for (const [x0, y0, x1, y1] of [
    [c.x - ROAD, c.y - PLAT, c.x + ROAD, c.y - PLAT + 4],
    [c.x - ROAD, c.y + PLAT - 4, c.x + ROAD, c.y + PLAT],
    [c.x - PLAT, c.y - ROAD, c.x - PLAT + 4, c.y + ROAD],
    [c.x + PLAT - 4, c.y - ROAD, c.x + PLAT, c.y + ROAD],
  ]) {
    slab(s, cam, x0, y0, x1, y1, PLAT_H, AMBER, 7.4);
  }
  // 高台边上的矮护墙（坡道口留开），四角各一座灯柱。
  const lip = (x0: number, y0: number, x1: number, y1: number): void => {
    s.quad(cam.worldToScreenZ(x0, y0, PLAT_H + 3), cam.worldToScreenZ(x1, y0, PLAT_H + 3), cam.worldToScreenZ(x1, y1, PLAT_H + 3), cam.worldToScreenZ(x0, y1, PLAT_H + 3), COPING, 7.6);
  };
  for (const sgn of [-1, 1]) {
    lip(c.x - PLAT, c.y + sgn * PLAT - 3, c.x - ROAD, c.y + sgn * PLAT + 3);
    lip(c.x + ROAD, c.y + sgn * PLAT - 3, c.x + PLAT, c.y + sgn * PLAT + 3);
    lip(c.x + sgn * PLAT - 3, c.y - PLAT, c.x + sgn * PLAT + 3, c.y - ROAD);
    lip(c.x + sgn * PLAT - 3, c.y + ROAD, c.x + sgn * PLAT + 3, c.y + PLAT);
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const base = cam.worldToScreenZ(c.x + sx * (PLAT - 6), c.y + sy * (PLAT - 6), PLAT_H);
      const tip = cam.worldToScreenZ(c.x + sx * (PLAT - 6), c.y + sy * (PLAT - 6), PLAT_H + 16);
      s.bar(base, tip, Math.max(1.5, g * 2.2), WALL_D, 7.7);
      const pulse = 0.6 + 0.4 * Math.sin(time * 2 + sx + sy * 2);
      s.ellipse(tip, 6 * g, 4 * g, 0, rgba(110, 210, 255, Math.round(70 * pulse)), 7.8);
      s.rect(tip, Math.max(2, g * 2.4), Math.max(2, g * 2.4), 0, lerpColor(rgb(30, 60, 80), GLOW, pulse), 7.81);
    }
  }
}
