import { type Vec2, type Vec3, clamp, lerp, v2, v3 } from '../core/math';
import { Effects } from '../fx/effects';
import { type Kit, makeKit } from '../characters/kit';
import { drawMarine } from '../characters/renderer';
import { Pose, RigSpec } from '../characters/rig';
import { Mesh3, drawMesh, drawShadow } from '../mesh/mesh';
import { LIVERY_BLUE, aaTurret, barracks, battlecruiser, bomb, commandCenter, gunship, siegeTank, walkerMech } from '../mesh/models';
import type { Camera } from '../render/camera';
import { type Rgba, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { Layers } from '../render/scene';
import { fallPose, strideCycle, walkPose } from '../characters/poses';
import { LANE_CX, drawFloor, spanAt } from './floor';
import { PlatformGround } from './ground';
import { type FieldDef, field } from './fields';
import { BUG_LOOKS, BUG_SIZE, type BugKind, type BugLook, type SplatBlob, drawBug, drawSplat, makeSplat } from './bugs';

/**
 * 行星防卫战的战场：一条悬在深空里的金属平台，虫群从上方顺着通道涌下来。
 *
 *   上方    虫群：小爬虫、跳虫、重甲甲虫、刺蛇、喷酸虫、飞虫
 *   防线    一排动力装甲机枪兵（有血条，阵亡后由兵营补人）—— **只打自己正面一定范围内的虫**；
 *           身后两台步行机甲来回巡逻
 *   后方    攻城坦克平射虫堆、双管高射炮塔打飞虫，最后面是兵营和指挥中心
 *   侧面    虚空里停着一艘战列巡航舰，隔很久一发主炮
 *   空中    时不时一组炮艇从下往上掠过投弹
 *
 * 虫的死法有两种：瘫倒（腿蜷起来、身子发暗，留一会儿），或者**被打爆**（甲壳碎成一片片飞出去，
 * 落地后散在地上）。爆炸一律打爆；步枪打死的一部分会爆。地上留下的血迹每一滩都是现生成的。
 */

/** 防线（机枪兵站的那一行）的 y。 */
export const LINE_Y = 470;
/** 炮艇从画面下方多远的地方进场。 */
const PLANE_ENTRY_Y = 980;

/** 射程：步枪只管正面一条纵列；机枪的扇面宽一些、远一些；坦克更远。 */
const RIFLE_RANGE = 210;
const RIFLE_LANE = 60;
/** 机甲：比步兵打得远、扇面宽、射速快；肩上导弹巢专打飞虫。 */
const MECH_RANGE = 300;
const MECH_LANE = 150;
const MISSILE_RANGE = 360;
const TANK_RANGE = 330;
const TANK_LANE = 170;
const AA_RANGE = 320;

/** 动力装甲：深蓝的甲片、橙色的饰条、发光的橙色面罩（帽檐那一块就是面罩）。 */
const MARINE_KIT: Kit = {
  ...makeKit({ shirt: rgb(66, 94, 160), trim: rgb(240, 150, 50), trousers: rgb(52, 62, 94), cap: rgb(78, 104, 170) }),
  capShade: rgb(255, 176, 60),
  shirtLight: rgb(130, 160, 220),
  skin: rgb(66, 94, 160),
  skinShade: rgb(40, 56, 100),
  glove: rgb(60, 66, 80),
  gloveShade: rgb(36, 40, 50),
  shoe: rgb(50, 60, 90),
  shoeDark: rgb(26, 30, 44),
};
const MARINE_SCALE = 1.18;
/** 机枪兵的血量、各种伤害。 */
const MARINE_HP = 30;
/** 血条分几格。 */
const HP_PIPS = 5;
const BITE: Partial<Record<BugKind, number>> = { crawler: 1, hopper: 2, beetle: 3 };
const SPIKE_DMG = 4;
const ACID_DMG = 2;
/** 兵营造一个兵的时间、新兵走路的速度、尸体躺多久。 */
const BUILD_TIME = 3;
const WALK_SPEED = 30;
/** 新兵走路的步幅（walkPose 的 gait）、对应的一个步态周期走多远（世界单位）。 */
const WALK_GAIT = 0.85;
const WALK_CYCLE = strideCycle(WALK_GAIT) * MARINE_SCALE;
const CORPSE_TIME = 7;
/** 战列巡航舰比模型原尺寸再大一圈：它得是场上最大的东西。 */
const CRUISER_SCALE = 1.4;
/** 后方的两座建筑：兵营在左、指挥中心在右，正面朝镜头。 */
const BARRACKS = v2(LANE_CX - 118, 690);
const BASE_CC = v2(LANE_CX + 96, 694);

const MOON_DEBRIS = [rgb(150, 150, 156), rgb(120, 118, 126), rgb(176, 174, 180)];

const SPINE = RigSpec.chestZ - RigSpec.hipZ;

function aimPose(pose: Pose, recoil: number): void {
  walkPose(pose, 0, 0);
  pose.hip = v3(0, -0.3 - recoil * 0.3, RigSpec.hipZ - 0.3);
  // 两脚分开站：前后错开、左右也拉开，装甲腿粗，站窄了两条腿就并成一块。
  pose.footL = v3(-3.4, 1.8, 0);
  pose.footR = v3(3.6, -1.8, 0);
  const lean = 0.12 - recoil * 0.08;
  pose.spineLean = lean;
  pose.spineYaw = 0.25;
  pose.chest = v3(0, pose.hip.y + Math.sin(lean) * SPINE, pose.hip.z + Math.cos(lean) * SPINE);
  const neck = RigSpec.headZ - RigSpec.chestZ;
  pose.head = v3(0.6, pose.chest.y + Math.sin(lean) * neck, pose.chest.z + Math.cos(lean) * neck);
  const k = recoil * 1.2;
  const butt = v3(1.7, pose.chest.y - 0.5 - k, pose.chest.z + 0.8);
  const muzzle = v3(0.9, pose.chest.y + 10.5 - k, pose.chest.z + 1.6);
  pose.gunButt = butt;
  pose.gunMuzzle = muzzle;
  pose.handR = v3(butt.x + 0.1, butt.y + 2.2, butt.z - 0.9);
  pose.handL = v3(butt.x - 1.2, butt.y + 6.2, butt.z - 0.5);
  pose.solveLimbs();
}

/** 行军时端枪：枪斜挎在胸前，右手握握把、左手托护木。walkPose 之后调用，覆盖两只手。 */
function carryPose(pose: Pose): void {
  const c = pose.chest;
  const grip = v3(1.8, c.y + 1.4, c.z - 3.2);
  const muzzle = v3(-1.6, c.y + 3.2, c.z + 5.4);
  pose.gunButt = grip;
  pose.gunMuzzle = muzzle;
  pose.handR = v3(grip.x + 0.2, grip.y + 0.4, grip.z + 0.6);
  pose.handL = v3(lerp(grip.x, muzzle.x, 0.55), lerp(grip.y, muzzle.y, 0.55) + 0.3, lerp(grip.z, muzzle.z, 0.55));
  pose.solveLimbs();
}

interface Bug {
  kind: BugKind;
  look: BugLook;
  x: number;
  y: number;
  z: number;
  lift: number;
  vz: number;
  kx: number;
  ky: number;
  speed: number;
  phase: number;
  hp: number;
  dead: number;
  wobble: number;
  /** 跳虫：一跳的计时（< 0.4 在空中）。 */
  hop: number;
  /** 刺蛇 / 喷酸虫：在哪儿停下来攻击。emerge 恒为 1（历史字段）。 */
  emerge: number;
  surfaceAt: number;
  /** 喷酸 / 放刺的冷却；喷吐动作。 */
  cd: number;
  spit: number;
}

interface Splat {
  x: number;
  y: number;
  t: number;
  blobs: SplatBlob[];
  blood: [Rgba, Rgba];
}

/** 甲壳碎片：一片小三角，飞出去、落地、躺一会儿。 */
interface Shard {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rot: number;
  spin: number;
  size: number;
  color: Rgba;
  t: number;
}

/** 地刺：从地里刺出来再缩回去。 */
interface Spike {
  x: number;
  y: number;
  t: number;
  h: number;
}

/** 酸液弹。 */
interface Glob {
  from: Vec3;
  to: Vec3;
  t: number;
  dur: number;
}

interface Defender {
  kind: 'rifle' | 'mech';
  x: number;
  y: number;
  z: number;
  cd: number;
  recoil: number;
  pose: Pose;
  burst: number;
  yaw: number;
  target: Bug | null;
  /** 机甲：步态相位、哪一侧在开火、导弹冷却。 */
  step: number;
  side: number;
  missileCd: number;
  /** 机甲巡逻：下半身朝向、要走的方向（±1）、停顿计时、巡逻区间、当前步幅。 */
  heading: number;
  dir: number;
  pause: number;
  minX: number;
  maxX: number;
  stride: number;
  /** 机枪兵：血量、死了多久（< 0 = 活着）、站位。 */
  hp: number;
  deadT: number;
  slotX: number;
  slotY: number;
}

/** 从兵营走向空缺站位的新兵。 */
interface Walker {
  slot: Defender;
  x: number;
  y: number;
  path: Vec2[];
  phase: number;
  heading: number;
  pose: Pose;
}

interface Gun {
  kind: 'tank' | 'aa';
  x: number;
  y: number;
  yaw: number;
  aim: number;
  pitch: number;
  recoil: number;
  cd: number;
  barrel: number;
  target: Bug | null;
  /** 坦克：多久之后才重新挑目标。 */
  retarget: number;
}

/**
 * 一颗子弹：不再是"从枪口到目标的一整条线"，而是一小截亮条沿着弹道**飞过去**。
 * 前端亮、尾巴淡；飞到了才算打中（命中的火星、打空的尘土都在那一刻出现）。
 */
interface Bullet {
  a: Vec3;
  b: Vec3;
  dist: number;
  speed: number;
  t: number;
  color: Rgba;
  width: number;
  len: number;
  /** 机枪大约每三发一颗曳光弹：其余的照样飞、照样打中，只是看不见。 */
  visible: boolean;
  kind: 'rifle' | 'cannon' | 'aa';
  target: Bug | null;
  hit: boolean;
  fromX: number;
  fromY: number;
  arrived: boolean;
}

/** 火星：命中 / 打在地上溅起来的亮点，很快熄灭。 */
interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  life: number;
  color: Rgba;
}

