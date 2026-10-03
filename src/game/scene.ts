import { type Vec2, type Vec3, clamp, lerp, v2, v3 } from '../core/math';
import { Effects } from '../fx/effects';
import { type Kit, makeKit } from '../characters/kit';
import { drawMarine } from '../characters/renderer';
import { Pose, RigSpec } from '../characters/rig';
import { Mesh3, drawMesh, drawShadow } from '../mesh/mesh';
import { LIVERY_BLUE, aaTurret, battlecruiser, bomb, crystalCore, gunship, siegeTank, walkerMech } from '../mesh/models';
import type { Camera } from '../render/camera';
import { type Rgba, lerpColor, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import { drawOutlinedText, drawPixelText } from '../render/pixelFont';
import { Projector } from '../render/projector';
import type { Layers } from '../render/scene';
import { fallPose, strideCycle, walkPose } from '../characters/poses';
import { CORE, END_Y, LANE_CX, TOP_Y, drawFloor, spanAt } from './floor';
import { AIRSTRIKE_COST, BUILDS, CRUISER_COST, CRUISER_ID, CRUISER_RANGE, type BuildKind, type StatKey, buildingMesh, statDef } from './buildings';
import { CROSS_C, PLAT, crossBlocks, crossClamp, crossRampTops, crossRowSpan, crossSpawn, crossWalkable } from './crossmap';
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
/** 机甲：比步兵打得远、扇面宽、射速快；肩上导弹巢专打飞虫。 */
const MECH_RANGE = 300;
const MISSILE_RANGE = 360;
const TANK_RANGE = 330;
const AA_RANGE = 320;

/** 动力装甲：深蓝的甲片、橙色的饰条、发光的橙色面罩（帽檐那一块就是面罩）。 */
export const MARINE_KIT: Kit = {
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
export const MARINE_SCALE = 1.18;
/** 机枪兵的血量、各种伤害。 */
const MARINE_HP = 30;
/** 建造模式：机甲的血量（建筑的血量在 buildings.ts）。 */
const MECH_HP = 60;
/** 漏过防线的虫往多远以内的建筑 / 机甲扑（再远就直奔核心）。 */
const PREY_RANGE = 150;

/** 巨舰挪位置时的最高航速（非常慢）。 */
const CRUISER_CRUISE = 8;
/** 碰撞半径：机枪兵、机甲（建造模式里单位之间、单位和建筑之间互相推开）。 */
const RIFLE_R = 6;
const MECH_R = 14;
/** 出售退还总花费（造价 + 升级）的多少。 */
const SELL_REFUND = 0.7;
/** 集结点离建筑最远多少。 */
export const RALLY_MAX = 220;
/** 走路的单位离终点这么近、又被挡住了，就当作到了（不去挤开占着位置的东西）。 */
const ARRIVE_NEAR = 30;
/**
 * 波次。分两段：
 *
 *   建防期   前 BUILD_WAVES 波：20 只起步，每波多 10 只，间隔短 —— 拿晶矿把基本防线搭起来
 *   总攻期   之后每一波都是大军（150 只起步，每波再多 35 只）；最后一波再多一半
 *
 * 每过一波虫跑快 3%（最多快 50%）。
 *
 * 一波来了先冲出一大群（WAVE_BURST 那么多，立刻刷出来，从地图顶边往下铺成一片），剩下的在这一波的时间里
 * 从顶边源源不断地往外涌（STREAM_SPAN × 波间隔内匀速刷完）—— 虫潮不断档。提前叫下一波，两波的虫潮就叠在一起涌。
 * 场上活着的最多 maxAlive 只，满了就等一等，空出位置再补。
 * 只数都乘地图的 waveScale，涌出的速度乘 pace（刷得更快）、虫的移动速度乘 rush（fields.ts）。打完地图的 waves 波就通关。
 * EARLY_BONUS：提前叫下一波时每剩一秒奖励多少晶矿。callLockOf：一波来了之后至少过这么久才能再提前叫
 * —— 不然手快的人一口气就把所有波叫完了。
 */
export const BUILD_WAVES = 5;
const WAVE_PREP = 15;
/** 第 n 波来了以后，离下一波多少秒。 */
const waveGap = (n: number): number => (n < BUILD_WAVES ? 15 : 20);
const waveSize = (n: number, scale: number, total: number): number => {
  const base = n <= BUILD_WAVES ? 20 + 10 * (n - 1) : 150 + 35 * (n - BUILD_WAVES - 1);
  return Math.max(1, Math.round(base * scale * (n === total ? 1.5 : 1)));
};
/** 一波里先冲出来的那一群占多少；剩下的在波间隔的多少比例里涌完。 */
const WAVE_BURST = 0.3;
const STREAM_SPAN = 1;
/**
 * 整群刷出来时，从地图顶边往下铺多长：至少 WAVE_STRING_MIN（虫少的波也有一部分直接落在默认镜头里，
 * 一按就看得见），每只虫再加 WAVE_STRING，最长 WAVE_STRING_MAX（别铺到防线跟前）。
 */
const WAVE_STRING_MIN = 280;
const WAVE_STRING = 2;
const WAVE_STRING_MAX = 320;
/** 提前叫下一波的冷却（秒）：建防期短一点，总攻期长一点。 */
const callLockOf = (n: number): number => (n <= BUILD_WAVES ? 3 : 8);
/** 每过一波虫跑快 3%，最多快 50%。 */
const waveRush = (n: number): number => 1 + Math.min(0.5, (n - 1) * 0.03);
/** 各种虫从第几波开始出现（之后两波里比例慢慢涨到 mix 里写的）。 */
const KIND_FROM: Record<BugKind, number> = { crawler: 1, hopper: 2, flyer: 3, spitter: 4, beetle: 4, serpent: 5 };
const EARLY_BONUS = 3;
/** 地上的血迹：留多久（秒）、最后几秒淡出、全场最多几摊、多近算"同一处"、同一处最多叠几摊。 */
const SPLAT_LIFE = 9;
const SPLAT_FADE = 3;
const SPLAT_MAX = 220;
const SPLAT_NEAR = 12;
const SPLAT_CROWD = 3;
/** 血条分几格。 */
const HP_PIPS = 5;
const BITE: Partial<Record<BugKind, number>> = { crawler: 1, hopper: 2, beetle: 3 };
const SPIKE_DMG = 4;
const ACID_DMG = 2;
/** 兵营造一个兵的时间、新兵走路的速度、尸体躺多久。 */
const WALK_SPEED = 30;
/** 建造模式：机甲默认的集结线、建筑最靠前能放到哪儿。 */
const PATROL_Y = LINE_Y + 38;
export const BUILD_FRONT = LINE_Y + 62;
/** 新兵走路的步幅（walkPose 的 gait）、对应的一个步态周期走多远（世界单位）。 */
const WALK_GAIT = 0.85;
const WALK_CYCLE = strideCycle(WALK_GAIT) * MARINE_SCALE;
const CORPSE_TIME = 7;
/** 战列巡航舰比模型原尺寸再大一圈：它得是场上最大的东西。 */
const CRUISER_SCALE = 1.4;

/**
 * 水晶核心：兵营和指挥中心中间、地图中轴上。突破防线的虫子会冲过来撞它，血打空这一局就输了。
 * 下面几张表是先填的占位数值，之后再调。
 */
export { CORE };
/** 虫子离核心多近算撞上。 */
const CORE_REACH = 16;
const CORE_HP = 100;
/** 每种虫撞一下核心扣多少血。 */
const CORE_DMG: Record<BugKind, number> = { crawler: 4, hopper: 5, beetle: 12, flyer: 6, serpent: 10, spitter: 8 };
/** 每种虫被打死给多少晶矿。 */
const KILL_REWARD: Record<BugKind, number> = { crawler: 1, hopper: 2, beetle: 5, flyer: 3, serpent: 6, spitter: 4 };
/**
 * 信用点（跨局保存）：打死虫子有一定概率掉一点（chance 概率，掉 min..max 点），越难打的虫越容易掉、掉得越多；
 * 每突破 CREDIT_MILESTONE 波再发一笔，越往后越多，也带一点随机。
 */
const CREDIT_DROP: Record<BugKind, { chance: number; min: number; max: number }> = {
  crawler: { chance: 0.02, min: 1, max: 2 },
  hopper: { chance: 0.03, min: 1, max: 3 },
  flyer: { chance: 0.04, min: 1, max: 3 },
  spitter: { chance: 0.05, min: 2, max: 4 },
  beetle: { chance: 0.08, min: 2, max: 5 },
  serpent: { chance: 0.1, min: 3, max: 6 },
};
const CREDIT_MILESTONE = 5;
/** 第 k 个里程碑（突破第 5k 波）发多少：基数 × k，再随机多给 0~50%。 */
const MILESTONE_BASE = 25;
const randInt = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a + 1));
/** 掉落信用点时飘起来的金色 "+N" 停留多久。 */
const POP_TIME = 1.4;
/**
 * 扣血数字：虫的血量和伤害都是 1、1.5、5 这种小数，显示时乘 HIT_SCALE（机枪一发 10、炮 20）。
 * 一只虫 HIT_MERGE 秒内连着挨的几下合成一个数往上加，不然机枪扫一只虫会叠出一摞数字；
 * 数字飘 HIT_TIME 秒，全场最多 HIT_MAX 个（虫潮里打得太密就先丢最老的）。
 */
const HIT_SCALE = 10;
const HIT_MERGE = 0.25;
const HIT_TIME = 0.7;
const HIT_MAX = 160;
/** 核心血条：两排小方块，一排 CORE_PIPS 个，一块 = CORE_HP / (2 × CORE_PIPS)。 */
const CORE_PIPS = 10;
/** 核心碎掉时的碎晶颜色。 */
const CORE_SHARDS = [rgb(84, 206, 240), rgb(170, 240, 255), rgb(40, 130, 190), rgb(255, 255, 255)];

const MOON_DEBRIS = [rgb(150, 150, 156), rgb(120, 118, 126), rgb(176, 174, 180)];

const SPINE = RigSpec.chestZ - RigSpec.hipZ;

