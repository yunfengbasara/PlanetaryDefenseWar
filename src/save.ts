/**
 * 存档：跨局保留的东西都在这里，存在浏览器的 localStorage 里。
 *
 *   credits       信用点：局内随机掉落、波次里程碑、首通奖励、成就奖励攒下来的，商城花
 *   tutorialDone  新兵训练场的引导走完（或跳过）了没有：走完才开放其他地图
 *   cleared       通关过的地图（首通奖励只发一次）
 *   clears        每张图一共通关了几次
 *   endlessRuns   每张图打完了几次无尽模式（核心碎掉就算打完一次）
 *   endlessBest   每张图无尽模式打到过的最高波数
 *   levels        商城强化的等级（id 见 menu/data.ts 的 SHOP_GROUPS，比如 barracks.dmg），没有上限
 *   owned         商城里一次性买断的东西（涂装）
 *   livery        当前涂装：blue（默认）/ red（买了"涂装：猩红"才能换）
 *   stats         累计战绩：击杀、精英、Boss、飞虫、完美通关、水晶升满过几次、一共挣过多少信用点（成就用）
 *   achieved      达成过的成就（奖励只发一次）
 *
 * 晶矿只在一局里用，不进存档。读写都包了 try/catch：隐私模式、禁用存储时照样能玩，只是不保存。
 */

const KEY = 'pdw-save-v1';

export interface Stats {
  kills: number;
  elites: number;
  bosses: number;
  flyers: number;
  perfect: number;
  coreMaxed: number;
  creditsEarned: number;
}

export interface SaveData {
  credits: number;
  tutorialDone: boolean;
  cleared: string[];
  clears: Record<string, number>;
  endlessRuns: Record<string, number>;
  endlessBest: Record<string, number>;
  levels: Record<string, number>;
  owned: string[];
  livery: 'blue' | 'red';
  stats: Stats;
  achieved: string[];
}

const freshStats = (): Stats => ({ kills: 0, elites: 0, bosses: 0, flyers: 0, perfect: 0, coreMaxed: 0, creditsEarned: 0 });

/**
 * 上一版商城是一次性买断的（强化装甲 +20%、穿甲弹匣 +15%、快速征召 -1 秒、导弹巢扩容、主炮校准 -20%），
 * 现在改成按守军分的无限等级：买过的折算成差不多效果的等级（id 见 menu/data.ts 的 SHOP_GROUPS）。
 */
const LEGACY_LEVELS: Record<string, [string, number]> = {
  armor: ['barracks.hp', 5],
  ammo: ['barracks.dmg', 5],
  draft: ['barracks.speed', 8],
  missiles: ['factory.dmg', 6],
  cannon: ['cruiser.rate', 8],
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const counts = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0).map(([k, n]) => [k, Math.floor(n)])) : {};

function load(): SaveData {
  const fresh: SaveData = {
    credits: 0,
    tutorialDone: false,
    cleared: [],
    clears: {},
    endlessRuns: {},
    endlessBest: {},
    levels: {},
    owned: [],
    livery: 'blue',
    stats: freshStats(),
    achieved: [],
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const o = JSON.parse(raw) as Partial<SaveData>;
    const cleared = strings(o.cleared);
    const levels = counts(o.levels);
    const owned: string[] = [];
    for (const id of strings(o.owned)) {
      const legacy = LEGACY_LEVELS[id];
      if (legacy) levels[legacy[0]] = Math.max(levels[legacy[0]] ?? 0, legacy[1]);
      else owned.push(id);
    }
    const st = (o.stats ?? {}) as Partial<Stats>;
    const stats = freshStats();
    for (const k of Object.keys(stats) as (keyof Stats)[]) if (typeof st[k] === 'number' && st[k]! > 0) stats[k] = Math.floor(st[k]!);
    const clears = counts(o.clears);
    // 有通关记录、却没有次数的（上一版的存档）：至少算一次。
    for (const id of cleared) clears[id] = Math.max(clears[id] ?? 0, 1);
    return {
      credits: typeof o.credits === 'number' && o.credits >= 0 ? Math.floor(o.credits) : 0,
      tutorialDone: o.tutorialDone === true,
      cleared,
      clears,
      endlessRuns: counts(o.endlessRuns),
      endlessBest: counts(o.endlessBest),
      levels,
      owned,
      livery: o.livery === 'red' && owned.includes('livery-red') ? 'red' : 'blue',
      stats,
      achieved: strings(o.achieved),
    };
  } catch {
    return fresh;
  }
}

const data = load();

