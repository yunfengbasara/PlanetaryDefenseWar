import { type Vec2, PI_OVER_2, V3_ZERO, clamp, dot2, lerp, lerp2, lerp3, v2, v3 } from '../core/math';
import { type Rgba, lerpColor, rgb, rgba, shade } from '../render/color';
import { Projection } from '../render/projection';
import type { Projector } from '../render/projector';
import { ShapeBatch } from '../render/shapeBatch';
import type { Kit } from './kit';
import { type Pose, RigSpec } from './rig';

/**
 * 用基础图形把一名动力装甲兵画出来：
 *   1. 每个部件是一块平涂 + 一条硬边阴影，绝不做渐变。
 *   2. 对比留在部件之间，不在部件内部。
 *
 * 同一具骨架，加上大肩甲、背包、装甲腿和腰甲，轮廓就从"人"变成"一身铁的人"。
 */

const DEPTH_SHADOW = -22;
const DEPTH_LEG = 0;
const DEPTH_TORSO = 2.2;
const DEPTH_ARM = 4;
const DEPTH_HAND = 6.6;
const DEPTH_HEAD = 8;

/** @param shadow 脚下画不画影子。 */
export function drawMarine(shapes: ShapeBatch, pose: Pose, p: Projector, kit: Kit, shadow = true): void {
  if (shadow) drawShadow(shapes, p);
  for (const side of [0, 1]) drawArmoredLeg(shapes, p, pose, kit, side);
  for (const side of [0, 1]) drawTasset(shapes, p, pose, kit, side);
  drawBackpack(shapes, p, pose, kit);
  drawTorso(shapes, p, pose, kit);
  drawArm(shapes, p, pose, kit, 0);
  drawArm(shapes, p, pose, kit, 1);
  for (const side of [0, 1]) drawPauldron(shapes, p, pose, kit, side);
  drawHead(shapes, p, pose, kit);
  drawGun(shapes, p, pose);
  drawHands(shapes, p, pose, kit);
}

/**
 * 动力装甲的肩甲：肩关节上一块大圆甲，两档 —— 暗底 + 往光源偏的亮面。
 *
 * 轮廓是动力装甲读出来的全部：同一具骨架，肩膀一下子宽出去一大截、背后多一个方箱，
 * 二十像素下就不再是"穿军装的人"，而是"穿着一身铁的人"。
 */
function drawPauldron(shapes: ShapeBatch, p: Projector, pose: Pose, kit: Kit, side: number): void {
  const s = pose.shoulderSocket(side);
  const at = p.screen(v3(s.x + (side === 0 ? -0.6 : 0.6), s.y, s.z + 0.6));
  const r = p.s(2.5);
  const depth = p.depth(s) + DEPTH_ARM + 1;
  shapes.ellipse(at, r * 1.15, r, 0, kit.shirtShade, depth);
  shapes.ellipse(v2(at.x - r * 0.2, at.y - r * 0.25), r * 0.85, r * 0.65, 0, kit.shirtLight, depth + 0.01);
  shapes.rect(v2(at.x, at.y + r * 0.45), r * 1.6, r * 0.28, 0, kit.trim, depth + 0.02);
}

/** 背包：胸口后方一个方箱。背对镜头时整个看得见，正对时被身体挡住（深度更小）。 */
function drawBackpack(shapes: ShapeBatch, p: Projector, pose: Pose, kit: Kit): void {
  const c = pose.chest;
  const at = v3(c.x, c.y - 3.2, c.z - 0.5);
  const sc = p.screen(at);
  const w = p.crossSectionWidth(3.2, 1.2);
  const h = p.s(5.5);
  const depth = p.depth(at) + DEPTH_TORSO - 0.5;
  shapes.rect(sc, w, h, 0, kit.trousersShade, depth);
  shapes.rect(v2(sc.x - w * 0.15, sc.y - h * 0.2), w * 0.55, h * 0.45, 0, kit.trousers, depth + 0.01);
  shapes.rect(v2(sc.x + w * 0.25, sc.y - h * 0.3), w * 0.18, h * 0.18, 0, kit.capShade, depth + 0.02);
}