/** 枪口焰：随机转角的十字星芒，只亮一两帧。 */
interface Flash {
  x: number;
  y: number;
  z: number;
  gz: number;
  t: number;
  size: number;
  rot: number;
  color: Rgba;
}

/** 机甲肩上的导弹：带烟尾，拐着弯追目标。 */
interface Missile {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  target: Bug | null;
  tx: number;
  ty: number;
  tz: number;
  t: number;
}

/** 机枪抛出的弹壳。 */
interface Casing {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rot: number;
  spin: number;
  t: number;
}


interface Shell {
  from: Vec3;
  to: Vec3;
  t: number;
  dur: number;
  arc: number;
  size: number;
}

/** 战列巡航舰：停在平台旁边的虚空里，很久才开一炮。 */
interface Cruiser {
  x: number;
  y: number;
  z: number;
  /** 船头朝向（世界角度，-π/2 = 朝上）。 */
  yaw: number;
  /** 转向的角速度：巨舰转身有惯性，慢慢起转、慢慢停。 */
  spin: number;
  /** 正在蓄能时锁定的落点；非空 = 方向已锁死，直到这一炮炸完。 */
  lock: Vec2 | null;
  cd: number;
  charge: number;
  recoil: number;
  t: number;
  target: Bug | null;
}

/** 主炮的光弹。 */
interface Bolt {
  from: Vec3;
  to: Vec3;
  t: number;
  dur: number;
}

/** 延时的连环爆炸：主炮落点周围一圈接一圈地炸开。 */
interface Blast {
  x: number;
  y: number;
  t: number;
  size: number;
}

interface Plane {
  x: number;
  y: number;
  z: number;
  dropCd: number;
}

interface Bomb {
  x: number;
  y: number;
  z: number;
  vy: number;
  vz: number;
}


export class DefenseScene {
  /** 这一局的战场（宽窄、虫群构成、有没有巡航舰和炮艇）：开局那一刻的 field()。 */
  readonly field: FieldDef = field();
  readonly terrain = new PlatformGround();
  readonly fx = new Effects();
  readonly bugs: Bug[] = [];
  readonly splats: Splat[] = [];
  readonly shards: Shard[] = [];
  readonly spikes: Spike[] = [];
  readonly globs: Glob[] = [];
  readonly defenders: Defender[] = [];
  readonly guns: Gun[] = [];
  readonly bullets: Bullet[] = [];
  readonly sparks: Spark[] = [];
  readonly flashes: Flash[] = [];
  readonly casings: Casing[] = [];
  readonly missiles: Missile[] = [];
  readonly shells: Shell[] = [];
  readonly planes: Plane[] = [];
  readonly cruiser: Cruiser = { x: LANE_CX + 320, y: 500, z: 22, yaw: -2.2, spin: 0, lock: null, cd: 6, charge: 0, recoil: 0, t: 0, target: null };
  readonly bolts: Bolt[] = [];
  readonly blasts: Blast[] = [];
  readonly bombs: Bomb[] = [];
  time = 0;
  shake = 0;
  private spawnAcc = 0;
  private planeCd = 4;

  constructor() {
    this.fx.debrisColors = MOON_DEBRIS;
    this.fx.smokeLift = 45;

    const blank = (): Omit<Defender, 'kind' | 'x' | 'y' | 'minX' | 'maxX'> => ({
      z: 0,
      cd: Math.random() * 1.2,
      recoil: 0,
      pose: new Pose(),
      burst: 0,
      yaw: 0,
      target: null,
      step: Math.random(),
      side: 1,
      missileCd: 1 + Math.random() * 2,
      heading: Math.random() < 0.5 ? 0 : Math.PI,
      dir: Math.random() < 0.5 ? 1 : -1,
      pause: Math.random() * 2,
      stride: 0,
      hp: MARINE_HP,
      deadT: -1,
      slotX: 0,
      slotY: 0,
    });
    // 机甲在步兵线后面来回踱步，各管半条防线。
    // 巡逻范围跟着通道宽窄走：窄通道里两台机甲各管一小段。
    const [mechA, mechB] = spanAt(LINE_Y + 38);
    const reach = Math.min(160, (mechB - mechA) / 2 - 24);
    for (const [minX, maxX] of [[LANE_CX - reach, LANE_CX - 20], [LANE_CX + 20, LANE_CX + reach]]) {
      const x = minX + Math.random() * (maxX - minX);
      this.defenders.push({ ...blank(), kind: 'mech', x, y: LINE_Y + 38, minX, maxX });
    }
    // 步兵：没有战壕，平地上一字排开。
    const [lineA, lineB] = spanAt(LINE_Y);
    for (let x = lineA + 22; x <= lineB - 22; x += 24) {
      const mech = false;
      this.defenders.push({
        kind: mech ? 'mech' : 'rifle',
        minX: x,
        maxX: x,
        heading: 0,
        dir: 1,
        pause: 0,
        stride: 0,
        x: x + (Math.random() - 0.5) * 5,
        y: LINE_Y + Math.sin(x * 0.031) * 3,
        z: 0,
        cd: Math.random() * 1.2,
        recoil: 0,
        pose: new Pose(),
        burst: 0,
        yaw: 0,
        target: null,
        step: Math.random(),
        side: 1,
        missileCd: 1 + Math.random() * 2,
        hp: MARINE_HP,
        deadT: -1,
        slotX: 0,
        slotY: 0,
      });
    }
    for (const d of this.defenders) {
      d.slotX = d.x;
      d.slotY = d.y;
    }
    this.guns.push(
      { kind: 'tank', x: LANE_CX - 130, y: 572, yaw: -Math.PI / 2, aim: 0, pitch: 0, recoil: 0, cd: 1.5, barrel: 1, target: null, retarget: 0 },
      { kind: 'tank', x: LANE_CX + 130, y: 580, yaw: -Math.PI / 2, aim: 0, pitch: 0, recoil: 0, cd: 3, barrel: 1, target: null, retarget: 0 },
      { kind: 'aa', x: LANE_CX - 202, y: 600, yaw: -Math.PI / 2, aim: 0, pitch: 0.8, recoil: 0, cd: 1, barrel: 1, target: null, retarget: 0 },
      { kind: 'aa', x: LANE_CX + 202, y: 612, yaw: -Math.PI / 2, aim: 0, pitch: 0.8, recoil: 0, cd: 1.6, barrel: 1, target: null, retarget: 0 },
    );
    for (let i = 0; i < this.field.initial; i++) this.spawn(30 + Math.random() * 360);
  }

  private spawn(y = 20 + Math.random() * 40): void {
    let r = Math.random();
    let kind: BugKind = 'crawler';
    for (const [k, w] of this.field.mix) {
      if (r < w) {
        kind = k;
        break;
      }
      r -= w;
    }
    const looks = BUG_LOOKS[kind];
    const speed = {
      crawler: 30 + Math.random() * 22,
      hopper: 34 + Math.random() * 10,
      beetle: 13 + Math.random() * 5,
      flyer: 26 + Math.random() * 10,
      serpent: 15 + Math.random() * 5,
      spitter: 16 + Math.random() * 6,
    }[kind];
    this.bugs.push({
      kind,
      look: looks[Math.floor(Math.random() * looks.length)],
      x: spanAt(y)[0] + 12 + Math.random() * (spanAt(y)[1] - spanAt(y)[0] - 24),
      y,
      z: 0,
      lift: kind === 'flyer' ? 45 + Math.random() * 30 : 0,
      vz: 0,
      kx: 0,
      ky: 0,
      speed,
      phase: Math.random(),
      hp: kind === 'beetle' ? 5 : kind === 'serpent' ? 4 : kind === 'spitter' ? 2 : 1,
      dead: -1,
      wobble: Math.random() * 10,
      hop: Math.random(),
      emerge: 1,
      // 刺蛇：在哪儿停下来砸刺。喷酸虫：在哪儿停下来吐 —— 每只不一样，离防线 140~290 不等。
      // （一开始是统一的"离防线 230 就停"，结果所有喷酸虫在同一条横线上排成一排、死成一排。）
      surfaceAt: kind === 'spitter' ? LINE_Y - 140 - Math.random() * 150 : LINE_Y - 150 - Math.random() * 60,
      cd: 1 + Math.random() * 2,
      spit: 0,
    });
  }

