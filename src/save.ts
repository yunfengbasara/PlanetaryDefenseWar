/**
 * 存档：跨局保留的东西都在这里，存在浏览器的 localStorage 里。
 *
 *   credits       信用点：局内随机掉落、波次里程碑奖励攒下来的，主界面显示，以后商城花
 *   tutorialDone  新兵训练场的引导走完（或跳过）了没有：走完才开放其他地图
 *   cleared       通关过的地图（首通奖励只发一次）
 *   owned         商城里买下的东西（id 见 menu/data.ts 的 SHOP_ITEMS），永久生效
 *   livery        当前涂装：blue（默认）/ red（买了"涂装：猩红"才能换）
 *   endlessBest   每张图无尽模式打到过的最高波数
 *
 * 晶矿只在一局里用，不进存档。读写都包了 try/catch：隐私模式、禁用存储时照样能玩，只是不保存。
 */

const KEY = 'pdw-save-v1';

export interface SaveData {
  credits: number;
  tutorialDone: boolean;
  cleared: string[];
  owned: string[];
  livery: 'blue' | 'red';
  endlessBest: Record<string, number>;
}

function load(): SaveData {
  const fresh: SaveData = { credits: 0, tutorialDone: false, cleared: [], owned: [], livery: 'blue', endlessBest: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const o = JSON.parse(raw) as Partial<SaveData>;
    return {
      credits: typeof o.credits === 'number' && o.credits >= 0 ? Math.floor(o.credits) : 0,
      tutorialDone: o.tutorialDone === true,
      cleared: Array.isArray(o.cleared) ? o.cleared.filter((x): x is string => typeof x === 'string') : [],
      owned: Array.isArray(o.owned) ? o.owned.filter((x): x is string => typeof x === 'string') : [],
      livery: o.livery === 'red' ? 'red' : 'blue',
      endlessBest:
        o.endlessBest && typeof o.endlessBest === 'object'
          ? Object.fromEntries(Object.entries(o.endlessBest).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0))
          : {},
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

export const save = {
  get credits(): number {
    return data.credits;
  },
  get tutorialDone(): boolean {
    return data.tutorialDone;
  },
  addCredits(n: number): void {
    if (n <= 0) return;
    data.credits += Math.floor(n);
    store();
  },
  isCleared(mapId: string): boolean {
    return data.cleared.includes(mapId);
  },
  /** 记下通关；第一次通关发首通奖励。返回这次发了多少信用点。 */
  clearMap(mapId: string, reward: number): number {
    if (data.cleared.includes(mapId)) return 0;
    data.cleared.push(mapId);
    data.credits += reward;
    store();
    return reward;
  },
  owns(id: string): boolean {
    return data.owned.includes(id);
  },
  /** 花信用点买一件商品：已经有了或者钱不够返回 false。 */
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
  /** 记下无尽模式打到第几波；破纪录返回 true。 */
  recordEndless(mapId: string, wave: number): boolean {
    if (wave <= (data.endlessBest[mapId] ?? 0)) return false;
    data.endlessBest[mapId] = wave;
    store();
    return true;
  },
  finishTutorial(): void {
    if (data.tutorialDone) return;
    data.tutorialDone = true;
    store();
  },
};
