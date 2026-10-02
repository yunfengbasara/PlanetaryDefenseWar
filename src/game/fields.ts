import type { BugKind } from './bugs';

/**
 * 战场定义：一张地图在玩法和画面上的全部差异。
 *
 * 地形的宽窄（spanAt）、地板画法、虫群构成、能不能买巨舰、初始晶矿都从这里读。所有地图都是同一套玩法：
 * 开局清空，只有核心和一笔晶矿，玩家自己造；虫一波一波地来，每波比上一波多（规模乘 waveScale）。当前战场是模块级的
 * 一个值 —— spanAt 被场景、地面、地板到处调用，传参数会穿透半个游戏；一局只打一张图，
 * 开局前 useField() 切过去就行。主界面画预览时临时切过去、画完切回来。
 */

export type Theme = 'space' | 'desert' | 'ice' | 'moon' | 'hive' | 'starship' | 'highland';

export interface FieldDef {
  id: string;
  theme: Theme;
  /** 前方通道、后方炮位区的半宽。后方要放坦克、高射炮、兵营，别比 235 窄。 */
  narrow: number;
  wide: number;
  /** 波次规模系数（1 = 标准：第 n 波 6 + 5(n-1) 只，乘上这个系数）；场上最多多少只活的（多出来的排队晚点出）。 */
  waveScale: number;
  maxAlive: number;
  /** 各种虫的出现比例（加起来为 1）。 */
  mix: [BugKind, number][];
  /** 这张图能不能买巨舰（战列巡航舰）。 */
  cruiser: boolean;
  /** 地图在通道最宽处之外还有多宽的可看内容（镜头横向能拖到哪儿）。默认 30。 */
  edge?: number;
  /** 初始晶矿。 */
  startCrystals: number;
  /**
   * 地图布局：lane（默认）= 虫从上方顺着一条通道下来、防线横在中间；
   * cross = 核心在正中的高台上，虫从上下左右四条路冲过来（几何在 crossmap.ts）。
   */
  layout?: 'lane' | 'cross';
}

export const FIELDS: Record<string, FieldDef> = {
  /** 00 新兵训练场：建造模式。通道很窄，开局空地图 + 200 晶矿，只来小爬虫和跳虫，节奏慢。 */
  'training-ground': {
    id: 'training-ground',
    theme: 'space',
    narrow: 80,
    wide: 235,
    waveScale: 0.5,
    maxAlive: 60,
    mix: [
      ['crawler', 0.82],
      ['hopper', 0.18],
    ],
    cruiser: true,
    startCrystals: 200,
  },
  /** 01 轨道平台 α：原来那张图。 */
  'orbital-alpha': {
    id: 'orbital-alpha',
    theme: 'space',
    narrow: 175,
    wide: 235,
    waveScale: 1,
    maxAlive: 150,
    mix: [
      ['crawler', 0.56],
      ['hopper', 0.13],
      ['beetle', 0.06],
      ['flyer', 0.08],
      ['serpent', 0.06],
      ['spitter', 0.11],
    ],
    cruiser: true,
    startCrystals: 500,
  },
  /** 02 赤沙峡谷：一条宽峡谷，甲虫和喷酸虫多，地上落的东西不会掉进虚空。 */
  'red-sand-canyon': {
    id: 'red-sand-canyon',
    theme: 'desert',
    narrow: 200,
    wide: 240,
    waveScale: 1.15,
    maxAlive: 160,
    mix: [
      ['crawler', 0.46],
      ['hopper', 0.1],
      ['beetle', 0.12],
      ['flyer', 0.06],
      ['serpent', 0.08],
      ['spitter', 0.18],
    ],
    cruiser: true,
    startCrystals: 500,
  },
  /** 03 静海月面：低重力，跳虫多；没有大气，所以没有飞虫。 */
  'lunar-surface': {
    id: 'lunar-surface',
    theme: 'moon',
    narrow: 180,
    wide: 235,
    waveScale: 1,
    maxAlive: 150,
    mix: [
      ['crawler', 0.5],
      ['hopper', 0.24],
      ['beetle', 0.08],
      ['serpent', 0.07],
      ['spitter', 0.11],
    ],
    cruiser: true,
    startCrystals: 500,
  },
  /** 04 冰封前哨：通道稍窄，刺蛇多；落雪。没有巡航舰支援，只有炮艇。 */
  'frost-outpost': {
    id: 'frost-outpost',
    theme: 'ice',
    narrow: 165,
    wide: 235,
    waveScale: 1.15,
    maxAlive: 170,
    mix: [
      ['crawler', 0.48],
      ['hopper', 0.12],
      ['beetle', 0.1],
      ['flyer', 0.08],
      ['serpent', 0.12],
      ['spitter', 0.1],
    ],
    cruiser: false,
    startCrystals: 550,
  },
  /** 06 星舰甲板：在一艘全速航行的巨舰背上打。两侧是往下弯的船舷和引擎舱，掉下去的东西甩进太空。 */
  'starship-deck': {
    id: 'starship-deck',
    theme: 'starship',
    narrow: 170,
    wide: 235,
    waveScale: 1.15,
    maxAlive: 170,
    mix: [
      ['crawler', 0.5],
      ['hopper', 0.12],
      ['beetle', 0.08],
      ['flyer', 0.14],
      ['serpent', 0.06],
      ['spitter', 0.1],
    ],
    cruiser: true,
    startCrystals: 550,
    edge: 150,
  },
  /** 07 十字高地：建造模式，核心在正中的高台上，四条路四个方向来虫。刺蛇、喷酸虫先不出（它们的攻击是按"防线在正前方"写的）。 */
  'cross-highland': {
    id: 'cross-highland',
    theme: 'highland',
    layout: 'cross',
    narrow: 150,
    wide: 150,
    waveScale: 0.85,
    maxAlive: 160,
    mix: [
      ['crawler', 0.55],
      ['hopper', 0.18],
      ['beetle', 0.12],
      ['flyer', 0.15],
    ],
    cruiser: true,
    startCrystals: 600,
  },
  /** 05 虫巢核心：最难。虫多、刷得快，重甲和远程比例最高。 */
  'hive-core': {
    id: 'hive-core',
    theme: 'hive',
    narrow: 195,
    wide: 240,
    waveScale: 1.5,
    maxAlive: 220,
    mix: [
      ['crawler', 0.4],
      ['hopper', 0.12],
      ['beetle', 0.14],
      ['flyer', 0.1],
      ['serpent', 0.1],
      ['spitter', 0.14],
    ],
    cruiser: true,
    startCrystals: 600,
  },
};

let current: FieldDef = FIELDS['orbital-alpha'];

export function field(): FieldDef {
  return current;
}

const changeHooks: (() => void)[] = [];

/** 换了战场以后要跟着变的东西（比如核心的位置）在这儿登记。 */
export function onFieldChange(fn: () => void): void {
  changeHooks.push(fn);
}

export function useField(id: string): FieldDef {
  current = FIELDS[id] ?? FIELDS['orbital-alpha'];
  for (const fn of changeHooks) fn();
  return current;
}