  /** 某个守军能打到的虫：在他正面一条纵列内、射程以内，不在地下。 */
  private inReach(x: number, y: number, range: number, lane: number, flyers: boolean): Bug[] {
    return this.bugs.filter(
      (b) =>
        b.dead < 0 &&
        (b.kind === 'flyer') === flyers &&
        b.emerge > 0.5 &&
        Math.abs(b.x - x) < lane &&
        y - b.y > 0 &&
        y - b.y < range,
    );
  }

  /** 在射界里挑一个：大多打最近的那几只，偶尔打远一点的。 */
  private pick(list: Bug[], near: number): Bug | null {
    if (list.length === 0) return null;
    list.sort((p, q) => q.y - p.y);
    return list[Math.floor(Math.random() * Math.min(list.length, near))];
  }

  /**
   * 打中一只虫。
   * @param blast 爆炸的冲击（0..1）。有冲击就一定打爆；步枪打死的按体型有一定概率打爆。
   */
  private hurt(b: Bug, dmg: number, fromX: number, fromY: number, blast: number): void {
    if (b.dead >= 0) return;
    b.hp -= dmg;
    if (b.hp > 0 && blast < 0.5) return;
    const dx = b.x - fromX;
    const dy = b.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    const size = BUG_SIZE[b.kind];
    const gib = blast > 0.15 || Math.random() < (b.kind === 'spitter' ? 0.8 : 0.4);
    // 血迹：方向就是"被从哪边打的"。打爆的那一滩更大、甩得更远。
    this.splats.push({ x: b.x, y: b.y, t: 0, blobs: makeSplat(3 + size * 2.4, dx, dy, gib), blood: b.look.blood });
    if (this.splats.length > 420) this.splats.shift();
    if (gib) {
      this.shatter(b, dx / d, dy / d, blast);
      b.dead = 99; // 打爆的直接移除（碎片接着飞）
      return;
    }
    b.dead = 0;
    b.kx = (dx / d) * (6 + blast * 100);
    b.ky = (dy / d) * (6 + blast * 100);
    b.vz = blast * (70 + Math.random() * 70);
  }

