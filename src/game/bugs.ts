import { type Vec2, v2, v3 } from '../core/math';
import { type Rgba, lerpColor, rgb, rgba } from '../render/color';
import type { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 虫子：和人一样是"局部 3D 点 → 投影 → 平涂色块"，只是身体换成三节（腹、胸、头）+ 六条腿。
 *
 *   身体每一节是两档的椭圆：暗底 + 往光源偏的亮面（和树冠、肩甲同一种画法），腹部背上
 *   一道深色的甲壳纹。腿是两截细杆，走路用**三角步态**：左前、右中、左后一组，另外三条一组，
 *   两组交替抬 —— 真实的昆虫就是这么走的，一大群一起爬的时候，那种密密麻麻的颤动全来自这一个相位。
 *
 * 六种：
 *   crawler  小爬虫：数量最多、跑得快，一对大颚
 *   beetle   甲虫：个头大、背上一排骨刺，慢、耐打
 *   flyer    飞虫：细身子、两对半透明的翅膀在扇
 *   hopper   跳虫：瘦长、后腿特别长，一蹦一蹦地扑过来
 *   serpent  刺蛇：下半身是贴地蜿蜒的蛇尾，上半身直立，头后一圈骨刺撑开的冠，两条骨镰臂；
 *            走到阵前停下，举镰往地上一砸，从地里朝前刺出一串尖刺
 *   spitter  喷酸虫：腹部一个发光的酸囊，停下来往前吐抛物线的酸液
 */
export type BugKind = 'crawler' | 'beetle' | 'flyer' | 'hopper' | 'serpent' | 'spitter';

export interface BugLook {
  shell: Rgba;
  shellLight: Rgba;
  shellDark: Rgba;
  belly: Rgba;
  accent: Rgba;
  leg: Rgba;
  /** 体液的颜色（两档）。 */
  blood: [Rgba, Rgba];
}

const look = (shell: Rgba, accent: Rgba, blood: [Rgba, Rgba]): BugLook => ({
  shell,
  shellLight: lerpColor(shell, rgb(255, 230, 255), 0.28),
  shellDark: lerpColor(shell, rgb(16, 8, 20), 0.45),
  belly: lerpColor(shell, rgb(220, 180, 120), 0.35),
  accent,
  leg: lerpColor(shell, rgb(16, 8, 20), 0.55),
  blood,
});

const GREEN: [Rgba, Rgba] = [rgb(84, 150, 40), rgb(160, 210, 60)];
const AMBER: [Rgba, Rgba] = [rgb(176, 120, 30), rgb(232, 190, 70)];
const ACID: [Rgba, Rgba] = [rgb(120, 200, 40), rgb(210, 250, 110)];
const TEAL: [Rgba, Rgba] = [rgb(40, 140, 120), rgb(110, 210, 180)];

export const BUG_LOOKS: Record<BugKind, BugLook[]> = {
  crawler: [
    look(rgb(132, 70, 128), rgb(226, 170, 60), GREEN),
    look(rgb(120, 62, 110), rgb(236, 190, 70), GREEN),
    look(rgb(146, 82, 120), rgb(220, 150, 60), GREEN),
  ],
  beetle: [look(rgb(84, 50, 96), rgb(240, 120, 60), AMBER)],
  flyer: [look(rgb(150, 96, 70), rgb(140, 220, 120), GREEN)],
  hopper: [look(rgb(170, 70, 56), rgb(250, 210, 90), GREEN), look(rgb(150, 60, 60), rgb(250, 200, 80), GREEN)],
  serpent: [look(rgb(112, 62, 96), rgb(232, 220, 196), TEAL), look(rgb(94, 70, 120), rgb(232, 220, 196), TEAL)],
  spitter: [look(rgb(96, 110, 60), rgb(190, 250, 90), ACID)],
};

export const BUG_SIZE: Record<BugKind, number> = { crawler: 1, beetle: 1.9, flyer: 0.9, hopper: 1.05, serpent: 1.4, spitter: 1.4 };

/** 一个两档的"球"：暗底 + 往左上偏的亮面。 */
function blob(shapes: ShapeBatch, at: Vec2, rx: number, ry: number, dark: Rgba, light: Rgba, depth: number): void {
  shapes.ellipse(at, rx, ry, 0, dark, depth);
  shapes.ellipse(v2(at.x - rx * 0.18, at.y - ry * 0.22), rx * 0.72, ry * 0.66, 0, light, depth + 0.01);
}

export interface BugState {
  phase: number;
  /** > 0 = 死了多久。 */
  dead: number;
  /** 跳虫：是否在空中（腿蹬直）。 */
  airborne: boolean;
  /** 历史字段：现在所有虫都在地面上，恒为 1。 */
  emerge: number;
  /** 喷酸虫：喷吐的动作 0..1。 */
  spit: number;
}

/**
 * 刺蛇：贴地蜿蜒的蛇尾 + 直立的上半身 + 头后一圈骨刺撑开的冠 + 两条骨镰臂。
 *
 * st.spit 在这里是"举镰"的程度：攻击前慢慢举高、上身后仰，砸下去的那一刻归零。
 * 死了整条趴倒：上半身往前扑在地上，冠和镰平摊开。
 */
function drawSerpent(
  shapes: ShapeBatch,
  P: (x: number, y: number, z: number) => Vec2,
  D: (x: number, y: number, z: number) => number,
  R: (r: number) => number,
  lk: BugLook,
  st: BugState,
  deadK: number,
  shell: Rgba,
  light: Rgba,
  time: number,
): void {
  const dark = lk.shellDark;
  const bone = lk.accent;
  const boneDark = lerpColor(bone, rgb(60, 50, 50), 0.35);
  const up = 1 - deadK;
  const atk = deadK > 0 ? 0 : st.spit;
  // 蛇尾往一侧盘过去（再叠一层游动的摆），从正面看轮廓才宽，不然尾巴全藏在身子后面。
  const wig = (k: number): number => k * k * 0.2 + Math.sin(st.phase * Math.PI * 2 - k * 1.1) * (0.9 + k * 0.35) * (1 - deadK * 0.6);

  if (deadK === 0) shapes.ellipse(P(0, -4, 0), R(7.5), R(7.5) * 0.5, 0, rgba(0, 0, 0, 70), D(0, -4, 0) - 20);

  // 蛇尾：六节从前往后越来越细，节与节之间用粗杆连起来，是一整条而不是一串珠子。尾尖先画（在最后面）。
  const seg = [0, 1, 2, 3, 4, 5].map((k) => ({ x: wig(k), y: -1.5 - k * 1.8, r: 3 - k * 0.38 }));
  for (let k = 5; k >= 0; k--) {
    const c = seg[k];
    const d = D(c.x, c.y, 0) + 0.02 * (5 - k);
    if (k < 5) {
      const n = seg[k + 1];
      shapes.bar(P(c.x, c.y, c.r * 0.55), P(n.x, n.y, n.r * 0.55), R(n.r * 1.7), dark, d - 0.01);
      shapes.bar(P(c.x - 0.3, c.y, c.r * 0.75), P(n.x - 0.3, n.y, n.r * 0.75), R(n.r * 0.9), shell, d - 0.005);
    }
    blob(shapes, P(c.x, c.y, c.r * 0.55), R(c.r), R(c.r * 0.82), dark, shell, d);
    shapes.disc(P(c.x, c.y + 0.3, c.r * 1.1), Math.max(0.7, R(c.r * 0.3)), boneDark, d + 0.015); // 背上的骨节
  }

  // 上半身：从蛇尾最前端立起来，举镰时往后仰。
  const lean = -atk * 1.6;
  const base = v3(wig(0), -0.4, 2);
  const mid = v3(0, 1 + lean * 0.5 + deadK * 2.5, 1 + 7.5 * up);
  const chest = v3(0, 2.2 + lean + deadK * 5.5, 1.5 + 12.5 * up + atk * 1.2);
  const head = v3(0, chest.y + 1.8 * up + deadK * 2.5, chest.z + 1.6 * up);
  const dBody = D(0, 2, 0) + 0.5;
  shapes.bar(P(base.x, base.y, base.z), P(mid.x, mid.y, mid.z), R(4), dark, dBody);
  shapes.bar(P(mid.x, mid.y, mid.z), P(chest.x, chest.y, chest.z), R(3.6), dark, dBody + 0.01);
  shapes.bar(P(base.x - 0.4, base.y, base.z), P(mid.x - 0.4, mid.y, mid.z), R(2.6), shell, dBody + 0.02);
  shapes.bar(P(mid.x - 0.4, mid.y, mid.z), P(chest.x - 0.4, chest.y, chest.z), R(2.2), light, dBody + 0.03);
  // 腹面一道浅色的环纹。
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const q = v3(0, mid.y + (chest.y - mid.y) * t + 1.1, mid.z + (chest.z - mid.z) * t);
    shapes.rect(P(q.x, q.y, q.z), R(2.6), Math.max(1, R(0.5)), 0, lk.belly, dBody + 0.04);
  }

  // 冠：头后两扇骨刺，往两侧、往后上方撑开，中间一层深色的膜。
  const dHood = dBody + 0.05;
  for (const side of [-1, 1]) {
    const root = v3(side * 1.2, head.y - 1, head.z + 0.4);
    // 冠像眼镜蛇的颈褶：骨刺往上翘、往外撑，刺与刺之间绷着一层膜。
    const tips = [0, 1, 2, 3].map((i) => v3(side * (2.4 + i * 1.15), head.y - 1.2 - i * 0.5 - deadK, head.z + (5.2 - i * 1.7) * up + deadK * 0.5));
    shapes.quad(P(root.x, root.y, root.z), P(tips[0].x, tips[0].y, tips[0].z), P(tips[3].x, tips[3].y, tips[3].z), P(root.x, root.y, root.z - 4), shell, dHood);
    shapes.quad(P(root.x, root.y, root.z), P(tips[1].x, tips[1].y, tips[1].z), P(tips[3].x, tips[3].y, tips[3].z), P(root.x, root.y, root.z - 3), lerpColor(shell, dark, 0.45), dHood + 0.002);
    tips.forEach((tp, i) => shapes.bar(P(root.x, root.y, root.z), P(tp.x, tp.y, tp.z), Math.max(1, R(0.55 - i * 0.06)), bone, dHood + 0.01 + i * 0.001));
  }

  // 头：长吻、一对发光的眼。
  const dHead = dHood + 0.1;
  blob(shapes, P(head.x, head.y, head.z), R(2.2), R(1.8), dark, shell, dHead);
  shapes.bar(P(0, head.y + 0.8, head.z - 0.2), P(0, head.y + 3, head.z - 1.2 * up), R(1.4), shell, dHead + 0.01);
  for (const side of [-1, 1]) shapes.disc(P(side * 0.9, head.y + 1.2, head.z + 0.5), Math.max(0.8, R(0.55)), deadK > 0 ? dark : lk.blood[1], dHead + 0.02);

  // 肩甲：胸口两侧两块鼓起的甲壳。
  for (const side of [-1, 1]) blob(shapes, P(side * 2.4, chest.y + 0.2, chest.z - 0.6), R(1.9), R(1.5), dark, light, dHead - 0.02);

  // 骨镰臂：肩 → 肘（深色臂骨）→ 一片三角形的镰刃。平时像螳螂那样折在胸前、刃尖朝上；
  // 举镰时肘抬过肩、两把刃往两边张开高过冠，砸下去那一刻收回。
  for (const side of [-1, 1]) {
    const sh = v3(side * 2.6, chest.y + 0.4, chest.z - 1);
    const el = v3(side * (4 + atk * 2), chest.y + 2.4 - atk * 1.6 + deadK * 1.5, chest.z - 4.5 * up + atk * 8);
    const tip = v3(side * (2.6 + atk * 4.5), chest.y + 3.6 - atk * 2.6 + deadK * 3, chest.z + (0.8 + atk * 11) * up);
    const w = Math.max(1.2, R(1.1));
    const d = dHead + 0.05;
    shapes.bar(P(sh.x, sh.y, sh.z), P(el.x, el.y, el.z), w, dark, d);
    // 镰刃：肘部宽、刃尖窄，外侧一条亮边。
    const pe = P(el.x, el.y, el.z);
    const pt = P(tip.x, tip.y, tip.z);
    const ax = pt.x - pe.x;
    const ay = pt.y - pe.y;
    const len = Math.hypot(ax, ay) || 1;
    const nx = (-ay / len) * R(1.3) * side;
    const ny = (ax / len) * R(1.3) * side;
    shapes.quad(v2(pe.x - nx, pe.y - ny), v2(pe.x + nx, pe.y + ny), pt, pt, boneDark, d + 0.004);
    shapes.quad(v2(pe.x + nx * 0.1, pe.y + ny * 0.1), v2(pe.x + nx, pe.y + ny), pt, pt, bone, d + 0.005);
    shapes.disc(pe, w * 0.6, bone, d + 0.006);
  }
  void time;
}