/**
 * 动力装甲的腿：深色的内衬 + 外面一层装甲 —— 大腿甲、护膝、一截粗的护胫、方头大靴。
 *
 * 比普通的腿粗一半多。上身有肩甲撑宽了轮廓，腿不跟着加厚就成了"铁罐头底下插两根筷子"。
 */
function drawArmoredLeg(shapes: ShapeBatch, p: Projector, pose: Pose, kit: Kit, side: number): void {
  const hip = pose.hipSocket(side);
  const knee = side === 0 ? pose.kneeL : pose.kneeR;
  const foot = side === 0 ? pose.footL : pose.footR;
  const depth = p.depth(lerp3(hip, foot, 0.5)) + DEPTH_LEG;
  const far = p.depth(foot) < p.depth(side === 0 ? pose.footR : pose.footL);
  const dim = far ? 0.82 : 1;
  const thick = RigSpec.legThickness * 1.32;
  const plate = shade(kit.shirt, dim);
  // 先垫一圈深色轮廓：近处那条腿画上去时会把远处那条压出一道缝，两条腿不再糊成一坨。
  const edge = shade(kit.shoeDark, 0.8);
  const ew = p.s(0.7);
  limb(shapes, p.screen(hip), p.screen(knee), p.s(thick * 1.05) + ew, edge, edge, depth - 0.003);
  limb(shapes, p.screen(knee), p.screen(foot), p.s(thick * 1.2) + ew, edge, edge, depth - 0.002);
  const plateDark = shade(kit.shirtShade, dim);
  const plateLight = shade(kit.shirtLight, dim);

  // 内衬：关节处露出来的那点深色。
  limb(shapes, p.screen(hip), p.screen(knee), p.s(thick * 0.85), shade(kit.trousers, dim), shade(kit.trousersShade, dim), depth);
  limb(shapes, p.screen(knee), p.screen(foot), p.s(thick * 0.8), shade(kit.trousers, dim), shade(kit.trousersShade, dim), depth + 0.001);
  // 大腿甲。
  slab(shapes, p.screen(lerp3(hip, knee, 0.12)), p.screen(lerp3(hip, knee, 0.78)), p.s(thick * 1.0), plateDark, plate, plateLight, depth + 0.004);
  // 护胫：上窄下宽，一直包到靴口。
  slab(shapes, p.screen(lerp3(knee, foot, 0.2)), p.screen(lerp3(knee, foot, 0.72)), p.s(thick * 1.0), plateDark, plate, plateLight, depth + 0.008);
  slab(shapes, p.screen(lerp3(knee, foot, 0.55)), p.screen(lerp3(knee, foot, 0.8)), p.s(thick * 1.15), plateDark, plate, plateLight, depth + 0.009);
  // 护膝：一块凸出来的圆甲 + 一道饰条。
  const kn = p.screen(knee);
  const kr = p.s(thick * 0.6);
  shapes.ellipse(kn, kr * 1.1, kr, 0, plateDark, depth + 0.012);
  shapes.ellipse(v2(kn.x - kr * 0.2, kn.y - kr * 0.2), kr * 0.75, kr * 0.62, 0, plateLight, depth + 0.013);
  shapes.rect(v2(kn.x, kn.y + kr * 0.55), kr * 1.4, kr * 0.3, 0, kit.trim, depth + 0.014);
  // 靴子：装甲色的靴面 + 深色厚底，不比护胫宽多少 —— 太大就成了两块砖。
  const at = p.screen(foot);
  const bw = p.s(thick * 1.12);
  const bh = p.s(thick * 0.62);
  shapes.rect(v2(at.x, at.y - bh * 0.1), bw + ew * 2, bh + ew * 2, 0, edge, depth + 0.019);
  shapes.rect(v2(at.x, at.y - bh * 0.1), bw, bh, 0, plateDark, depth + 0.02);
  shapes.rect(v2(at.x - bw * 0.1, at.y - bh * 0.32), bw * 0.62, bh * 0.3, 0, plate, depth + 0.021);
  shapes.rect(v2(at.x, at.y + bh * 0.35), bw * 1.04, bh * 0.3, 0, kit.shoeDark, depth + 0.022);
}

