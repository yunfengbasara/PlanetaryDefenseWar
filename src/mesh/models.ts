import { v3 } from '../core/math';
import { type Rgba, lerpColor, rgb } from '../render/color';
import { Mesh3 } from './mesh';

/**
 * 载具、建筑和物件的模型。每个都是一个普通函数：在局部坐标里（X 朝前、Y 朝右、Z 朝上，单位和
 * 人物一样 —— 人 19 个单位高）用盒子、楔形、棱柱拼出来；会动的部件（炮塔、腿、雷达）挂在
 * 矩阵栈上，传一个角度进来就转。全部是原创造型。
 */

/** 航空炸弹：弹体 + 四片尾翼。沿 X 轴（机头方向）。 */
export function bomb(m: Mesh3): Mesh3 {
  const c = rgb(60, 66, 58);
  m.prism('x', -5, 5, 0, 0, 1.8, c, 8);
  m.hexa(
    [
      v3(5, -1.8, -1.8), v3(8, -0.3, -0.3), v3(8, 0.3, -0.3), v3(5, 1.8, -1.8),
      v3(5, -1.8, 1.8), v3(8, -0.3, 0.3), v3(8, 0.3, 0.3), v3(5, 1.8, 1.8),
    ],
    c,
  );
  m.box(-8, -5, -0.2, 0.2, -3, 3, c);
  m.box(-8, -5, -3, 3, -0.2, 0.2, c);
  return m;
}

/**
 * 双管高射炮塔：六角形底座、可转的炮塔、两根斜指天空的长管、侧面的雷达板。
 * yaw 炮塔转向，pitch 仰角，recoil 两根管交替后坐（0..1，正负表示哪一根）。
 */
export function aaTurret(m: Mesh3, p: { yaw: number; pitch: number; recoil: number }, body: Rgba, accent: Rgba): Mesh3 {
  const dark = lerpColor(body, rgb(16, 18, 28), 0.35);
  // 底座：一个矮的八棱台。
  m.prism('z', 0, 6, 0, 0, 13, dark, 8);
  m.prism('z', 6, 8, 0, 0, 10, body, 8);
  m.push().translate(0, 0, 8).rotZ(p.yaw);
  m.taper(-9, 9, -8, 8, 0, 9, 1.5, 3, 1.5, body);
  m.box(-8, 6, -8.2, -7.9, 2, 6, accent);
  m.box(-8, 6, 7.9, 8.2, 2, 6, accent);
  m.box(-6, -1, -11, -8, 4, 13, rgb(60, 66, 80)); // 侧面的雷达板
  m.push().translate(4, 0, 5).rotY(-p.pitch);
  for (const s of [-1, 1]) {
    const r = (s > 0 ? Math.max(0, p.recoil) : Math.max(0, -p.recoil)) * 3;
    m.prism('x', 2 - r, 30 - r, s * 3.2, 0, 1.2, rgb(70, 74, 86), 6);
    m.prism('x', 30 - r, 33 - r, s * 3.2, 0, 1.7, dark, 6);
  }
  m.box(-4, 4, -5, 5, -2.5, 2.5, dark); // 炮闩
  m.pop();
  m.pop();
  return m;
}

/**
 * 涂装：主体色、装甲板色、深色细节、警示条两色、发光件。同一个模型换一套涂装就是另一支部队。
 */
export interface Livery {
  base: Rgba;
  panel: Rgba;
  dark: Rgba;
  stripeA: Rgba;
  stripeB: Rgba;
  glow: Rgba;
}

/** 蓝白黑：白色主体、钴蓝装甲板、近黑的机件，青蓝色的灯。和动力装甲步兵一套。 */
export const LIVERY_BLUE: Livery = {
  base: rgb(214, 220, 230),
  panel: rgb(52, 88, 168),
  dark: rgb(34, 38, 50),
  stripeA: rgb(52, 88, 168),
  stripeB: rgb(26, 28, 36),
  glow: rgb(110, 200, 255),
};

/** 相间的警示条：沿 X 排一串小块，贴在某个面上。 */
function hazardStripe(m: Mesh3, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, L: Livery = LIVERY_BLUE): void {
  const n = Math.max(2, Math.round((x1 - x0) / 2.4));
  for (let i = 0; i < n; i++) {
    const a = x0 + ((x1 - x0) * i) / n;
    const b = x0 + ((x1 - x0) * (i + 1)) / n;
    m.box(a, b, y0, y1, z0, z1, i % 2 === 0 ? L.stripeA : L.stripeB);
  }
}

export interface WalkerPose {
  /** 上半身转向（局部）。 */
  torso: number;
  /** 步态相位：0..1，原地踏步时两条腿交替。 */
  step: number;
  /** 左右炮的后坐（正 = 右边那组、负 = 左边那组）。 */
  recoil: number;  /** 走路时的步幅：0 = 原地踏步，1 = 大步走（脚前后摆得开、抬得高）。 */
  stride?: number;
}

/**
 * 重型步行机甲：反关节的两条腿、驾驶舱、两臂各一组双联机炮、肩上两个导弹巢。
 * 原创造型，走的是重工业科幻的路子 —— 方、厚、到处是铆接的装甲板和警示条。
 */