function store(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 存不了就算了，这一次打开页面里照样有效。
  }
}

const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);

export const save = {
  get credits(): number {
    return data.credits;
  },
  get tutorialDone(): boolean {
    return data.tutorialDone;
  },
  /** 加信用点；earned：算不算"挣到的"（成就"累计获得信用点"只数局里挣的和通关奖励，不数成就自己发的）。 */
  addCredits(n: number, earned = true): void {
    if (n <= 0) return;
    data.credits += Math.floor(n);
    if (earned) data.stats.creditsEarned += Math.floor(n);
    store();
  },
  isCleared(mapId: string): boolean {
    return data.cleared.includes(mapId);
  },
  /** 这张图通关了几次。 */
  clears(mapId: string): number {
    return data.clears[mapId] ?? 0;
  },
  /** 记下一次通关（次数 +1）；第一次通关发首通奖励，返回这次发了多少信用点。perfect：核心满血。 */
  clearMap(mapId: string, reward: number, perfect = false): number {
    data.clears[mapId] = (data.clears[mapId] ?? 0) + 1;
    if (perfect) data.stats.perfect++;
    let paid = 0;
    if (!data.cleared.includes(mapId)) {
      data.cleared.push(mapId);
      data.credits += reward;
      data.stats.creditsEarned += reward;
      paid = reward;
    }
    store();
    return paid;
  },
  /** 商城强化的等级（0 = 没买）。 */
  level(id: string): number {
    return data.levels[id] ?? 0;
  },
  /** 所有商城强化一共升了多少级。 */
  get totalLevels(): number {
    return sum(data.levels);
  },
  /** 花信用点把一项强化升一级：钱不够返回 false。 */
  upgrade(id: string, price: number): boolean {
    if (data.credits < price) return false;
    data.credits -= price;
    data.levels[id] = (data.levels[id] ?? 0) + 1;
    store();
    return true;
  },
  owns(id: string): boolean {
    return data.owned.includes(id);
  },
  /** 一次性买断（涂装）：已经有了或者钱不够返回 false。 */
  buy(id: string, price: number): boolean {
    if (data.owned.includes(id) || data.credits < price) return false;
    data.credits -= price;
    data.owned.push(id);
    store();
    return true;
  },
  get livery(): 'blue' | 'red' {
    return data.livery;
  },
  setLivery(l: 'blue' | 'red'): void {
    data.livery = l;
    store();
  },
  endlessBest(mapId: string): number {
    return data.endlessBest[mapId] ?? 0;
  },
  /** 所有地图里无尽模式打到过的最高波数。 */
  get endlessBestAny(): number {
    return Math.max(0, ...Object.values(data.endlessBest));
  },
  endlessRuns(mapId: string): number {
    return data.endlessRuns[mapId] ?? 0;
  },
  /** 记下打完一次无尽模式（次数 +1）和打到第几波；破纪录返回 true。 */
  recordEndless(mapId: string, wave: number): boolean {
    data.endlessRuns[mapId] = (data.endlessRuns[mapId] ?? 0) + 1;
    const best = wave > (data.endlessBest[mapId] ?? 0);
    if (best) data.endlessBest[mapId] = wave;
    store();
    return best;
  },
  /** 累计战绩（只读）；通关总次数、无尽模式总次数、通关过几张不同的图。 */
  get stats(): Readonly<Stats> {
    return data.stats;
  },
  get totalClears(): number {
    return sum(data.clears);
  },
  get totalEndlessRuns(): number {
    return sum(data.endlessRuns);
  },
  get mapsCleared(): number {
    return data.cleared.length;
  },
  /** 把一局里新增的战绩加进存档。 */
  addStats(d: Partial<Record<'kills' | 'elites' | 'bosses' | 'flyers' | 'coreMaxed', number>>): void {
    let changed = false;
    for (const [k, n] of Object.entries(d) as [keyof Stats, number][]) {
      if (!n || n <= 0) continue;
      data.stats[k] += n;
      changed = true;
    }
    if (changed) store();
  },
  isAchieved(id: string): boolean {
    return data.achieved.includes(id);
  },
  /** 记下达成了一个成就并发奖励（不算进"累计获得信用点"）。已经达成过返回 false。 */
  achieve(id: string, reward: number): boolean {
    if (data.achieved.includes(id)) return false;
    data.achieved.push(id);
    data.credits += reward;
    store();
    return true;
  },
  finishTutorial(): void {
    if (data.tutorialDone) return;
    data.tutorialDone = true;
    store();
  },
};
