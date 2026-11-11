import type { BugKind } from '../game/bugs';
import { FIELDS, type FieldDef } from '../game/fields';
import type { CoreStat, PerkStat, PerkUnit, Perks } from '../game/scene';
import { save } from '../save';
import type { GuideStep } from './hints';
import type { ShopIcon } from './shopIcons';

/**
 * 主界面上展示用的静态数据。field 对应 game/fields.ts 里的战场。
 * 00 新兵训练场一开始就能玩，其余的（afterTutorial）要先走完 00 的引导才开放。
 */

export interface EnemyInfo {
  kind: BugKind;
  name: string;
  tag: string;
  /** 威胁等级 1~5。 */
  threat: number;
  note: string;
}

export interface MapInfo {
  id: string;
  /** 对应的战场定义（game/fields.ts）。锁着的图为空。 */
  field: string;
  /** 教学关：开局后在画面下方一步步引导。 */
  hints?: GuideStep[];
  index: string;
  name: string;
  code: string;
  locked: boolean;
  /** 锁定时显示的解锁条件。 */
  unlock?: string;
  /** 要先走完新兵训练场的引导才开放（看存档）。 */
  afterTutorial?: boolean;
  /** 难度 1~5。 */
  difficulty: number;
  desc: string;
  /** 战区类型（详情里的一格）。 */
  zone: string;
  /** 首通奖励（信用点）。 */
  reward: number;
  enemies: EnemyInfo[];
}

const ALL_ENEMIES: EnemyInfo[] = [
  { kind: 'crawler', name: '小爬虫', tag: '地面 · 集群', threat: 1, note: '数量最多、跑得快，冲到防线会扑上来咬一口。' },
  { kind: 'hopper', name: '跳虫', tag: '地面 · 突袭', threat: 2, note: '后腿发达，一蹦一蹦地越过火力网扑向防线。' },
  { kind: 'beetle', name: '甲虫', tag: '地面 · 重甲', threat: 3, note: '个头大、背负骨刺，非常耐打。' },
  { kind: 'serpent', name: '刺蛇', tag: '地面 · 范围', threat: 4, note: '在阵前停下，举镰砸地，朝防线刺出一串地刺。' },
  { kind: 'spitter', name: '喷酸虫', tag: '远程 · 腐蚀', threat: 3, note: '停在射程外，往防线吐抛物线的酸液。' },
  { kind: 'flyer', name: '飞虫', tag: '空中', threat: 2, note: '从空中越过地面的拥堵直扑基地；火炮专打它们，别的守军也能顺手打。' },
];

const enemies = (...kinds: BugKind[]): EnemyInfo[] => kinds.map((k) => ALL_ENEMIES.find((e) => e.kind === k)!);

/** 没走完引导的地图在列表里显示的解锁条件。 */
export const TUTORIAL_UNLOCK = '通过新手引导解锁';

/** 这张图现在锁着没有：写死锁着的，或者要等引导走完的。 */
export const isLocked = (m: MapInfo): boolean => m.locked || (!!m.afterTutorial && !save.tutorialDone);
export const unlockText = (m: MapInfo): string => (m.locked ? (m.unlock ?? '') : TUTORIAL_UNLOCK);

/** 虫群速度的说法：按刷虫速度 × 移动速度分档。 */
function speedText(f: FieldDef): string {
  const k = f.pace * f.rush;
  return k < 0.8 ? '慢' : k < 1.15 ? '中' : k < 1.5 ? '快' : '极快';
}

/** 详情里的那几格：战区类型、通关波次、虫群速度、首通奖励、通关次数（波次和速度从战场定义读）。 */
export function mapStats(m: MapInfo): { label: string; value: string }[] {
  const f = FIELDS[m.field];
  return [
    { label: '战区类型', value: m.zone },
    { label: '通关波次', value: `${f.waves} 波` },
    { label: '虫群速度', value: speedText(f) },
    { label: '首通奖励', value: m.reward.toLocaleString() },
    { label: '通关次数', value: `${save.clears(m.id)} 次` },
  ];
}