export function walkerMech(m: Mesh3, p: WalkerPose, L: Livery = LIVERY_BLUE): Mesh3 {
  const metal = L.base;
  const dark = L.dark;
  // 腿：髋 → 膝（往前顶）→ 踝（往后收）→ 脚掌。两条腿交替抬一点。
  for (const s of [-1, 1]) {
    // 步态：前半周期抬脚往前迈（脚相对身体从后摆到前），后半周期脚踩在地上、相对身体匀速往后蹬。
    // 脚只在身体的前后方向上动，不往两边拐。
    const k = p.stride ?? 0;
    const amp = 1.5 + k * 5.5;
    const u = (p.step + (s > 0 ? 0.5 : 0)) % 1;
    let fx: number;
    let lift: number;
    if (u < 0.5) {
      const w = u / 0.5;
      fx = -amp + 2 * amp * (w * w * (3 - 2 * w));
      lift = Math.sin(w * Math.PI) * (2.2 + k * 2.3);
    } else {
      fx = amp - 2 * amp * ((u - 0.5) / 0.5);
      lift = 0;
    }
    const y = s * 7.5;
    const hip = v3(0, y, 22);
    const knee = v3(6 + fx * 0.5, y, 13 + lift);
    const ankle = v3(-2 + fx, y, 4 + lift);
    // 大腿、小腿：两段斜着的方柱（用 hexa 连两个截面）。
    const seg = (a: typeof hip, b: typeof hip, w: number, h: number, c: Rgba): void => {
      m.hexa(
        [
          v3(a.x - h, a.y - w, a.z), v3(a.x + h, a.y - w, a.z), v3(a.x + h, a.y + w, a.z), v3(a.x - h, a.y + w, a.z),
          v3(b.x - h, b.y - w, b.z), v3(b.x + h, b.y - w, b.z), v3(b.x + h, b.y + w, b.z), v3(b.x - h, b.y + w, b.z),
        ],
        c,
      );
    };
    seg(knee, hip, 2.4, 2.8, metal);
    seg(ankle, knee, 2, 2.2, dark);
    m.box(knee.x - 1, knee.x + 3.5, y - 2.8, y + 2.8, knee.z - 2, knee.z + 2.5, L.panel); // 膝甲
    // 脚掌：前面两个趾、后面一个跟。
    m.box(ankle.x - 5, ankle.x + 8, y - 3.6, y + 3.6, lift, lift + 2.4, dark);
    m.box(ankle.x + 6, ankle.x + 9, y - 3.6, y + 3.6, lift, lift + 1.4, metal);
  }
  // 骨盆。
  m.box(-6, 6, -9, 9, 19, 25, dark);
  // 上半身：可以转。
  m.push().translate(0, 0, 25).rotZ(p.torso);
  m.taper(-10, 10, -10, 10, 0, 15, 1, 4, 1.5, metal);
  m.box(-8, 6, -10.3, -10, 2, 10, L.panel);
  m.box(-8, 6, 10, 10.3, 2, 10, L.panel);
  hazardStripe(m, -7, 5, 10.3, 10.6, 11, 12.5, L);
  hazardStripe(m, -7, 5, -10.6, -10.3, 11, 12.5, L);
  // 驾驶舱：前面一道斜的深色玻璃，中间一条发光的观察缝。
  m.hexa(
    [
      v3(8, -6, 6), v3(11, -6, 6), v3(11, 6, 6), v3(8, 6, 6),
      v3(5.8, -5, 13), v3(6.4, -5, 13), v3(6.4, 5, 13), v3(5.8, 5, 13),
    ],
    rgb(40, 46, 56),
  );
  m.plate([v3(10.6, -4, 8.5), v3(10.6, 4, 8.5), v3(9.8, 4, 9.8), v3(9.8, -4, 9.8)], L.glow, true);
  // 两臂的双联机炮。
  for (const s of [-1, 1]) {
    const r = (s > 0 ? Math.max(0, p.recoil) : Math.max(0, -p.recoil)) * 2.5;
    const y = s * 13.5;
    m.box(-5, 7, y - 3.5, y + 3.5, 3, 10, dark); // 炮座
    m.box(-3, 5, y - 3.8, y + 3.8, 9.5, 10.5, L.panel);
    for (const k of [-1, 1]) {
      m.prism('x', 6 - r, 24 - r, y + k * 1.5, 6.5, 1.15, lerpColor(L.dark, L.base, 0.35), 6);
      m.prism('x', 24 - r, 27 - r, y + k * 1.5, 6.5, 1.6, dark, 6);
    }
  }
  // 肩上的导弹巢：一个红色方箱，前面一格格黑洞。
  for (const s of [-1, 1]) {
    const y = s * 7;
    m.box(-7, 4, y - 4, y + 4, 15, 21, L.panel);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) m.box(4, 4.4, y - 2.6 + i * 3, y - 0.6 + i * 3, 16 + j * 2.6, 17.8 + j * 2.6, rgb(24, 24, 26));
  }
  // 背部：一个背包式的动力舱 —— 外壳、两侧散热栅、上面两根排气管、中间一道发光的散热缝。
  m.box(-16, -9.5, -7.5, 7.5, 1, 13, dark);
  m.box(-16.4, -14, -6.5, 6.5, 3, 12, metal);
  for (let i = 0; i < 4; i++) m.box(-16.8, -16.4, -5.5 + i * 3, -4.3 + i * 3, 4, 10.5, dark); // 散热栅
  m.plate([v3(-16.9, -1, 4.5), v3(-16.9, 1, 4.5), v3(-16.9, 1, 10), v3(-16.9, -1, 10)].reverse(), L.glow, true);
  for (const s of [-1, 1]) {
    m.box(-15.5, -10, s * 8.6 - 1.3, s * 8.6 + 1.3, 2, 11, L.panel); // 侧面加强筋
    m.prism('z', 13, 19, -13, s * 4.2, 1.4, dark, 6); // 排气管
    m.prism('z', 18.6, 19.4, -13, s * 4.2, 1.9, metal, 6);
  }
  m.box(-15, -10, -4, 4, 13, 14, L.panel); // 舱顶检修盖
  m.box(-9, -8, 6, 7, 15, 24, rgb(50, 50, 54)); // 天线
  m.box(9, 10, -8, -7, 10, 11.5, L.glow, true); // 示廓灯
  m.pop();
  return m;
}