/** 腰甲：挂在两侧髋关节上的一块甲片，盖住大腿根，把上下两截装甲接起来。 */
function drawTasset(shapes: ShapeBatch, p: Projector, pose: Pose, kit: Kit, side: number): void {
  const h = pose.hipSocket(side);
  const at3 = v3(h.x + (side === 0 ? -0.5 : 0.5), h.y, h.z - 0.6);
  const at = p.screen(at3);
  const r = p.s(1.7);
  const depth = p.depth(at3) + DEPTH_TORSO + 0.05;
  shapes.rect(at, r * 1.5, r * 1.3, 0, kit.shirtShade, depth);
  shapes.rect(v2(at.x - r * 0.15, at.y - r * 0.2), r * 1.05, r * 0.7, 0, kit.shirt, depth + 0.01);
}

function drawShadow(shapes: ShapeBatch, p: Projector): void {
  shapes.ellipse(
    p.screen(V3_ZERO),
    p.s(RigSpec.shadowRadius * 0.95),
    p.s(RigSpec.shadowRadius * 0.95 * Projection.groundSquash),
    0,
    rgba(0, 0, 0, 52),
    p.baseDepth + DEPTH_SHADOW,
  );
}

/** 一条肢体：平涂、方头、背光侧一条硬阴影。 */
function limb(shapes: ShapeBatch, a: Vec2, b: Vec2, w: number, mid: Rgba, dark: Rgba, depth: number): void {
  let ax = v2(b.x - a.x, b.y - a.y);
  const len = Math.sqrt(ax.x * ax.x + ax.y * ax.y);
  ax = len > 1e-3 ? v2(ax.x / len, ax.y / len) : v2(0, -1);
  let n = v2(-ax.y, ax.x);
  if (dot2(n, ShapeBatch.LIGHT_DIR) > 0) n = v2(-n.x, -n.y);
  shapes.bar(a, b, w, mid, depth);
  const off = w * 0.33;
  shapes.bar(v2(a.x + n.x * off, a.y + n.y * off), v2(b.x + n.x * off, b.y + n.y * off), w * 0.34, dark, depth + 0.002);
}

function fist(shapes: ShapeBatch, at: Vec2, r: number, mid: Rgba, dark: Rgba, depth: number): void {
  shapes.disc(at, r, mid, depth);
  shapes.rect(v2(at.x, at.y + r * 0.6), r * 1.5, r * 0.7, 0, dark, depth + 0.002);
}

function slab(shapes: ShapeBatch, a: Vec2, b: Vec2, w: number, shadowColor: Rgba, mid: Rgba, light: Rgba, depth: number): void {
  let ax = v2(b.x - a.x, b.y - a.y);
  const len = Math.sqrt(ax.x * ax.x + ax.y * ax.y);
  ax = len > 1e-3 ? v2(ax.x / len, ax.y / len) : v2(0, -1);
  let n = v2(-ax.y, ax.x);
  if (dot2(n, ShapeBatch.LIGHT_DIR) < 0) n = v2(-n.x, -n.y);
  shapes.bar(a, b, w, mid, depth);
  const o1 = w * 0.33;
  shapes.bar(v2(a.x - n.x * o1, a.y - n.y * o1), v2(b.x - n.x * o1, b.y - n.y * o1), w * 0.34, shadowColor, depth + 0.002);
  if (w > 5) {
    const o2 = w * 0.38;
    shapes.bar(v2(a.x + n.x * o2, a.y + n.y * o2), v2(b.x + n.x * o2, b.y + n.y * o2), w * 0.18, light, depth + 0.003);
  }
}

function band(shapes: ShapeBatch, center: Vec2, width: number, height: number, across: number, color: Rgba, depth: number): void {
  shapes.rect(center, width, height, across, color, depth);
}

