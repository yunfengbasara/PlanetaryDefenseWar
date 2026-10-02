import { Mesh3 } from '../mesh/mesh';
import { LIVERY_BLUE, aaTurret, barracks, battlecruiser, gunship, mechFactory, siegeTank } from '../mesh/models';

/**
 * 建造模式（新兵训练场）里能造的东西：造价、占地、生产时间、各条升级线，以及各自用哪个模型画。
 * 所有数值都是先填的占位，之后统一在这里调。
 *
 *   兵营          出机枪兵；升级线：数量、生产速度、攻击力、射程、射速
 *   机器人车间    出步行机甲；升级线：数量、生产速度、攻击力、射程、射速
 *   坦克          攻城坦克，原地轰虫堆；升级线：攻击力、射程、射速
 *   火炮          双管速射炮，优先打飞虫、没有飞虫就打地面；升级线：攻击力、射程、射速
 *   巨舰          不是建筑：一局买一次，战列巡航舰飞到战场旁边待命，隔一阵开一发主炮
 *   轰炸支援      不是建筑：花一笔晶矿，立刻叫一组炮艇沿通道投弹
 *
 * 每条升级线各自独立升级（各 3 级）。
 */

/** cruiser（巨舰）不在建造列表里放置，买下后停在战场旁边；在这里登记只是为了升级面板和升级线。 */
export type BuildKind = 'barracks' | 'factory' | 'tank' | 'artillery' | 'cruiser';
/** 升级线：count 产量上限，speed 生产速度倍率，dmg 攻击力倍率，range 射程倍率，rate 射速倍率。 */
export type StatKey = 'count' | 'speed' | 'dmg' | 'range' | 'rate';

export interface StatDef {
  key: StatKey;
  name: string;
  /** 每一级的数值（count 是个数，其余是倍率）；长度 = 最高等级。 */
  values: number[];
  /** 升到第 2、3…级各要多少晶矿；长度 = 最高等级 - 1。 */
  costs: number[];
}

export interface BuildDef {
  kind: BuildKind;
  name: string;
  /** 一句话说明（建造列表的提示里用）。 */
  desc: string;
  cost: number;
  /** 血量：漏过防线的虫、酸液会打建筑，打空就炸毁。 */
  hp: number;
  /** 占地（世界单位）：w 横向、h 纵向，以建筑中心为准。 */
  w: number;
  h: number;
  /** 建筑顶部大概多高（进度条画在它上面）。 */
  top: number;
  /** 出兵类：造一个要几秒（生产速度升级按倍率缩短）；出的是什么。 */
  time?: number;
  unit?: string;
  stats: StatDef[];
}

/** 几条通用的升级线：攻击力、射程、射速。 */
const DMG = (costs: number[]): StatDef => ({ key: 'dmg', name: '攻击力', values: [1, 1.5, 2], costs });
const RANGE = (costs: number[]): StatDef => ({ key: 'range', name: '射程', values: [1, 1.15, 1.3], costs });
const RATE = (costs: number[]): StatDef => ({ key: 'rate', name: '射速', values: [1, 1.3, 1.6], costs });
/** 生产速度：造一个单位的时间除以这个倍率。 */
const SPEED = (costs: number[]): StatDef => ({ key: 'speed', name: '生产速度', values: [1, 1.3, 1.6], costs });