export interface SiegeTankPose {
  turret: number;
  recoil: number;
  /** 驻锄放下的程度 0..1。 */
  deploy: number;
}

/**
 * 重型攻城坦克：四个独立的履带舱、扁平的车体、大炮塔 + 长炮管，展开时四根驻锄撑地。
 */
export function siegeTank(m: Mesh3, p: SiegeTankPose, L: Livery = LIVERY_BLUE): Mesh3 {
  const metal = L.base;
  const dark = L.dark;
  // 车体压暗一档，和白色炮塔分开：从上往下看两块白叠在一起就分不清谁是谁。
  const hull = lerpColor(metal, dark, 0.38);
  // 四个履带舱，前后左右。
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = sx * 17;
      const y = sy * 15;
      m.hexa(
        [
          v3(x - 11, y - 4.5, 1), v3(x + 11, y - 4.5, 1), v3(x + 11, y + 4.5, 1), v3(x - 11, y + 4.5, 1),
          v3(x - 13, y - 4.5, 8), v3(x + 13, y - 4.5, 8), v3(x + 13, y + 4.5, 8), v3(x - 13, y + 4.5, 8),
        ],
        L.dark,
      );
      m.box(x - 12, x + 12, y - 5, y + 5, 8, 9.5, hull);
      // 驻锄：粗壮的液压撑脚 —— 缸体（粗）+ 活塞杆（细一圈）+ 一块大脚垫，从履带舱外侧斜撑到地上。
      const d = p.deploy;
      if (d > 0.02) {
        const out = sy * (6 + 10 * d);
        const top = v3(x, y + sy * 4.5, 7.5);
        const foot = v3(x, y + out, 1.2 + (1 - d) * 5);
        const mid = v3((top.x + foot.x) / 2, (top.y + foot.y) / 2, (top.z + foot.z) / 2);
        const strut = (a: typeof top, b: typeof top, w: number, c: Rgba): void => {
          m.hexa(
            [
              v3(a.x - w, a.y - w * 0.6, a.z - w * 0.6), v3(a.x + w, a.y - w * 0.6, a.z - w * 0.6), v3(a.x + w, a.y + w * 0.6, a.z + w * 0.6), v3(a.x - w, a.y + w * 0.6, a.z + w * 0.6),
              v3(b.x - w, b.y - w * 0.6, b.z - w * 0.6), v3(b.x + w, b.y - w * 0.6, b.z - w * 0.6), v3(b.x + w, b.y + w * 0.6, b.z + w * 0.6), v3(b.x - w, b.y + w * 0.6, b.z + w * 0.6),
            ],
            c,
          );
        };
        strut(top, mid, 3, metal);
        strut(mid, foot, 1.8, dark);
        m.box(x - 3.4, x + 3.4, top.y - 1.5, top.y + 1.5, 6, 9.5, L.panel); // 铰座
        m.box(x - 5, x + 5, foot.y - 3.5, foot.y + 3.5, 0, 1.4 * d + 0.2, dark); // 脚垫
        m.box(x - 4, x + 4, foot.y - 2.6, foot.y + 2.6, 1.4 * d + 0.2, 2 * d + 0.3, metal);
      }
    }
  }
  // 车体：扁的六面体，前低后高。
  m.hexa(
    [
      v3(-26, -11, 6), v3(26, -11, 6), v3(26, 11, 6), v3(-26, 11, 6),
      v3(-24, -10, 14), v3(18, -10, 13), v3(18, 10, 13), v3(-24, 10, 14),
    ],
    hull,
  );
  m.box(-24, -12, -8, 8, 14, 15.5, L.panel);
  hazardStripe(m, 10, 24, -10.5, -10.2, 9, 11, L);
  hazardStripe(m, 10, 24, 10.2, 10.5, 9, 11, L);
  // 炮塔：整体压在车体上画（深度偏移），座圈一圈深色，炮塔底边再垫一道阴影。
  m.bias = 20;
  m.prism('z', 13, 14.6, -2, 0, 12, dark, 10);
  m.push().translate(-2, 0, 14).rotZ(p.turret);
  m.box(-13.5, 12.5, -11.5, 11.5, 0, 1.2, dark);
  m.taper(-14, 13, -12, 12, 0, 9, 2, 5, 2, metal);
  m.box(-12, 4, -12.3, -12, 2, 7, L.panel);
  m.box(-12, 4, 12, 12.3, 2, 7, L.panel);
  m.box(-16, -13, -8, 8, 1, 7, dark);
  m.box(12, 16, -5, 5, 2, 7.5, dark); // 防盾
  const r = p.recoil * 6;
  m.prism('x', 16 - r, 56 - r, 0, 4.8, 2, lerpColor(L.dark, L.base, 0.45), 8);
  m.prism('x', 34 - r, 38 - r, 0, 4.8, 2.6, L.panel, 8); // 炮管中段的加强箍
  m.prism('x', 56 - r, 61 - r, 0, 4.8, 3.2, dark, 8); // 炮口制退器
  m.box(-6, 2, -4, 4, 9, 10.2, rgb(60, 64, 72)); // 顶舱盖
  m.box(4, 6, -2, 2, 9, 12, L.glow, true); // 炮塔顶的指示灯
  m.pop();
  m.bias = 0;
  return m;
}