export function aimPose(pose: Pose, recoil: number): void {
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

/** 虫头上飘的扣血数字。 */
interface HitNum {
  x: number;
  y: number;
  z: number;
  t: number;
  /** 这一下（以及 HIT_MERGE 秒内同一只虫挨的几下）一共扣了多少（显示时 ×HIT_SCALE）。 */
  n: number;
  /** 打死了：数字换成亮黄色。 */
  kill: boolean;
}

interface Bug {
  hit?: HitNum;
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
  /** 建造模式：漏过防线后扑向的目标（建筑或机甲）；null = 直奔核心，undefined = 还没挑。 */
  prey?: Structure | Defender | null;
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
  /** 建造模式：是哪座兵营 / 车间造出来的（算产量上限、升级加成用）。 */
  owner?: Structure;
  /** 机甲：出厂后要走的路径点（绕开建筑走到巡逻线），走完才开始巡逻。 */
  path?: Vec2[];
  /** 走路时被挡住（这一帧被站着的东西推了一下）；连续没往前走了多久；卡住后重新寻路过几次。 */
  blocked?: boolean;
  stuckT?: number;
  lastDist?: number;
  reroutes?: number;
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
  /** 建造模式：这门炮属于哪座建筑。 */
  owner?: Structure;
}

/** 建造模式里玩家造的一座建筑。 */
export interface Structure {
  id: number;
  kind: BuildKind;
  x: number;
  y: number;
  /** 每条升级线的等级（从 1 开始）。 */
  up: Record<StatKey, number>;
  /** 出兵类：当前这一个的生产进度 0..1。 */
  prog: number;
  /** 门（兵营、车间）：开合（0..1）、要开、开着再等多久、造好的单位等着出门。 */
  door: number;
  doorWant: number;
  doorHold: number;
  exitReady: boolean;
  /** 炮塔类：对应的那门炮。 */
  gun: Gun | null;
  /** 刚建好 / 刚升级的闪光（1 → 0）。 */
  flash: number;
  /** 血量；挨打的闪白（1 → 0）。 */
  hp: number;
  hit: number;
  /** 出兵类：集结点（造出来的单位去这儿；右键改）。 */
  rally: Vec2;
  /** 一共花了多少晶矿（造价 + 升级），出售按比例退。 */
  spent: number;
}

/** 一条升级线的现状。 */
export interface StatInfo {
  key: StatKey;
  name: string;
  level: number;
  max: number;
  /** 当前值、下一级的值（满级是 null）、下一级要多少晶矿。 */
  value: number;
  next: number | null;
  cost: number | null;
}

/** 给界面看的一座建筑的现状。 */
export interface StructureInfo {
  id: number;
  kind: BuildKind;
  x: number;
  y: number;
  /** 出兵类：现有多少、上限多少、当前进度；防线站满了就 blocked。非出兵类 cap = 0。 */
  count: number;
  cap: number;
  prog: number;
  blocked: boolean;
  hp: number;
  maxHp: number;
  /** 现在卖掉能退多少晶矿。 */
  refund: number;
  stats: StatInfo[];
}

/** 建筑虚影：正在放的那种建筑跟着鼠标走，能放就绿、不能放就红。 */
export interface Ghost {
  kind: BuildKind;
  x: number;
  y: number;
  valid: boolean;
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
  /** 打中扣多少血。 */
  dmg: number;
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
  /** 威力倍率（坦克攻击力升级）。 */
  power?: number;
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
  /** 待命位置：建造模式买下后从画面外飞过来，飞到了才开始打；右键挪位置也是改这里。 */
  hx: number;
  hy: number;
  /** 挪位置时的航速（慢慢加速、慢慢减速）。 */
  vel: number;
}

/** 主炮的光弹。 */
interface Bolt {
  from: Vec3;
  to: Vec3;
  t: number;
  dur: number;
  /** 威力倍率（巨舰攻击力升级）。 */
  power: number;
}

/** 延时的连环爆炸：主炮落点周围一圈接一圈地炸开。 */
interface Blast {
  x: number;
  y: number;
  t: number;
  size: number;
  power: number;
}

interface Plane {
  x: number;
  y: number;
  z: number;
  dropCd: number;
  /** 在哪一段 y 里投弹（默认是防线前到地图顶；十字高地的轰炸支援只炸虫最密的那一小段）。 */
  dropY0?: number;
  dropY1?: number;
}

interface Bomb {
  x: number;
  y: number;
  z: number;
  vy: number;
  vz: number;
}


/** 一个新的守军（建造模式里兵营、车间造出来的）。 */
function makeDefender(kind: 'rifle' | 'mech', x: number, y: number): Defender {
  return {
    kind,
    x,
    y,
    z: 0,
    cd: 0.5,
    recoil: 0,
    pose: new Pose(),
    burst: 0,
    yaw: 0,
    target: null,
    step: Math.random(),
    side: 1,
    missileCd: 1 + Math.random() * 2,
    heading: kind === 'mech' ? Math.PI / 2 : 0,
    dir: Math.random() < 0.5 ? 1 : -1,
    pause: 0,
    stride: 0,
    minX: x,
    maxX: x,
    hp: kind === 'mech' ? MECH_HP : MARINE_HP,
    deadT: -1,
    slotX: x,
    slotY: y,
  };
}

/** 线段 a→b 从哪儿（0..1）进入矩形 r；碰不到是 null。Liang–Barsky 裁剪。 */
function segEnter(a: Vec2, b: Vec2, r: { x0: number; x1: number; y0: number; y1: number }): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x0, r.x1 - a.x, a.y - r.y0, r.y1 - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return t0;
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
  readonly cruiser: Cruiser = { x: LANE_CX + 320, y: 500, z: 22, yaw: -2.2, spin: 0, lock: null, cd: 6, charge: 0, recoil: 0, t: 0, target: null, hx: LANE_CX + 320, hy: 500, vel: 0 };
  /** 巨舰买了没有。 */
  cruiserBought = false;
  /** 巨舰的升级线、花费（借用建筑的结构，升级面板、加成都按建筑那一套算；不在 structures 里）。 */
  readonly cruiserS: Structure = {
    id: CRUISER_ID,
    kind: 'cruiser',
    x: 0,
    y: 0,
    up: { count: 1, speed: 1, dmg: 1, range: 1, rate: 1 },
    prog: 0,
    door: 0,
    doorWant: 0,
    doorHold: 0,
    exitReady: false,
    gun: null,
    flash: 0,
    hp: 9999,
    hit: 0,
    rally: v2(0, 0),
    spent: CRUISER_COST,
  };
  /** 巨舰到过待命位置了没有：第一次飞进场是快的，之后右键挪位置是慢的。 */
  private cruiserArrived = false;
  readonly bolts: Bolt[] = [];
  readonly blasts: Blast[] = [];
  readonly bombs: Bomb[] = [];
  time = 0;
  shake = 0;
  /** 局内晶矿：打死虫子就涨，之后拿来升级、建造。 */
  crystals = 0;
  /** 这一局挣到的信用点（外面每帧把新增的存进存档）。 */
  credits = 0;
  /** 最近一次波次里程碑：突破第几波、发了多少（HUD 跟着"第 N 波来袭"一起显示）。 */
  milestone: { wave: number; amount: number } | null = null;
  /** 飘在战场上的金色 "+N"。 */
  private readonly pops: { x: number; y: number; z: number; t: number; text: string }[] = [];
  /** 飘在虫头上的扣血数字。 */
  private readonly hits: HitNum[] = [];
  coreHp = CORE_HP;
  readonly coreMax = CORE_HP;
  /** 核心挨打后的闪白（0..1）。 */
  coreHit = 0;
  /** 核心被打碎：不再刷虫，lostT 记碎了多久（外面据此弹结算）。 */
  lost = false;
  lostT = 0;
  /** 打完最后一波、虫全清光：通关；wonT 记通关了多久（外面据此弹结算）。 */
  won = false;
  wonT = 0;
  /** 上一波来了多久（提前叫下一波的冷却用）。 */
  private sinceLaunch = 0;

  /** 十字高地：虫从四个方向来，没有"防线"那一行；几何在 crossmap.ts。 */
  readonly cross: boolean = this.field.layout === 'cross';
  /** 虫群开始进攻了没有（外面调 startWaves()：引导走完 / 跳过，或者没有引导的地图一开局就调）。 */
  waves = false;
  /** 当前是第几波（0 = 第一波还没来）；离下一波还有几秒；还排着没刷出来的虫。 */
  wave = 0;
  nextIn = WAVE_PREP;
  /** 每一波还没涌出来的虫：剩几只、每秒涌几只、攒着的零头。 */
  private readonly streams: { left: number; rate: number; acc: number }[] = [];
  readonly structures: Structure[] = [];
  ghost: Ghost | null = null;
  /** 当前选中（弹着升级面板）的建筑。 */
  selected: number | null = null;
  /** 升级面板上鼠标停在"射程"那一行：再画一圈升级后的射程。 */
  rangePreview = false;
  private nextId = 1;

  /**
   * 开局：地图是空的，只有水晶核心和一笔晶矿；玩家自己造兵营、车间、坦克、火炮，买巨舰、叫轰炸。
   */
  constructor() {
    this.fx.debrisColors = MOON_DEBRIS;
    this.fx.smokeLift = 45;
    this.crystals = this.field.startCrystals;
    if (this.cross) {
      this.cruiser.hx = CROSS_C.x + 300;
      this.cruiser.hy = CROSS_C.y - 240;
      this.cruiser.yaw = 2.5;
    }
  }

  /** 新虫默认从地图顶边外面一点刷出来，走进画面。 */
  private spawn(y = TOP_Y - 30 + Math.random() * 34): void {
    // 按 mix 抽一种；还没到出场波次的虫不出，刚出场的比例打折。
    const n = Math.max(1, this.wave);
    const weights = this.field.mix.map(([k, w]): [BugKind, number] => [k, w * clamp((n - KIND_FROM[k] + 1) / 3, 0, 1)]);
    let r = Math.random() * weights.reduce((t, [, w]) => t + w, 0);
    let kind: BugKind = 'crawler';
    for (const [k, w] of weights) {
      if (r < w) {
        kind = k;
        break;
      }
      r -= w;
    }
    const looks = BUG_LOOKS[kind];
    const at = this.cross ? crossSpawn() : null;
    const speed = {
      crawler: 30 + Math.random() * 22,
      hopper: 34 + Math.random() * 10,
      beetle: 13 + Math.random() * 5,
      flyer: 26 + Math.random() * 10,
      serpent: 15 + Math.random() * 5,
      spitter: 16 + Math.random() * 6,
    }[kind] * this.field.rush * waveRush(n);
    this.bugs.push({
      kind,
      look: looks[Math.floor(Math.random() * looks.length)],
      x: at ? at.x : spanAt(y)[0] + 12 + Math.random() * (spanAt(y)[1] - spanAt(y)[0] - 24),
      y: at ? at.y : y,
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
  /** 以 (x, y) 为圆心、range 为半径的圆里活着的虫（flyers：只要飞虫 / 只要地面虫）。 */
  private inRange(x: number, y: number, range: number, flyers: boolean): Bug[] {
    const r2 = range * range;
    return this.bugs.filter((b) => b.dead < 0 && (b.kind === 'flyer') === flyers && b.emerge > 0.5 && (b.x - x) ** 2 + (b.y - y) ** 2 < r2);
  }

  /** 离 (x, y) 最近的那一只。 */
  private nearest(list: Bug[], x: number, y: number): Bug | null {
    let best: Bug | null = null;
    let bd = Infinity;
    for (const b of list) {
      const d = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /**
   * 打中一只虫。
   * @param blast 爆炸的冲击（0..1）。有冲击就一定打爆；步枪打死的按体型有一定概率打爆。
   */
  private hurt(b: Bug, dmg: number, fromX: number, fromY: number, blast: number): void {
    if (b.dead >= 0) return;
    const dealt = Math.min(dmg, Math.max(0, b.hp));
    b.hp -= dmg;
    this.hitNumber(b, dealt, b.hp <= 0 || blast >= 0.5);
    if (b.hp > 0 && blast < 0.5) return;
    if (!this.lost) {
      this.crystals += KILL_REWARD[b.kind];
      const drop = CREDIT_DROP[b.kind];
      if (Math.random() < drop.chance) {
        const n = randInt(drop.min, drop.max);
        this.credits += n;
        this.pops.push({ x: b.x, y: b.y, z: b.z + b.lift + 14, t: 0, text: `+${n}` });
      }
    }
    const dx = b.x - fromX;
    const dy = b.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    const size = BUG_SIZE[b.kind];
    const gib = blast > 0.15 || Math.random() < (b.kind === 'spitter' ? 0.8 : 0.4);
    // 血迹：方向就是"被从哪边打的"。打爆的那一滩更大、甩得更远。
    this.addSplat({ x: b.x, y: b.y, t: 0, blobs: makeSplat(3 + size * 2.4, dx, dy, gib), blood: b.look.blood });
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

  /** power：威力倍率（坦克攻击力升级），炸得更狠、范围更大一点。 */
  private explode(x: number, y: number, size: number, power = 1): void {
    const z = this.terrain.heightAt(x, y);
    this.fx.explode(x, y, z, size);
    // 金属地板炸不出坑，留一块焦黑。
    this.addSplat({ x, y, t: 0, blobs: makeSplat(5 + size * 5, 0, 1, true), blood: [rgb(22, 24, 30), rgb(52, 50, 50)] });
    const r = (20 + size * 20) * (1 + (power - 1) * 0.3);
    for (const b of this.bugs) {
      if (b.dead >= 0 || b.lift > 20) continue;
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < r) this.hurt(b, 10 * power, x, y, 1 - d / r);
    }
    // 爆炸本身不震镜头：炮弹、导弹满屏都是，每发都震眼睛受不了。只有巨舰主炮、轰炸支援的炸弹
    // 在各自落地的地方另外震一下。
  }

  private fire(kind: Bullet['kind'], a: Vec3, b: Vec3, target: Bug | null, hit: boolean, fromX: number, fromY: number, visible = true, dmg = kind === 'cannon' ? 2 : 1): void {
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
      dmg,
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
    // 火炮打地面（建造模式）：按伤害值扣血，不是一炮一个。
    if (b.kind === 'aa' && t && t.lift <= 20) {
      if (b.hit && t.dead < 0) {
        this.fx.explode(b.b.x, b.b.y, b.b.z, 0.25);
        this.hurt(t, b.dmg, b.fromX, b.fromY, 0);
      } else if (Math.random() < 0.45) this.fx.explode(b.b.x, b.b.y, b.b.z, 0.2);
      return;
    }
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
      this.hurt(t, b.dmg, b.fromX, b.fromY, 0);
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

    this.coreHit = Math.max(0, this.coreHit - dt * 4);
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const o = this.hits[i];
      o.t += dt;
      // 先蹦得快、后面慢下来。
      o.z += (40 - 45 * Math.min(1, o.t / HIT_TIME)) * dt;
      if (o.t >= HIT_TIME) this.hits.splice(i, 1);
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const o = this.pops[i];
      o.t += dt;
      o.z += 16 * dt;
      if (o.t >= POP_TIME) this.pops.splice(i, 1);
    }
    if (this.lost) this.lostT += dt;
    if (this.won) this.wonT += dt;
    // 波次：倒计时到了就来下一波（最后一波来了就不再倒计时）；每一波剩下的虫按各自的速度从顶边涌出来（场上满了就等一等）。
    if (this.waves && !this.lost && !this.won) {
      this.sinceLaunch += dt;
      if (this.wave < this.field.waves) {
        this.nextIn -= dt;
        if (this.nextIn <= 0) this.launchWave();
      }
      let alive = this.aliveCount();
      for (const st of this.streams) {
        st.acc = Math.min(st.acc + dt * st.rate, Math.max(2, st.rate));
        while (st.acc >= 1 && st.left > 0 && alive < this.field.maxAlive) {
          st.acc--;
          st.left--;
          this.spawn();
          alive++;
        }
      }
      for (let i = this.streams.length - 1; i >= 0; i--) if (this.streams[i].left <= 0) this.streams.splice(i, 1);
    }
    this.checkWin();

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
      // 正面没人（那个位置的兵死了）就穿过缺口；路过巡逻机甲脚边会被它顺手打掉，没碰上的就一路冲向核心。
      if ((this.cross || b.y > LINE_Y - 14) && b.kind !== 'flyer') {
        const m = this.marineNear(b.x, b.y, 20);
        if (m) {
          this.hurtMarine(m, BITE[b.kind] ?? 2, b.kind);
          this.hurt(b, 99, b.x, LINE_Y, 0);
          continue;
        }
        const mech = this.cross || (b.y > LINE_Y + 20 && b.y < LINE_Y + 60) ? this.mechNear(b.x, b.y) : null;
        if (mech) {
          // 建造模式的机甲会挨咬（别的地图的机甲是打不坏的）。
          this.hurtMech(mech, BITE[b.kind] ?? 2);
          this.hurt(b, 99, b.x, LINE_Y + 40, 0);
          continue;
        }
      }
      if (b.prey && this.preyReached(b)) {
        this.strike(b);
        continue;
      }
      if ((this.cross || b.y > LINE_Y) && Math.hypot(b.x - CORE.x, b.y - CORE.y) < CORE_REACH) this.crash(b);
    }

    this.updateDefenders(dt);
    this.separate();
    this.updateGuns(dt);
    if (this.cruiserOn) this.updateCruiser(dt);
    this.updateStructures(dt);
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
        if (!this.toCore(b, (air ? b.speed * 2.2 : 0) * dt)) {
          b.y += (air ? b.speed * 2.2 : 0) * dt;
          b.x += wob * (air ? 2 : 0);
        }
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
        if (!this.toCore(b, b.speed * dt)) {
          b.y += b.speed * dt;
          b.x += wob;
        }
        b.lift = 50 + Math.sin(this.time * 1.7 + b.wobble) * 12;
        b.phase = (b.phase + (b.speed / 9) * dt) % 1;
        break;
      default:
        if (!this.toCore(b, b.speed * dt)) {
          b.y += b.speed * dt;
          b.x += wob;
        }
        b.phase = (b.phase + (b.speed / 9) * dt) % 1;
    }
    // 地面上的虫只能在平台上走；飞虫可以飞到虚空上面去。
    if (this.cross) {
      // 十字高地：地面虫只能在路和高台上走，飞虫随便飞。
      if (b.kind !== 'flyer') {
        const p = crossClamp(b.x, b.y);
        b.x = p.x;
        b.y = p.y;
      }
      return;
    }
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
        // 还在去集结点的路上：射程里没虫就接着走（端着枪走路的姿势）；有虫就停下来打，打完再走。
        if (d.path?.length) {
          if (d.burst <= 0 && (!d.target || d.target.dead >= 0) && d.cd <= 0) {
            d.target = this.nearest(this.inRange(d.x, d.y, this.rangeOf(d), false), d.x, d.y);
            if (d.target) d.burst = 3;
            else d.cd = 0.25;
          }
          if (d.burst <= 0 && (!d.target || d.target.dead >= 0)) {
            this.walkMarine(d, dt);
            continue;
          }
        }
        // 站定的士兵被挤离站位（比如机甲走过去），没在打的时候自己走回去。
        if (d.owner && d.burst <= 0 && Math.hypot(d.x - d.slotX, d.y - d.slotY) > 8) {
          d.path = [v2(d.slotX, d.slotY)];
          d.reroutes = 0;
        }
        // 步兵就是机枪兵：三发一个短点射。
        aimPose(d.pose, d.recoil);
        if (d.burst <= 0 && d.cd <= 0) {
          d.target = this.nearest(this.inRange(d.x, d.y, this.rangeOf(d), false), d.x, d.y);
          if (d.target) d.burst = 3;
          else d.cd = 0.3;
        }
        // 转身对准目标（d.yaw：相对"朝上"的角度，往右为正）；没对准就先不开火。
        let aligned = true;
        if (d.target) {
          const want = Math.atan2(d.target.x - d.x, -(d.target.y - d.y));
          const err = Math.atan2(Math.sin(want - d.yaw), Math.cos(want - d.yaw));
          d.yaw += clamp(err, -dt * 7, dt * 7);
          aligned = Math.abs(err) < 0.1;
        } else d.yaw += clamp(-d.yaw, -dt * 2, dt * 2);
        if (d.burst > 0 && d.cd <= 0 && aligned) {
          d.burst--;
          d.cd = d.burst > 0 ? 0.08 : (0.6 + Math.random() * 0.5) / this.stat(d.owner, 'rate');
          const t = d.target;
          if (!t) continue;
          d.recoil = 1;
          const a = this.muzzleOf(d);
          const hit = t.dead < 0 && Math.random() < 0.5;
          const b = hit ? v3(t.x, t.y, t.z + t.lift + 4) : v3(t.x + (Math.random() - 0.5) * 24, t.y - Math.random() * 30, t.z + 1);
          this.fire('rifle', a, b, t, hit, d.x, d.y, true, this.stat(d.owner, 'dmg'));
          this.flash(a, 1.3, rgb(200, 240, 255));
        }
        continue;
      }

      // 机甲：上半身转向目标，两臂的双联机炮左右交替连射；肩上导弹巢隔一阵齐射一轮。
      this.patrol(d, dt);
      if (d.burst <= 0 && d.cd <= 0) {
        d.target = this.nearest(this.inRange(d.x, d.y, this.rangeOf(d), false), d.x, d.y);
        if (d.target) d.burst = 12;
        else d.cd = 0.25;
      }
      if (d.target) {
        const want = Math.atan2(d.target.x - d.x, -(d.target.y - d.y));
        d.yaw += clamp(Math.atan2(Math.sin(want - d.yaw), Math.cos(want - d.yaw)), -dt * 3, dt * 3);
      }
      if (d.burst > 0 && d.cd <= 0) {
        d.burst--;
        d.cd = d.burst > 0 ? 0.07 : (0.45 + Math.random() * 0.3) / this.stat(d.owner, 'rate');
        d.side = -d.side;
        d.recoil = 1;
        const t = d.target;
        const a = this.muzzleOf(d);
        if (t) {
          const hit = t.dead < 0 && Math.random() < 0.55;
          const b = hit ? v3(t.x, t.y, t.z + t.lift + 4) : v3(t.x + (Math.random() - 0.5) * 30, t.y + (Math.random() - 0.5) * 24, t.z + 1);
          this.fire('cannon', a, b, t, hit, d.x, d.y, d.burst % 2 === 0, 2 * this.stat(d.owner, 'dmg'));
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
        const fl = this.inRange(d.x, d.y, MISSILE_RANGE, true);
        const ground = fl.length ? [] : this.inRange(d.x, d.y, this.rangeOf(d), false);
        const pool = fl.length ? fl : ground;
        if (pool.length) {
          d.missileCd = (2.6 + Math.random() * 1.2) / this.stat(d.owner, 'rate');
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

  /** 机枪兵沿路径点走：转向、往前挪、走路姿势；走完就站在集结点上（slotX / slotY）。 */
  private walkMarine(d: Defender, dt: number): void {
    const to = d.path![0];
    const dx = to.x - d.x;
    const dy = to.y - d.y;
    const dist = Math.hypot(dx, dy);
    const step = WALK_SPEED * dt;
    if (this.giveUp(d, dist, dt)) return;
    if (dist <= step) {
      d.x = to.x;
      d.y = to.y;
      d.path!.shift();
      if (!d.path!.length) {
        d.path = undefined;
        d.yaw = 0;
      }
      return;
    }
    d.x += (dx / dist) * step;
    d.y += (dy / dist) * step;
    const want = Math.atan2(dy, dx) + Math.PI / 2;
    d.yaw += clamp(Math.atan2(Math.sin(want - d.yaw), Math.cos(want - d.yaw)), -dt * 8, dt * 8);
    d.step = (d.step + step / WALK_CYCLE) % 1;
    walkPose(d.pose, d.step, WALK_GAIT);
    carryPose(d.pose);
  }

  /**
   * 走不到就算了：最后一段路上被站着的东西挡住、离终点已经不远，就停在这儿当作到了，
   * 站位改成现在的位置（不去挤开占着位置的人）；中途卡住（好一阵没往前走）就跳过这个路径点。
   * 返回 true = 这一帧不用再走了。
   */
  private giveUp(d: Defender, dist: number, dt: number): boolean {
    const last = d.path!.length === 1;
    const progressed = d.lastDist === undefined || d.lastDist - dist > 0.05;
    d.stuckT = progressed ? 0 : (d.stuckT ?? 0) + dt;
    d.lastDist = dist;
    const blockedNear = last && d.blocked && dist < ARRIVE_NEAR;
    d.blocked = false;
    if (blockedNear || (last && (d.stuckT ?? 0) > 0.8 && dist < ARRIVE_NEAR * 2)) {
      this.settle(d);
      return true;
    }
    if ((d.stuckT ?? 0) > 1.5) {
      d.lastDist = undefined;
      d.stuckT = 0;
      const goal = d.path![d.path!.length - 1];
      if ((d.reroutes ?? 0) < 2) {
        // 路被新盖的楼、挤在一起的人挡住了：从现在的位置重新绕一条。
        d.reroutes = (d.reroutes ?? 0) + 1;
        d.path = this.route(v2(d.x, d.y), goal, d.kind === 'mech' ? 22 : 10);
      } else if (!last) {
        d.path!.shift();
      } else {
        d.path!.shift();
        this.settle(d);
      }
      return true;
    }
    return false;
  }

  /** 就停在这儿当作到了：士兵把站位改成现在的位置；机甲在这儿（避开建筑、核心）左右踱步。 */
  private settle(d: Defender): void {
    d.path = undefined;
    d.lastDist = undefined;
    d.stuckT = 0;
    d.reroutes = 0;
    d.slotX = d.x;
    d.slotY = d.y;
    if (d.kind === 'rifle') d.yaw = 0;
    else [d.minX, d.maxX] = this.pacing(d.x, d.y);
  }

  /**
   * 机甲在 (cx, y) 附近踱步的左右范围：±22，但把会撞到建筑、核心的那一侧截短；平台边上也夹住。
   * 两边都被堵死就原地站着（min = max）。
   */
  private pacing(cx: number, y: number): [number, number] {
    const [a, b] = this.rowSpan(cx, y);
    let lo = Math.max(cx - 22, a + MECH_R + 4);
    let hi = Math.min(cx + 22, b - MECH_R - 4);
    const blocks = this.structures.map((st) => {
      const d = BUILDS[st.kind];
      return { x0: st.x - d.w / 2, x1: st.x + d.w / 2, y0: st.y - d.h / 2, y1: st.y + d.h / 2 };
    });
    blocks.push({ x0: CORE.x - 18, x1: CORE.x + 18, y0: CORE.y - 18, y1: CORE.y + 18 });
    for (const r of blocks) {
      if (y < r.y0 - MECH_R - 2 || y > r.y1 + MECH_R + 2) continue;
      const rx0 = r.x0 - MECH_R - 2;
      const rx1 = r.x1 + MECH_R + 2;
      if (rx1 <= lo || rx0 >= hi) continue;
      if ((r.x0 + r.x1) / 2 < cx) lo = Math.max(lo, rx1);
      else hi = Math.min(hi, rx0);
    }
    if (lo > hi) lo = hi = clamp(cx, a + MECH_R, b - MECH_R);
    return [lo, hi];
  }

  /** 机甲巡逻：沿 x 来回走，走到头停一下、原地转身再往回走；偶尔中途也停下站一会。 */
  private patrol(d: Defender, dt: number): void {
    // 刚从车间出来：沿路径点走（出门 → 绕开建筑 → 巡逻线上自己那一段），走完再开始左右巡逻。
    if (d.path && d.path.length) {
      const to = d.path[0];
      const dx = to.x - d.x;
      const dy = to.y - d.y;
      const dist = Math.hypot(dx, dy);
      // 机甲是朝着身体方向走、边走边转的，到点判定放宽一点，免得在路径点附近绕圈。
      if (dist < 3) {
        d.path.shift();
        d.lastDist = undefined;
        if (!d.path.length) d.reroutes = 0;
        return;
      }
      const head = Math.atan2(dy, dx);
      const e = Math.atan2(Math.sin(head - d.heading), Math.cos(head - d.heading));
      d.heading += clamp(e, -dt * 2.5, dt * 2.5);
      if (Math.abs(e) > 0.7) {
        // 拐大弯：原地小碎步转身。这段时间不算"卡住"。
        d.step = (d.step + dt * 0.9) % 1;
        d.stride += (0 - d.stride) * Math.min(1, dt * 5);
        d.lastDist = undefined;
        return;
      }
      if (this.giveUp(d, dist, dt)) return;
      // 小角度：边走边转，走的方向就是身体朝向（转着弯走过去，不是横着平移）。
      const step = Math.min(dist, 15 * dt);
      d.x += Math.cos(d.heading) * step;
      d.y += Math.sin(d.heading) * step;
      d.step = (d.step + step / 28) % 1;
      d.stride += (1 - d.stride) * Math.min(1, dt * 5);
      return;
    }
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
        // 巡逻区间被重新分过（多了一台机甲）时可能已经在区间外面：掉头慢慢走回去，不瞬移。
        if (d.x >= d.minX - 2 && d.x <= d.maxX + 2) d.x = clamp(d.x, d.minX, d.maxX);
        d.dir = d.x >= d.maxX ? -1 : 1;
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
    this.addSplat({ x: d.x, y: d.y + 2, t: 0, blobs: makeSplat(5, 0, 1, true), blood: [rgb(110, 16, 16), rgb(180, 36, 30)] });
    // 不补位：尸体躺够了就清掉，兵营看到人数少了会自己再造。
  }

  /** 中弹溅出的一点血星。 */
  private sparkAt(x: number, y: number, z: number): Spark {
    const a = Math.random() * Math.PI * 2;
    return { x, y, z, vx: Math.cos(a) * 30, vy: Math.sin(a) * 20, vz: 20 + Math.random() * 30, t: 0, life: 0.35, color: rgb(200, 40, 30) };
  }

  /**
   * 过了防线的虫：朝目标走 step 这么远。别的地图直奔核心；建造模式先扑向附近的建筑 / 机甲
   * （PREY_RANGE 以内最近的那个），附近没有就直奔核心；目标被打掉了就重新挑。
   * 还没过防线就什么都不做，返回 false。
   */
  private toCore(b: Bug, step: number): boolean {
    // 十字高地：虫一出来就朝核心（或者路上碰到的建筑 / 机甲）冲，隔一会儿看看附近有没有新目标。
    if (!this.cross && b.y <= LINE_Y + 10) return false;
    if ((b.prey === undefined || (b.prey && !this.alive(b.prey)) || (b.prey === null && this.cross && Math.random() < 0.05)))
      b.prey = this.pickPrey(b);
    const goal = b.prey ? this.preyPoint(b.prey, b) : CORE;
    const dx = goal.x - b.x;
    const dy = goal.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    b.x += (dx / d) * Math.min(step, d);
    b.y += (dy / d) * Math.min(step, d);
    return true;
  }

  private mechNear(x: number, y: number): Defender | null {
    return this.defenders.find((d) => d.kind === 'mech' && Math.abs(d.x - x) < 26 && Math.abs(d.y - y) < 24) ?? null;
  }

  private alive(t: Structure | Defender): boolean {
    return 'kind' in t && (t.kind === 'rifle' || t.kind === 'mech') ? this.defenders.includes(t as Defender) : this.structures.includes(t as Structure);
  }

  /** 离虫最近的建筑 / 机甲（PREY_RANGE 以内）；没有就是 null（直奔核心）。 */
  private pickPrey(b: Bug): Structure | Defender | null {
    let best: Structure | Defender | null = null;
    let bd = PREY_RANGE;
    for (const s of this.structures) {
      const p = this.preyPoint(s, b);
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    for (const m of this.defenders) {
      if (m.kind !== 'mech') continue;
      const d = Math.hypot(m.x - b.x, m.y - b.y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /** 扑向目标时朝哪个点走：建筑是占地上离虫最近的那一点，机甲是它本身。 */
  private preyPoint(t: Structure | Defender, b: Bug): Vec2 {
    if (t.kind === 'rifle' || t.kind === 'mech') return v2(t.x, t.y);
    const d = BUILDS[(t as Structure).kind];
    return v2(clamp(b.x, t.x - d.w / 2, t.x + d.w / 2), clamp(b.y, t.y - d.h / 2, t.y + d.h / 2));
  }

  private preyReached(b: Bug): boolean {
    const t = b.prey!;
    if (!this.alive(t)) return false;
    const p = this.preyPoint(t, b);
    return Math.hypot(p.x - b.x, p.y - b.y) < (t.kind === 'mech' ? 14 : 5);
  }

  /** 虫扑到建筑 / 机甲身上：咬一口（按撞核心的伤害表），自己炸成一摊（不给晶矿）。 */
  private strike(b: Bug): void {
    const t = b.prey!;
    const dmg = CORE_DMG[b.kind];
    if (t.kind === 'mech') this.hurtMech(t as Defender, dmg);
    else this.hurtStructure(t as Structure, dmg);
    this.addSplat({ x: b.x, y: b.y, t: 0, blobs: makeSplat(3 + BUG_SIZE[b.kind] * 2.4, 0, -1, true), blood: b.look.blood });
    this.shatter(b, 0, -1, 0.3);
    b.dead = 99;
  }

  /** 建造模式的机甲挨打：扣血、迸火星，打空就炸掉（车间看到少了一台会再造）。 */
  private hurtMech(d: Defender, dmg: number): void {
    if (d.kind !== 'mech' || !this.defenders.includes(d)) return;
    d.hp -= dmg;
    this.spray(v3(d.x, d.y, d.z + 26), 4, rgb(255, 200, 120), 50);
    if (d.hp > 0) return;
    this.explode(d.x, d.y, 1.4);
    this.debris(d.x, d.y, 30, 24);
    this.defenders.splice(this.defenders.indexOf(d), 1);
    if (d.owner) this.regroup(d.owner);
  }

  /** 建筑 / 炮塔挨打：扣血、闪一下；打空就炸毁（炮塔连炮一起没了，选中的面板自动关）。 */
  private hurtStructure(s: Structure, dmg: number): void {
    if (!this.structures.includes(s)) return;
    s.hp -= dmg;
    s.hit = 1;
    const d = BUILDS[s.kind];
    this.spray(v3(s.x, s.y + d.h / 2, d.top * 0.5), 5, rgb(255, 200, 120), 60);
    if (s.hp > 0) return;
    this.explode(s.x, s.y, 2.2);
    this.explode(s.x + (Math.random() - 0.5) * d.w * 0.6, s.y + (Math.random() - 0.5) * d.h * 0.6, 1.4);
    this.debris(s.x, s.y, d.top, 40);
    this.structures.splice(this.structures.indexOf(s), 1);
    if (s.gun) this.guns.splice(this.guns.indexOf(s.gun), 1);
    if (this.selected === s.id) this.selected = null;
  }

  /** 炸毁时飞出去的一把金属碎块（白、蓝、深灰）。 */
  private debris(x: number, y: number, z: number, n: number): void {
    const colors = [LIVERY_BLUE.base, LIVERY_BLUE.panel, LIVERY_BLUE.dark, rgb(120, 126, 140)];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 90;
      this.shards.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 20,
        z: z * Math.random(),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: 50 + Math.random() * 100,
        rot: Math.random() * 6,
        spin: (Math.random() - 0.5) * 20,
        size: 1 + Math.random() * 2.4,
        color: colors[Math.floor(Math.random() * colors.length)],
        t: 0,
      });
    }
  }

  /** (x, y) 附近 reach 以内被波及的建筑（占地外扩 reach）。 */
  private structuresNear(x: number, y: number, reach: number): Structure[] {
    return this.structures.filter((s) => {
      const d = BUILDS[s.kind];
      return Math.abs(s.x - x) < d.w / 2 + reach && Math.abs(s.y - y) < d.h / 2 + reach;
    });
  }

  /** 虫撞上核心：扣核心的血，虫自己炸成一摊（不给晶矿）。 */
  private crash(b: Bug): void {
    if (this.lost) return;
    this.coreHp = Math.max(0, this.coreHp - CORE_DMG[b.kind]);
    this.coreHit = 1;
    this.shake = Math.min(1, this.shake + 0.12);
    this.addSplat({ x: b.x, y: b.y, t: 0, blobs: makeSplat(3 + BUG_SIZE[b.kind] * 2.4, b.x - CORE.x, b.y - CORE.y, true), blood: b.look.blood });
    this.shatter(b, (b.x - CORE.x) / CORE_REACH, (b.y - CORE.y) / CORE_REACH, 0.3);
    b.dead = 99;
    if (this.coreHp <= 0) this.breakCore();
  }

  /** 核心碎了：一声大爆炸，水晶碎片往四周飞，这一局结束。 */
  private breakCore(): void {
    this.lost = true;
    this.lostT = 0;
    this.explode(CORE.x, CORE.y, 3);
    this.shake = 1;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 110;
      this.shards.push({
        x: CORE.x,
        y: CORE.y,
        z: 24,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: 60 + Math.random() * 120,
        rot: Math.random() * 6,
        spin: (Math.random() - 0.5) * 20,
        size: 1 + Math.random() * 2.2,
        color: CORE_SHARDS[Math.floor(Math.random() * CORE_SHARDS.length)],
        t: 0,
      });
    }
  }

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

  /** 巨舰在不在场：别的地图看地图设定，建造模式要买了才有。 */
  get cruiserOn(): boolean {
    return this.field.cruiser && this.cruiserBought;
  }

  /** 巨舰主炮现在的射程。 */
  cruiserRange(): number {
    return CRUISER_RANGE * this.stat(this.cruiserS, 'range');
  }

  /** 点到巨舰了没有：船浮在半空，点到的地面点会偏上，按它在地上的投影附近一大块算。 */
  cruiserAt(x: number, y: number): boolean {
    if (!this.cruiserOn) return false;
    const c = this.cruiser;
    const lift = (c.z * Projection.heightSquash) / Projection.groundSquash;
    return Math.hypot(x - c.x, (y + lift) - c.y) < 80;
  }

  /** 右键挪巨舰：慢慢开到 (x, y)（不出地图太远）。 */
  moveCruiser(x: number, y: number): boolean {
    if (!this.cruiserOn) return false;
    const c = this.cruiser;
    const [lo, hi] = this.cross ? [CROSS_C.x - 500, CROSS_C.x + 500] : [LANE_CX - 420, LANE_CX + 420];
    c.hx = clamp(x, lo, hi);
    c.hy = clamp(y, this.cross ? CROSS_C.y - 500 : TOP_Y + 60, this.cross ? CROSS_C.y + 500 : END_Y - 40);
    return true;
  }

  /** 买巨舰（建造模式，一局一次）：从待命位置的右边远处飞进来。 */
  buyCruiser(): boolean {
    if (!this.field.cruiser || this.cruiserBought || this.lost || this.crystals < CRUISER_COST) return false;
    this.crystals -= CRUISER_COST;
    this.cruiserBought = true;
    const c = this.cruiser;
    c.x = c.hx + 700;
    c.y = c.hy - 200;
    c.cd = 4;
    return true;
  }

  private updateCruiser(dt: number): void {
    const c = this.cruiser;
    c.t += dt;
    // 往待命位置开：
    //   第一次进场：船头直接对着待命位置，飞得快（越近越慢），到之前不打。
    //   之后右键挪位置：先慢慢转身让船头对准目的地，对准了才往前开（沿船头方向，慢慢加速、到了附近慢慢减速），
    //   路上一直微调方向。整段移动都不打：正在蓄能的那一发中止、目标丢掉；已经打出去的光弹照常落地。
    const fx = c.hx - c.x;
    const fy = c.hy - c.y;
    const far = Math.hypot(fx, fy);
    const moving = far > 3;
    if (moving) {
      const want = Math.atan2(fy, fx);
      c.lock = null;
      c.target = null;
      c.charge = Math.max(0, c.charge - dt * 2);
      c.recoil = Math.max(0, c.recoil - dt * 1.2);
      if (!this.cruiserArrived) {
        c.yaw = want;
        const sp = Math.min(far, Math.max(20, far * 1.2) * dt);
        c.x += (fx / far) * sp;
        c.y += (fy / far) * sp;
        if (far <= 40) this.cruiserArrived = true;
        return;
      }
      const err = Math.atan2(Math.sin(want - c.yaw), Math.cos(want - c.yaw));
      // 转向带惯性：想要的角速度随剩余角度变小（最快约 14°/秒），角速度本身也只能慢慢变。
      const wantSpin = clamp(err * 0.6, -0.25, 0.25);
      c.spin += clamp(wantSpin - c.spin, -dt * 0.15, dt * 0.15);
      c.yaw += c.spin * dt;
      // 船头差不多对准了才开；离目的地越近开得越慢。
      const wantVel = Math.abs(err) < 0.15 ? Math.min(CRUISER_CRUISE, far * 0.35) : 0;
      c.vel += clamp(wantVel - c.vel, -dt * 3, dt * 1.5);
      c.x += Math.cos(c.yaw) * c.vel * dt;
      c.y += Math.sin(c.yaw) * c.vel * dt;
      return;
    }
    if (far > 0.01) {
      // 到了：停稳。
      c.x = c.hx;
      c.y = c.hy;
    }
    c.vel = 0;
    if (!this.cruiserArrived) this.cruiserArrived = true;
    this.cruiserS.x = c.x;
    this.cruiserS.y = c.y;
    c.recoil = Math.max(0, c.recoil - dt * 1.2);
    c.cd -= dt;
    // 一轮攻击 = 对准 → 蓄能（锁死方向和落点）→ 光弹飞行 → 连环爆炸。整轮期间不挑目标、不转向。
    // 炸完才挑下一个虫最密的地方，冷却期间船身慢慢转过去；目标死了或者冲得太近就换，优先挑不用大转的。
    const busy = c.lock !== null || this.bolts.length > 0 || this.blasts.length > 0;
    const aimAt = (b: Bug): number => Math.atan2(b.y - c.y, b.x - c.x);
    const turn = (a: number): number => Math.abs(Math.atan2(Math.sin(a - c.yaw), Math.cos(a - c.yaw)));
    const range = this.cruiserRange();
    const inRange = (b: Bug): boolean => Math.hypot(b.x - c.x, b.y - c.y) <= range;
    const tooClose = (b: Bug): boolean => (this.cross ? Math.hypot(b.x - CORE.x, b.y - CORE.y) < 140 : b.y > LINE_Y - 100);
    if (!busy && (!c.target || c.target.dead >= 0 || tooClose(c.target) || !inRange(c.target))) {
      const pool = this.bugs.filter(
            (b) =>
              b.dead < 0 &&
              b.kind !== 'flyer' &&
              inRange(b) &&
              (this.cross ? Math.hypot(b.x - CORE.x, b.y - CORE.y) > 160 : b.y > 40 && b.y < LINE_Y - 130),
          );
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
        const to = v3(c.lock.x, c.lock.y, this.terrain.heightAt(c.lock.x, c.lock.y));
        this.bolts.push({ from, to, t: 0, dur: Math.hypot(to.x - from.x, to.y - from.y) / 420, power: this.stat(this.cruiserS, 'dmg') });
        this.flash(from, 6, rgb(200, 235, 255));
        this.fx.muzzle(from.x, from.y, from.z);
        c.recoil = 1;
        c.cd = (14 + Math.random() * 4) / this.stat(this.cruiserS, 'rate');
        c.target = null;
        c.lock = null;
      }
    } else c.charge = Math.max(0, c.charge - dt * 2);
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t >= b.dur) {
        this.explode(b.to.x, b.to.y, 1.9, b.power);
        this.shake = Math.max(this.shake, 0.6);
        // 主炮落点：中心一炸，周围再一圈一圈地连环炸开，和一轮轰炸差不多。
        for (let k = 0; k < 7; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = 18 + Math.random() * 30;
          this.blasts.push({ x: b.to.x + Math.cos(a) * r, y: b.to.y + Math.sin(a) * r * 0.8, t: 0.12 + k * 0.09 + Math.random() * 0.05, size: 0.7 + Math.random() * 0.4, power: b.power });
        }
        this.bolts.splice(i, 1);
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t -= dt;
      if (b.t <= 0) {
        this.explode(b.x, b.y, b.size, b.power);
        this.blasts.splice(i, 1);
      }
    }
  }

  /** 一个守军现在的射程（圆的半径）。 */
  private rangeOf(d: Defender): number {
    return (d.kind === 'rifle' ? RIFLE_RANGE : MECH_RANGE) * this.stat(d.owner, 'range');
  }

  /** 一门炮现在的射程。 */
  private gunRange(g: Gun): number {
    return (g.kind === 'tank' ? TANK_RANGE : AA_RANGE) * this.stat(g.owner, 'range');
  }

  /** 某种炮塔在某个射程等级下的射程（射程圈用）。 */
  private baseRange(kind: BuildKind): number {
    return kind === 'tank' ? TANK_RANGE : kind === 'artillery' ? AA_RANGE : 0;
  }

  /** 地面上的一点（按地形高度垫高，再加 dz）→ 缓冲像素。十字高地的高台上要垫高。 */
  private onGround(cam: Camera, x: number, y: number, dz = 0): Vec2 {
    return cam.worldToScreenZ(x, y, this.terrain.heightAt(x, y) + dz);
  }

  /** 过 (x, y) 这一行能走的那一段：单通道是通道的左右边，十字高地是高台 / 路。 */
  private rowSpan(x: number, y: number): [number, number] {
    return this.cross ? crossRowSpan(x, y) : spanAt(y);
  }

  /** 把一个点挪回能站人的地方。 */
  private walkClamp(x: number, y: number, margin: number): Vec2 {
    if (this.cross) return crossClamp(x, y);
    const yy = clamp(y, TOP_Y + 20, END_Y - 20);
    const [a, b] = spanAt(yy);
    return v2(clamp(x, a + margin, b - margin), yy);
  }

  /** 某个单位 / 炮在某条升级线上的倍率（count 以外）：没有主人（自动地图）或没有这条线就是 1。 */
  private stat(owner: Structure | undefined, key: StatKey): number {
    if (!owner) return 1;
    const def = statDef(owner.kind, key);
    return def ? def.values[owner.up[key] - 1] : 1;
  }

  // ------------------------------------------------------------ 建造模式

  /** 虫群开始进攻（引导走完或跳过）：先是 WAVE_PREP 秒准备时间，倒计时走完第一波才来。 */
  startWaves(): void {
    this.waves = true;
  }

  /** 最后一波来了、虫全清光：通关。 */
  private checkWin(): void {
    if (this.won || this.lost || !this.waves || this.wave < this.field.waves || this.bugsLeft > 0) return;
    this.won = true;
  }

  /** 来下一波：波数 +1，这一波的虫排进队列（和场上还没打完的叠在一起），倒计时重新开始。 */
  private launchWave(): void {
    if (this.wave >= this.field.waves) return;
    // 上一波撑过去了：每突破 CREDIT_MILESTONE 波发一笔信用点。
    if (this.wave > 0 && this.wave % CREDIT_MILESTONE === 0) {
      const k = this.wave / CREDIT_MILESTONE;
      const amount = Math.round(MILESTONE_BASE * k * (1 + Math.random() * 0.5));
      this.credits += amount;
      this.milestone = { wave: this.wave, amount };
    }
    this.wave++;
    const size = waveSize(this.wave, this.field.waveScale, this.field.waves);
    this.nextIn = this.wave < this.field.waves ? waveGap(this.wave) : 0;
    this.sinceLaunch = 0;
    // 先冲出来的一群：立刻刷出来（场上装得下多少出多少），从地图顶边往下铺成一长片（越多铺得越长），一路压下来。
    const burst = Math.max(1, Math.round(size * WAVE_BURST));
    const n = Math.max(0, Math.min(burst, this.field.maxAlive - this.aliveCount()));
    const len = Math.min(WAVE_STRING_MAX, WAVE_STRING_MIN + n * WAVE_STRING);
    // 分层撒：每只落在自己那一小段里，整片铺得匀，虫少时前头也一定有几只在镜头里。
    for (let i = 0; i < n; i++) this.spawn(TOP_Y - 30 + (len * (i + Math.random())) / n);
    // 剩下的（加上场上装不下的那部分）在这一波的时间里匀速涌出来。
    const left = size - n;
    if (left > 0) this.streams.push({ left, rate: (left / (waveGap(this.wave) * STREAM_SPAN)) * this.field.pace, acc: 0 });
  }

  /** 还没涌出来的虫（所有波加起来）。 */
  private get pending(): number {
    return this.streams.reduce((t, st) => t + st.left, 0);
  }

  private aliveCount(): number {
    return this.bugs.reduce((n, b) => n + (b.dead < 0 ? 1 : 0), 0);
  }

  /** 还要等几秒才能提前叫下一波（0 = 现在就能叫）。 */
  get callLock(): number {
    return Math.max(0, callLockOf(this.wave) - this.sinceLaunch);
  }

  /** 现在这段倒计时一共多长（HUD 的进度条用）。 */
  get waveTimer(): number {
    return this.wave === 0 ? WAVE_PREP : waveGap(this.wave);
  }

  /** 下一波有多少只（已经是最后一波就是 0）。 */
  get nextWaveSize(): number {
    return this.wave < this.field.waves ? waveSize(this.wave + 1, this.field.waveScale, this.field.waves) : 0;
  }

  /** 现在提前叫下一波能拿多少晶矿（剩下的秒数 × EARLY_BONUS）。 */
  get earlyBonus(): number {
    return this.waves && !this.lost && this.wave < this.field.waves ? Math.round(Math.max(0, this.nextIn) * EARLY_BONUS) : 0;
  }

  /** 提前叫下一波：按剩余倒计时给晶矿，下一波立刻来。返回给了多少晶矿（不能叫就是 -1）。 */
  callNextWave(): number {
    if (!this.waves || this.lost || this.won || this.wave >= this.field.waves || (this.wave > 0 && this.callLock > 0)) return -1;
    const bonus = this.earlyBonus;
    this.crystals += bonus;
    this.launchWave();
    return bonus;
  }

  /** 还没打完的虫：场上活着的 + 排着没出来的。 */
  get bugsLeft(): number {
    return this.bugs.reduce((n, b) => n + (b.dead < 0 ? 1 : 0), 0) + this.pending;
  }

  /** (x, y) 处能不能放一座 kind：整块落在通道里、在防线后面（让开机甲巡逻线）、不压核心、不压别的建筑。 */
  placeable(kind: BuildKind, x: number, y: number): boolean {
    const d = BUILDS[kind];
    const x0 = x - d.w / 2;
    const x1 = x + d.w / 2;
    const y0 = y - d.h / 2;
    const y1 = y + d.h / 2;
    if (this.cross) {
      // 十字高地：整块落在高台上（离边 8）。
      if (x0 < CROSS_C.x - PLAT + 8 || x1 > CROSS_C.x + PLAT - 8 || y0 < CROSS_C.y - PLAT + 8 || y1 > CROSS_C.y + PLAT - 8) return false;
    } else {
      if (y0 < BUILD_FRONT || y1 > END_Y - 6) return false;
      for (const yy of [y0, y, y1]) {
        const [a, b] = spanAt(yy);
        if (x0 < a + 8 || x1 > b - 8) return false;
      }
    }
    // 核心周围留一圈。
    const cx = clamp(CORE.x, x0, x1);
    const cy = clamp(CORE.y, y0, y1);
    if (Math.hypot(cx - CORE.x, cy - CORE.y) < 36) return false;
    for (const o of this.structures) {
      const od = BUILDS[o.kind];
      if (Math.abs(o.x - x) < (od.w + d.w) / 2 + 4 && Math.abs(o.y - y) < (od.h + d.h) / 2 + 4) return false;
    }
    return true;
  }

  /** 花晶矿在 (x, y) 造一座 kind；钱不够或放不下就返回 null。 */
  place(kind: BuildKind, x: number, y: number): Structure | null {
    const d = BUILDS[kind];
    if (this.crystals < d.cost || !this.placeable(kind, x, y)) return null;
    this.crystals -= d.cost;
    const s: Structure = {
      id: this.nextId++,
      kind,
      x,
      y,
      up: { count: 1, speed: 1, dmg: 1, range: 1, rate: 1 },
      prog: 0,
      door: 0,
      doorWant: 0,
      doorHold: 0,
      exitReady: false,
      gun: null,
      flash: 1,
      hp: d.hp,
      hit: 0,
      rally: this.cross
        ? crossRampTops().reduce((p, q) => (Math.hypot(q.x - x, q.y - y) < Math.hypot(p.x - x, p.y - y) ? q : p))
        : kind === 'factory'
          ? v2(LANE_CX, PATROL_Y)
          : v2(LANE_CX, LINE_Y + 4),
      spent: d.cost,
    };
    if (kind === 'tank' || kind === 'artillery') {
      s.gun = { kind: kind === 'tank' ? 'tank' : 'aa', x, y, yaw: -Math.PI / 2, aim: 0, pitch: 0.6, recoil: 0, cd: 1, barrel: 1, target: null, retarget: 0, owner: s };
      this.guns.push(s.gun);
    }
    this.structures.push(s);
    // 默认集结点也得在集结范围里（建在离防线很远的地方时，就落在范围圈靠防线那一边）。
    if (kind === 'barracks' || kind === 'factory') s.rally = this.clampRally(s, s.rally.x, s.rally.y);
    this.fx.poof(x, y + d.h / 2, 0, 1.2);
    this.shake = Math.min(1, this.shake + 0.15);
    this.makeRoom();
    return s;
  }

  /** 把一座建筑的某条升级线升一级；满级、没有这条线或钱不够返回 false。 */
  /** 按编号找：建筑，或者（编号 CRUISER_ID）巨舰。 */
  private findS(id: number): Structure | null {
    if (id === CRUISER_ID) {
      if (!this.cruiserOn) return null;
      // 巨舰飞进场、右键挪位置的途中也要对得上（升级面板跟着它走）。
      this.cruiserS.x = this.cruiser.x;
      this.cruiserS.y = this.cruiser.y;
      return this.cruiserS;
    }
    return this.structures.find((o) => o.id === id) ?? null;
  }

  upgrade(id: number, key: StatKey): boolean {
    const s = this.findS(id);
    const def = s && statDef(s.kind, key);
    if (!s || !def) return false;
    const lv = s.up[key];
    if (lv >= def.values.length) return false;
    const cost = def.costs[lv - 1];
    if (this.crystals < cost) return false;
    this.crystals -= cost;
    s.up[key] = lv + 1;
    s.spent += cost;
    s.flash = 1;
    if (s !== this.cruiserS) this.fx.poof(s.x, s.y + BUILDS[s.kind].h / 2, 0, 0.8);
    return true;
  }

  /** 卖掉一座建筑：退还总花费的 70%，原地冒一团烟就没了，它造出来的兵和机甲也一起撤走。 */
  sell(id: number): boolean {
    const s = this.structures.find((o) => o.id === id);
    if (!s) return false;
    this.crystals += Math.round(s.spent * SELL_REFUND);
    const d = BUILDS[s.kind];
    this.fx.poof(s.x, s.y, 0, 1.6);
    this.fx.poof(s.x + d.w * 0.3, s.y + d.h * 0.3, 0, 1);
    this.structures.splice(this.structures.indexOf(s), 1);
    if (s.gun) this.guns.splice(this.guns.indexOf(s.gun), 1);
    if (this.selected === id) this.selected = null;
    // 它造出来的兵和机甲一起撤走（不然卖了再造就能无限刷兵）。
    for (let i = this.defenders.length - 1; i >= 0; i--) {
      const u = this.defenders[i];
      if (u.owner !== s) continue;
      this.fx.poof(u.x, u.y, 0, u.kind === 'mech' ? 0.9 : 0.4);
      this.defenders.splice(i, 1);
    }
    return true;
  }

  /** 轰炸支援：花晶矿立刻叫一组炮艇，从后方飞过来，沿虫最多的那一列投弹。 */
  callAirstrike(): boolean {
    if (this.crystals < AIRSTRIKE_COST || this.lost) return false;
    this.crystals -= AIRSTRIKE_COST;
    if (this.cross) {
      // 十字高地：挑虫最密的一团（随便抽几只，数周围 60 以内的同伴），炮艇从南往北飞过去，只在那一团上空投弹。
      const live = this.bugs.filter((b) => b.dead < 0);
      let best = live[0];
      let bestN = -1;
      for (let k = 0; k < 12 && live.length; k++) {
        const c = live[Math.floor(Math.random() * live.length)];
        const n = live.filter((o) => Math.abs(o.x - c.x) < 60 && Math.abs(o.y - c.y) < 60).length;
        if (n > bestN) {
          bestN = n;
          best = c;
        }
      }
      const tx = best ? best.x : CORE.x;
      const ty = best ? best.y : CORE.y - 200;
      const drop = { dropY0: ty - 70, dropY1: ty + 70 };
      this.planes.push({ x: tx - 18, y: ty + 520, z: 120, dropCd: 0, ...drop }, { x: tx + 18, y: ty + 550, z: 124, dropCd: 0.06, ...drop });
      return true;
    }
    const front = this.bugs.filter((b) => b.dead < 0 && b.y < LINE_Y && b.y > 40);
    const mx = front.length ? front.reduce((a, b) => a + b.x, 0) / front.length : LANE_CX;
    const [a, b] = spanAt(LINE_Y - 200);
    const x = clamp(mx - 18, a + 6, b - 42);
    this.planes.push({ x, y: PLANE_ENTRY_Y, z: 120, dropCd: 0 }, { x: x + 36, y: PLANE_ENTRY_Y + 30, z: 124, dropCd: 0.06 });
    return true;
  }

  /** 点在 (x, y) 上的建筑。楼是立着的，点到楼顶时换算出来的地面点会偏上，所以往下多试几格。 */
  structureAt(x: number, y: number): Structure | null {
    for (let k = 0; k <= 40; k += 8) {
      for (const s of this.structures) {
        const d = BUILDS[s.kind];
        if (Math.abs(s.x - x) <= d.w / 2 && Math.abs(s.y - (y + k)) <= d.h / 2) return s;
      }
    }
    return null;
  }

  structureInfo(id: number): StructureInfo | null {
    const s = this.findS(id);
    if (!s) return null;
    const d = BUILDS[s.kind];
    const count = statDef(s.kind, 'count');
    return {
      id: s.id,
      kind: s.kind,
      x: s.x,
      y: s.y,
      count: this.unitCount(s),
      cap: count ? count.values[s.up.count - 1] : 0,
      prog: s.prog,
      blocked: false,
      hp: s.hp,
      maxHp: d.hp,
      // 巨舰不能卖（-1）。
      refund: s === this.cruiserS ? -1 : Math.round(s.spent * SELL_REFUND),
      stats: d.stats.map((st) => {
        const lv = s.up[st.key];
        const max = st.values.length;
        return { key: st.key, name: st.name, level: lv, max, value: st.values[lv - 1], next: lv < max ? st.values[lv] : null, cost: lv < max ? st.costs[lv - 1] : null };
      }),
    };
  }

  /** 这座兵营 / 车间名下现有多少兵（活着的 + 正在走去站位的）。 */
  unitCount(s: Structure): number {
    let n = 0;
    for (const d of this.defenders) if (d.owner === s && (d.kind === 'mech' || d.deadT < 0)) n++;
    return n;
  }

  /**
   * 绕开建筑的路：从 from 直奔 to，路上撞到哪座建筑（占地往外扩 margin）就从它旁边绕 —— 先横到它的左边或右边
   * （挑离起点和终点都近的那边），沿着边走到它的另一头，再接着往目标走。起点所在的那座不算（刚从它的门里出来）。
   */
  private route(from: Vec2, to: Vec2, margin: number): Vec2[] {
    const inside = (p: Vec2, r: { x0: number; x1: number; y0: number; y1: number }): boolean => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
    // 每块障碍按 margin 外扩；终点落在外扩带里的那块（终点贴着楼），改成只外扩单位自己的半径 ——
    // 照样绕开楼，又走得到贴着楼的终点。
    const rad = margin > 12 ? MECH_R : RIFLE_R;
    const boxes = this.structures.map((o) => ({ x: o.x, y: o.y, hw: BUILDS[o.kind].w / 2, hh: BUILDS[o.kind].h / 2 }));
    boxes.push({ x: CORE.x, y: CORE.y, hw: 18, hh: 18 });
    // 十字高地四个角上的崖壁（不外扩：它们本身就到路边为止）。
    const cliffs = this.cross ? crossBlocks() : [];
    const rects = boxes.map((o) => {
      const wide = { x0: o.x - o.hw - margin, x1: o.x + o.hw + margin, y0: o.y - o.hh - margin, y1: o.y + o.hh + margin };
      return inside(to, wide) ? { x0: o.x - o.hw - rad, x1: o.x + o.hw + rad, y0: o.y - o.hh - rad, y1: o.y + o.hh + rad } : wide;
    });
    for (const k of cliffs) rects.push({ x0: k.x0 - rad, x1: k.x1 + rad, y0: k.y0 - rad, y1: k.y1 + rad });
    const out: Vec2[] = [];
    let cur = from;
    for (let guard = 0; guard < 6; guard++) {
      let hit: (typeof rects)[number] | null = null;
      let best = Infinity;
      for (const r of rects) {
        // 起点所在的那座不算（刚从它的门里出来）；收紧后终点还在里面的也不算（目标就在楼上，走到跟前为止）。
        if (inside(cur, r) || inside(from, r) || inside(to, r)) continue;
        const t = segEnter(cur, to, r);
        if (t !== null && t < best) {
          best = t;
          hit = r;
        }
      }
      if (!hit) break;
      const r = hit;
      const corners = this.around(cur, to, r);
      out.push(...corners);
      cur = corners[corners.length - 1];
    }
    out.push(to);
    return out;
  }

  /**
   * 绕过一块矩形障碍：在它外面一圈取四个角点（离边 1 个单位，落在边上的话下一轮会被当成"又撞上了"），
   * 在"经过一个角"和"经过相邻两个角"这几种走法里，挑每一段都不穿过它、总长最短的那条，返回要经过的角点。
   * 比如人在楼右边、目标在楼左边而且高度落在楼的范围里：走"右上角 → 左上角 → 目标"。
   */
  private around(cur: Vec2, to: Vec2, r: { x0: number; x1: number; y0: number; y1: number }): Vec2[] {
    const c = [v2(r.x0 - 1, r.y0 - 1), v2(r.x1 + 1, r.y0 - 1), v2(r.x1 + 1, r.y1 + 1), v2(r.x0 - 1, r.y1 + 1)];
    const clear = (p: Vec2, q: Vec2): boolean => segEnter(p, q, r) === null;
    const len = (...pts: Vec2[]): number => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    let best: Vec2[] | null = null;
    let bestLen = Infinity;
    for (let i = 0; i < 4; i++) {
      if (clear(cur, c[i]) && clear(c[i], to) && len(cur, c[i], to) < bestLen) {
        bestLen = len(cur, c[i], to);
        best = [c[i]];
      }
      for (const j of [(i + 1) % 4, (i + 3) % 4]) {
        if (clear(cur, c[i]) && clear(c[i], c[j]) && clear(c[j], to) && len(cur, c[i], c[j], to) < bestLen) {
          bestLen = len(cur, c[i], c[j], to);
          best = [c[i], c[j]];
        }
      }
    }
    // 都不行（人卡在角上之类）：走离人最近的那个角，下一轮再说。
    return best ?? [c.reduce((p, q) => (Math.hypot(q.x - cur.x, q.y - cur.y) < Math.hypot(p.x - cur.x, p.y - cur.y) ? q : p))];
  }

  /** 兵营 / 车间的门：要开就往上升，开到顶后等 doorHold，没有单位要出门了再落下。 */
  private updateDoor(s: Structure, dt: number): void {
    if (s.doorWant > 0 && s.door >= 1 && !s.exitReady) {
      s.doorHold -= dt;
      if (s.doorHold <= 0) s.doorWant = 0;
    }
    s.door = clamp(s.door + (s.doorWant > 0 ? dt * 1.2 : -dt), 0, 1);
  }

  /**
   * 碰撞（建造模式）：单位之间按半径互相推开，单位推出建筑占地。
   * 推的时候按"好不好推"分：走路中的士兵最好推，站定的士兵难推一些，机甲最难推 —— 这样站好的方阵
   * 不会被路过的人挤散，路过的人自己绕开。一帧只推一部分，挤在一起时慢慢散开，不会抖。
   */
  private separate(): void {
    const units = this.defenders.filter((d) => d.kind === 'mech' || d.deadT < 0);
    const rad = (d: Defender): number => (d.kind === 'mech' ? MECH_R : RIFLE_R);
    const moving = (d: Defender): boolean => !!d.path?.length;
    const give = (d: Defender, other: Defender): number => {
      // 机甲又大又重：和士兵碰上，不管谁在走，都是士兵让开。
      if (d.kind === 'mech' && other.kind === 'rifle') return 0.05;
      if (d.kind === 'rifle' && other.kind === 'mech') return 1;
      // 走路的碰上站着的：站着的不动，走路的自己让开（并记一笔"被挡住了"）。
      if (!moving(d) && moving(other)) return 0;
      if (moving(d) && !moving(other)) return 1;
      return d.kind === 'mech' ? 0.15 : 1;
    };
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j];
        const r = rad(a) + rad(b);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        const dist = Math.sqrt(d2) || 0.01;
        const nx = d2 > 0 ? dx / dist : Math.cos(i + j);
        const ny = d2 > 0 ? dy / dist : Math.sin(i + j);
        const push = (r - dist) * 0.5;
        const ga = give(a, b);
        const gb = give(b, a);
        const sum = ga + gb || 1;
        if (moving(a) && !moving(b) && ga > 0.5) a.blocked = true;
        if (moving(b) && !moving(a) && gb > 0.5) b.blocked = true;
        a.x -= nx * push * (ga / sum);
        a.y -= ny * push * (ga / sum);
        b.x += nx * push * (gb / sum);
        b.y += ny * push * (gb / sum);
      }
    }
    // 建筑：单位的圆和占地矩形重叠了，就沿穿进去最浅的那个方向推出去。核心按一个圆推开。
    for (const u of units) {
      const r = rad(u);
      if (this.cross) {
        const p = crossClamp(u.x, u.y);
        u.x = p.x;
        u.y = p.y;
      }
      const cdx = u.x - CORE.x;
      const cdy = u.y - CORE.y;
      const cd = Math.hypot(cdx, cdy);
      if (cd < 18 + r) {
        const k = cd > 0.01 ? (18 + r) / cd : 0;
        u.x = cd > 0.01 ? CORE.x + cdx * k : u.x + 18 + r;
        u.y = cd > 0.01 ? CORE.y + cdy * k : u.y;
      }
      for (const st of this.structures) {
        const d = BUILDS[st.kind];
        const x0 = st.x - d.w / 2 - r;
        const x1 = st.x + d.w / 2 + r;
        const y0 = st.y - d.h / 2 - r;
        const y1 = st.y + d.h / 2 + r;
        if (u.x <= x0 || u.x >= x1 || u.y <= y0 || u.y >= y1) continue;
        // 刚从这座楼的门里出来、还在门口那一小段：不推（门槛在占地边上）。
        if (u.owner === st && u.path?.length && u.y > st.y + d.h / 2 - 2) continue;
        const outs = [u.x - x0, x1 - u.x, u.y - y0, y1 - u.y];
        const k = outs.indexOf(Math.min(...outs));
        if (k === 0) u.x = x0;
        else if (k === 1) u.x = x1;
        else if (k === 2) u.y = y0;
        else u.y = y1;
      }
    }
  }

  /**
   * 兵营方阵：集结点往前（朝虫来的方向）排成每排 5 个、间距 16 的方阵，从第一排中间往两边、往前填
   * （往后排会压到防线后面机甲的巡逻线）；
   * 已经有人（或正在走过去）的位置跳过。夹在平台里。
   */
  private formationSpot(s: Structure, skip?: Defender): Vec2 {
    const taken = this.defenders.filter((d) => d.owner === s && d.kind === 'rifle' && d.deadT < 0 && d !== skip);
    // 往哪边排：单通道朝上（虫来的方向）；十字高地朝"从核心指向集结点"的方向（集结点在哪个路口就朝那条路）。
    let fx = 0;
    let fy = -1;
    if (this.cross) {
      const dx = s.rally.x - CORE.x;
      const dy = s.rally.y - CORE.y;
      const l = Math.hypot(dx, dy);
      if (l > 1) [fx, fy] = [dx / l, dy / l];
    }
    for (let i = 0; i < 60; i++) {
      const row = Math.floor(i / 5);
      const k = i % 5;
      const col = k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -k / 2;
      const p = this.walkClamp(s.rally.x + fx * row * 16 - fy * col * 16, s.rally.y + fy * row * 16 + fx * col * 16, 10);
      const x = p.x;
      const y = p.y;
      if (this.blockedSpot(x, y)) continue;
      if (!taken.some((d) => Math.abs(d.slotX - x) < 1 && Math.abs(d.slotY - y) < 1)) return v2(x, y);
    }
    return v2(s.rally.x, s.rally.y);
  }

  /** 这个位置站不了机甲：机甲的圆会压到建筑或核心。 */
  private mechBlocked(x: number, y: number): boolean {
    if (Math.hypot(x - CORE.x, y - CORE.y) < 18 + MECH_R + 2) return true;
    if (this.cross && !crossWalkable(x, y)) return true;
    return this.structures.some((st) => {
      const d = BUILDS[st.kind];
      return Math.abs(x - st.x) < d.w / 2 + MECH_R + 2 && Math.abs(y - st.y) < d.h / 2 + MECH_R + 2;
    });
  }

  /** 这个位置站不了人：在建筑占地里（外扩一圈）或者压着核心。 */
  private blockedSpot(x: number, y: number): boolean {
    if (Math.hypot(x - CORE.x, y - CORE.y) < 30) return true;
    if (this.cross && !crossWalkable(x, y)) return true;
    return this.structures.some((st) => {
      const d = BUILDS[st.kind];
      return Math.abs(x - st.x) < d.w / 2 + RIFLE_R + 2 && Math.abs(y - st.y) < d.h / 2 + RIFLE_R + 2;
    });
  }

  /**
   * 一座车间的机甲在集结点附近踱步：左右错开 40 一台，每台在自己那一小段（±22）来回走。
   * 正在路上的把终点改过去；已经到了的直接改踱步范围、走过去。
   */
  private regroup(s: Structure): void {
    const mechs = this.defenders.filter((d) => d.kind === 'mech' && d.owner === s);
    const [a, b] = this.rowSpan(s.rally.x, s.rally.y);
    // 位置：从集结点往两边每 40 一个候选（0、-40、+40、-80…），跳过被建筑 / 核心占着的，取前几个、从左到右排。
    const y = s.rally.y;
    const spots: number[] = [];
    for (let k = 0; k < 24 && spots.length < mechs.length; k++) {
      const off = k === 0 ? 0 : (k % 2 === 1 ? -1 : 1) * Math.ceil(k / 2) * 40;
      const x = s.rally.x + off;
      if (x < a + 26 || x > b - 26 || this.mechBlocked(x, y)) continue;
      spots.push(x);
    }
    while (spots.length < mechs.length) spots.push(clamp(s.rally.x, a + 26, b - 26));
    spots.sort((p, q) => p - q);
    mechs.sort((p, q) => p.x - q.x);
    mechs.forEach((m, i) => {
      const cx = spots[i];
      [m.minX, m.maxX] = this.pacing(cx, s.rally.y);
      m.slotX = cx;
      m.slotY = s.rally.y;
      m.reroutes = 0;
      m.stuckT = 0;
      m.lastDist = undefined;
      const from = m.path?.length ? m.path[0] : v2(m.x, m.y);
      m.path = [...(m.path?.length ? [from] : []), ...this.route(from, v2(cx, s.rally.y), 22)];
    });
  }

  /**
   * 新盖了一座楼：目标位置被它占住的单位换个位置。机甲按集结点重新排；士兵只给被占住的那几个
   * 重新领方阵位置、重新寻路（站着的、走着的都算）。
   */
  private makeRoom(): void {
    for (const s of this.structures) {
      if (s.kind === 'factory') {
        const mine = this.defenders.filter((d) => d.kind === 'mech' && d.owner === s);
        if (mine.some((m) => this.mechBlocked(m.slotX, m.slotY))) this.regroup(s);
      } else if (s.kind === 'barracks') {
        for (const d of this.defenders) {
          if (d.owner !== s || d.kind !== 'rifle' || d.deadT >= 0 || !this.blockedSpot(d.slotX, d.slotY)) continue;
          const spot = this.formationSpot(s, d);
          d.slotX = spot.x;
          d.slotY = spot.y;
          d.path = this.route(v2(d.x, d.y), spot, 10);
          d.reroutes = 0;
        }
      }
    }
  }

  /** 改集结点（右键）：夹在平台里；名下的士兵按新方阵重新走过去，机甲重新排。 */
  /** 集结点离建筑最远 RALLY_MAX：更远就放在范围圈的边上，再挪到能走到的地方。 */
  private clampRally(s: Structure, x: number, y: number): Vec2 {
    const dx = x - s.x;
    const dy = y - s.y;
    const dist = Math.hypot(dx, dy);
    if (dist > RALLY_MAX) {
      x = s.x + (dx / dist) * RALLY_MAX;
      y = s.y + (dy / dist) * RALLY_MAX;
    }
    return this.walkClamp(x, y, 14);
  }

  setRally(id: number, x: number, y: number): boolean {
    const s = this.structures.find((o) => o.id === id);
    if (!s || (s.kind !== 'barracks' && s.kind !== 'factory')) return false;
    s.rally = this.clampRally(s, x, y);
    this.fx.poof(s.rally.x, s.rally.y, 0, 0.5);
    if (s.kind === 'factory') {
      this.regroup(s);
      return true;
    }
    // 士兵：先全部让出位置，再一个个按新方阵领位置。
    const mine = this.defenders.filter((d) => d.owner === s && d.kind === 'rifle' && d.deadT < 0);
    for (const d of mine) d.slotX = d.slotY = -9999;
    for (const d of mine) {
      const spot = this.formationSpot(s, d);
      d.slotX = spot.x;
      d.slotY = spot.y;
      d.path = this.route(v2(d.x, d.y), spot, 10);
    }
    return true;
  }

  /** 建造模式的建筑：兵营出兵、车间出机甲（都是升门、单位走出来、绕开建筑去站位），尸体清理。 */
  private updateStructures(dt: number): void {
    for (const s of [...this.structures]) {
      s.flash = Math.max(0, s.flash - dt * 1.5);
      s.hit = Math.max(0, s.hit - dt * 4);
      const d = BUILDS[s.kind];
      const count = statDef(s.kind, 'count');
      if (!count || !d.time) continue;
      const cap = count.values[s.up.count - 1];
      if (!s.exitReady && this.unitCount(s) < cap) {
        s.prog += (dt / d.time) * this.stat(s, 'speed');
        if (s.prog >= 1) {
          s.prog = 1;
          s.exitReady = true;
          s.doorWant = 1;
        }
      }
      // 门开到顶：单位在门槛外出现（门朝镜头；在门洞里面出现的话，排序会把它画到门框前面），
      // 往外走一段，再绕开建筑去集结点。
      if (s.exitReady && s.door >= 1) {
        const doorX = s.x;
        const sill = s.y + d.h / 2 + (s.kind === 'factory' ? 16 : 4);
        const doorOut = s.y + d.h / 2 + (s.kind === 'factory' ? 30 : 14);
        s.exitReady = false;
        s.prog = 0;
        s.doorHold = s.kind === 'factory' ? 3.5 : 2.2;
        if (s.kind === 'barracks') {
          const spot = this.formationSpot(s);
          const unit = makeDefender('rifle', doorX, sill);
          unit.owner = s;
          unit.slotX = spot.x;
          unit.slotY = spot.y;
          unit.yaw = Math.PI;
          unit.cd = 0.4;
          unit.path = [v2(doorX, doorOut), ...this.route(v2(doorX, doorOut), spot, 10)];
          this.defenders.push(unit);
        } else {
          const m = makeDefender('mech', doorX, sill);
          m.owner = s;
          m.heading = Math.PI / 2;
          m.path = [v2(doorX, doorOut)];
          this.defenders.push(m);
          this.regroup(s);
        }
      }
      this.updateDoor(s, dt);
      if (s.kind === 'barracks' && Math.random() < dt * 2) this.fx.trail(s.x + (Math.random() < 0.5 ? -10 : 10), s.y - d.h * 0.3, 40);
      if (s.kind === 'factory' && Math.random() < dt * 2.5) this.fx.trail(s.x + (Math.random() < 0.5 ? -18 : 18), s.y - d.h * 0.37, 62);
    }
    // 机枪兵的尸体躺够了就清掉（空出站位，兵营接着造）。
    for (let i = this.defenders.length - 1; i >= 0; i--) {
      const d = this.defenders[i];
      if (d.kind === 'rifle' && d.deadT > CORPSE_TIME) this.defenders.splice(i, 1);
    }
  }

  private updateGuns(dt: number): void {
    for (const g of this.guns) {
      g.recoil = g.kind === 'aa' ? g.recoil * Math.exp(-dt * 8) : Math.max(0, g.recoil - dt * 2.5);
      g.cd -= dt;
      if (g.kind === 'tank') {
        // 坦克不追着虫子乱转：咬住一个虫堆好几秒，炮塔慢慢摆过去，对准了才开炮。
        g.retarget -= dt;
        const lost = !g.target || g.target.dead >= 0 || (g.target.x - g.x) ** 2 + (g.target.y - g.y) ** 2 > this.gunRange(g) ** 2;
        if (lost || g.retarget <= 0) {
          const list = this.inRange(g.x, g.y, this.gunRange(g), false);
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
          g.cd = (2.2 + Math.random() * 1.6) / this.stat(g.owner, 'rate');
          g.recoil = 1;
          const dir = g.yaw + g.aim;
          const from = v3(g.x + Math.cos(dir) * 46, g.y + Math.sin(dir) * 46, this.terrain.heightAt(g.x, g.y) + 16.5);
          const dist = Math.hypot(t.x - from.x, t.y - from.y);
          this.shells.push({ from, to: v3(t.x, t.y, this.terrain.heightAt(t.x, t.y)), t: 0, dur: dist / 650, arc: 5, size: 0.9, power: this.stat(g.owner, 'dmg') });
          this.fx.muzzle(from.x, from.y, from.z);
          this.fx.muzzle(from.x, from.y, from.z);
        }
      } else {
        if (!g.target || g.target.dead >= 0) {
          const range = this.gunRange(g);
          const fl = this.inRange(g.x, g.y, range, true);
          // 建造模式的火炮：没有飞虫就打地面上最近的那只。
          const pool = fl.length ? fl : this.inRange(g.x, g.y, range, false);
          g.target = this.nearest(pool, g.x, g.y);
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
          g.cd = 0.11 / this.stat(g.owner, 'rate');
          g.barrel = -g.barrel;
          g.recoil = g.barrel;
          const dir = g.yaw + g.aim;
          const side = v2(-Math.sin(dir), Math.cos(dir));
          const L = 33 * Math.cos(g.pitch);
          const from = v3(
            g.x + Math.cos(dir) * (L + 4) + side.x * 3.2 * g.barrel,
            g.y + Math.sin(dir) * (L + 4) + side.y * 3.2 * g.barrel,
            this.terrain.heightAt(g.x, g.y) + 13 + 33 * Math.sin(g.pitch),
          );
          // 打飞虫一发命中就炸；打地面命中率高一些、按攻击力扣血。
          const ground = t.lift <= 20;
          const hit = Math.random() < (ground ? 0.5 : 0.18);
          const to = hit
            ? v3(t.x, t.y, t.z + t.lift)
            : v3(t.x + (Math.random() - 0.5) * 30, t.y + (Math.random() - 0.5) * 30, t.z + t.lift + (Math.random() - 0.3) * 30);
          this.fire('aa', from, to, t, hit, t.x, t.y + 10, true, 1.5 * this.stat(g.owner, 'dmg'));
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
        this.explode(s.to.x, s.to.y, s.size, s.power ?? 1);
        this.shells.splice(i, 1);
      }
    }

    for (let i = this.planes.length - 1; i >= 0; i--) {
      const p = this.planes[i];
      p.y -= 240 * dt;
      p.dropCd -= dt;
      if (p.y < (p.dropY1 ?? LINE_Y - 120) && p.y > (p.dropY0 ?? 40) && p.dropCd <= 0) {
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
        this.shake = Math.max(this.shake, 0.32);
        this.bombs.splice(i, 1);
      }
    }

    // 酸液：落地溅开一滩亮绿，冒一小团烟。
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i];
      g.t += dt;
      if (g.t >= g.dur) {
        this.addSplat({ x: g.to.x, y: g.to.y, t: 0, blobs: makeSplat(5, 0, 1, true), blood: [rgb(110, 200, 40), rgb(220, 255, 120)] });
        this.fx.poof(g.to.x, g.to.y, g.to.z, 0.8);
        const m = this.marineNear(g.to.x, g.to.y, 12);
        if (m) this.hurtMarine(m, ACID_DMG, 'acid');
        {
          const mech = this.mechNear(g.to.x, g.to.y);
          if (mech) this.hurtMech(mech, ACID_DMG);
          for (const st of this.structuresNear(g.to.x, g.to.y, 6)) this.hurtStructure(st, ACID_DMG);
        }
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
        {
          const mech = this.mechNear(s.x, s.y);
          if (mech) this.hurtMech(mech, SPIKE_DMG);
        }
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
      if (this.splats[i].t > SPLAT_LIFE) this.splats.splice(i, 1);
    }
  }

  /** 虫挨了一下：头上冒一个扣血数字（刚冒的还没飘远就往上加）。 */
  private hitNumber(b: Bug, dealt: number, kill: boolean): void {
    if (dealt <= 0) return;
    const h = b.hit;
    if (h && h.t < HIT_MERGE && this.hits.includes(h)) {
      h.n += dealt;
      h.kill ||= kill;
      return;
    }
    const top = b.z + b.lift + 6 + BUG_SIZE[b.kind] * 5;
    const o: HitNum = { x: b.x + (Math.random() - 0.5) * 6, y: b.y, z: top, t: 0, n: dealt, kill };
    b.hit = o;
    this.hits.push(o);
    if (this.hits.length > HIT_MAX) this.hits.shift();
  }

  /**
   * 地上添一摊血。虫成群死在防线前，同一处会一层层叠得发黑：附近（SPLAT_NEAR 以内）已经有 SPLAT_CROWD 摊的，
   * 先把那里最老的一摊去掉；全场最多 SPLAT_MAX 摊。
   */
  private addSplat(o: Splat): void {
    let near = 0;
    let oldest = -1;
    for (let i = 0; i < this.splats.length; i++) {
      const q = this.splats[i];
      if (Math.abs(q.x - o.x) > SPLAT_NEAR || Math.abs(q.y - o.y) > SPLAT_NEAR) continue;
      near++;
      if (oldest < 0 || q.t > this.splats[oldest].t) oldest = i;
    }
    if (near >= SPLAT_CROWD && oldest >= 0) this.splats.splice(oldest, 1);
    this.splats.push(o);
    if (this.splats.length > SPLAT_MAX) this.splats.shift();
  }

  shellPos(s: Shell): Vec3 {
    const u = clamp(s.t / s.dur, 0, 1);
    return v3(lerp(s.from.x, s.to.x, u), lerp(s.from.y, s.to.y, u), lerp(s.from.z, s.to.z, u) + s.arc * 4 * u * (1 - u));
  }

  /**
   * 建造模式的建筑：模型（炮塔类由 guns 那一圈画）、选中框、出兵类头顶的生产进度条
   * （和血条一个画法：一排小方块，青色 = 进度）和产量读数、等级小方块；最后是跟着鼠标的虚影。
   */
  private drawStructures(ground: Layers['ground'], units: Layers['units'], fx: Layers['fx'], cam: Camera): void {
    const g = cam.grain;
    for (const s of this.structures) {
      const d = BUILDS[s.kind];
      if (!s.gun) {
        const bz = this.terrain.heightAt(s.x, s.y);
        const m = buildingMesh(s.kind, s.x, s.y, this.time, s.door, bz);
        drawShadow(ground, cam, m, bz, 9e5, 70);
        drawMesh(units, cam, m, v2(s.x, s.y));
      }
      // 刚建好 / 升级：地上一圈白光散开。
      if (s.flash > 0) {
        const at = this.onGround(cam, s.x, s.y);
        const r = (Math.max(d.w, d.h) * 0.6 + (1 - s.flash) * 20) * g;
        ground.ellipse(at, r, r * Projection.groundSquash, 0, rgba(200, 240, 255, Math.round(120 * s.flash)), 2e6);
      }
      if (s.id === this.selected) {
        this.drawFootprint(ground, cam, s.kind, s.x, s.y, rgba(110, 220, 255, 230), false);
        if (d.time) {
          this.drawRange(ground, cam, s.x, s.y, RALLY_MAX, rgba(255, 196, 70, 255), true);
          this.drawRally(ground, units, cam, s);
        }
        if (s.gun) {
          const r = this.gunRange(s.gun);
          this.drawRange(ground, cam, s.x, s.y, r, rgba(110, 220, 255, 255), false);
          const next = statDef(s.kind, 'range');
          if (this.rangePreview && next && s.up.range < next.values.length) {
            this.drawRange(ground, cam, s.x, s.y, this.baseRange(s.kind) * next.values[s.up.range], rgba(120, 245, 120, 255), true);
          }
        }
      }
      // 头顶：升过几次级（几个小黄块）、出兵类的进度条和读数。
      const top = this.onGround(cam, s.x, s.y - d.h * 0.25, d.top + 10);
      const sz = Math.max(2, Math.round(1.9 * g));
      const gap = Math.max(1, Math.round(0.5 * g));
      let y = top.y;
      const ups = Object.values(s.up).reduce((a, b) => a + b, 0) - Object.keys(s.up).length;
      for (let i = 0; i < ups; i++) fx.rect(v2(top.x + (i - (ups - 1) / 2) * (sz + gap + 1), y - sz - 3), sz, sz, 0, rgb(255, 196, 70), 20.02);
      // 现在就能升级（有没满级的线、而且付得起）：头顶一个转着、上下浮的绿色箭头。
      if (this.canUpgrade(s)) {
        const bob = Math.sin(this.time * 3 + s.id) * 1.5 * g;
        const lift = (ups > 0 ? sz + 3 : 0) + 6 * g;
        this.drawUpArrow(fx, top.x, y - sz - lift - 3 * g + bob, 4.2 * g, this.time * 3 + s.id);
      }
      // 血条（10 格）；出兵类下面再接一条生产进度。
      this.hpBar(fx, cam, v2(top.x, y), s.hp / d.hp, 10, s.hit);
      y += sz + gap + 2;
      if (d.time) {
        const info = this.structureInfo(s.id)!;
        const N = 10;
        const span = N * sz + (N - 1) * gap;
        const full = info.count >= info.cap;
        const lit = full ? N : Math.floor(info.prog * N);
        fx.rect(v2(top.x, y), span + 2, sz + 2, 0, rgba(8, 10, 16, 210), 20);
        for (let i = 0; i < N; i++) {
          const c = v2(top.x - span / 2 + sz / 2 + i * (sz + gap), y);
          fx.rect(c, sz, sz, 0, i < lit ? (full ? rgb(110, 230, 110) : rgb(110, 210, 255)) : rgba(70, 76, 90, 230), 20.01);
        }
        y += sz / 2 + 2;
        const px = Math.max(1, Math.round(0.8 * g));
        drawPixelText(fx, `${info.count}/${info.cap}`, v2(top.x, y + px * 3.5), px, info.blocked && !full ? rgb(255, 190, 90) : rgb(220, 236, 255), rgba(8, 10, 16, 220), 20.02);
      }
    }
    const gh = this.ghost;
    if (gh) {
      const c = gh.valid ? rgba(90, 240, 120, 255) : rgba(250, 80, 70, 255);
      const r0 = this.baseRange(gh.kind);
      if (r0) this.drawRange(ground, cam, gh.x, gh.y, r0, c, false);
      this.drawFootprint(ground, cam, gh.kind, gh.x, gh.y, c, true);
      const m = buildingMesh(gh.kind, gh.x, gh.y, this.time, 0, this.terrain.heightAt(gh.x, gh.y));
      for (const f of m.faces) {
        const k = lerpColor(f.color, c, 0.5);
        f.color = rgba(k.r, k.g, k.b, 150);
      }
      drawMesh(fx, cam, m, v2(gh.x, gh.y));
    }
  }

  /**
   * 一条血条：一排 pips 个小方块，剩得多绿、过半黄、最后一截红，打掉的是暗格。hit 时底框闪白。
   * 机枪兵、机甲、建筑、核心都是这个样式。
   */
  private hpBar(fx: Layers['fx'], cam: Camera, at: Vec2, frac: number, pips: number, hit = 0): void {
    const g = cam.grain;
    const n = Math.ceil(clamp(frac, 0, 1) * pips);
    const sz = Math.max(2, Math.round(1.9 * g));
    const gap = Math.max(1, Math.round(0.5 * g));
    const span = pips * sz + (pips - 1) * gap;
    const k = n / pips;
    const on = k > 0.6 ? rgb(110, 230, 110) : k > 0.3 ? rgb(245, 205, 60) : rgb(240, 70, 50);
    fx.rect(at, span + 2, sz + 2, 0, hit > 0.5 ? rgba(230, 250, 255, 230) : rgba(8, 10, 16, 210), 20);
    for (let i = 0; i < pips; i++) fx.rect(v2(at.x - span / 2 + sz / 2 + i * (sz + gap), at.y), sz, sz, 0, i < n ? on : rgba(70, 76, 90, 230), 20.01);
  }

  /** 这座建筑现在有没有能升的线（没满级、而且晶矿付得起）。 */
  private canUpgrade(s: Structure): boolean {
    return BUILDS[s.kind].stats.some((st) => {
      const lv = s.up[st.key];
      return lv < st.values.length && this.crystals >= st.costs[lv - 1];
    });
  }

  /**
   * 一个绕竖轴旋转的向上箭头（像素画的转法：宽度跟着 cos 缩放，转到背面压暗一档）。
   * (cx, cy) 是箭头中心，size 是半高（缓冲像素）。先画一圈深色描边，再画本体。
   */
  private drawUpArrow(fx: Layers['fx'], cx: number, cy: number, size: number, spin: number): void {
    const c = Math.cos(spin);
    const k = Math.max(0.18, Math.abs(c));
    const body = c >= 0 ? rgb(120, 245, 120) : rgb(60, 170, 70);
    const edge = rgba(8, 14, 10, 230);
    const shape = (w: number, grow: number, color: Rgba, d: number): void => {
      const hw = size * w * k + grow;
      const top = v2(cx, cy - size - grow);
      const neck = cy - size * 0.05;
      // 箭头：三角形的头 + 一截杆。
      fx.quad(top, v2(cx + hw, neck + grow * 0.5), v2(cx - hw, neck + grow * 0.5), v2(cx - hw, neck + grow * 0.5), color, d);
      const sw = hw * 0.42 + grow * 0.3;
      fx.quad(v2(cx - sw, neck), v2(cx + sw, neck), v2(cx + sw, cy + size + grow), v2(cx - sw, cy + size + grow), color, d);
    };
    shape(1, 1.2, edge, 20.03);
    shape(1, 0, body, 20.04);
    // 正面的一道高光。
    if (c > 0.3) fx.quad(v2(cx, cy - size + 1), v2(cx - size * 0.35 * k, cy - size * 0.3), v2(cx - size * 0.1 * k, cy - size * 0.3), v2(cx - size * 0.1 * k, cy - size * 0.3), rgb(220, 255, 220), 20.05);
  }

  /** 射程圈：地上一圈淡淡的底色 + 一圈描边（dashed 时是虚线，用来画"升级后的射程"）。 */
  private drawRange(ground: Layers['ground'], cam: Camera, x: number, y: number, r: number, c: Rgba, dashed: boolean): void {
    const at = this.onGround(cam, x, y);
    const g = cam.grain;
    if (!dashed) ground.ellipse(at, r * g, r * g * Projection.groundSquash, 0, rgba(c.r, c.g, c.b, 22), 2e6 - 2);
    const n = 72;
    const t = Math.max(1, g * 0.9);
    for (let i = 0; i < n; i++) {
      if (dashed && i % 2) continue;
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      ground.bar(this.onGround(cam, x + Math.cos(a0) * r, y + Math.sin(a0) * r), this.onGround(cam, x + Math.cos(a1) * r, y + Math.sin(a1) * r), t, rgba(c.r, c.g, c.b, 200), 2e6 - 1);
    }
  }

  /** 集结点：从建筑到旗子一条虚线，旗子是一根旗杆 + 一面会飘的小三角旗，脚下一圈。 */
  private drawRally(ground: Layers['ground'], units: Layers['units'], cam: Camera, s: Structure): void {
    const g = cam.grain;
    const r = s.rally;
    const d = BUILDS[s.kind];
    const from = v2(s.x, s.y + d.h / 2);
    const len = Math.hypot(r.x - from.x, r.y - from.y);
    for (let k = 0; k < len; k += 10) {
      const u0 = k / len;
      const u1 = Math.min(1, (k + 5) / len);
      ground.bar(this.onGround(cam, lerp(from.x, r.x, u0), lerp(from.y, r.y, u0)), this.onGround(cam, lerp(from.x, r.x, u1), lerp(from.y, r.y, u1)), Math.max(1, g * 0.8), rgba(255, 196, 70, 170), 2e6);
    }
    const foot = this.onGround(cam, r.x, r.y);
    ground.ellipse(foot, 7 * g, 7 * g * Projection.groundSquash, 0, rgba(255, 196, 70, 70), 2e6);
    const base = this.onGround(cam, r.x, r.y);
    const tip = this.onGround(cam, r.x, r.y, 20);
    const depth = cam.worldToScreen(r.x, r.y).y * Projector.DEPTH_PER_ROW;
    units.bar(base, tip, Math.max(1, g * 0.8), rgb(220, 224, 232), depth);
    const wave = Math.sin(this.time * 6) * 1.5 * g;
    const flagA = this.onGround(cam, r.x, r.y, 20);
    const flagB = this.onGround(cam, r.x, r.y, 13);
    const flagTip = v2(flagA.x + 10 * g, (flagA.y + flagB.y) / 2 + wave);
    units.quad(flagA, flagTip, flagB, flagB, rgb(255, 160, 50), depth + 0.01);
  }

  /** 地上画一块建筑占地：fill 时铺一层半透明底色，再描四条边。 */
  private drawFootprint(ground: Layers['ground'], cam: Camera, kind: BuildKind, x: number, y: number, c: { r: number; g: number; b: number; a: number }, fill: boolean): void {
    const d = BUILDS[kind];
    const x0 = x - d.w / 2;
    const x1 = x + d.w / 2;
    const y0 = y - d.h / 2;
    const y1 = y + d.h / 2;
    const P = (px: number, py: number): Vec2 => this.onGround(cam, px, py);
    if (fill) ground.quad(P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), rgba(c.r, c.g, c.b, 60), 2e6);
    const t = Math.max(1, cam.grain * 0.9);
    const edge = rgba(c.r, c.g, c.b, 220);
    ground.bar(P(x0, y0), P(x1, y0), t, edge, 2e6 + 1);
    ground.bar(P(x1, y0), P(x1, y1), t, edge, 2e6 + 1);
    ground.bar(P(x1, y1), P(x0, y1), t, edge, 2e6 + 1);
    ground.bar(P(x0, y1), P(x0, y0), t, edge, 2e6 + 1);
  }

  /** 水晶核心：地上一圈呼吸的青光，基座和浮着的水晶；碎了就只剩基座。 */
  private drawCore(ground: Layers['ground'], units: Layers['units'], fx: Layers['fx'], cam: Camera): void {
    const g = cam.grain;
    const sq = Projection.groundSquash;
    const cz = this.terrain.heightAt(CORE.x, CORE.y);
    const foot = this.onGround(cam, CORE.x, CORE.y);
    if (!this.lost) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2);
      ground.ellipse(foot, 34 * g, 34 * g * sq, 0, rgba(110, 220, 255, Math.round(22 + 22 * pulse + 60 * this.coreHit)), 9.5e5);
      ground.ellipse(foot, 22 * g, 22 * g * sq, 0, rgba(150, 236, 255, Math.round(30 + 26 * pulse)), 9.5e5 + 1);
    }
    const m = crystalCore(new Mesh3().translate(CORE.x, CORE.y, cz), { t: this.time, hit: this.coreHit, broken: this.lost }, LIVERY_BLUE);
    drawShadow(ground, cam, m, cz, 9e5, 60);
    drawMesh(units, cam, m, CORE);
    if (!this.lost) {
      const tip = cam.worldToScreenZ(CORE.x, CORE.y, cz + 40 + Math.sin(this.time * 1.6) * 3);
      fx.disc(tip, Math.max(1, g * (1.2 + 0.6 * Math.sin(this.time * 5))), rgba(230, 255, 255, 200), 9);
      this.drawCoreBar(fx, cam);
    }
  }

  /**
   * 核心血条：画在基座正下方，和机枪兵头顶那排一个画法 —— 小方块、暗底框、剩得多绿、过半黄、
   * 最后一截红，只是两排；再往下是像素数字的读数。挨打时底框闪白。
   */
  private drawCoreBar(fx: Layers['fx'], cam: Camera): void {
    const g = cam.grain;
    const at = this.onGround(cam, CORE.x, CORE.y + 26);
    const total = CORE_PIPS * 2;
    const n = Math.ceil((clamp(this.coreHp, 0, this.coreMax) / this.coreMax) * total);
    const sz = Math.max(2, Math.round(1.9 * g));
    const gap = Math.max(1, Math.round(0.5 * g));
    const span = CORE_PIPS * sz + (CORE_PIPS - 1) * gap;
    const rows = 2 * sz + gap;
    const k = n / total;
    const on = k > 0.6 ? rgb(110, 230, 110) : k > 0.3 ? rgb(245, 205, 60) : rgb(240, 70, 50);
    const frame = this.coreHit > 0.5 ? rgba(230, 250, 255, 230) : rgba(8, 10, 16, 210);
    fx.rect(at, span + 2, rows + 2, 0, frame, 20);
    // 第一排是前一半血、第二排是后一半：从上排左边开始掉。
    for (let i = 0; i < total; i++) {
      const row = i < CORE_PIPS ? 0 : 1;
      const col = i % CORE_PIPS;
      const c = v2(at.x - span / 2 + sz / 2 + col * (sz + gap), at.y - rows / 2 + sz / 2 + row * (sz + gap));
      const lit = total - 1 - i < n;
      fx.rect(c, sz, sz, 0, lit ? on : rgba(70, 76, 90, 230), 20.01);
    }
    const px = Math.max(1, Math.round(0.8 * g));
    drawPixelText(fx, `${Math.ceil(this.coreHp)}/${this.coreMax}`, v2(at.x, at.y + rows / 2 + 2 + px * 3.5), px, rgb(220, 236, 255), rgba(8, 10, 16, 220), 20.02);
  }

  /** 选中的是巨舰：射程圈（悬停射程升级时再加一圈虚线）、脚下一圈选中环；在挪位置的话画虚线和目的地标记。 */
  private drawCruiserSelection(ground: Layers['ground'], cam: Camera): void {
    const c = this.cruiser;
    const g = cam.grain;
    this.drawRange(ground, cam, c.x, c.y, this.cruiserRange(), rgba(110, 220, 255, 255), false);
    const next = statDef('cruiser', 'range');
    if (this.rangePreview && next && this.cruiserS.up.range < next.values.length) {
      this.drawRange(ground, cam, c.x, c.y, CRUISER_RANGE * next.values[this.cruiserS.up.range], rgba(120, 245, 120, 255), true);
    }
    const foot = this.onGround(cam, c.x, c.y);
    ground.ellipse(foot, 70 * g, 70 * g * Projection.groundSquash, 0, rgba(110, 220, 255, 50), 2e6);
    const far = Math.hypot(c.hx - c.x, c.hy - c.y);
    if (far > 2) {
      for (let k = 0; k < far; k += 12) {
        const u0 = k / far;
        const u1 = Math.min(1, (k + 6) / far);
        ground.bar(this.onGround(cam, lerp(c.x, c.hx, u0), lerp(c.y, c.hy, u0)), this.onGround(cam, lerp(c.x, c.hx, u1), lerp(c.y, c.hy, u1)), Math.max(1, g * 0.8), rgba(110, 220, 255, 170), 2e6);
      }
      const at = this.onGround(cam, c.hx, c.hy);
      ground.ellipse(at, 12 * g, 12 * g * Projection.groundSquash, 0, rgba(110, 220, 255, 90), 2e6);
      ground.ellipse(at, 5 * g, 5 * g * Projection.groundSquash, 0, rgba(200, 245, 255, 220), 2e6 + 1);
    }
  }

  private drawCruiser(units: Layers['sky'], fx: Layers['skyFx'], cam: Camera): void {
    const c = this.cruiser;
    const g = cam.grain;
    const scr = (q: Vec3): Vec2 => cam.worldToScreenZ(q.x, q.y, q.z);
    const at = this.cruiserPoint(0, 0, 0);
    const roll = Math.sin(c.t * 0.4) * 0.03;
    const m = battlecruiser(new Mesh3().translate(at.x, at.y, at.z).rotZ(c.yaw).rotX(roll).scale(CRUISER_SCALE), { charge: c.charge, thrust: 0.8 + 0.2 * Math.sin(c.t * 5) }, LIVERY_BLUE);
    drawMesh(units, cam, m, v2(c.x, c.y), true);
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
    const { ground, units, fx, sky, skyFx } = layers;
    const g = cam.grain;
    drawFloor(ground, cam, this.time);

    for (const o of this.splats) {
      const at = cam.worldToScreenZ(o.x, o.y, this.terrain.heightAt(o.x, o.y));
      drawSplat(ground, at, o.blobs, o.blood, g, Projection.groundSquash, Math.min(1, (SPLAT_LIFE - o.t) / SPLAT_FADE), 1e6 + o.y);
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
    // 血条：头顶一排小方块。机枪兵 5 格（走在路上的新兵也带着），建造模式的机甲 8 格。
    for (const d of this.defenders) {
      if (d.kind === 'rifle' && d.deadT < 0) this.hpBar(fx, cam, cam.worldToScreenZ(d.x, d.y, d.z + 27), d.hp / MARINE_HP, HP_PIPS);
      if (d.kind === 'mech') this.hpBar(fx, cam, cam.worldToScreenZ(d.x, d.y, d.z + 54), d.hp / MECH_HP, 8);
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
    // 玩家造的建筑、核心。
    this.drawStructures(ground, units, fx, cam);
    this.drawCore(ground, units, fx, cam);
    // 扣血数字，红白配色、带一圈细描边：普通的一下白字红边，打死的那一下红字白边；最后一截淡出。
    // 字号和下面信用点的 "+N" 一样（同一个 px）。
    const px = Math.max(1, Math.round(0.8 * g));
    for (const o of this.hits) {
      const a = Math.round(255 * Math.min(1, (HIT_TIME - o.t) / 0.25));
      const fill = o.kill ? rgba(236, 36, 44, a) : rgba(255, 255, 255, a);
      const edge = o.kill ? rgba(255, 244, 244, a) : rgba(170, 14, 28, a);
      drawOutlinedText(fx, String(Math.max(1, Math.round(o.n * HIT_SCALE))), cam.worldToScreenZ(o.x, o.y, o.z), px, fill, edge, 20.5);
    }
    // 掉落的信用点："+N" 往上飘，最后一截淡出。字色和右上角信用点的数字一样（#ffe2a8），描边取图标的橙色压暗。
    for (const o of this.pops) {
      const a = Math.round(255 * Math.min(1, (POP_TIME - o.t) / 0.4));
      drawPixelText(fx, o.text, cam.worldToScreenZ(o.x, o.y, o.z), px, rgba(255, 226, 168, a), rgba(110, 56, 14, Math.round(a * 0.9)), 21);
    }

    if (this.cruiserOn) {
      if (this.selected === CRUISER_ID) this.drawCruiserSelection(ground, cam);
      // 巨舰在天空层：地面上的一切（单位、血条、子弹、炮火、爆炸）都被它盖住。
      this.drawCruiser(sky, skyFx, cam);
    }

    for (const b of this.bombs) {
      const m = bomb(new Mesh3().translate(b.x, b.y, b.z).rotZ(-Math.PI / 2).rotY(Math.atan2(-b.vz, -b.vy)));
      drawShadow(ground, cam, m, this.terrain.heightAt(b.x, b.y), 9e5, 60);
      drawMesh(sky, cam, m, v2(b.x, b.y), true);
    }
    // 炮艇和它投下的炸弹也在天上。
    for (const p of this.planes) {
      const m = gunship(new Mesh3().translate(p.x, p.y, p.z).rotZ(-Math.PI / 2).scale(0.75), { bank: 0, thrust: 1 }, LIVERY_BLUE);
      drawShadow(ground, cam, m, 0, 9e5, 70);
      drawMesh(sky, cam, m, v2(p.x, p.y), true);
      // 两个尾喷口的火焰。
      for (const sd of [-1, 1]) {
        const tail = cam.worldToScreenZ(p.x + sd * 15, p.y + 19, p.z + 4.5);
        skyFx.disc(tail, 2.6 * g, rgba(255, 170, 80, 170), 8);
        skyFx.disc(tail, 1.3 * g, rgb(255, 240, 200), 8.01);
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