export const MAPS: MapInfo[] = [
  {
    id: 'training-ground',
    field: 'training-ground',
    index: '00',
    name: '新兵训练场',
    code: 'TRAINING GROUND',
    locked: false,
    difficulty: 1,
    desc: '一条很窄的训练通道，开局什么都没有：用晶矿建兵营、机器人车间和炮台，亲手搭起第一道防线。来的只是零星的小虫，跟着引导熟悉建造和升级。',
    zone: '新手引导',
    reward: 300,
    enemies: enemies('crawler', 'hopper'),
    hints: [
      { text: '欢迎来到新兵训练场！这里还什么都没有，虫群也暂时不会来。先用晶矿把防线建起来。' },
      { text: '你有 1400 晶矿。点击这里的「兵营」（或按数字键 1）。', wait: 'placing-barracks', target: 'build:barracks' },
      { text: '把兵营移到亮出来的基地空地上：绿色表示可以建造，红色不行。左键放下，右键或 Esc 取消。', wait: 'built-barracks', target: 'area:base' },
      { text: '选中兵营，在亮出的范围里右键点地面，设置集结点。', wait: 'rally', target: 'rally:barracks' },
      { text: '兵营会自动出兵，点击建筑可以升级。打死虫子能获得晶矿；右上角的「下一波」可以提前叫虫，多拿晶矿。守住水晶核心！' },
    ],
  },
  {
    id: 'orbital-alpha',
    field: 'orbital-alpha',
    index: '01',
    name: '轨道平台 α',
    code: 'ORBITAL PLATFORM ALPHA',
    locked: false,
    afterTutorial: true,
    difficulty: 3,
    desc: '一条悬在深空里的金属平台。虫群顺着前方的窄通道涌下来，在后方建起防线，别让它们碰到水晶核心。',
    zone: '轨道防御',
    reward: 1200,
    enemies: ALL_ENEMIES,
  },
  {
    id: 'red-sand-canyon',
    field: 'red-sand-canyon',
    index: '02',
    name: '赤沙峡谷',
    code: 'RED SAND CANYON',
    locked: false,
    afterTutorial: true,
    difficulty: 4,
    desc: '一颗干旱行星上的峡谷要道。通道更宽，虫群里甲虫和喷酸虫明显更多；峡谷底部是一片可以建造的水泥地坪。',
    zone: '地表防御',
    reward: 1800,
    enemies: enemies('crawler', 'beetle', 'spitter', 'serpent', 'hopper', 'flyer'),
  },
  {
    id: 'lunar-surface',
    field: 'lunar-surface',
    index: '03',
    name: '静海月面',
    code: 'LUNAR SURFACE · MARE',
    locked: false,
    afterTutorial: true,
    difficulty: 3,
    desc: '一片布满陨石坑的灰色月海。没有大气，飞虫上不来；可低重力让跳虫蹦得又高又远，基地的地坪一直铺到防线后面。',
    zone: '月面防御',
    reward: 1500,
    enemies: enemies('crawler', 'hopper', 'beetle', 'serpent', 'spitter'),
  },
  {
    id: 'frost-outpost',
    field: 'frost-outpost',
    index: '04',
    name: '冰封前哨',
    code: 'FROST OUTPOST',
    locked: false,
    afterTutorial: true,
    difficulty: 4,
    desc: '暴风雪里的一座极地前哨。通道两侧是冰棱和雪堆，刺蛇在冻土下格外活跃；暴雪挡住了轨道支援，这一仗呼叫不了巨舰。',
    zone: '极地防御',
    reward: 2200,
    enemies: enemies('serpent', 'crawler', 'hopper', 'beetle', 'spitter', 'flyer'),
  },
  {
    id: 'hive-core',
    field: 'hive-core',
    index: '05',
    name: '虫巢核心',
    code: 'HIVE CORE',
    locked: false,
    afterTutorial: true,
    difficulty: 5,
    desc: '直插虫巢腹地的突击阵地。脚下是会喘气的菌毯，四周长满卵囊和骨刺；虫群刷得最快、重甲和喷酸虫最多，这是最后的考验。',
    zone: '巢穴突击',
    reward: 3600,
    enemies: enemies('beetle', 'spitter', 'serpent', 'crawler', 'hopper', 'flyer'),
  },
  {
    id: 'starship-deck',
    field: 'starship-deck',
    index: '06',
    name: '远征号甲板',
    code: 'STARSHIP DECK · ODYSSEY',
    locked: false,
    afterTutorial: true,
    difficulty: 4,
    desc: '在一艘全速航行的巨型星舰背上迎战。虫群从船头方向扑来，中轴的能量导管直通水晶核心；两侧船舷外就是呼啸而过的星空，飞虫格外多。',
    zone: '舰上防御',
    reward: 2800,
    enemies: enemies('crawler', 'flyer', 'hopper', 'spitter', 'beetle', 'serpent'),
  },
  {
    id: 'cross-highland',
    field: 'cross-highland',
    index: '07',
    name: '十字高地',
    code: 'CROSSROAD HIGHLAND',
    locked: false,
    afterTutorial: true,
    difficulty: 4,
    desc: '水晶核心坐镇正中的高台，上下左右四条路直通高台的坡道，虫群从四个方向同时涌来。在高台上建好据点，把兵力分派到四个路口。',
    zone: '四面防守',
    reward: 3000,
    enemies: enemies('crawler', 'hopper', 'beetle', 'flyer'),
  },
];