/**
 * 武装运输机 / 炮艇：尖头机身、两侧两个发动机舱（尾喷口亮着）、后掠的短翼和双垂尾。
 * bank 是横滚（转弯时压坡度），thrust 0..1 控制尾焰亮度。
 */
export function gunship(m: Mesh3, p: { bank: number; thrust: number }, L: Livery = LIVERY_BLUE): Mesh3 {
  const metal = L.base;
  const dark = L.dark;
  m.rotX(p.bank);
  // 机身：机鼻、中段、尾段。
  m.hexa(
    [
      v3(18, -6, 4), v3(40, -1, 7), v3(40, 1, 7), v3(18, 6, 4),
      v3(18, -6, 13), v3(40, -1, 9), v3(40, 1, 9), v3(18, 6, 13),
    ],
    metal,
  );
  m.box(-26, 18, -7, 7, 3, 13, metal);
  m.box(-20, 10, -7.3, 7.3, 9, 10.5, L.panel);
  m.hexa(
    [
      v3(14, -4, 13), v3(30, -2, 10), v3(30, 2, 10), v3(14, 4, 13),
      v3(16, -3, 16), v3(24, -1.5, 13), v3(24, 1.5, 13), v3(16, 3, 16),
    ],
    rgb(50, 70, 90),
  ); // 座舱
  // 短翼 + 发动机舱。
  for (const s of [-1, 1]) {
    m.hexa(
      [
        v3(-14, s * 7, 6), v3(10, s * 7, 6), v3(-2, s * 30, 6), v3(-16, s * 30, 6),
        v3(-14, s * 7, 8), v3(10, s * 7, 8), v3(-2, s * 30, 7.4), v3(-16, s * 30, 7.4),
      ],
      metal,
    );
    hazardStripe(m, -14, -4, s * 27 - 1, s * 27 + 1, 7.5, 7.9, L);
    m.prism('x', -22, 6, s * 20, 6, 4.6, dark, 8); // 发动机舱
    m.prism('x', 6, 10, s * 20, 6, 3.6, L.panel, 8); // 进气口
    m.prism('x', -23.5, -22, s * 20, 6, 3.4, lerpColor(L.glow, rgb(255, 255, 220), p.thrust * 0.5), 8, rgb(255, 210, 120)); // 尾喷口
    // 垂尾。
    m.hexa(
      [
        v3(-26, s * 5, 12), v3(-14, s * 5, 12), v3(-14, s * 6, 12), v3(-26, s * 6, 12),
        v3(-30, s * 8, 24), v3(-22, s * 8, 24), v3(-22, s * 9, 24), v3(-30, s * 9, 24),
      ],
      L.panel,
    );
  }
  return m;
}

export interface BattlecruiserPose {
  /** 主炮蓄能 0..1：舰首炮口越来越亮。 */
  charge: number;
  /** 引擎亮度 0..1。 */
  thrust: number;
}

/**
 * 战列巡航舰：分叉的舰首（两根前伸的重装甲舰艏夹着中间的主炮）、长条舰身、指挥塔、
 * 两舷翼舱和几座小炮台、舰尾一排引擎。原创造型，走的是厚重的太空战舰路子。
 * 局部坐标 X 朝前，长约 190（-95..95），宽约 70。
 */
