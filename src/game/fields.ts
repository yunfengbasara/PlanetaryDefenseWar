import type { BugKind } from './bugs';

/**
 * 战场定义：一张地图在玩法和画面上的全部差异。
 *
 * 地形的宽窄（spanAt）、地板画法、虫群构成、有没有巡航舰和炮艇都从这里读。当前战场是模块级的
 * 一个值 —— spanAt 被场景、地面、地板到处调用，传参数会穿透半个游戏；一局只打一张图，
 * 开局前 useField() 切过去就行。主界面画预览时临时切过去、画完切回来。
 */

export type Theme = 'space' | 'desert' | 'ice' | 'moon' | 'hive' | 'starship';

export interface FieldDef {
  id: string;
  theme: Theme;
  /** 前方通道、后方炮位区的半宽。后方要放坦克、高射炮、兵营，别比 235 窄。 */
  narrow: number;
  wide: number;
  /** 每秒刷多少只虫、场上最多多少只活的、开局先铺多少只。 */
  spawnRate: number;
  maxAlive: number;
  initial: number;
  /** 各种虫的出现比例（加起来为 1）。 */
  mix: [BugKind, number][];
  /** 侧面的战列巡航舰、从下往上掠过的炮艇。 */
  cruiser: boolean;
  gunships: boolean;
  /** 地图在通道最宽处之外还有多宽的可看内容（镜头横向能拖到哪儿）。默认 30。 */
  edge?: number;
}

export const FIELDS: Record<string, FieldDef> = {
  /** 00 新兵训练场：通道很窄，只有五六个机枪兵，只来小爬虫和跳虫，节奏慢。 */
  'training-ground': {
    id: 'training-ground',
    theme: 'space',
    narrow: 80,
    wide: 235,
    spawnRate: 4,
    maxAlive: 60,
    initial: 24,
    mix: [
      ['crawler', 0.82],
      ['hopper', 0.18],
    ],
    cruiser: false,
    gunships: false,
  },
  /** 01 轨道平台 α：原来那张图。 */
  'orbital-alpha': {
    id: 'orbital-alpha',
    theme: 'space',
    narrow: 175,
    wide: 235,
    spawnRate: 20,
    maxAlive: 520,
    initial: 320,
    mix: [
      ['crawler', 0.56],
      ['hopper', 0.13],
      ['beetle', 0.06],
      ['flyer', 0.08],
      ['serpent', 0.06],
      ['spitter', 0.11],
    ],
    cruiser: true,
    gunships: true,
  },
  /** 02 赤沙峡谷：一条宽峡谷，甲虫和喷酸虫多，地上落的东西不会掉进虚空。 */
  'red-sand-canyon': {
    id: 'red-sand-canyon',
    theme: 'desert',
    narrow: 200,
    wide: 240,
    spawnRate: 22,
    maxAlive: 560,
    initial: 300,
    mix: [
      ['crawler', 0.46],
      ['hopper', 0.1],
      ['beetle', 0.12],
      ['flyer', 0.06],
      ['serpent', 0.08],
      ['spitter', 0.18],
    ],
    cruiser: true,
    gunships: true,
  },
  /** 03 静海月面：低重力，跳虫多；没有大气，所以没有飞虫。 */
  'lunar-surface': {
    id: 'lunar-surface',
    theme: 'moon',
    narrow: 180,
    wide: 235,
    spawnRate: 20,
    maxAlive: 520,
    initial: 300,
    mix: [
      ['crawler', 0.5],
      ['hopper', 0.24],
      ['beetle', 0.08],
      ['serpent', 0.07],
      ['spitter', 0.11],
    ],
    cruiser: true,
    gunships: true,
  },
  /** 04 冰封前哨：通道稍窄，刺蛇多；落雪。没有巡航舰支援，只有炮艇。 */
  'frost-outpost': {
    id: 'frost-outpost',
    theme: 'ice',
    narrow: 165,
    wide: 235,
    spawnRate: 22,
    maxAlive: 540,
    initial: 320,
    mix: [
      ['crawler', 0.48],
      ['hopper', 0.12],
      ['beetle', 0.1],
      ['flyer', 0.08],
      ['serpent', 0.12],
      ['spitter', 0.1],
    ],
    cruiser: false,
    gunships: true,
  },
  /** 06 星舰甲板：在一艘全速航行的巨舰背上打。两侧是往下弯的船舷和引擎舱，掉下去的东西甩进太空。 */
  'starship-deck': {
    id: 'starship-deck',
    theme: 'starship',
    narrow: 170,
    wide: 235,
    spawnRate: 22,
    maxAlive: 540,
    initial: 320,
    mix: [
      ['crawler', 0.5],
      ['hopper', 0.12],
      ['beetle', 0.08],
      ['flyer', 0.14],
      ['serpent', 0.06],
      ['spitter', 0.1],
    ],
    cruiser: true,
    gunships: true,
    edge: 150,
  },
  /** 05 虫巢核心：最难。虫多、刷得快，重甲和远程比例最高。 */
  'hive-core': {
    id: 'hive-core',
    theme: 'hive',
    narrow: 195,
    wide: 240,
    spawnRate: 30,
    maxAlive: 680,
    initial: 420,
    mix: [
      ['crawler', 0.4],
      ['hopper', 0.12],
      ['beetle', 0.14],
      ['flyer', 0.1],
      ['serpent', 0.1],
      ['spitter', 0.14],
    ],
    cruiser: true,
    gunships: true,
  },
};

let current: FieldDef = FIELDS['orbital-alpha'];

export function field(): FieldDef {
  return current;
}

export function useField(id: string): FieldDef {
  current = FIELDS[id] ?? FIELDS['orbital-alpha'];
  return current;
}