/**
 * 商城：花信用点买永久强化，没有等级上限（无尽模式越往后越需要）。
 *
 * 按守军分组：机枪兵、机甲、坦克、火炮、巨舰各有攻击力、射程、射速（出兵的两种再加生产速度、生命），对应局内的升级线，
 * 但每级只加一点点（step），乘在局内升级之上；数量线不在商城里卖。另外是水晶核心的血量上限和一次性买断的涂装。
 * 下一级的价钱 = 基础价 × PRICE_GROWTH^当前等级（越往后越贵，取整到 10）。
 * 效果在 currentPerks() 里折算成战场的 Perks，开局传进 DefenseScene。
 */
export interface ShopLine {
  /** 存档里的 id：<守军>.<强化>，比如 barracks.dmg；水晶是 core.hp / core.strike / core.regen。 */
  id: string;
  stat: PerkStat | CoreStat;
  name: string;
  /** 每级加多少（倍率的增量）；第 1 级的价钱。 */
  step: number;
  price: number;
}

export interface ShopGroup {
  unit: PerkUnit | 'core';
  icon: ShopIcon;
  name: string;
  tag: string;
  lines: ShopLine[];
}

export const PRICE_GROWTH = 1.4;

/** 强化项的名字、每级加多少、基础价相对守军基础价的倍数（射程加得最少，因为射程太远炮台会在后方就把虫清光）。 */
const LINE_SPEC: Record<PerkStat, { name: string; step: number; k: number }> = {
  dmg: { name: '攻击力', step: 0.03, k: 1 },
  rate: { name: '射速', step: 0.03, k: 1 },
  range: { name: '射程', step: 0.02, k: 0.8 },
  speed: { name: '生产速度', step: 0.03, k: 0.8 },
  hp: { name: '生命', step: 0.04, k: 0.8 },
};

const group = (unit: PerkUnit | 'core', icon: ShopIcon, name: string, tag: string, base: number, stats: PerkStat[]): ShopGroup => ({
  unit,
  icon,
  name,
  tag,
  lines: stats.map((st) => ({ id: `${unit}.${st}`, stat: st, name: LINE_SPEC[st].name, step: LINE_SPEC[st].step, price: Math.round((base * LINE_SPEC[st].k) / 10) * 10 })),
});

export const SHOP_GROUPS: ShopGroup[] = [
  group('barracks', 'marine', '机枪兵', '兵营', 150, ['dmg', 'rate', 'range', 'speed', 'hp']),
  group('factory', 'mech', '步行机甲', '车间', 220, ['dmg', 'rate', 'range', 'speed', 'hp']),
  group('tank', 'tank', '攻城坦克', '炮塔', 200, ['dmg', 'rate', 'range']),
  group('artillery', 'aa', '火炮', '防空', 180, ['dmg', 'rate', 'range']),
  group('cruiser', 'cruiser', '战列巡航舰', '舰队', 300, ['dmg', 'rate', 'range']),
  // 反击、自动恢复乘在局内的升级线上：局内还是 0 级（没有反击 / 不回血）时，商城加成也不起作用。
  {
    unit: 'core',
    icon: 'core',
    name: '水晶核心',
    tag: '核心',
    lines: [
      { id: 'core.hp', stat: 'hp', name: '血量上限', step: 0.05, price: 200 },
      { id: 'core.strike', stat: 'strike', name: '反击', step: 0.05, price: 200 },
      { id: 'core.regen', stat: 'regen', name: '自动恢复', step: 0.05, price: 200 },
    ],
  },
];

/** 一次性买断的涂装。 */
export const LIVERY_ITEM = { id: 'livery-red', icon: 'livery' as ShopIcon, name: '涂装：猩红', desc: '全军换上红黑涂装', tag: '外观', price: 3000 };

/** 一项强化升到下一级要多少信用点。 */
export const shopPrice = (line: ShopLine, level: number): number => Math.round((line.price * PRICE_GROWTH ** level) / 10) * 10;

/** 一项强化在 level 级时的倍率：1 + step × 级数。 */
export const shopValue = (line: ShopLine, level: number): number => 1 + line.step * level;

/** 倍率写成"+12%"。 */
export const shopEffect = (line: ShopLine, level: number): string => `+${Math.round((shopValue(line, level) - 1) * 100)}%`;

/** 按存档里每项强化的等级算出这一局的强化。 */
export function currentPerks(): Perks {
  const perks: Perks = { units: {}, core: { hp: 1, strike: 1, regen: 1 } };
  for (const g of SHOP_GROUPS) {
    for (const line of g.lines) {
      const v = shopValue(line, save.level(line.id));
      if (g.unit === 'core') perks.core[line.stat as CoreStat] = v;
      else (perks.units[g.unit] ??= {})[line.stat as PerkStat] = v;
    }
  }
  return perks;
}