export function battlecruiser(m: Mesh3, p: BattlecruiserPose, L: Livery = LIVERY_BLUE): Mesh3 {
  const metal = L.base;
  const dark = L.dark;
  const mid = lerpColor(metal, dark, 0.38);
  // 龙骨：舰身下面一条窄一些的深色底。
  m.hexa(
    [
      v3(-80, -10, -8), v3(50, -6, -6), v3(50, 6, -6), v3(-80, 10, -8),
      v3(-84, -14, 2), v3(56, -10, 2), v3(56, 10, 2), v3(-84, 14, 2),
    ],
    dark,
  );
  // 主舰身：前低后高的长条，顶上收窄。
  m.hexa(
    [
      v3(-84, -17, 2), v3(44, -14, 2), v3(44, 14, 2), v3(-84, 17, 2),
      v3(-80, -13, 18), v3(36, -10, 14), v3(36, 10, 14), v3(-80, 13, 18),
    ],
    mid,
  );
  // 背脊上一条白色装甲带 + 一排蓝色装甲板。
  m.box(-74, 30, -7, 7, 14, 17.5, metal);
  for (let i = 0; i < 5; i++) m.box(-66 + i * 18, -54 + i * 18, -11.5, 11.5, 12, 14.8, i % 2 ? L.panel : metal);
  // 分叉舰首：左右两根重装甲舰艏往前伸，前端削尖。
  for (const s of [-1, 1]) {
    m.hexa(
      [
        v3(30, s * 5, 0), v3(96, s * 6, 3), v3(96, s * 14, 3), v3(30, s * 22, 0),
        v3(30, s * 6, 17), v3(88, s * 7, 12), v3(88, s * 13, 12), v3(30, s * 20, 17),
      ],
      metal,
    );
    m.box(40, 80, s * 8, s * 18, 15, 16.5, L.panel);
    hazardStripe(m, 70, 86, s * 21.5 - 0.3, s * 21.5, 4, 6, L);
  }
  // 主炮：两根舰艏中间的深色炮槽，前端一个发光的炮口，蓄能时越来越亮。
  m.box(26, 84, -4.5, 4.5, 3, 12, dark);
  m.prism('x', 60, 88, 0, 8, 3.4, lerpColor(dark, metal, 0.3), 8);
  const glow = lerpColor(rgb(40, 60, 90), rgb(255, 250, 230), p.charge);
  m.box(88, 89.5, -2.4, 2.4, 5.6, 10.4, glow, true);
  // 两舷翼舱。
  for (const s of [-1, 1]) {
    m.hexa(
      [
        v3(-60, s * 16, 3), v3(6, s * 14, 3), v3(6, s * 30, 4), v3(-50, s * 38, 4),
        v3(-60, s * 16, 12), v3(6, s * 14, 10), v3(4, s * 28, 8), v3(-50, s * 36, 9),
      ],
      metal,
    );
    m.box(-48, -6, s * 30 - 2, s * 30 + 2, 8.5, 9.6, L.panel);
    for (let i = 0; i < 4; i++) m.box(-44 + i * 10, -38 + i * 10, s * 36 - 0.4, s * 36 + 0.4, 5, 7, L.glow, true); // 舷窗
  }
  // 指挥塔。
  m.taper(-46, -20, -8, 8, 17, 30, 3, 6, 2, metal);
  m.box(-28, -26.5, -5, 5, 25, 27.5, L.glow, true);
  m.box(-44, -36, -2, 2, 30, 38, dark); // 天线桅
  // 小炮台：背脊上三座双联炮。
  for (const x of [8, -6, -62]) {
    m.prism('z', 17.5, 20, x, 0, 4, dark, 8);
    m.box(x - 3, x + 3, -3, 3, 20, 22.5, metal);
    for (const k of [-1, 1]) m.prism('x', x + 3, x + 10, k * 1.4, 21.3, 0.7, dark, 6);
  }
  // 舰尾引擎组：一个深色的大方块，后面四个喷口，喷口里发光。
  m.box(-96, -80, -22, 22, 0, 20, dark);
  m.box(-94, -82, -23, 23, 18, 21, L.panel);
  const fire = lerpColor(rgb(40, 70, 110), L.glow, p.thrust);
  for (const [y, z] of [[-14, 6], [14, 6], [-6, 14], [6, 14]]) {
    m.prism('x', -101, -96, y, z, 4.6, lerpColor(dark, metal, 0.25), 8);
    m.box(-101.5, -101, y - 3, y + 3, z - 3, z + 3, fire, true);
  }
  return m;
}

/** 沿 Y 排的警示条（贴在朝 +X 的面上）：门框下沿、门楣用。 */
function hazardStripeY(m: Mesh3, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, L: Livery): void {
  const n = Math.max(2, Math.round((y1 - y0) / 2.4));
  for (let i = 0; i < n; i++) {
    const a = y0 + ((y1 - y0) * i) / n;
    const b = y0 + ((y1 - y0) * (i + 1)) / n;
    m.box(x0, x1, a, b, z0, z1, i % 2 === 0 ? L.stripeA : L.stripeB);
  }
}

/**
 * 指挥中心（基地）：四条着陆腿撑着一座方墩墩的堡垒 —— 外扩的裙甲、主楼、两舷推进舱、
 * 正面（+X）一扇大闸门、楼顶的指挥塔、转动的雷达和闪灯天线。原创造型。
 * 占地约 110×110，高约 64。t 是时间（秒），驱动雷达和灯。
 */
