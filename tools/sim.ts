/**
 * 自动玩家：不开浏览器，把一局整个快进打一遍。数值就是拿它对比着调的。
 *
 *   npm run sim                              混合兵种，00~07 每张图打 3 局（不同随机种子），逐图报结果和伤害分布
 *   npm run sim -- hive-core 5               只打 05，5 局
 *   npm run sim -- endless                   无尽模式：一直打到核心碎掉
 *   npm run sim -- tank                      只造坦克（策略：mix 混合 / barracks / factory / tank / artillery）
 *   npm run sim -- compare                   五种策略都打：普通模式通关几局 + 无尽模式打到第几波，汇总成一张表
 *   npm run sim -- compare mix factory       只比这几种策略
 *   npm run sim -- ... verbose               逐波打印
 *
 * 策略（故意写得很"普通"，不是最优解）：先铺建筑，被拆了就补；放不下了才花钱升级，挑最便宜的攻击力 / 射速 / 人数。
 * 不提前叫波，不叫轰炸。
 *   mix        四种建筑按 兵营 : 车间 : 坦克 : 火炮 = 1 : 1 : 1 : 1.3 铺；第 10 波起攒钱买巨舰（能买的图）
 *   barracks / factory / tank / artillery   只造这一种（单一兵种对照），不买巨舰
 *
 * 伤害分布按挨打的是普通虫、精英还是 Boss 分开算（运行时包一层 DefenseScene 的 hurt，不改游戏代码）。
 */

import { BUILDS, type BuildKind, type StatKey } from '../src/game/buildings';
import { CROSS_C, PLAT } from '../src/game/crossmap';
import { FIELDS, useField } from '../src/game/fields';
import { CORE, END_Y, LANE_CX, spanAt } from '../src/game/floor';
import { BUILD_FRONT, DefenseScene } from '../src/game/scene';