/**
 * 画一只虫。p 的朝向就是虫头的方向。
 */
export function drawBug(shapes: ShapeBatch, p: Projector, kind: BugKind, lk: BugLook, st: BugState, time: number): void {
  const s = BUG_SIZE[kind];
  const P = (x: number, y: number, z: number): Vec2 => p.screen(v3(x * s, y * s, z * s));
  const D = (x: number, y: number, z: number): number => p.depth(v3(x * s, y * s, z * s));
  const R = (r: number): number => p.s(r * s);

  const deadK = st.dead > 0 ? Math.min(1, st.dead * 3) : 0;
  // 死了翻过来：朝上的是浅色的腹面，整体再压暗一点。
  const shell = deadK > 0 ? lerpColor(lk.belly, rgb(40, 34, 40), 0.35 * deadK) : lk.shell;
  const light = deadK > 0 ? lerpColor(lk.belly, rgb(255, 240, 220), 0.15) : lk.shellLight;
  const dark = lk.shellDark;
  if (kind === 'serpent') {
    drawSerpent(shapes, P, D, R, lk, st, deadK, shell, light, time);
    return;
  }
  const bodyZ = kind === 'flyer' ? 0 : 4 * (1 - deadK * 0.6);

  if (deadK === 0 && kind !== 'flyer' && !st.airborne) shapes.ellipse(P(0, -1, 0), R(7), R(7) * 0.55, 0, rgba(0, 0, 0, 70), D(0, -1, 0) - 20);

  // 腿。
  if (kind !== 'flyer') {
    const legYs = [3.4, 0.8, -1.8];
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const group = (i + (side > 0 ? 1 : 0)) % 2;
        const ph = (st.phase + group * 0.5) % 1;
        const swing = Math.sin(ph * Math.PI * 2);
        const lift = deadK > 0 || st.airborne ? 0 : Math.max(0, Math.cos(ph * Math.PI * 2)) * 1.6;
        const y0 = legYs[i];
        const hip = v3(side * 1.8, y0, bodyZ);
        let knee = v3(side * 5.2, y0 + swing * 1.2 + (i - 1) * 0.6, bodyZ + 2.6 + lift * 0.5);
        let foot = v3(side * 7.4, y0 + swing * 2.2 + (i - 1) * 1.4, lift);
        // 跳虫的后腿：一对大折腿，膝盖高高顶起；腾空时往后蹬直。
        if (kind === 'hopper' && i === 2) {
          knee = st.airborne ? v3(side * 4, y0 - 5, bodyZ + 1) : v3(side * 4.6, y0 + 1, bodyZ + 6.5);
          foot = st.airborne ? v3(side * 4.4, y0 - 10, bodyZ - 1.5) : v3(side * 5.2, y0 - 5, 0);
        } else if (st.airborne) {
          knee = v3(side * 4.5, y0 + 1.5, bodyZ - 0.5);
          foot = v3(side * 5, y0 + 3.5, bodyZ - 2.5);
        }
        if (deadK > 0) {
          // 翻过来、四脚朝天：腿往两侧上方张开，膝盖再往里勾一下。
          knee = v3(side * 5, y0 + (i - 1) * 1.2, bodyZ + 4.5);
          foot = v3(side * 4, y0 + (i - 1) * 2, bodyZ + 8);
        }
        const w = Math.max(1, R(kind === 'hopper' && i === 2 ? 1 : 0.75));
        // 死了的虫腿蜷在身子上面：画在身体之后，读作"翻倒、腿缩起来"，而不是一只缩小的虫。
        const d = deadK > 0 ? D(0, 0, bodyZ) + 2 : D(hip.x, hip.y, hip.z) - 0.5;
        const legColor = deadK > 0 ? lk.belly : lk.leg;
        shapes.bar(P(hip.x, hip.y, hip.z), P(knee.x, knee.y, knee.z), w, legColor, d);
        shapes.bar(P(knee.x, knee.y, knee.z), P(foot.x, foot.y, foot.z), Math.max(1, w * 0.8), legColor, d + 0.01);
      }
    }
  }

  if (kind === 'flyer' && deadK === 0) {
    const flap = Math.sin(time * 40 + st.phase * 20);
    for (const side of [-1, 1]) {
      for (const k of [0, 1]) {
        const tip = P(side * (7 + flap * 1.5), -0.5 - k * 2.5, 2 + flap * 3);
        const root = P(side * 1.2, 0 - k * 2, 1.5);
        const c = v2((tip.x + root.x) / 2, (tip.y + root.y) / 2);
        const ang = Math.atan2(tip.y - root.y, tip.x - root.x);
        const len = Math.hypot(tip.x - root.x, tip.y - root.y);
        shapes.ellipse(c, len * 0.6, R(1.5), ang, rgba(220, 240, 230, 120), D(0, 0, 3) + 1 + k * 0.01);
      }
    }
  }

  // 腹部。
  const abY = kind === 'hopper' ? -3.6 : -4.4;
  const ab = P(0, abY, bodyZ + 0.6);
  const abD = D(0, abY, bodyZ);
  const abR = { crawler: 4.4, beetle: 5.2, flyer: 2.8, hopper: 3.2, serpent: 5, spitter: 5.4 }[kind];
  const abSquash = kind === 'flyer' || kind === 'hopper' ? 0.7 : 1;
  if (kind === 'spitter') {
    // 酸囊：亮绿的大泡，鼓起来的时候（喷吐前）更大更亮。
    const swell = 1 + st.spit * 0.18;
    blob(shapes, ab, R(abR) * swell, R(abR) * 0.85 * swell, dark, shell, abD);
    shapes.ellipse(v2(ab.x - R(1), ab.y - R(1.4)), R(abR * 0.62) * swell, R(abR * 0.5) * swell, 0, lerpColor(lk.accent, rgb(255, 255, 200), 0.2 + st.spit * 0.4), abD + 0.02);
  } else {
    blob(shapes, ab, R(abR) * abSquash, R(abR) * 0.82, dark, shell, abD);
    shapes.bar(P(0, -1.6, bodyZ + 2.4), P(0, abY - 3.2, bodyZ + 1.8), Math.max(1, R(0.9)), dark, abD + 0.02);
  }
  if (kind === 'crawler' || kind === 'hopper') {
    for (const side of [-1, 1]) shapes.disc(P(side * 2.2, abY - 0.2, bodyZ + 2.2), Math.max(0.8, R(0.7)), lk.accent, abD + 0.03);
  }
  if (kind === 'beetle') {
    for (let i = 0; i < 4; i++) {
      const y = -1.5 - i * 1.8;
      shapes.bar(P(0, y, bodyZ + 3.2), P(0, y - 0.6, bodyZ + 6 - i * 0.4), Math.max(1, R(0.8)), lk.accent, abD + 0.04 + i * 0.001);
    }
  }
  // 胸、头、眼睛、大颚。
  const th = P(0, 0.9, bodyZ + 0.5);
  blob(shapes, th, R(kind === 'hopper' ? 2.2 : 2.8), R(2.4), dark, light, D(0, 0.9, bodyZ) + 0.1);
  const hd = P(0, 3.8, bodyZ + 0.2);
  const hdD = D(0, 3.8, bodyZ) + 0.2;
  blob(shapes, hd, R(2.1), R(1.8), dark, shell, hdD);
  for (const side of [-1, 1]) shapes.disc(P(side * 1.1, 4.8, bodyZ + 1.2), Math.max(0.6, R(0.45)), lk.accent, hdD + 0.03);
  if (kind !== 'flyer') {
    const open = deadK > 0 ? 0 : kind === 'spitter' ? st.spit : 0.5 + 0.5 * Math.sin(time * 9 + st.phase * 30);
    for (const side of [-1, 1]) {
      const a = P(side * 1.2, 5.2, bodyZ - 0.4);
      const b = P(side * (0.6 + open * 1.2), 7.6, bodyZ - 0.8);
      shapes.bar(a, b, Math.max(1, R(0.6)), lk.belly, hdD + 0.04);
    }
  }
}