export function commandCenter(m: Mesh3, p: { t: number }, L: Livery = LIVERY_BLUE): Mesh3 {
  const metal = L.base;
  const dark = L.dark;
  const mid = lerpColor(metal, dark, 0.38);
  // 着陆腿：四角一个脚垫 + 一根斜撑到楼底。
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = sx * 42;
      const y = sy * 40;
      m.box(x - 8, x + 8, y - 8, y + 8, 0, 3, dark);
      m.box(x - 6, x + 6, y - 6, y + 6, 3, 4.5, mid);
      m.hexa(
        [
          v3(x - 4, y - 4, 4), v3(x + 4, y - 4, 4), v3(x + 4, y + 4, 4), v3(x - 4, y + 4, 4),
          v3(x * 0.82 - 4, y * 0.82 - 4, 14), v3(x * 0.82 + 4, y * 0.82 - 4, 14), v3(x * 0.82 + 4, y * 0.82 + 4, 14), v3(x * 0.82 - 4, y * 0.82 + 4, 14),
        ],
        metal,
      );
    }
  }
  // 裙甲：下窄上宽，往外扩。
  m.hexa(
    [
      v3(-36, -34, 8), v3(36, -34, 8), v3(36, 34, 8), v3(-36, 34, 8),
      v3(-46, -42, 18), v3(46, -42, 18), v3(46, 42, 18), v3(-46, 42, 18),
    ],
    mid,
  );
  // 主楼。
  m.box(-45, 45, -41, 41, 18, 34, metal);
  // 腰带：一圈蓝色装甲板。
  m.box(-45.6, 45.6, -41.6, 41.6, 27, 30, L.panel);
  // 主楼四角的蓝色护角。
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) m.box(sx * 45.8 - 5, sx * 45.8 + 5, sy * 41.8 - 5, sy * 41.8 + 5, 18, 35, L.panel);
  // 楼顶甲板：往上收；甲板上几道深色接缝、两块蓝色装甲板。
  m.taper(-40, 38, -36, 36, 34, 42, 4, 6, 4, metal);
  for (const x of [-22, 10]) m.box(x - 0.5, x + 0.5, -32, 32, 42, 42.3, dark);
  for (const y of [-18, 18]) m.box(-34, 30, y - 0.5, y + 0.5, 42, 42.3, dark);
  m.box(14, 30, -12, 12, 42, 43, L.panel);
  m.box(-34, -24, -12, 12, 42, 43, L.panel);
  // 两舷推进舱（±Y），前端深色、后端喷口发光。
  for (const s of [-1, 1]) {
    m.prism('x', -34, 22, s * 47, 25, 7.5, mid, 8);
    m.prism('x', 22, 26, s * 47, 25, 8.2, L.panel, 8);
    m.prism('x', -38, -34, s * 47, 25, 6.5, dark, 8);
    m.box(-38.6, -38, s * 47 - 4, s * 47 + 4, 21, 29, L.glow, true);
    // 推进舱和主楼之间的挂架。
    m.box(-20, 8, s * 41, s * 44, 22, 28, dark);
  }
  // 正面大闸门：深色门洞、两扇门板、门框、下沿和门楣上的警示条、门楣上一排灯。
  m.box(45, 46.5, -18, 18, 18, 33, L.panel);
  m.box(46, 47, -15, 15, 18, 30, dark);
  m.box(46.5, 47.4, -14, -0.6, 18.5, 29.5, mid);
  m.box(46.5, 47.4, 0.6, 14, 18.5, 29.5, mid);
  hazardStripeY(m, 46.5, 48, -18, 18, 16.5, 18, L);
  for (let i = 0; i < 5; i++) m.box(46.5, 47, -10 + i * 5 - 0.8, -10 + i * 5 + 0.8, 31, 32.2, L.glow, true);
  // 主楼正面两侧的观察窗。
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) m.box(45, 45.8, s * (24 + i * 5) - 1.6, s * (24 + i * 5) + 1.6, 21.5, 24, L.glow, true);
  // 楼顶：指挥塔（圆柱 + 一圈发光的窗 + 顶盖）。
  m.prism('z', 42, 56, -6, 0, 15, mid, 10);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    m.push().translate(-6 + Math.cos(a) * 15, Math.sin(a) * 15, 0).rotZ(a);
    m.box(-0.3, 0.6, -2.4, 2.4, 50, 52.5, L.glow, true);
    m.pop();
  }
  m.prism('z', 56, 59, -6, 0, 16.5, L.panel, 10);
  m.prism('z', 59, 61, -6, 0, 9, metal, 10);
  // 楼顶的通风口。
  for (const [x, y] of [[22, -24], [22, 24], [-30, -24]]) {
    m.box(x - 5, x + 5, y - 4, y + 4, 41, 43, dark);
    for (let k = 0; k < 3; k++) m.box(x - 4, x + 4, y - 3 + k * 2.4, y - 2.2 + k * 2.4, 43, 43.4, mid);
  }
  // 雷达：一根桅杆上一面会转的天线板。
  m.push().translate(-28, 24, 42).rotZ(p.t * 0.9);
  m.box(-1.2, 1.2, -1.2, 1.2, 0, 10, dark);
  m.hexa(
    [
      v3(-1, -9, 8), v3(1, -9, 8), v3(1, 9, 8), v3(-1, 9, 8),
      v3(2.5, -9, 15), v3(4.5, -9, 15), v3(4.5, 9, 15), v3(2.5, 9, 15),
    ],
    metal,
  );
  m.pop();
  // 天线：细高的杆，顶上一盏一闪一闪的红灯。
  m.box(-37, -35, -30, -28, 42, 68, dark);
  const blink = Math.sin(p.t * 3) > 0.3;
  m.box(-37.5, -34.5, -30.5, -27.5, 68, 70.5, blink ? rgb(255, 80, 60) : rgb(90, 30, 30), blink);
  return m;
}