function drawTorso(shapes: ShapeBatch, p: Projector, pose: Pose, kit: Kit): void {
  const hip = p.screen(pose.hip);
  const depth = p.depth(pose.chest) + DEPTH_TORSO;

  const wChest = p.crossSectionWidth(RigSpec.torsoHalfWidth, RigSpec.torsoHalfDepth);
  const wWaist = p.crossSectionWidth(RigSpec.waistHalfWidth, RigSpec.waistHalfDepth);
  const wPelvis = p.crossSectionWidth(RigSpec.pelvisHalfWidth, RigSpec.pelvisHalfDepth);

  // 衣领沿脊柱方向抬出去，不是沿 +z —— 收杆时人是后仰的。
  const sx = pose.chest.x - pose.hip.x;
  const sy = pose.chest.y - pose.hip.y;
  const sz = pose.chest.z - pose.hip.z;
  const sl = Math.hypot(sx, sy, sz) || 1;
  const crown = p.screen(v3(pose.chest.x + (sx / sl) * 1.15, pose.chest.y + (sy / sl) * 1.15, pose.chest.z + (sz / sl) * 1.15));
  const across = Math.atan2(crown.y - hip.y, crown.x - hip.x) + PI_OVER_2;

  const seat = hip;
  const waist = lerp2(seat, crown, RigSpec.waistFrac);
  const upper = lerp2(seat, crown, 0.7);

  // 裤子的臀部那一截：从胯往下垂一点，把大腿根盖住。
  const hem = p.screen(v3(pose.hip.x, pose.hip.y, pose.hip.z - 1.2));
  slab(shapes, hem, seat, wPelvis * 0.98, kit.trousersShade, kit.trousers, lerpColor(kit.trousers, rgb(255, 255, 255), 0.15), depth);

  // 上衣塞在裤子里，所以从腰带往上才是衣服。
  const belt = lerp2(seat, crown, 0.14);
  slab(shapes, belt, waist, wWaist * 1.02, shade(kit.shirtShade, 0.95), shade(kit.shirt, 0.94), kit.shirtLight, depth + 0.004);
  slab(shapes, waist, upper, wWaist, kit.shirtShade, kit.shirt, kit.shirtLight, depth + 0.005);
  slab(shapes, upper, crown, wChest, kit.shirtShade, kit.shirt, kit.shirtLight, depth + 0.006);

  // 腰带：上衣和裤子之间那一道近黑的横线。没有它，浅衫配卡其裤从肩到脚是一根色柱。
  band(shapes, belt, wWaist * 1.06, p.s(0.95), across, kit.belt, depth + 0.01);
  // 领口：一小截饰条色。
  band(shapes, lerp2(seat, crown, 0.94), wChest * 0.5, p.s(0.9), across, kit.trim, depth + 0.02);
}

function drawArm(shapes: ShapeBatch, p: Projector, pose: Pose, kit: Kit, side: number): void {
  const shoulder = pose.shoulderSocket(side);
  const elbow = side === 0 ? pose.elbowL : pose.elbowR;
  const hand = side === 0 ? pose.handL : pose.handR;
  const depth = p.depth(hand) + DEPTH_ARM;
  const thick = RigSpec.armThickness;

  // 上臂一截装甲色、前臂一截深色护臂：端枪时两条前臂并在一起，深浅两截才读得出是两只手。
  const a = p.screen(shoulder);
  const b = p.screen(elbow);
  const sleeveEnd = lerp2(a, b, 0.62);
  limb(shapes, b, p.screen(hand), p.s(thick * 0.9), kit.skin, kit.skinShade, depth);
  limb(shapes, a, b, p.s(thick * 0.95), kit.skin, kit.skinShade, depth + 0.004);
  limb(shapes, a, sleeveEnd, p.s(thick * 1.12), shade(kit.shirt, 0.9), kit.shirtShade, depth + 0.008);
}

