import { save } from './save';

/**
 * 成就：进度全从存档里的累计战绩算（save.stats、通关次数、无尽模式次数和纪录、商城等级），不另存进度。
 * 达成的那一刻发一小笔信用点（reward，存档 achieved 记着，只发一次），并通知外面弹一条提示。
 *
 * 外面（src/main.ts）每帧调一次 checkAchievements()：战绩变了就会有新达成的。成就按 group 分组、每组由易到难。
 */

export interface Achievement {
  id: string;
  group: string;
  name: string;
  desc: string;
  goal: number;
  reward: number;
  /** 现在的进度。 */
  value: () => number;
}

const kills = (): number => save.stats.kills;
const elites = (): number => save.stats.elites;
const bosses = (): number => save.stats.bosses;
const flyers = (): number => save.stats.flyers;
const clears = (): number => save.totalClears;
const endless = (): number => save.totalEndlessRuns;
const bestWave = (): number => save.endlessBestAny;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'kill-1', group: '击杀', name: '第一滴血', desc: '击杀第一只虫子', goal: 1, reward: 10, value: kills },
  { id: 'kill-1k', group: '击杀', name: '灭虫新兵', desc: '累计击杀 1,000 只虫子', goal: 1000, reward: 30, value: kills },
  { id: 'kill-10k', group: '击杀', name: '灭虫专家', desc: '累计击杀 10,000 只虫子', goal: 10000, reward: 100, value: kills },
  { id: 'kill-100k', group: '击杀', name: '灭虫大师', desc: '累计击杀 100,000 只虫子', goal: 100000, reward: 300, value: kills },
  { id: 'flyer-500', group: '击杀', name: '防空网', desc: '累计击落 500 只飞虫', goal: 500, reward: 50, value: flyers },
  { id: 'flyer-5k', group: '击杀', name: '天空清道夫', desc: '累计击落 5,000 只飞虫', goal: 5000, reward: 150, value: flyers },
  { id: 'elite-10', group: '精英与首领', name: '精英猎手', desc: '击杀 10 只精英怪', goal: 10, reward: 30, value: elites },
  { id: 'elite-200', group: '精英与首领', name: '精英克星', desc: '击杀 200 只精英怪', goal: 200, reward: 100, value: elites },
  { id: 'boss-1', group: '精英与首领', name: '首领陨落', desc: '击杀第一只 Boss', goal: 1, reward: 30, value: bosses },
  { id: 'boss-20', group: '精英与首领', name: '屠戮巨兽', desc: '击杀 20 只 Boss', goal: 20, reward: 100, value: bosses },
  { id: 'boss-100', group: '精英与首领', name: '巨兽终结者', desc: '击杀 100 只 Boss', goal: 100, reward: 300, value: bosses },
  { id: 'clear-1', group: '通关', name: '初次凯旋', desc: '通关任意一张地图', goal: 1, reward: 30, value: clears },
  { id: 'clear-10', group: '通关', name: '身经百战', desc: '累计通关 10 次', goal: 10, reward: 100, value: clears },
  { id: 'clear-50', group: '通关', name: '常胜将军', desc: '累计通关 50 次', goal: 50, reward: 300, value: clears },
  { id: 'maps-all', group: '通关', name: '征服全境', desc: '通关全部 8 张地图', goal: 8, reward: 300, value: () => save.mapsCleared },
  { id: 'hive', group: '通关', name: '深入虫巢', desc: '通关 05 虫巢核心', goal: 1, reward: 150, value: () => save.clears('hive-core') },
  { id: 'perfect', group: '通关', name: '完美防守', desc: '水晶核心满血通关一张地图', goal: 1, reward: 80, value: () => save.stats.perfect },
  { id: 'endless-1', group: '无尽模式', name: '无尽挑战者', desc: '完成 1 次无尽模式', goal: 1, reward: 20, value: endless },
  { id: 'endless-10', group: '无尽模式', name: '无尽常客', desc: '完成 10 次无尽模式', goal: 10, reward: 100, value: endless },
  { id: 'wave-20', group: '无尽模式', name: '坚守二十波', desc: '无尽模式坚持到第 20 波', goal: 20, reward: 50, value: bestWave },
  { id: 'wave-30', group: '无尽模式', name: '铁壁三十波', desc: '无尽模式坚持到第 30 波', goal: 30, reward: 100, value: bestWave },
  { id: 'wave-50', group: '无尽模式', name: '不灭防线', desc: '无尽模式坚持到第 50 波', goal: 50, reward: 300, value: bestWave },
  { id: 'shop-10', group: '成长', name: '军需采购', desc: '商城强化累计升 10 级', goal: 10, reward: 50, value: () => save.totalLevels },
  { id: 'shop-50', group: '成长', name: '军工复合体', desc: '商城强化累计升 50 级', goal: 50, reward: 200, value: () => save.totalLevels },
  { id: 'core-max', group: '成长', name: '水晶守护者', desc: '一局里把水晶核心的一条升级线升满', goal: 1, reward: 50, value: () => save.stats.coreMaxed },
  { id: 'credits-10k', group: '成长', name: '富可敌国', desc: '累计获得 10,000 信用点', goal: 10000, reward: 100, value: () => save.stats.creditsEarned },
];

export const achievedCount = (): number => ACHIEVEMENTS.filter((a) => save.isAchieved(a.id)).length;

/** 看一遍有没有新达成的：达成的记进存档、发奖励，返回这次新达成的。 */
export function checkAchievements(): Achievement[] {
  const out: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (save.isAchieved(a.id) || a.value() < a.goal) continue;
    if (save.achieve(a.id, a.reward)) out.push(a);
  }
  return out;
}