export const BUILDS: Record<BuildKind, BuildDef> = {
  barracks: {
    kind: 'barracks',
    name: '兵营',
    desc: '生产机枪兵，走到防线上驻守',
    cost: 150,
    hp: 150,
    w: 58,
    h: 68,
    top: 38,
    time: 4,
    unit: '士兵',
    stats: [{ key: 'count', name: '士兵数量', values: [5, 8, 11], costs: [200, 350] }, SPEED([150, 300]), DMG([150, 300]), RANGE([120, 250]), RATE([150, 300])],
  },
  factory: {
    kind: 'factory',
    name: '机器人车间',
    desc: '生产步行机甲，在防线后巡逻',
    cost: 300,
    hp: 200,
    w: 84,
    h: 80,
    top: 56,
    time: 10,
    unit: '机甲',
    stats: [{ key: 'count', name: '机甲数量', values: [1, 2, 3], costs: [400, 600] }, SPEED([250, 450]), DMG([250, 450]), RANGE([200, 350]), RATE([250, 450])],
  },
  tank: {
    kind: 'tank',
    name: '坦克',
    desc: '攻城坦克，远距离轰击虫堆',
    cost: 200,
    hp: 100,
    w: 44,
    h: 60,
    top: 22,
    stats: [DMG([200, 350]), RANGE([180, 300]), RATE([200, 350])],
  },
  artillery: {
    kind: 'artillery',
    name: '火炮',
    desc: '双管速射炮，优先打飞虫',
    cost: 150,
    hp: 80,
    w: 30,
    h: 30,
    top: 24,
    stats: [DMG([150, 300]), RANGE([120, 250]), RATE([150, 300])],
  },
  cruiser: {
    kind: 'cruiser',
    name: '巨舰',
    desc: '战列巡航舰：一局一艘，在战场旁边待命，隔一阵开一发主炮；右键慢慢移动',
    cost: 1500,
    hp: 9999,
    w: 0,
    h: 0,
    top: 60,
    stats: [DMG([600, 1000]), RANGE([400, 800]), RATE([600, 1000])],
  },
};

export const BUILD_ORDER: BuildKind[] = ['barracks', 'factory', 'tank', 'artillery'];

/** 轰炸支援：每叫一次的价钱。 */
export const AIRSTRIKE_COST = 500;
/** 巨舰（战列巡航舰）：一局只能买一艘，买下后从画面外飞到战场旁边待命，自动开主炮。 */
export const CRUISER_COST = 1500;
/** 巨舰主炮的基础射程（以舰身为圆心）。 */
export const CRUISER_RANGE = 460;
/** 巨舰在升级面板里用的编号（建筑的编号从 1 开始）。 */
export const CRUISER_ID = 0;

export const statDef = (kind: BuildKind, key: StatKey): StatDef | undefined => BUILDS[kind].stats.find((s) => s.key === key);

/** 建筑的模型。t 是时间，door 是门的开合（0..1，兵营和车间有门），z 是地面高度。炮塔类的炮口朝上（朝虫来的方向）。 */
export function buildingMesh(kind: BuildKind, x: number, y: number, t: number, door = 0, z = 0): Mesh3 {
  const m = new Mesh3().translate(x, y, z);
  switch (kind) {
    case 'barracks':
      return barracks(m.rotZ(Math.PI / 2).scale(0.8), { t, door }, LIVERY_BLUE);
    case 'factory':
      return mechFactory(m.rotZ(Math.PI / 2), { t, door }, LIVERY_BLUE);
    case 'tank':
      return siegeTank(m.rotZ(-Math.PI / 2), { turret: 0, recoil: 0, deploy: 1 }, LIVERY_BLUE);
    case 'artillery':
      return aaTurret(m.rotZ(-Math.PI / 2), { yaw: 0, pitch: 0.6, recoil: 0 }, LIVERY_BLUE.base, LIVERY_BLUE.panel);
    case 'cruiser':
      return battlecruiser(m.rotZ(-2.4).scale(0.42), { charge: 0, thrust: 1 }, LIVERY_BLUE);
  }
}

/** 巨舰的图标模型。 */
export function cruiserMesh(): Mesh3 {
  return battlecruiser(new Mesh3().rotZ(-2.4).scale(0.42), { charge: 0, thrust: 1 }, LIVERY_BLUE);
}

/** 轰炸支援的图标模型：一架炮艇。 */
export function airstrikeMesh(): Mesh3 {
  return gunship(new Mesh3().rotZ(-Math.PI / 2).scale(0.75), { bank: 0, thrust: 1 }, LIVERY_BLUE);
}