/** 左手戴白手套，右手露肤色。两只手叠在握把上时，一白一肤才看得出是两只手。 */
function drawHands(shapes: ShapeBatch, p: Projector, pose: Pose, kit: Kit): void {
  const r = RigSpec.handRadius;
  fist(shapes, p.screen(pose.handL), p.s(r), kit.glove, kit.gloveShade, p.depth(pose.handL) + DEPTH_HAND + 0.4);
  fist(shapes, p.screen(pose.handR), p.s(r), kit.skin, kit.skinShade, p.depth(pose.handR) + DEPTH_HAND);
}

/**
 * 头盔：一叠屏幕空间的平板：
 *   - 帽顶是一块深色平板，比头骨略宽；
 *   - 帽檐朝面朝方向伸出去 —— 侧面时是一根伸出去的短横，正面时是额头上一条更深的带子，
 *     背面看不见。它是这颗头上唯一有方向的东西。
 */
function drawHead(shapes: ShapeBatch, p: Projector, pose: Pose, kit: Kit): void {
  const depth = p.depth(pose.head) + DEPTH_HEAD;
  const r = RigSpec.headRadius;
  const headAt = p.screen(pose.head);
  const w = p.s(r * 1.5);
  const bandH = p.s(r * 0.6);

  const face = clamp(0.5 + 0.5 * p.facingCamera, 0, 1);
  const faceShift = p.ground({ x: 0, y: 1, z: 0 }).x;

  // 后脑（头发）和脸。
  const back = 1 - face;
  if (back > 0.04) {
    shapes.rect(v2(headAt.x - w * 0.24 * faceShift, headAt.y + bandH * 0.62), w * (0.5 + 0.3 * back), bandH * (0.5 + 0.6 * back), 0, kit.hair, depth);
  }
  if (face > 0.04) {
    shapes.rect(v2(headAt.x + w * 0.24 * faceShift, headAt.y + bandH * 0.68), w * (0.5 + 0.3 * face), bandH * (0.5 + 0.7 * face), 0, kit.skin, depth + 0.002);
  }

  // 帽冠。
  shapes.rect(v2(headAt.x, headAt.y - bandH * 0.3), w * 1.04, bandH * 1.5, 0, kit.cap, depth + 0.01);
  shapes.rect(v2(headAt.x - w * 0.12, headAt.y - bandH * 0.8), w * 0.6, bandH * 0.36, 0, lerpColor(kit.cap, rgb(255, 250, 235), 0.22), depth + 0.012);
  // 帽子下沿的阴影线。
  shapes.rect(v2(headAt.x, headAt.y + bandH * 0.42), w * 1.0, bandH * 0.3, 0, kit.capShade, depth + 0.014);

  // 帽檐。
  if (face > 0.15) {
    const side = Math.abs(faceShift);
    const brimW = w * lerp(1.1, 0.62, side);
    const brimX = headAt.x + faceShift * w * 0.62;
    shapes.rect(v2(brimX, headAt.y + bandH * 0.38), brimW, bandH * lerp(0.42, 0.36, side), 0, kit.capShade, depth + 0.03);
  }

  shapes.rect(v2(headAt.x, headAt.y + bandH * (0.72 + 0.62 * face)), w * 0.8, bandH * 0.28, 0, rgba(0, 0, 0, 85), depth + 0.05);
}

/**
 * 动力装甲用的重枪：一整根深灰的方管，中段一道青色的能量槽，枪口一个深色点。
 * gunButt 是枪托末端，gunMuzzle 是枪口。
 */
function drawGun(shapes: ShapeBatch, p: Projector, pose: Pose): void {
  if (!pose.gunButt || !pose.gunMuzzle) return;
  const a = p.screen(pose.gunButt);
  const b = p.screen(pose.gunMuzzle);
  const depth = p.depth(lerp3(pose.gunButt, pose.gunMuzzle, 0.5)) + DEPTH_HAND - 0.2;
  shapes.bar(a, b, Math.max(1.5, p.s(1.3)), rgb(52, 56, 64), depth);
  shapes.bar(lerp2(a, b, 0.35), lerp2(a, b, 0.7), Math.max(1, p.s(0.5)), rgb(90, 200, 255), depth + 0.01);
  shapes.disc(b, Math.max(0.8, p.s(0.55)), rgb(30, 32, 36), depth + 0.02);
}
