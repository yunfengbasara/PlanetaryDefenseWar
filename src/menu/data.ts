import type { BugKind } from '../game/bugs';
import type { GuideStep } from './hints';

/**
 * 主界面上展示用的静态数据。00~05 都能玩，field 对应 game/fields.ts 里的战场；locked 的样式还留着，以后加锁着的图直接用。
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
  /** 难度 1~5。 */
  difficulty: number;
  desc: string;
  stats: { label: string; value: string }[];
  enemies: EnemyInfo[];
}

const ALL_ENEMIES: EnemyInfo[] = [
  { kind: 'crawler', name: '小爬虫', tag: '地面 · 集群', threat: 1, note: '数量最多、跑得快，冲到防线会扑上来咬一口。' },
  { kind: 'hopper', name: '跳虫', tag: '地面 · 突袭', threat: 2, note: '后腿发达，一蹦一蹦地越过火力网扑向防线。' },
  { kind: 'beetle', name: '甲虫', tag: '地面 · 重甲', threat: 3, note: '个头大、背负骨刺，非常耐打。' },
  { kind: 'serpent', name: '刺蛇', tag: '地面 · 范围', threat: 4, note: '在阵前停下，举镰砸地，朝防线刺出一串地刺。' },
  { kind: 'spitter', name: '喷酸虫', tag: '远程 · 腐蚀', threat: 3, note: '停在射程外，往防线吐抛物线的酸液。' },
  { kind: 'flyer', name: '飞虫', tag: '空中', threat: 2, note: '只有高射炮和机甲导弹能对付它们。' },
];

const enemies = (...kinds: BugKind[]): EnemyInfo[] => kinds.map((k) => ALL_ENEMIES.find((e) => e.kind === k)!);

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
    stats: [
      { label: '战区类型', value: '新手引导' },
      { label: '初始晶矿', value: '200' },
      { label: '推荐时长', value: '5 分钟' },
      { label: '首通奖励', value: '300' },
    ],
    enemies: enemies('crawler', 'hopper'),
    hints: [
      { text: '欢迎来到新兵训练场！这里还什么都没有，虫群也暂时不会来。先用晶矿把防线建起来。' },
      { text: '你有 200 晶矿。点击这里的「兵营」（或按数字键 1）。', wait: 'placing-barracks', target: 'build:barracks' },
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
    difficulty: 3,
    desc: '一条悬在深空里的金属平台。虫群顺着前方的窄通道涌下来，守住防线，别让它们碰到后方的兵营和指挥中心。',
    stats: [
      { label: '战区类型', value: '轨道防御' },
      { label: '敌群规模', value: '无尽' },
      { label: '推荐时长', value: '5 分钟' },
      { label: '首通奖励', value: '1,200' },
    ],
    enemies: ALL_ENEMIES,
  },
  {
    id: 'red-sand-canyon',
    field: 'red-sand-canyon',
    index: '02',
    name: '赤沙峡谷',
    code: 'RED SAND CANYON',
    locked: false,
    difficulty: 4,
    desc: '一颗干旱行星上的峡谷要道。通道更宽，虫群里甲虫和喷酸虫明显更多；防线前垒了一排沙袋，后方是一片可以建造的水泥地坪。',
    stats: [
      { label: '战区类型', value: '地表防御' },
      { label: '敌群规模', value: '无尽' },
      { label: '推荐时长', value: '6 分钟' },
      { label: '首通奖励', value: '1,800' },
    ],
    enemies: enemies('crawler', 'beetle', 'spitter', 'serpent', 'hopper', 'flyer'),
  },
  {
    id: 'lunar-surface',
    field: 'lunar-surface',
    index: '03',
    name: '静海月面',
    code: 'LUNAR SURFACE · MARE',
    locked: false,
    difficulty: 3,
    desc: '一片布满陨石坑的灰色月海。没有大气，飞虫上不来；可低重力让跳虫蹦得又高又远，防线前竖起了一排金属挡板。',
    stats: [
      { label: '战区类型', value: '月面防御' },
      { label: '敌群规模', value: '无尽' },
      { label: '推荐时长', value: '5 分钟' },
      { label: '首通奖励', value: '1,500' },
    ],
    enemies: enemies('crawler', 'hopper', 'beetle', 'serpent', 'spitter'),
  },
  {
    id: 'frost-outpost',
    field: 'frost-outpost',
    index: '04',
    name: '冰封前哨',
    code: 'FROST OUTPOST',
    locked: false,
    difficulty: 4,
    desc: '暴风雪里的一座极地前哨。通道两侧是冰棱和雪堆，刺蛇在冻土下格外活跃；暴雪挡住了轨道支援，这一仗呼叫不了巨舰。',
    stats: [
      { label: '战区类型', value: '极地防御' },
      { label: '敌群规模', value: '无尽' },
      { label: '推荐时长', value: '6 分钟' },
      { label: '首通奖励', value: '2,200' },
    ],
    enemies: enemies('serpent', 'crawler', 'hopper', 'beetle', 'spitter', 'flyer'),
  },
  {
    id: 'hive-core',
    field: 'hive-core',
    index: '05',
    name: '虫巢核心',
    code: 'HIVE CORE',
    locked: false,
    difficulty: 5,
    desc: '直插虫巢腹地的突击阵地。脚下是会喘气的菌毯，四周长满卵囊和骨刺；虫群刷得最快、重甲和喷酸虫最多，这是最后的考验。',
    stats: [
      { label: '战区类型', value: '巢穴突击' },
      { label: '敌群规模', value: '极多' },
      { label: '推荐时长', value: '8 分钟' },
      { label: '首通奖励', value: '3,600' },
    ],
    enemies: enemies('beetle', 'spitter', 'serpent', 'crawler', 'hopper', 'flyer'),
  },
  {
    id: 'starship-deck',
    field: 'starship-deck',
    index: '06',
    name: '远征号甲板',
    code: 'STARSHIP DECK · ODYSSEY',
    locked: false,
    difficulty: 4,
    desc: '在一艘全速航行的巨型星舰背上迎战。虫群从船头方向扑来，中轴的能量导管直通水晶核心；两侧船舷外就是呼啸而过的星空，飞虫格外多。',
    stats: [
      { label: '战区类型', value: '舰上防御' },
      { label: '敌群规模', value: '无尽' },
      { label: '推荐时长', value: '6 分钟' },
      { label: '首通奖励', value: '2,800' },
    ],
    enemies: enemies('crawler', 'flyer', 'hopper', 'spitter', 'beetle', 'serpent'),
  },
  {
    id: 'cross-highland',
    field: 'cross-highland',
    index: '07',
    name: '十字高地',
    code: 'CROSSROAD HIGHLAND',
    locked: false,
    difficulty: 4,
    desc: '水晶核心坐镇正中的高台，上下左右四条路直通高台的坡道，虫群从四个方向同时涌来。在高台上建好据点，把兵力分派到四个路口。',
    stats: [
      { label: '战区类型', value: '四面防守' },
      { label: '初始晶矿', value: '500' },
      { label: '推荐时长', value: '8 分钟' },
      { label: '首通奖励', value: '3,000' },
    ],
    enemies: enemies('crawler', 'hopper', 'beetle', 'flyer'),
  },
];