// ─── 血迹 ─────────────────────────────────────────────────────────────────────
//
// 一滩血不是一个椭圆：中间几块不规则的主斑叠在一起，顺着中弹方向甩出去几道拉长的条痕，
// 周围再撒一圈大小不一的液滴。每一滩都按自己的随机种子现生成，所以没有两滩是一样的；
// 方向跟着"从哪边被打的"走，一整片打下来，地上的血迹会显出火力是从哪儿来的。

export interface SplatBlob {
  dx: number;
  dy: number;
  rx: number;
  ry: number;
  rot: number;
  dark: boolean;
}

export function makeSplat(size: number, dirX: number, dirY: number, big: boolean): SplatBlob[] {
  const out: SplatBlob[] = [];
  const dl = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / dl;
  const uy = dirY / dl;
  const ang = Math.atan2(uy, ux);
  const rnd = Math.random;
  // 主斑：3~6 块，偏向喷溅方向一点。
  const n = 3 + Math.floor(rnd() * (big ? 4 : 3));
  for (let i = 0; i < n; i++) {
    const r = size * (0.45 + rnd() * 0.55);
    const off = size * 0.6 * rnd();
    const a = ang + (rnd() - 0.5) * 2.4;
    out.push({ dx: Math.cos(a) * off, dy: Math.sin(a) * off, rx: r, ry: r * (0.6 + rnd() * 0.4), rot: rnd() * Math.PI, dark: rnd() < 0.55 });
  }
  // 条痕：顺着方向甩出去的长条。
  const streaks = 1 + Math.floor(rnd() * (big ? 4 : 2));
  for (let i = 0; i < streaks; i++) {
    const a = ang + (rnd() - 0.5) * 0.9;
    const len = size * (1.2 + rnd() * (big ? 1.8 : 1));
    out.push({ dx: Math.cos(a) * len * 0.75, dy: Math.sin(a) * len * 0.75, rx: len * 0.55, ry: size * (0.12 + rnd() * 0.14), rot: a, dark: rnd() < 0.4 });
  }
  // 液滴：一圈小点，多数落在喷溅方向的前方。
  const drops = 4 + Math.floor(rnd() * (big ? 12 : 6));
  for (let i = 0; i < drops; i++) {
    const a = ang + (rnd() - 0.5) * (rnd() < 0.7 ? 1.4 : 6);
    const dist = size * (1 + rnd() * (big ? 2.6 : 1.6));
    const r = size * (0.08 + rnd() * 0.16);
    out.push({ dx: Math.cos(a) * dist, dy: Math.sin(a) * dist, rx: r, ry: r * 0.85, rot: 0, dark: rnd() < 0.5 });
  }
  return out;
}

/** 画一滩血。blobs 的偏移和半径是世界单位，这里换算成屏幕。 */
export function drawSplat(shapes: ShapeBatch, at: Vec2, blobs: SplatBlob[], blood: [Rgba, Rgba], grain: number, squash: number, alpha: number, depth: number): void {
  const a = Math.round(200 * alpha);
  const dark = rgba(blood[0].r, blood[0].g, blood[0].b, a);
  const lite = rgba(blood[1].r, blood[1].g, blood[1].b, a);
  blobs.forEach((b, i) => {
    const c = v2(at.x + b.dx * grain, at.y + b.dy * grain * squash);
    // 椭圆的旋转在压扁的地面上要换算：方向向量的 y 分量乘压扁系数。
    const rot = Math.atan2(Math.sin(b.rot) * squash, Math.cos(b.rot));
    shapes.ellipse(c, Math.max(0.7, b.rx * grain), Math.max(0.7, b.ry * grain * squash * (0.7 + 0.3 * Math.abs(Math.cos(b.rot)))), rot, b.dark ? dark : lite, depth + i * 0.0001);
  });
}