// ---- 可复现的随机数：整局所有 Math.random 都换成带种子的。
let seed = 1;
Math.random = (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- 伤害按目标分：每次 hurt 前后看目标掉了多少血，记到当前这一局的账上。
type Bucket = 'crowd' | 'elite' | 'boss';
let split: Record<Bucket, Record<string, number>> = { crowd: {}, elite: {}, boss: {} };
const proto = DefenseScene.prototype as unknown as { hurt: (...a: unknown[]) => void };
const origHurt = proto.hurt;
proto.hurt = function (this: DefenseScene, ...a: unknown[]) {
  const b = a[0] as { dead: number; hp: number; rank: number };
  const src = (a[5] as string | undefined) ?? 'other';
  const before = b.dead >= 0 ? 0 : Math.max(0, b.hp);
  origHurt.apply(this, a);
  const dealt = before - Math.max(0, b.hp);
  const k: Bucket = b.rank === 2 ? 'boss' : b.rank === 1 ? 'elite' : 'crowd';
  if (dealt > 0) split[k][src] = (split[k][src] ?? 0) + dealt;
};

type Strategy = 'mix' | 'barracks' | 'factory' | 'tank' | 'artillery';
const STRATEGIES: Strategy[] = ['mix', 'barracks', 'factory', 'tank', 'artillery'];
const STRAT_NAME: Record<Strategy, string> = { mix: '混合', barracks: '全步兵', factory: '全机甲', tank: '全坦克', artillery: '全火炮' };
const SRC_NAME: Record<string, string> = { rifle: '步兵', mech: '机甲机炮', missile: '机甲导弹', tank: '坦克', aa: '火炮', cruiser: '战列舰', core: '水晶', airstrike: '轰炸', other: '其他' };

const args = process.argv.slice(2);
const verbose = args.includes('verbose');
const compare = args.includes('compare');
const endlessArg = args.includes('endless');
const stratArg = (STRATEGIES.find((s) => args.includes(s)) ?? 'mix') as Strategy;
const rest = args.filter((a) => !['verbose', 'endless', 'compare', ...STRATEGIES].includes(a));
const ALL_MAPS = ['training-ground', 'orbital-alpha', 'red-sand-canyon', 'lunar-surface', 'frost-outpost', 'starship-deck', 'cross-highland', 'hive-core'];
const maps = rest[0] && FIELDS[rest[0]] ? [rest[0]] : ALL_MAPS;
const runs = Number(rest.find((a) => /^\d+$/.test(a)) ?? 3);

const DT = 1 / 30;
const THINK = 0.25;

/** 放得下这种建筑的所有格点，按"离防线近、靠中间"排好（十字高地按离核心近）。 */
function spots(sc: DefenseScene, kind: BuildKind): { x: number; y: number }[] {
  const out: { x: number; y: number; k: number }[] = [];
  if (sc.cross) {
    for (let x = CROSS_C.x - PLAT; x <= CROSS_C.x + PLAT; x += 8)
      for (let y = CROSS_C.y - PLAT; y <= CROSS_C.y + PLAT; y += 8) if (sc.placeable(kind, x, y)) out.push({ x, y, k: Math.hypot(x - CORE.x, y - CORE.y) });
  } else {
    const d = BUILDS[kind];
    for (let y = BUILD_FRONT + d.h / 2; y <= END_Y; y += 8) {
      const [a, b] = spanAt(y);
      // 中间留一条 120 宽的走廊：不然建筑在防线后面连成一堵墙，车间出来的机甲走不到集结点。
      for (let x = a; x <= b; x += 8) if (Math.abs(x - LANE_CX) >= 60 + d.w / 2 && sc.placeable(kind, x, y)) out.push({ x, y, k: y - BUILD_FRONT + Math.abs(x - LANE_CX) * 0.3 });
    }
  }
  return out.sort((p, q) => p.k - q.k);
}

interface Result {
  won: boolean;
  wave: number;
  time: number;
  core: number;
  /** 每种守军一共打了多少伤害；按目标分的伤害；Boss 从第一次挨打到被打死几秒。 */
  dmg: Record<string, number>;
  split: Record<Bucket, Record<string, number>>;
  bossKillTimes: number[];
}

function play(mapId: string, s: number, strat: Strategy, endless: boolean): Result {
  seed = s * 7919 + 13;
  split = { crowd: {}, elite: {}, boss: {} };
  useField(mapId);
  const sc = new DefenseScene({ endless });
  sc.view = sc.cross ? { l: CROSS_C.x - 490, t: CROSS_C.y - 490, r: CROSS_C.x + 490, b: CROSS_C.y + 490 } : { l: LANE_CX - 420, t: 147, r: LANE_CX + 420, b: 780 };
  sc.startWaves();
  const f = sc.field;
  const weight: Record<string, number> =
    strat === 'mix' ? { barracks: 1, factory: 1, tank: 1, artillery: 1.3 } : { [strat]: 1 };
  const kinds = Object.keys(weight) as BuildKind[];
  let think = 0;
  let lastWave = 0;
  const statKeys: StatKey[] = ['dmg', 'rate', 'count'];
  const maxTime = endless ? 60 * 60 : 30 * 60;
  for (let t = 0; t < maxTime && !sc.lost && !sc.won; t += DT) {
    sc.update(DT);
    think -= DT;
    if (think <= 0) {
      think = THINK;
      for (let guard = 0; guard < 6; guard++) {
        // 1) 铺建筑：数量 / 权重最小的那种，有地方就造。
        const order = kinds.map((k) => ({ k, n: sc.structures.filter((o) => o.kind === k).length / weight[k] })).sort((a, b) => a.n - b.n);
        let acted = false;
        let wantBuild = false;
        for (const { k } of order) {
          const sp = spots(sc, k);
          if (!sp.length) continue;
          wantBuild = true;
          if (sc.crystals >= BUILDS[k].cost) {
            sc.place(k, sp[0].x, sp[0].y);
            acted = true;
          }
          break;
        }
        if (acted) continue;
        // 2) 混合策略：第 10 波起攒钱买巨舰。
        if (strat === 'mix' && f.cruiser && !sc.cruiserBought && sc.wave >= 10) {
          if (sc.crystals >= 1500) sc.buyCruiser();
          break;
        }
        // 3) 升级：基地还有空地、钱又不够造的时候先攒着（前 4 座以前）。
        if (wantBuild && sc.structures.length < 4) break;
        let best: { id: number; key: StatKey; cost: number } | null = null;
        for (const st of sc.structures) {
          const info = sc.structureInfo(st.id)!;
          for (const line of info.stats) {
            if (!statKeys.includes(line.key) || line.cost === null) continue;
            if (!best || line.cost < best.cost) best = { id: st.id, key: line.key, cost: line.cost };
          }
        }
        if (best && best.cost <= sc.crystals) {
          sc.upgrade(best.id, best.key);
          continue;
        }
        break;
      }
    }
    if (sc.wave !== lastWave) {
      lastWave = sc.wave;
      if (verbose) {
        const alive = sc.bugs.filter((b) => b.dead < 0).length;
        console.log(`  [${mapId} ${STRAT_NAME[strat]} #${s}] 第 ${String(sc.wave).padStart(2)} 波  ${fmt(t)}  晶矿 ${String(sc.crystals).padStart(5)}  场上 ${String(alive).padStart(3)}  核心 ${Math.ceil(sc.coreHp)}  建筑 ${sc.structures.length}`);
      }
    }
  }
  return { won: sc.won, wave: sc.wave, time: sc.time, core: Math.ceil(sc.coreHp), dmg: { ...sc.stats.dmg }, split, bossKillTimes: [...sc.stats.bossTimes] };
}

const fmt = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** 把几局的按目标分的伤害加起来，写成"火炮 41%  坦克 22% ……"。 */
function shares(rs: Result[], k: Bucket): string {
  const tot: Record<string, number> = {};
  for (const r of rs) for (const [s, v] of Object.entries(r.split[k])) tot[s] = (tot[s] ?? 0) + v;
  const sum = Object.values(tot).reduce((a, b) => a + b, 0);
  if (!sum) return '—';
  return Object.entries(tot)
    .filter(([, v]) => v / sum >= 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([s, v]) => `${SRC_NAME[s] ?? s} ${((v / sum) * 100).toFixed(0)}%`)
    .join('  ');
}

if (!compare) {
  // 一种策略，逐图报。
  const all: Result[] = [];
  for (const m of maps) {
    const rs: Result[] = [];
    for (let i = 1; i <= runs; i++) rs.push(play(m, i, stratArg, endlessArg));
    all.push(...rs);
    const f = FIELDS[m];
    const wins = rs.filter((r) => r.won).length;
    console.log(
      `${m.padEnd(16)} ${STRAT_NAME[stratArg]} ${endlessArg ? '无尽' : `通关 ${wins}/${runs}`}  ` +
        rs.map((r) => (r.won ? `✓${fmt(r.time)} 核心${r.core}` : `✗第${r.wave}${endlessArg ? '' : `/${f.waves}`}波 ${fmt(r.time)}`)).join('  |  '),
    );
    const boss = rs.flatMap((r) => r.bossKillTimes);
    if (boss.length) console.log(`   Boss 从第一次挨打到被打死：平均 ${(boss.reduce((a, b) => a + b, 0) / boss.length).toFixed(1)} 秒（${boss.length} 只）`);
  }
  console.log(`\n全部地图合计的伤害分布（${STRAT_NAME[stratArg]}${endlessArg ? '，无尽' : ''}）`);
  console.log(`  普通虫  ${shares(all, 'crowd')}`);
  console.log(`  精英    ${shares(all, 'elite')}`);
  console.log(`  Boss    ${shares(all, 'boss')}`);
} else {
  // 五种策略：普通模式通关几局、无尽模式平均打到第几波。
  const short: Record<string, string> = {
    'training-ground': '00', 'orbital-alpha': '01', 'red-sand-canyon': '02', 'lunar-surface': '03', 'frost-outpost': '04', 'starship-deck': '06', 'cross-highland': '07', 'hive-core': '05',
  };
  const head = `${'策略'.padEnd(6)}${maps.map((m) => `${short[m] ?? m}`.padStart(11)).join('')}   通关合计   无尽平均波数`;
  console.log(`每格：普通模式通关局数 / ${runs} · 无尽模式平均打到第几波\n${head}`);
  const mixRuns: Result[] = [];
  // 命令行里点了名的策略只跑这几种（调数值时省时间），没点名就五种都跑。
  const picked = STRATEGIES.filter((x) => args.includes(x));
  for (const st of picked.length ? picked : STRATEGIES) {
    let wins = 0;
    let waves = 0;
    let n = 0;
    const cells: string[] = [];
    for (const m of maps) {
      const std: Result[] = [];
      const end: Result[] = [];
      for (let i = 1; i <= runs; i++) {
        std.push(play(m, i, st, false));
        end.push(play(m, i, st, true));
      }
      if (st === 'mix') mixRuns.push(...std, ...end);
      const w = std.filter((r) => r.won).length;
      const avg = end.reduce((a, r) => a + r.wave, 0) / runs;
      wins += w;
      waves += avg;
      n++;
      cells.push(`${w}/${runs}·${avg.toFixed(0)}`.padStart(11));
    }
    console.log(`${STRAT_NAME[st].padEnd(5)}${cells.join('')}   ${String(wins).padStart(3)}/${runs * maps.length}      ${(waves / n).toFixed(1)}`);
  }
  console.log('\n混合兵种（普通 + 无尽合计）的伤害分布');
  console.log(`  普通虫  ${shares(mixRuns, 'crowd')}`);
  console.log(`  精英    ${shares(mixRuns, 'elite')}`);
  console.log(`  Boss    ${shares(mixRuns, 'boss')}`);
}