/**
 * 兵营：一座斜顶的厂房，正面（+X）一扇上下升降的大门（door 0..1 = 关..开），门里亮着灯；
 * 两侧两座立塔带闪灯，屋顶两根排气烟囱。原创造型。占地约 84×70，高约 46。
 */
export function barracks(m: Mesh3, p: { t: number; door: number }, L: Livery = LIVERY_BLUE): Mesh3 {
  const metal = L.base;
  const dark = L.dark;
  const mid = lerpColor(metal, dark, 0.38);
  m.box(-42, 40, -34, 34, 0, 4, dark); // 地基
  // 厂房：正面往里斜一点。
  m.hexa(
    [
      v3(-38, -30, 4), v3(34, -30, 4), v3(34, 30, 4), v3(-38, 30, 4),
      v3(-36, -28, 28), v3(30, -28, 28), v3(30, 28, 28), v3(-36, 28, 28),
    ],
    metal,
  );
  // 斜屋顶 + 两条蓝色屋脊板。
  m.hexa(
    [
      v3(-36, -28, 28), v3(30, -28, 28), v3(30, 28, 28), v3(-36, 28, 28),
      v3(-32, -22, 36), v3(14, -22, 36), v3(14, 22, 36), v3(-32, 22, 36),
    ],
    mid,
  );
  m.box(-30, 12, -16, -12, 35.5, 37, L.panel);
  m.box(-30, 12, 12, 16, 35.5, 37, L.panel);
  // 屋顶的横向肋条（沿两侧斜面）。
  for (let i = 0; i < 6; i++) {
    const x = -30 + i * 8;
    for (const s of [-1, 1]) m.box(x - 0.6, x + 0.6, s * 17, s * 27.5, 30, 35, dark);
  }
  // 屋顶中间一个小检修舱，前面一盏灯。
  m.box(-18, -4, -7, 7, 36, 40, metal);
  m.box(-4, -3.4, -4, 4, 37, 39, L.glow, true);
  // 侧墙的一排窗。
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) m.box(-28 + i * 13, -22 + i * 13, s * 30.2 - 0.4, s * 30.2 + 0.4, 15, 18, L.glow, true);
  // 大门：门框、门洞里的灯、升降的门板、下沿警示条、门楣上的标牌。
  m.box(31, 35, -16, 16, 4, 26, L.panel);
  m.box(34.5, 35.2, -12, 12, 4, 22, rgb(255, 214, 140), true);
  const top = 22;
  const bottom = 4 + p.door * 17;
  if (top - bottom > 0.3) {
    m.box(35, 36, -12, 12, bottom, top, mid);
    for (let z = bottom + 2.5; z < top - 0.5; z += 3) m.box(35.8, 36.2, -11.5, 11.5, z, z + 0.6, dark);
  }
  hazardStripeY(m, 35, 36.6, -16, 16, 4, 5.6, L);
  m.box(35, 36, -8, 8, 23, 25.5, dark);
  m.box(35.8, 36.3, -6.5, 6.5, 23.6, 25, L.glow, true);
  // 两侧立塔：方柱 + 顶上一盏闪灯（两边错开闪）。
  for (const s of [-1, 1]) {
    m.box(-8, 4, s * 30, s * 38, 0, 40, metal);
    m.box(-8.4, 4.4, s * 29.6, s * 38.4, 30, 33, L.panel);
    m.box(-4, 0, s * 32, s * 36, 40, 43, dark);
    const on = Math.sin(p.t * 2.5 + s * 1.6) > 0.4;
    m.box(-3.4, -0.6, s * 32.6, s * 35.4, 43, 45.5, on ? L.glow : lerpColor(L.glow, dark, 0.7), on);
  }
  // 屋顶后部两根排气烟囱。
  for (const s of [-1, 1]) {
    m.prism('z', 30, 46, -26, s * 12, 3.4, dark, 8);
    m.prism('z', 46, 47.5, -26, s * 12, 4.2, mid, 8);
  }
  return m;
}

/**
 * 水晶核心：六角形的金属基座、一圈蓝色装甲环、三根带灯的导流柱，上面悬着一颗慢慢转、
 * 上下浮动的大水晶，旁边两小块碎晶绕着它转。原创造型。
 * 占地约 36×36，水晶尖顶高约 44。t 是时间（秒）；hit 是挨打后的闪白（0..1）；broken 时只剩基座。
 */
export function crystalCore(m: Mesh3, p: { t: number; hit: number; broken?: boolean }, L: Livery = LIVERY_BLUE): Mesh3 {
  const metal = L.base;
  const dark = L.dark;
  // 基座：两层六角台，上层蓝色装甲环。
  m.prism('z', 0, 3, 0, 0, 18, lerpColor(metal, dark, 0.45), 6);
  m.prism('z', 3, 6, 0, 0, 14, L.panel, 6);
  m.prism('z', 6, 7, 0, 0, 9, dark, 6);
  // 三根导流柱，顶上一盏灯。
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 15;
    const y = Math.sin(a) * 15;
    m.box(x - 1.6, x + 1.6, y - 1.6, y + 1.6, 3, 14, metal);
    m.box(x - 1.2, x + 1.2, y - 1.2, y + 1.2, 14, 16, L.glow, true);
  }
  if (p.broken) return m;
  // 主水晶：上下浮动、慢慢自转；挨打时整颗闪白。
  const bob = Math.sin(p.t * 1.6) * 3;
  const gem = lerpColor(rgb(84, 206, 240), rgb(255, 255, 255), p.hit * 0.8);
  m.push().translate(0, 0, 24 + bob).rotZ(p.t * 0.5);
  m.gem(8.5, 16, 11, gem, 6);
  m.pop();
  // 两块碎晶绕着转，和主水晶反着浮。
  for (let i = 0; i < 2; i++) {
    const a = p.t * 1.1 + i * Math.PI;
    m.push().translate(Math.cos(a) * 14, Math.sin(a) * 14, 22 - bob * 0.6).rotZ(-p.t * 1.5);
    m.gem(2.4, 4.5, 3.2, lerpColor(rgb(130, 226, 250), rgb(255, 255, 255), p.hit * 0.8), 4);
    m.pop();
  }
  return m;
}

