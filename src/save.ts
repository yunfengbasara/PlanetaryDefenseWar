/**
 * 存档：跨局保留的东西都在这里，存在浏览器的 localStorage 里。
 *
 *   credits       信用点：局内随机掉落、波次里程碑奖励攒下来的，主界面显示，以后商城花
 *   tutorialDone  新兵训练场的引导走完（或跳过）了没有：走完才开放其他地图
 *   cleared       通关过的地图（首通奖励只发一次）
 *
 * 晶矿只在一局里用，不进存档。读写都包了 try/catch：隐私模式、禁用存储时照样能玩，只是不保存。
 */

const KEY = 'pdw-save-v1';

export interface SaveData {
  credits: number;
  tutorialDone: boolean;
  cleared: string[];
}

function load(): SaveData {
  const fresh: SaveData = { credits: 0, tutorialDone: false, cleared: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const o = JSON.parse(raw) as Partial<SaveData>;
    return {
      credits: typeof o.credits === 'number' && o.credits >= 0 ? Math.floor(o.credits) : 0,
      tutorialDone: o.tutorialDone === true,
      cleared: Array.isArray(o.cleared) ? o.cleared.filter((x): x is string => typeof x === 'string') : [],
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
  finishTutorial(): void {
    if (data.tutorialDone) return;
    data.tutorialDone = true;
    store();
  },
};