  /** 打爆：一把甲壳碎片 + 几块体液，朝"被打的方向"和上方散开。 */
  private shatter(b: Bug, ux: number, uy: number, blast: number): void {
    const size = BUG_SIZE[b.kind];
    const n = Math.round(7 + size * 7);
    const lk = b.look;
    const colors = [lk.shell, lk.shellLight, lk.shellDark, lk.accent, lk.leg, lk.blood[0], lk.blood[1]];
    const z = b.z + b.lift + 3 * size;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(uy, ux) + (Math.random() - 0.5) * 2.6;
      const sp = 20 + Math.random() * 60 + blast * 90;
      this.shards.push({
        x: b.x + (Math.random() - 0.5) * 4 * size,
        y: b.y + (Math.random() - 0.5) * 4 * size,
        z,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: 40 + Math.random() * 70 + blast * 80,
        rot: Math.random() * 6,
        spin: (Math.random() - 0.5) * 20,
        size: (0.8 + Math.random() * 1.4) * size,
        color: colors[Math.floor(Math.random() * colors.length)],
        t: 0,
      });
    }
    if (this.shards.length > 1400) this.shards.splice(0, this.shards.length - 1400);
  }

  private explode(x: number, y: number, size: number): void {
    const z = this.terrain.heightAt(x, y);
    this.fx.explode(x, y, z, size);
    // 金属地板炸不出坑，留一块焦黑。
    this.splats.push({ x, y, t: 0, blobs: makeSplat(5 + size * 5, 0, 1, true), blood: [rgb(22, 24, 30), rgb(52, 50, 50)] });
    const r = 20 + size * 20;
    for (const b of this.bugs) {
      if (b.dead >= 0 || b.lift > 20) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < r) this.hurt(b, 10, x, y, 1 - d / r);
    }
    // 只有轰炸机的大炸弹才震一下镜头，而且很轻：炮弹、导弹满屏都是，每发都震眼睛受不了。
    if (size >= 1) this.shake = Math.max(this.shake, 0.12);
  }

  private fire(kind: Bullet['kind'], a: Vec3, b: Vec3, target: Bug | null, hit: boolean, fromX: number, fromY: number, visible = true): void {
    const spec = {
      rifle: { speed: 950, len: 22, width: 0.75, color: rgb(150, 220, 255) },
      cannon: { speed: 1050, len: 22, width: 1.1, color: rgb(255, 160, 60) },
      aa: { speed: 760, len: 18, width: 0.95, color: rgb(255, 214, 110) },
    }[kind];
    this.bullets.push({
      a,
      b,
      dist: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1,
      speed: spec.speed,
      t: 0,
      color: spec.color,
      width: spec.width,
      len: spec.len,
      visible,
      kind,
      target,
      hit,
      fromX,
      fromY,
      arrived: false,
    });
  }

  private flash(p: Vec3, size: number, color: Rgba): void {
    this.flashes.push({ x: p.x, y: p.y, z: p.z, gz: this.terrain.heightAt(p.x, p.y), t: 0, size, rot: Math.random() * Math.PI, color });
  }

  private spray(p: Vec3, n: number, color: Rgba, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.sparks.push({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 20 + Math.random() * speed, t: 0, life: 0.18 + Math.random() * 0.2, color });
    }
  }

  /** 子弹飞到了：命中就结算伤害、迸火星；打空就在落点溅尘土和火星（防空炮弹在空中炸开）。 */
  private impact(b: Bullet): void {
    const t = b.target;
    if (b.kind === 'aa') {
      if (b.hit && t && t.dead < 0) {
        this.fx.explode(b.b.x, b.b.y, b.b.z, 0.35);
        this.hurt(t, 99, t.x, t.y + 10, 0.6);
      } else if (Math.random() < 0.45) this.fx.explode(b.b.x, b.b.y, b.b.z, 0.25);
      return;
    }
    if (b.hit && t && t.dead < 0) {
      this.spray(b.b, 4, t.look.blood[1], 50);
      this.spray(b.b, 2, b.color, 60);
      this.hurt(t, b.kind === 'cannon' ? 2 : 1, b.fromX, b.fromY, 0);
    } else {
      if (Math.random() < 0.6) this.fx.trail(b.b.x, b.b.y, b.b.z + 1);
      this.spray(b.b, 3, rgb(230, 226, 210), 45);
    }
  }

  /**
   * 机甲上半身局部的一个点 → 世界坐标。机甲整体朝 −y（rotZ(−π/2)），上半身再转 d.yaw：
   * 局部 +X 是炮口方向，局部 +Y 映到世界 +x。
   */
  private mechPoint(d: Defender, lx: number, ly: number, z: number): Vec3 {
    const c = Math.cos(d.yaw);
    const sn = Math.sin(d.yaw);
    const rx = lx * c - ly * sn;
    const ry = lx * sn + ly * c;
    return v3(d.x + ry, d.y - rx, d.z + z);
  }

  private muzzleOf(d: Defender): Vec3 {
    if (d.kind === 'mech') return this.mechPoint(d, 27, d.side * 13.5 + (Math.random() < 0.5 ? -1.5 : 1.5), 31.5);
    // 枪口在身体坐标里是（右 1，前 12.5，高 18.5），随朝向一起转。
    const c = Math.cos(d.yaw);
    const sn = Math.sin(d.yaw);
    return v3(d.x - c + 12.5 * sn, d.y - sn - 12.5 * c, d.z + 18.5);
  }

  update(dt: number): void {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);

    this.spawnAcc += dt * this.field.spawnRate;
    const alive = this.bugs.reduce((n, b) => n + (b.dead < 0 ? 1 : 0), 0);
    while (this.spawnAcc >= 1) {
      this.spawnAcc--;
      if (alive < this.field.maxAlive) this.spawn();
    }

    for (let i = this.bugs.length - 1; i >= 0; i--) {
      const b = this.bugs[i];
      const ground = this.terrain.heightAt(b.x, b.y);
      if (b.dead >= 0) {
        b.dead += dt;
        if (b.lift > 0 || b.vz > 0) {
          b.vz -= 220 * dt;
          b.lift = Math.max(0, b.lift + b.vz * dt);
          if (b.lift === 0) b.vz = 0;
        }
        const k = Math.exp(-dt * 4);
        b.kx *= k;
        b.ky *= k;
        b.x += b.kx * dt;
        b.y += b.ky * dt;
        b.z = ground;
        if (b.dead > 5) this.bugs.splice(i, 1);
        continue;
      }
      this.moveBug(b, dt, ground);
      // 冲到防线前：扑上去咬最近的机枪兵一口，然后被近距离打倒（碎片和血往远离防线的方向溅）。
      // 正面没人（那个位置的兵死了）就穿过缺口，一直冲到机甲巡逻线才被打倒。
      if (b.y > LINE_Y - 14 && b.kind !== 'flyer') {
        const m = this.marineNear(b.x, b.y, 20);
        if (m) {
          this.hurtMarine(m, BITE[b.kind] ?? 2, b.kind);
          this.hurt(b, 99, b.x, LINE_Y, 0);
        } else if (b.y > LINE_Y + 26) this.hurt(b, 99, b.x, LINE_Y + 40, 0);
      }
    }

    this.updateDefenders(dt);
    this.updateGuns(dt);
    if (this.field.cruiser) this.updateCruiser(dt);
    this.updateBuildings(dt);
    this.updateProjectiles(dt);
    this.updateDebris(dt);
    this.fx.update(dt, this.terrain);
  }

  private moveBug(b: Bug, dt: number, ground: number): void {
    b.z = ground;
    const wob = Math.sin(this.time * 2.2 + b.wobble) * b.speed * 0.25 * dt;
    switch (b.kind) {
      case 'hopper': {
        // 一跳 0.4 秒、落地停 0.5 秒。跳的时候速度是走路的三倍多，划一道小抛物线。
        b.hop += dt;
        const cycle = 0.9;
        if (b.hop > cycle) b.hop -= cycle;
        const air = b.hop < 0.4;
        const u = b.hop / 0.4;
        b.lift = air ? 14 * 4 * u * (1 - u) : 0;
        b.y += (air ? b.speed * 2.2 : 0) * dt;
        b.x += wob * (air ? 2 : 0);
        b.phase = (b.phase + dt * 2) % 1;
        break;
      }
      case 'serpent': {
        // 刺蛇：蛇尾左右扭着往前游；到了阵前停下，慢慢举起骨镰，砸下去的一瞬间朝前刺出一串地刺。
        if (b.y < b.surfaceAt) {
          b.y += b.speed * dt;
          b.x += wob * 0.5;
          b.phase = (b.phase + dt * 1.4) % 1;
          b.spit = Math.max(0, b.spit - dt * 4);
        } else {
          b.phase = (b.phase + dt * 0.35) % 1;
          b.cd -= dt;
          b.spit = b.cd < 0.7 ? Math.min(1, b.spit + dt * 2) : Math.max(0, b.spit - dt * 5);
          if (b.cd <= 0) {
            b.cd = 3.5 + Math.random() * 2;
            b.spit = 0;
            // 一串地刺：从虫身前开始，一根接一根往前冒，像一道沿地面窜过去的裂缝。
            for (let k = 1; k <= 14; k++) {
              const yy = b.y + 10 + k * 10;
              if (yy > LINE_Y + 6) break;
              this.spikes.push({ x: b.x + Math.sin(k * 1.7) * 3, y: yy, t: -k * 0.05, h: 10 + Math.random() * 6 });
            }
            this.fx.poof(b.x, b.y + 8, 0, 0.4);
            // 砸完往前挪一点，免得一排刺蛇的尸体死在同一条线上。
            b.surfaceAt = Math.min(LINE_Y - 120, b.surfaceAt + 8 + Math.random() * 16);
          }
        }
        break;
      }
      case 'spitter': {
        // 走到离防线两百多单位的地方就停下，鼓起酸囊，往前吐。
        if (b.y < b.surfaceAt) {
          b.y += b.speed * dt;
          b.x += wob;
          b.phase = (b.phase + (b.speed / 9) * dt) % 1;
          b.spit = Math.max(0, b.spit - dt * 3);
        } else {
          b.cd -= dt;
          b.spit = clamp(1 - b.cd / 0.8, 0, 1);
          if (b.cd <= 0) {
            b.cd = 2.6 + Math.random() * 1.5;
            // 吐完一口往前挪一小段再停：一边吐一边逼近，最近挪到离防线 110。
            b.surfaceAt = Math.min(LINE_Y - 110, b.surfaceAt + 10 + Math.random() * 25);
            const tx = b.x + (Math.random() - 0.5) * 50;
            const ty = LINE_Y - 4 + (Math.random() - 0.5) * 14;
            const from = v3(b.x, b.y + 9, ground + 8);
            this.globs.push({ from, to: v3(tx, ty, this.terrain.heightAt(tx, ty)), t: 0, dur: 0.9 });
          }
        }
        break;
      }
      case 'flyer':
        b.y += b.speed * dt;
        b.x += wob;
        b.lift = 50 + Math.sin(this.time * 1.7 + b.wobble) * 12;
        b.phase = (b.phase + (b.speed / 9) * dt) % 1;
        break;
      default:
        b.y += b.speed * dt;
        b.x += wob;
        b.phase = (b.phase + (b.speed / 9) * dt) % 1;
    }
    // 地面上的虫只能在平台上走；飞虫可以飞到虚空上面去。
    const [ea, eb] = spanAt(b.y);
    b.x = b.kind === 'flyer' ? clamp(b.x, ea - 40, eb + 40) : clamp(b.x, ea + 8, eb - 8);
  }

  private updateDefenders(dt: number): void {
    for (const d of this.defenders) {
      d.z = this.terrain.heightAt(d.x, d.y);
      d.recoil = Math.max(0, d.recoil - dt * 6);
      d.cd -= dt;
      if (d.kind === 'rifle' && d.deadT >= 0) {
        // 倒下了：往后一仰躺在地上，躺够了尸体就没了（空缺等兵营补人）。
        d.deadT += dt;
        fallPose(d.pose, d.deadT);
        continue;
      }
      if (d.kind === 'rifle') {
        // 步兵就是机枪兵：三发一个短点射。
        aimPose(d.pose, d.recoil);
        if (d.burst <= 0 && d.cd <= 0) {
          d.target = this.pick(this.inReach(d.x, d.y, RIFLE_RANGE, RIFLE_LANE, false), 6);
          if (d.target) d.burst = 3;
          else d.cd = 0.3;
        }
        // 转身对准目标（d.yaw：相对"朝上"的角度，往右为正）；没对准就先不开火。
        let aligned = true;
        if (d.target) {
          const want = Math.atan2(d.target.x - d.x, -(d.target.y - d.y));
          const err = want - d.yaw;
          d.yaw += clamp(err, -dt * 7, dt * 7);
          aligned = Math.abs(err) < 0.1;
        } else d.yaw += clamp(-d.yaw, -dt * 2, dt * 2);
        if (d.burst > 0 && d.cd <= 0 && aligned) {
          d.burst--;
          d.cd = d.burst > 0 ? 0.08 : 0.6 + Math.random() * 0.5;
          const t = d.target;
          if (!t) continue;
          d.recoil = 1;
          const a = this.muzzleOf(d);
          const hit = t.dead < 0 && Math.random() < 0.5;
          const b = hit ? v3(t.x, t.y, t.z + t.lift + 4) : v3(t.x + (Math.random() - 0.5) * 24, t.y - Math.random() * 30, t.z + 1);
          this.fire('rifle', a, b, t, hit, d.x, d.y);
          this.flash(a, 1.3, rgb(200, 240, 255));
        }
        continue;
      }

      // 机甲：上半身转向目标，两臂的双联机炮左右交替连射；肩上导弹巢隔一阵齐射一轮。
      this.patrol(d, dt);
      if (d.burst <= 0 && d.cd <= 0) {
        d.target = this.pick(this.inReach(d.x, d.y, MECH_RANGE, MECH_LANE, false), 12);
        if (d.target) d.burst = 12;
        else d.cd = 0.25;
      }
      if (d.target) {
        const want = Math.atan2(d.target.x - d.x, -(d.target.y - d.y));
        d.yaw += clamp(want - d.yaw, -dt * 3, dt * 3);
      }
      if (d.burst > 0 && d.cd <= 0) {
        d.burst--;
        d.cd = d.burst > 0 ? 0.07 : 0.45 + Math.random() * 0.3;
        d.side = -d.side;
        d.recoil = 1;
        const t = d.target;
        const a = this.muzzleOf(d);
        if (t) {
          const hit = t.dead < 0 && Math.random() < 0.55;
          const b = hit ? v3(t.x, t.y, t.z + t.lift + 4) : v3(t.x + (Math.random() - 0.5) * 30, t.y + (Math.random() - 0.5) * 24, t.z + 1);
          this.fire('cannon', a, b, t, hit, d.x, d.y, d.burst % 2 === 0);
        }
        this.flash(a, 2.2, rgb(255, 210, 120));
        // 大号弹壳：从炮座外侧往外抛。
        const out = this.mechPoint(d, 0, d.side * 17, 30);
        this.casings.push({
          x: out.x,
          y: out.y,
          z: out.z,
          vx: (out.x - d.x) * 2.5,
          vy: 10 + Math.random() * 15,
          vz: 35 + Math.random() * 25,
          rot: Math.random() * 6,
          spin: 22,
          t: 0,
        });
      }
      d.missileCd -= dt;
      if (d.missileCd <= 0) {
        const fl = this.inReach(d.x, d.y, MISSILE_RANGE, 260, true);
        const ground = fl.length ? [] : this.inReach(d.x, d.y, MECH_RANGE, MECH_LANE + 40, false);
        const pool = fl.length ? fl : ground;
        if (pool.length) {
          d.missileCd = 2.6 + Math.random() * 1.2;
          for (let k = 0; k < 4; k++) {
            const t = pool[Math.floor(Math.random() * pool.length)];
            const from = this.mechPoint(d, 4, (k < 2 ? -7 : 7) + (k % 2 ? 1.2 : -1.2), 43);
            this.missiles.push({
              x: from.x,
              y: from.y,
              z: from.z,
              vx: (Math.random() - 0.5) * 40,
              vy: -20 - Math.random() * 20,
              vz: 70 + Math.random() * 30,
              target: t,
              tx: t.x,
              ty: t.y,
              tz: t.z + t.lift,
              t: -k * 0.09,
            });
          }
        } else d.missileCd = 0.5;
      }
    }
  }

  /** 机甲巡逻：沿 x 来回走，走到头停一下、原地转身再往回走；偶尔中途也停下站一会。 */
  private patrol(d: Defender, dt: number): void {
    const want = d.dir > 0 ? 0 : Math.PI;
    const err = Math.atan2(Math.sin(want - d.heading), Math.cos(want - d.heading));
    let speed = 0;
    if (d.pause > 0) d.pause -= dt;
    else if (Math.abs(err) > 0.05) {
      // 原地转身：小碎步。
      d.heading += clamp(err, -dt * 1.6, dt * 1.6);
      d.step = (d.step + dt * 0.9) % 1;
    } else {
      d.heading = want;
      speed = 13;
      d.x += d.dir * speed * dt;
      if ((d.dir > 0 && d.x >= d.maxX) || (d.dir < 0 && d.x <= d.minX)) {
        d.x = clamp(d.x, d.minX, d.maxX);
        d.dir = -d.dir;
        d.pause = 0.8 + Math.random() * 1.6;
      } else if (Math.random() < dt * 0.06) d.pause = 1 + Math.random() * 1.5;
      // 一个步态周期走 28 个单位。
      d.step = (d.step + (speed * dt) / 28) % 1;
    }
    d.stride += ((speed > 0 ? 1 : 0) - d.stride) * Math.min(1, dt * 5);
    if (speed === 0 && Math.abs(err) <= 0.05 && d.stride < 0.05) d.step = (d.step + dt * 0.2) % 1;
  }

  /** 巡航舰上某个局部点（X 朝前、Y 朝右舷、Z 朝上）在世界里的位置。 */
  private cruiserPoint(lx: number, ly: number, lz: number): Vec3 {
    const c = this.cruiser;
    lx *= CRUISER_SCALE;
    ly *= CRUISER_SCALE;
    lz *= CRUISER_SCALE;
    const cs = Math.cos(c.yaw);
    const sn = Math.sin(c.yaw);
    // 后坐：整艘船顺着船身往后一顿。
    const back = c.recoil * 6;
    return v3(c.x + (lx - back) * cs - ly * sn, c.y + (lx - back) * sn + ly * cs, c.z + Math.sin(c.t * 0.6) * 3 + lz);
  }

  /** 兵营：门的开合（0..1）、要补的空缺、正在造的那个兵还差多久、走在路上的新兵。 */
  barracksDoor = 0;
  private doorWant = 0;
  private doorHold = 0;
  private exitReady = false;
  readonly queue: Defender[] = [];
  private build = 0;
  readonly walkers: Walker[] = [];
  private updateBuildings(dt: number): void {
    // 兵营：有空缺就造兵，造好了升门、新兵从门里走出来，人出了门再落门。
    if (this.queue.length && this.build <= 0) this.build = BUILD_TIME;
    if (this.build > 0) {
      this.build -= dt;
      if (this.build <= 0) {
        this.doorWant = 1;
        this.exitReady = true;
      }
    }
    if (this.exitReady && this.barracksDoor >= 1 && this.queue.length) {
      this.exitReady = false;
      this.doorHold = 2.2;
      const slot = this.queue.shift()!;
      // 出门 → 绕到兵营侧面 → 往前走到站位。
      const side = slot.slotX < BARRACKS.x ? -1 : 1;
      const x0 = BARRACKS.x;
      const y0 = BARRACKS.y + 30;
      this.walkers.push({
        slot,
        x: x0,
        y: y0,
        path: [v2(x0, BARRACKS.y + 52), v2(BARRACKS.x + side * 54, BARRACKS.y + 52), v2(BARRACKS.x + side * 54, BARRACKS.y - 56), v2(slot.slotX, slot.slotY)],
        phase: 0,
        heading: Math.PI / 2,
        pose: new Pose(),
      });
    }
    if (this.doorWant > 0 && this.barracksDoor >= 1 && !this.exitReady) {
      this.doorHold -= dt;
      if (this.doorHold <= 0) this.doorWant = 0;
    }
    this.barracksDoor = clamp(this.barracksDoor + (this.doorWant > 0 ? dt : -dt), 0, 1);

    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      const to = w.path[0];
      const dx = to.x - w.x;
      const dy = to.y - w.y;
      const dist = Math.hypot(dx, dy);
      const step = WALK_SPEED * dt;
      if (dist <= step) {
        w.x = to.x;
        w.y = to.y;
        w.path.shift();
        if (!w.path.length) {
          // 到位：接替那个空缺。
          const d = w.slot;
          d.x = d.slotX;
          d.y = d.slotY;
          d.hp = MARINE_HP;
          d.deadT = -1;
          d.yaw = 0;
          d.burst = 0;
          d.cd = 0.5;
          d.target = null;
          this.walkers.splice(i, 1);
        }
        continue;
      }
      w.x += (dx / dist) * step;
      w.y += (dy / dist) * step;
      const want = Math.atan2(dy, dx);
      w.heading += clamp(Math.atan2(Math.sin(want - w.heading), Math.cos(want - w.heading)), -dt * 8, dt * 8);
      // 步频跟着走路速度：一个步态周期身体前进两个步长（左右脚各踩一次），踩在地上的脚就不打滑。
      w.phase = (w.phase + (WALK_SPEED * dt) / WALK_CYCLE) % 1;
      walkPose(w.pose, w.phase, WALK_GAIT);
      carryPose(w.pose);
    }

    if (Math.random() < dt * 3) {
      const s = Math.random() < 0.5 ? -1 : 1;
      this.fx.trail(BARRACKS.x - s * 12 + (Math.random() - 0.5) * 2, BARRACKS.y - 26, 48);
    }
  }

  /** 伤到机枪兵：扣血，归零就倒下，空缺排进兵营的队列。 */
  /** 各来源对机枪兵造成的总伤害（调数值用）。 */
  readonly dmgBy: Record<string, number> = {};
  private hurtMarine(d: Defender, dmg: number, src: string): void {
    if (d.kind !== 'rifle' || d.deadT >= 0) return;
    this.dmgBy[src] = (this.dmgBy[src] ?? 0) + dmg;
    d.hp -= dmg;
    this.sparks.push(...[0, 1, 2].map(() => this.sparkAt(d.x, d.y, d.z + 12)));
    if (d.hp > 0) return;
    d.deadT = 0;
    d.target = null;
    d.burst = 0;
    this.splats.push({ x: d.x, y: d.y + 2, t: 0, blobs: makeSplat(5, 0, 1, true), blood: [rgb(110, 16, 16), rgb(180, 36, 30)] });
    this.queue.push(d);
  }

  /** 中弹溅出的一点血星。 */
  private sparkAt(x: number, y: number, z: number): Spark {
    const a = Math.random() * Math.PI * 2;
    return { x, y, z, vx: Math.cos(a) * 30, vy: Math.sin(a) * 20, vz: 20 + Math.random() * 30, t: 0, life: 0.35, color: rgb(200, 40, 30) };
  }

  /** 离 (x, y) 最近的活着的机枪兵，限定横向距离。 */
  private marineNear(x: number, y: number, reach: number): Defender | null {
    let best: Defender | null = null;
    let bd = reach;
    for (const d of this.defenders) {
      if (d.kind !== 'rifle' || d.deadT >= 0) continue;
      const dd = Math.hypot(d.x - x, (d.y - y) * 0.7);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }

  private updateCruiser(dt: number): void {
    const c = this.cruiser;
    c.t += dt;
    c.recoil = Math.max(0, c.recoil - dt * 1.2);
    c.cd -= dt;
    // 一轮攻击 = 对准 → 蓄能（锁死方向和落点）→ 光弹飞行 → 连环爆炸。整轮期间不挑目标、不转向。
    // 炸完才挑下一个虫最密的地方，冷却期间船身慢慢转过去；目标死了或者冲得太近就换，优先挑不用大转的。
    const busy = c.lock !== null || this.bolts.length > 0 || this.blasts.length > 0;
    const aimAt = (b: Bug): number => Math.atan2(b.y - c.y, b.x - c.x);
    const turn = (a: number): number => Math.abs(Math.atan2(Math.sin(a - c.yaw), Math.cos(a - c.yaw)));
    if (!busy && (!c.target || c.target.dead >= 0 || c.target.y > LINE_Y - 100)) {
      const pool = this.bugs.filter((b) => b.dead < 0 && b.kind !== 'flyer' && b.y > 40 && b.y < LINE_Y - 130);
      let best = -Infinity;
      c.target = null;
      for (let k = 0; k < 24 && pool.length; k++) {
        const b = pool[Math.floor(Math.random() * pool.length)];
        const crowd = pool.filter((o) => Math.abs(o.x - b.x) < 30 && Math.abs(o.y - b.y) < 30).length;
        const score = crowd - turn(aimAt(b)) * 12;
        if (score > best) {
          best = score;
          c.target = b;
        }
      }
    }
    if (busy) c.spin = 0;
    else {
      // 没目标就保持当前朝向，不回正。转向带惯性：想要的角速度随剩余角度变小（最快约 3.4°/秒），
      // 角速度本身也只能慢慢变。
      const err = c.target ? Math.atan2(Math.sin(aimAt(c.target) - c.yaw), Math.cos(aimAt(c.target) - c.yaw)) : 0;
      const wantSpin = c.target ? clamp(err * 0.5, -0.06, 0.06) : 0;
      c.spin += clamp(wantSpin - c.spin, -dt * 0.03, dt * 0.03);
      c.yaw += c.spin * dt;
      // 冷却快好了、船头对准了、船也停稳了：锁定落点，开始蓄能。
      if (c.target && c.cd <= 2 && Math.abs(err) < 0.02 && Math.abs(c.spin) < 0.01) {
        c.lock = v2(c.target.x, c.target.y);
        c.spin = 0;
      }
    }
    if (c.lock) {
      c.charge = Math.min(1, c.charge + dt / 2);
      if (c.charge >= 1) {
        const from = this.cruiserPoint(92, 0, 8);
        const to = v3(c.lock.x, c.lock.y, 0);
        this.bolts.push({ from, to, t: 0, dur: Math.hypot(to.x - from.x, to.y - from.y) / 420 });
        this.flash(from, 6, rgb(200, 235, 255));
        this.fx.muzzle(from.x, from.y, from.z);
        c.recoil = 1;
        c.cd = 14 + Math.random() * 4;
        c.target = null;
        c.lock = null;
      }
    } else c.charge = Math.max(0, c.charge - dt * 2);
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t >= b.dur) {
        this.explode(b.to.x, b.to.y, 1.9);
        // 主炮落点：中心一炸，周围再一圈一圈地连环炸开，和一轮轰炸差不多。
        for (let k = 0; k < 7; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = 18 + Math.random() * 30;
          this.blasts.push({ x: b.to.x + Math.cos(a) * r, y: b.to.y + Math.sin(a) * r * 0.8, t: 0.12 + k * 0.09 + Math.random() * 0.05, size: 0.7 + Math.random() * 0.4 });
        }
        this.bolts.splice(i, 1);
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t -= dt;
      if (b.t <= 0) {
        this.explode(b.x, b.y, b.size);
        this.blasts.splice(i, 1);
      }
    }
  }

  private updateGuns(dt: number): void {
    for (const g of this.guns) {
      g.recoil = g.kind === 'aa' ? g.recoil * Math.exp(-dt * 8) : Math.max(0, g.recoil - dt * 2.5);
      g.cd -= dt;
      if (g.kind === 'tank') {
        // 坦克不追着虫子乱转：咬住一个虫堆好几秒，炮塔慢慢摆过去，对准了才开炮。
        g.retarget -= dt;
        const lost = !g.target || g.target.dead >= 0 || g.target.y > LINE_Y - 30;
        if (lost || g.retarget <= 0) {
          const list = this.inReach(g.x, g.y, TANK_RANGE, TANK_LANE, false);
          // 在射界里随机抽几只，挑周围同伴最多、又不用大幅转炮塔的那只。
          let best: Bug | null = null;
          let bestScore = -Infinity;
          for (let k = 0; k < 10 && list.length; k++) {
            const c = list[Math.floor(Math.random() * list.length)];
            const crowd = list.filter((o) => Math.abs(o.x - c.x) < 25 && Math.abs(o.y - c.y) < 25).length;
            const want = Math.atan2(c.y - g.y, c.x - g.x) - g.yaw;
            const turn = Math.abs(Math.atan2(Math.sin(want - g.aim), Math.cos(want - g.aim)));
            const score = crowd - turn * 10;
            if (score > bestScore) {
              bestScore = score;
              best = c;
            }
          }
          if (best || lost) g.target = best;
          g.retarget = 3.5 + Math.random() * 2.5;
        }
        const t = g.target;
        let aligned = false;
        if (t) {
          const want = Math.atan2(t.y - g.y, t.x - g.x) - g.yaw;
          const err = Math.atan2(Math.sin(want - g.aim), Math.cos(want - g.aim));
          // 起步慢、快到位时再减速，像液压炮塔那样稳。
          const rate = Math.min(0.45, Math.abs(err) * 2 + 0.04);
          g.aim += clamp(err, -dt * rate, dt * rate);
          aligned = Math.abs(err) < 0.05;
        }
        if (g.cd <= 0 && t && aligned) {
          g.cd = 2.2 + Math.random() * 1.6;
          g.recoil = 1;
          const dir = g.yaw + g.aim;
          const from = v3(g.x + Math.cos(dir) * 46, g.y + Math.sin(dir) * 46, 16.5);
          const dist = Math.hypot(t.x - from.x, t.y - from.y);
          this.shells.push({ from, to: v3(t.x, t.y, this.terrain.heightAt(t.x, t.y)), t: 0, dur: dist / 650, arc: 5, size: 0.9 });
          this.fx.muzzle(from.x, from.y, from.z);
          this.fx.muzzle(from.x, from.y, from.z);
        }
      } else {
        if (!g.target || g.target.dead >= 0) {
          const fl = this.inReach(g.x, g.y, AA_RANGE, 260, true);
          g.target = fl.length ? fl.reduce((a, b) => (b.y > a.y ? b : a)) : null;
        }
        const t = g.target;
        const tx = t ? t.x : g.x + Math.sin(this.time * 0.5) * 80;
        const ty = t ? t.y : g.y - 200;
        const tz = t ? t.lift + t.z : 60;
        const want = Math.atan2(ty - g.y, tx - g.x) - g.yaw;
        g.aim += clamp(Math.atan2(Math.sin(want - g.aim), Math.cos(want - g.aim)), -dt * 2.2, dt * 2.2);
        const pitchWant = Math.atan2(tz - 14, Math.hypot(tx - g.x, ty - g.y));
        g.pitch += clamp(pitchWant - g.pitch, -dt, dt);
        if (t && g.cd <= 0) {
          g.cd = 0.11;
          g.barrel = -g.barrel;
          g.recoil = g.barrel;
          const dir = g.yaw + g.aim;
          const side = v2(-Math.sin(dir), Math.cos(dir));
          const L = 33 * Math.cos(g.pitch);
          const from = v3(
            g.x + Math.cos(dir) * (L + 4) + side.x * 3.2 * g.barrel,
            g.y + Math.sin(dir) * (L + 4) + side.y * 3.2 * g.barrel,
            13 + 33 * Math.sin(g.pitch),
          );
          const hit = Math.random() < 0.18;
          const to = hit
            ? v3(t.x, t.y, t.z + t.lift)
            : v3(t.x + (Math.random() - 0.5) * 30, t.y + (Math.random() - 0.5) * 30, t.z + t.lift + (Math.random() - 0.3) * 30);
          this.fire('aa', from, to, t, hit, t.x, t.y + 10);
          this.flash(from, 2.2, rgb(255, 220, 130));
          this.fx.muzzle(from.x, from.y, from.z);
        }
      }
    }
  }

  private updateProjectiles(dt: number): void {
    // 导弹：先往上窜一下，再拐弯扑向目标；一路拖烟。
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.t += dt;
      if (m.t < 0) continue;
      if (m.target && m.target.dead < 0) {
        m.tx = m.target.x;
        m.ty = m.target.y;
        m.tz = m.target.z + m.target.lift;
      }
      const dx = m.tx - m.x;
      const dy = m.ty - m.y;
      const dz = m.tz - m.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const sp = 260;
      const k = Math.min(1, dt * (m.t < 0.25 ? 2 : 7));
      m.vx += ((dx / d) * sp - m.vx) * k;
      m.vy += ((dy / d) * sp - m.vy) * k;
      m.vz += ((dz / d) * sp - m.vz) * k;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      if (Math.random() < dt * 40) this.fx.trail(m.x, m.y, m.z);
      const ground = this.terrain.heightAt(m.x, m.y);
      if (d < 6 || m.t > 2.5 || m.z < ground) {
        if (m.target && m.target.kind === 'flyer' && m.target.dead < 0 && d < 12) {
          this.fx.explode(m.x, m.y, m.z, 0.5);
          this.hurt(m.target, 99, m.x, m.y + 10, 0.7);
        } else if (m.z - ground < 15) this.explode(m.x, m.y, 0.55);
        else this.fx.explode(m.x, m.y, m.z, 0.4);
        this.missiles.splice(i, 1);
      }
    }

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      if (Math.random() < dt * 30) {
        const p = this.shellPos(s);
        this.fx.trail(p.x, p.y, p.z);
      }
      if (s.t >= s.dur) {
        this.explode(s.to.x, s.to.y, s.size);
        this.shells.splice(i, 1);
      }
    }

    if (this.field.gunships) this.planeCd -= dt;
    if (this.planeCd <= 0) {
      this.planeCd = 8 + Math.random() * 5;
      const x = LANE_CX - 110 + Math.random() * 220;
      this.planes.push({ x, y: PLANE_ENTRY_Y, z: 120, dropCd: 0 }, { x: x + 36, y: PLANE_ENTRY_Y + 30, z: 124, dropCd: 0.06 });
    }
    for (let i = this.planes.length - 1; i >= 0; i--) {
      const p = this.planes[i];
      p.y -= 240 * dt;
      p.dropCd -= dt;
      if (p.y < LINE_Y - 120 && p.y > 40 && p.dropCd <= 0) {
        p.dropCd = 0.14;
        this.bombs.push({ x: p.x + (Math.random() - 0.5) * 6, y: p.y, z: p.z - 4, vy: -190, vz: 0 });
      }
      if (p.y < -400) this.planes.splice(i, 1);
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.vz -= 170 * dt;
      b.vy *= 1 - 0.4 * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.z <= this.terrain.heightAt(b.x, b.y)) {
        this.explode(b.x, b.y, 1.2);
        this.bombs.splice(i, 1);
      }
    }

    // 酸液：落地溅开一滩亮绿，冒一小团烟。
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i];
      g.t += dt;
      if (g.t >= g.dur) {
        this.splats.push({ x: g.to.x, y: g.to.y, t: 0, blobs: makeSplat(5, 0, 1, true), blood: [rgb(110, 200, 40), rgb(220, 255, 120)] });
        this.fx.poof(g.to.x, g.to.y, g.to.z, 0.8);
        const m = this.marineNear(g.to.x, g.to.y, 12);
        if (m) this.hurtMarine(m, ACID_DMG, 'acid');
        this.globs.splice(i, 1);
      }
    }
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      const before = s.t;
      s.t += dt;
      if (before < 0 && s.t >= 0) {
        this.fx.poof(s.x, s.y, this.terrain.heightAt(s.x, s.y), 0.5);
        const m = this.marineNear(s.x, s.y, 9);
        if (m) this.hurtMarine(m, SPIKE_DMG, 'spike');
      }
      if (s.t > 0.7) this.spikes.splice(i, 1);
    }
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.t += dt;
      const head = b.speed * b.t;
      if (!b.arrived && head >= b.dist) {
        b.arrived = true;
        this.impact(b);
      }
      if (head - b.len >= b.dist) this.bullets.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      s.vz -= 160 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (s.t > s.life) this.sparks.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].t += dt;
      if (this.flashes[i].t > 0.05) this.flashes.splice(i, 1);
    }
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.t += dt;
      const g = this.terrain.heightAt(c.x, c.y);
      if (c.z > g || c.vz > 0) {
        c.vz -= 220 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z = Math.max(g, c.z + c.vz * dt);
        c.rot += c.spin * dt;
        if (c.z === g) {
          c.vz = Math.abs(c.vz) > 30 ? -c.vz * 0.35 : 0;
          c.vx *= 0.5;
          c.vy *= 0.5;
          c.spin *= 0.5;
        }
      }
      if (c.t > 1.4) this.casings.splice(i, 1);
    }
  }

  private updateDebris(dt: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.t += dt;
      // 飞出平台边缘的碎片没有地面接着，一直往虚空里掉。
      // 行星地表没有虚空，哪儿都有地面接着。
      const g = this.terrain.floorAt(s.x, s.y) ?? -1e4;
      if (s.z < -150) s.t = 99;
      if (s.z > g + 0.1 || s.vz > 0) {
        s.vz -= 200 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z = Math.max(g, s.z + s.vz * dt);
        s.rot += s.spin * dt;
        if (s.z === g) {
          // 落地弹一下就停。
          s.vz = Math.abs(s.vz) > 40 ? -s.vz * 0.25 : 0;
          s.vx *= 0.4;
          s.vy *= 0.4;
        }
      }
      if (s.t > 5) this.shards.splice(i, 1);
    }
    for (let i = this.splats.length - 1; i >= 0; i--) {
      this.splats[i].t += dt;
      if (this.splats[i].t > 18) this.splats.splice(i, 1);
    }
  }

  shellPos(s: Shell): Vec3 {
    const u = clamp(s.t / s.dur, 0, 1);
    return v3(lerp(s.from.x, s.to.x, u), lerp(s.from.y, s.to.y, u), lerp(s.from.z, s.to.z, u) + s.arc * 4 * u * (1 - u));
  }

  private drawCruiser(units: Layers['units'], fx: Layers['fx'], cam: Camera): void {
    const c = this.cruiser;
    const g = cam.grain;
    const scr = (q: Vec3): Vec2 => cam.worldToScreenZ(q.x, q.y, q.z);
    const at = this.cruiserPoint(0, 0, 0);
    const roll = Math.sin(c.t * 0.4) * 0.03;
    const m = battlecruiser(new Mesh3().translate(at.x, at.y, at.z).rotZ(c.yaw).rotX(roll).scale(CRUISER_SCALE), { charge: c.charge, thrust: 0.8 + 0.2 * Math.sin(c.t * 5) }, LIVERY_BLUE);
    drawMesh(units, cam, m, v2(c.x, c.y));
    // 引擎尾焰：四个喷口各一团青白的光，微微闪。
    for (const [ly, lz] of [[-14, 6], [14, 6], [-6, 14], [6, 14]]) {
      const p = scr(this.cruiserPoint(-104, ly, lz));
      const f = 0.85 + 0.15 * Math.sin(c.t * 23 + ly);
      fx.disc(p, 7 * g * f, rgba(110, 200, 255, 90), 8);
      fx.disc(p, 3.6 * g * f, rgba(200, 240, 255, 220), 8.01);
    }
    // 蓄能：舰首炮口一团越来越大的光，外面一圈收缩的光环。
    if (c.charge > 0.01) {
      const p = scr(this.cruiserPoint(92, 0, 8));
      const k = c.charge;
      fx.disc(p, (3 + 9 * k) * g, rgba(120, 200, 255, Math.round(60 + 80 * k)), 8.1);
      fx.disc(p, (1.5 + 4 * k) * g, rgb(235, 250, 255), 8.11);
      const ring = (1 - ((c.t * 1.8) % 1)) * 18 * g;
      fx.ellipse(p, ring, ring * 0.7, 0, rgba(150, 220, 255, Math.round(90 * k)), 8.05);
    }
    // 光弹：一颗大亮球，后面拖一条渐细的光尾。
    for (const b of this.bolts) {
      const u = b.t / b.dur;
      const p = v3(lerp(b.from.x, b.to.x, u), lerp(b.from.y, b.to.y, u), lerp(b.from.z, b.to.z, u) + 25 * 4 * u * (1 - u));
      const s = cam.worldToScreenZ(p.x, p.y, p.z);
      const u0 = Math.max(0, u - 0.18);
      const q = cam.worldToScreenZ(lerp(b.from.x, b.to.x, u0), lerp(b.from.y, b.to.y, u0), lerp(b.from.z, b.to.z, u0) + 25 * 4 * u0 * (1 - u0));
      fx.bar(q, s, 5 * g, rgba(120, 200, 255, 90), 8.2);
      fx.bar(q, s, 2 * g, rgba(220, 245, 255, 200), 8.21);
      fx.disc(s, 8 * g, rgba(120, 200, 255, 110), 8.22);
      fx.disc(s, 4 * g, rgb(240, 252, 255), 8.23);
    }
  }

  draw(layers: Layers, cam: Camera): void {
    const { ground, units, fx } = layers;
    const g = cam.grain;
    drawFloor(ground, cam, this.time);

    for (const o of this.splats) {
      const at = cam.worldToScreenZ(o.x, o.y, this.terrain.heightAt(o.x, o.y));
      drawSplat(ground, at, o.blobs, o.blood, g, Projection.groundSquash, Math.min(1, (18 - o.t) / 6), 1e6 + o.y);
    }

    for (const b of this.bugs) {
      if (b.dead > 50) continue;
      const root = cam.worldToScreenZ(b.x, b.y, b.z + b.lift);
      if (root.x < -30 || root.x > cam.viewWidth + 30 || root.y < -60 || root.y > cam.viewHeight + 30) continue;
      if (b.lift > 2) {
        const sh = cam.worldToScreenZ(b.x, b.y, b.z);
        const r = 3.5 * BUG_SIZE[b.kind] * g;
        ground.ellipse(sh, r, r * Projection.groundSquash, 0, rgba(0, 0, 0, 55), 1e6 + 900);
      }
      const row = cam.worldToScreen(b.x, b.y).y;
      const p = new Projector(root, Math.PI / 2, Projection.groundSquash, g, b.lift > 20 ? row + 4000 : row);
      drawBug(units, p, b.kind, b.look, { phase: b.phase, dead: b.dead, airborne: b.kind === 'hopper' && b.lift > 1, emerge: b.emerge, spit: b.spit }, this.time);
    }

    // 碎片：转着飞的小三角，落地后躺在那儿。
    for (const s of this.shards) {
      const c = cam.worldToScreenZ(s.x, s.y, s.z);
      const r = Math.max(1, s.size * g);
      const a = s.rot;
      const P = (k: number): { x: number; y: number } => ({ x: c.x + Math.cos(a + k * 2.1) * r, y: c.y + Math.sin(a + k * 2.1) * r * 0.75 });
      units.quad(P(0), P(1), P(2), P(2), s.color, cam.worldToScreen(s.x, s.y).y * Projector.DEPTH_PER_ROW + (s.z > 1 ? 2000 : 1));
    }

    // 地刺：一根骨白色的尖锥从地里冒出来再缩回去。
    for (const s of this.spikes) {
      if (s.t < 0) continue;
      const u = s.t / 0.7;
      const h = s.h * (u < 0.2 ? u / 0.2 : u > 0.7 ? (1 - u) / 0.3 : 1);
      const z = this.terrain.heightAt(s.x, s.y);
      const base = cam.worldToScreenZ(s.x, s.y, z);
      const tip = cam.worldToScreenZ(s.x + 1, s.y - 1, z + h);
      const w = 2.4 * g;
      const d = cam.worldToScreen(s.x, s.y).y * Projector.DEPTH_PER_ROW;
      units.quad(v2(base.x - w, base.y), v2(base.x + w, base.y), tip, tip, rgb(214, 204, 180), d);
      units.quad(v2(base.x, base.y), v2(base.x + w, base.y), tip, tip, rgb(150, 138, 120), d + 0.01);
    }

    const figure = (pose: Pose, x: number, y: number, z: number, yaw: number): void => {
      const p = new Projector(cam.worldToScreenZ(x, y, z), -Math.PI / 2 + yaw, Projection.groundSquash, g * MARINE_SCALE, cam.worldToScreen(x, y).y);
      drawMarine(units, pose, p, MARINE_KIT);
    };
    for (const d of this.defenders) {
      if (d.kind === 'mech') {
        // 下半身朝走路方向，上半身照旧朝目标（d.yaw 是相对“朝上”的世界角度）。
        const torso = -Math.PI / 2 + d.yaw - d.heading;
        const m = walkerMech(
          new Mesh3().translate(d.x, d.y, d.z).rotZ(d.heading),
          { torso: Math.atan2(Math.sin(torso), Math.cos(torso)), step: d.step, recoil: d.recoil * d.side, stride: d.stride },
          LIVERY_BLUE,
        );
        drawShadow(ground, cam, m, d.z, 9e5, 80);
        drawMesh(units, cam, m, v2(d.x, d.y));
      } else if (d.deadT < CORPSE_TIME) figure(d.pose, d.x, d.y, d.z, d.yaw);
    }
    for (const w of this.walkers) figure(w.pose, w.x, w.y, 0, w.heading + Math.PI / 2);
    // 血条：头顶一排 5 个小方块，一块 = 1/5 血量。剩得多绿、过半黄、最后一块红；打掉的是暗格。
    for (const d of this.defenders) {
      if (d.kind !== 'rifle' || d.deadT >= 0) continue;
      const at = cam.worldToScreenZ(d.x, d.y, d.z + 27);
      const n = Math.ceil((clamp(d.hp, 0, MARINE_HP) / MARINE_HP) * HP_PIPS);
      const sz = Math.max(2, Math.round(1.9 * g));
      const gap = Math.max(1, Math.round(0.5 * g));
      const span = HP_PIPS * sz + (HP_PIPS - 1) * gap;
      const on = n >= 4 ? rgb(110, 230, 110) : n >= 2 ? rgb(245, 205, 60) : rgb(240, 70, 50);
      fx.rect(at, span + 2, sz + 2, 0, rgba(8, 10, 16, 210), 20);
      for (let i = 0; i < HP_PIPS; i++) {
        const c = v2(at.x - span / 2 + sz / 2 + i * (sz + gap), at.y);
        fx.rect(c, sz, sz, 0, i < n ? on : rgba(70, 76, 90, 230), 20.01);
      }
    }

    for (const gun of this.guns) {
      const z = this.terrain.heightAt(gun.x, gun.y);
      const m =
        gun.kind === 'tank'
          ? siegeTank(new Mesh3().translate(gun.x, gun.y, z).rotZ(gun.yaw), { turret: gun.aim, recoil: gun.recoil, deploy: 1 }, LIVERY_BLUE)
          : aaTurret(new Mesh3().translate(gun.x, gun.y, z).rotZ(gun.yaw), { yaw: gun.aim, pitch: gun.pitch, recoil: gun.recoil }, LIVERY_BLUE.base, LIVERY_BLUE.panel);
      drawShadow(ground, cam, m, z, 9e5, 90);
      drawMesh(units, cam, m, v2(gun.x, gun.y));
    }

    for (const s of this.shells) {
      const p = this.shellPos(s);
      units.disc(cam.worldToScreenZ(p.x, p.y, p.z), Math.max(1.4, 1.1 * g), rgb(255, 200, 120), Projector.DEPTH_OVERLAY - 20);
    }
    // 酸液弹：亮绿的一团，后面拖一截。
    for (const gl of this.globs) {
      const u = gl.t / gl.dur;
      const p = v3(lerp(gl.from.x, gl.to.x, u), lerp(gl.from.y, gl.to.y, u), lerp(gl.from.z, gl.to.z, u) + 60 * 4 * u * (1 - u));
      const at = cam.worldToScreenZ(p.x, p.y, p.z);
      fx.disc(at, Math.max(1.5, 1.6 * g), rgb(170, 240, 70), 7);
      fx.disc(v2(at.x - 0.4 * g, at.y - 0.4 * g), Math.max(1, 0.8 * g), rgb(236, 255, 170), 7.01);
    }
    // 后方建筑。
    {
      const bm = barracks(new Mesh3().translate(BARRACKS.x, BARRACKS.y, 0).rotZ(Math.PI / 2), { t: this.time, door: this.barracksDoor }, LIVERY_BLUE);
      drawShadow(ground, cam, bm, 0, 9e5, 70);
      drawMesh(units, cam, bm, BARRACKS);
      const cm = commandCenter(new Mesh3().translate(BASE_CC.x, BASE_CC.y, 0).rotZ(Math.PI / 2), { t: this.time }, LIVERY_BLUE);
      drawShadow(ground, cam, cm, 0, 9e5, 70);
      drawMesh(units, cam, cm, BASE_CC);
    }

    if (this.field.cruiser) this.drawCruiser(units, fx, cam);

    for (const b of this.bombs) {
      const m = bomb(new Mesh3().translate(b.x, b.y, b.z).rotZ(-Math.PI / 2).rotY(Math.atan2(-b.vz, -b.vy)));
      drawShadow(ground, cam, m, this.terrain.heightAt(b.x, b.y), 9e5, 60);
      drawMesh(units, cam, m, v2(b.x, b.y), true);
    }
    for (const p of this.planes) {
      const m = gunship(new Mesh3().translate(p.x, p.y, p.z).rotZ(-Math.PI / 2).scale(0.75), { bank: 0, thrust: 1 }, LIVERY_BLUE);
      drawShadow(ground, cam, m, 0, 9e5, 70);
      drawMesh(units, cam, m, v2(p.x, p.y), true);
      // 两个尾喷口的火焰。
      for (const sd of [-1, 1]) {
        const tail = cam.worldToScreenZ(p.x + sd * 15, p.y + 19, p.z + 4.5);
        fx.disc(tail, 2.6 * g, rgba(255, 170, 80, 170), 8);
        fx.disc(tail, 1.3 * g, rgb(255, 240, 200), 8.01);
      }
    }

    // 导弹：一个亮点 + 后面一团橙色的火。
    for (const m of this.missiles) {
      if (m.t < 0) continue;
      const at = cam.worldToScreenZ(m.x, m.y, m.z);
      const sp = Math.hypot(m.vx, m.vy, m.vz) || 1;
      const back = cam.worldToScreenZ(m.x - (m.vx / sp) * 4, m.y - (m.vy / sp) * 4, m.z - (m.vz / sp) * 4);
      fx.disc(back, 1.6 * g, rgba(255, 160, 60, 200), 7);
      fx.bar(back, at, Math.max(1, 0.8 * g), rgb(220, 224, 230), 7.01);
      fx.disc(at, Math.max(1, 0.6 * g), rgb(255, 250, 230), 7.02);
    }

    // 弹壳：一个个黄铜小方块，转着落地。
    for (const c of this.casings) {
      const at = cam.worldToScreenZ(c.x, c.y, c.z);
      const w = Math.max(1, 0.5 * g);
      units.rect(at, w, w * 2, c.rot, rgb(214, 170, 70), cam.worldToScreen(c.x, c.y).y * Projector.DEPTH_PER_ROW + 3);
    }

    // 子弹：外层一道带颜色的光晕，内层一根亮芯，弹头一个白点。看得见的那一截只有十几个单位长，
    // 沿着弹道往前跑 —— 眼睛跟着一个会动的亮点，读起来就是"一颗子弹飞过去"，而不是一道激光。
    for (const bl of this.bullets) {
      if (!bl.visible) continue;
      const head = Math.min(bl.dist, bl.speed * bl.t);
      const tail = Math.max(0, head - bl.len);
      if (head <= tail) continue;
      const at = (d: number): { x: number; y: number } => {
        const u = d / bl.dist;
        return cam.worldToScreenZ(lerp(bl.a.x, bl.b.x, u), lerp(bl.a.y, bl.b.y, u), lerp(bl.a.z, bl.b.z, u));
      };
      const h = at(head);
      const tl = at(tail);
      const mid = at(tail + (head - tail) * 0.45);
      const w = Math.max(1, bl.width * g);
      fx.bar(tl, h, w * 2.4, rgba(bl.color.r, bl.color.g, bl.color.b, 90), 5);
      fx.bar(mid, h, w, rgb(Math.min(255, bl.color.r + 70), Math.min(255, bl.color.g + 50), Math.min(255, bl.color.b + 40)), 5.01);
      fx.disc(h, w * 0.85, rgb(255, 255, 240), 5.02);
    }

    // 火星。
    for (const sp of this.sparks) {
      const k = 1 - sp.t / sp.life;
      fx.rect(cam.worldToScreenZ(sp.x, sp.y, sp.z), Math.max(1, 0.5 * g), Math.max(1, 0.5 * g), 0, rgba(sp.color.r, sp.color.g, sp.color.b, Math.round(255 * k)), 5.5);
    }

    // 枪口焰：十字星芒（长短两根交叉的亮条，每次转一个随机角度）+ 中心亮点；脚下的地面亮一圈。
    for (const f of this.flashes) {
      const c = cam.worldToScreenZ(f.x, f.y, f.z);
      const r = f.size * g * (1 - f.t / 0.06);
      const gl = cam.worldToScreenZ(f.x, f.y, f.gz);
      ground.ellipse(gl, r * 5, r * 5 * Projection.groundSquash, 0, rgba(255, 240, 200, 40), 1e6 + 950);
      for (let k = 0; k < 2; k++) {
        const a = f.rot + k * (Math.PI / 2);
        const L = r * (k === 0 ? 3.2 : 2);
        fx.bar(v2(c.x - Math.cos(a) * L, c.y - Math.sin(a) * L), v2(c.x + Math.cos(a) * L, c.y + Math.sin(a) * L), Math.max(1, r * 0.55), f.color, 6);
      }
      fx.disc(c, r * 1.1, rgb(255, 255, 230), 6.01);
    }
    this.fx.draw(units, fx, cam);
  }
}