/** 商城（只有样子）：icon 是图标画哪个模型（menu/shopIcons.ts）。 */
export const SHOP_ITEMS = [
  { icon: 'marine' as const, name: '强化装甲', desc: '机枪兵生命 +20%', price: 800, tag: '守军' },
  { icon: 'ammo' as const, name: '穿甲弹匣', desc: '步枪伤害 +15%', price: 1200, tag: '火力' },
  { icon: 'barracks' as const, name: '快速征召', desc: '兵营造兵时间 -1 秒', price: 1500, tag: '后勤' },
  { icon: 'mech' as const, name: '导弹巢扩容', desc: '机甲每轮多发 2 枚导弹', price: 2000, tag: '机甲' },
  { icon: 'cruiser' as const, name: '主炮校准', desc: '战列巡航舰冷却 -20%', price: 2600, tag: '舰队' },
  { icon: 'livery' as const, name: '涂装：猩红', desc: '全军换上红黑涂装', price: 3000, tag: '外观' },
];

export const ACHIEVEMENTS = [
  { name: '第一滴血', desc: '击杀第一只虫子', progress: 1, goal: 1 },
  { name: '灭虫专家', desc: '累计击杀 10,000 只虫子', progress: 3420, goal: 10000 },
  { name: '钢铁防线', desc: '一局内没有任何机枪兵阵亡并坚持 3 分钟', progress: 0, goal: 1 },
  { name: '防空网', desc: '击落 500 只飞虫', progress: 212, goal: 500 },
  { name: '天降正义', desc: '战列巡航舰一炮击杀 30 只虫子', progress: 0, goal: 1 },
  { name: '老兵不死', desc: '同一名机枪兵存活 10 分钟', progress: 0, goal: 1 },
];