/**
 * 机器人车间：一座宽大的装配厂房。正面（+X）一扇落地的大卷帘门（door 0..1 = 关..开），门洞里亮着
 * 装配线的灯；屋顶两条导轨上一台吊车来回挪；侧面两座配电塔、后部两根排气管。原创造型。
 * 占地约 80×84，高约 58；门洞够一台步行机甲直着走出来。t 是时间（秒）。
 */
export function mechFactory(m: Mesh3, p: { t: number; door: number }, L: Livery = LIVERY_BLUE): Mesh3 {
  const metal = L.base;
  const dark = L.dark;
  const mid = lerpColor(metal, dark, 0.38);
  // 地基和主厂房：墙往里收一点，正面是平的（门在上面）。
  m.box(-41, 41, -43, 43, 0, 3, dark);
  m.taper(-38, 36, -40, 40, 3, 46, 3, 0, 3, metal);
  // 墙腰一圈蓝色装甲带，四角护角。
  m.box(-38.6, 36.6, -40.6, 40.6, 30, 34, L.panel);
  for (const sy of [-1, 1]) {
    m.box(30, 37, sy * 40.8 - 4, sy * 40.8 + 4, 3, 47, L.panel);
    m.box(-39, -32, sy * 40.8 - 4, sy * 40.8 + 4, 3, 47, mid);
  }
  // 屋顶：一层收窄的顶板 + 中间一道天窗。
  m.taper(-35, 33, -37, 37, 46, 52, 3, 3, 3, mid);
  m.box(-26, 22, -5, 5, 52, 53.5, L.glow, true);
  // 屋顶吊车：两条导轨，一台横梁在上面来回挪，吊钩下垂。
  for (const sy of [-1, 1]) m.box(-30, 28, sy * 26 - 1.5, sy * 26 + 1.5, 52, 55, dark);
  const cx = Math.sin(p.t * 0.6) * 20;
  m.box(cx - 4, cx + 4, -30, 30, 55, 58, L.panel);
  m.box(cx - 2, cx + 2, -3, 3, 50, 55, dark);
  // 正面大门：门框（蓝）、门洞里的装配灯、卷帘门板（往上卷）、下沿警示条、门楣灯牌。
  m.box(36, 39, -24, 24, 3, 44, L.panel);
  m.box(38.6, 39.2, -19, 19, 3, 40, rgb(255, 214, 140), true);
  const top = 40;
  const bottom = 3 + p.door * 36;
  if (top - bottom > 0.3) {
    m.box(39, 40, -19, 19, bottom, top, mid);
    for (let z = bottom + 3; z < top - 0.5; z += 3.5) m.box(39.8, 40.2, -18.5, 18.5, z, z + 0.7, dark);
  }
  hazardStripeY(m, 39, 40.6, -24, 24, 3, 4.8, L);
  m.box(39, 40, -12, 12, 41, 44, dark);
  for (let i = 0; i < 5; i++) m.box(39.8, 40.3, -9 + i * 4.5 - 1, -9 + i * 4.5 + 1, 41.8, 43.2, L.glow, true);
  // 门开着的时候门洞两侧的警示灯转起来。
  for (const sy of [-1, 1]) {
    const on = p.door > 0.05 && Math.sin(p.t * 8 + sy) > 0;
    m.box(39, 41, sy * 22 - 1.5, sy * 22 + 1.5, 44, 47, on ? rgb(255, 170, 60) : lerpColor(rgb(255, 170, 60), dark, 0.7), on);
  }
  // 两侧配电塔：方柱 + 一排发光的格栅 + 顶灯。
  for (const sy of [-1, 1]) {
    m.box(-20, -6, sy * 40, sy * 47, 3, 38, mid);
    for (let i = 0; i < 4; i++) m.box(-18 + i * 3.4, -16.4 + i * 3.4, sy * 47 - 0.3, sy * 47 + 0.3, 20, 30, L.glow, true);
    const on = Math.sin(p.t * 2.2 + sy * 1.4) > 0.3;
    m.box(-15, -11, sy * 42.5 - 2, sy * 42.5 + 2, 38, 41, on ? L.glow : lerpColor(L.glow, dark, 0.7), on);
  }
  // 后部两根排气管。
  for (const sy of [-1, 1]) m.prism('z', 46, 60, -30, sy * 18, 3.2, dark, 8);
  return m;
}
