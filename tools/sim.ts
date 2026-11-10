/**
 * 自动玩家：不开浏览器，把一局整个快进打一遍，报每一波的晶矿、场上虫数、核心血量。数值就是拿它对比着调的。
 *
 *   npm run sim                         01~07 每张图打 3 局（不同随机种子）
 *   npm run sim -- hive-core 5          只打 05，5 局
 *   npm run sim -- orbital-alpha 3 endless   无尽模式：一直打到核心碎掉
 *   npm run sim -- ... verbose          逐波打印
 *
 * 策略（故意写得很"普通"，不是最优解）：先铺建筑（兵营 : 坦克 : 车间 : 火炮 ≈ 3 : 2 : 1.5 : 1.5，没飞虫的图火炮少造），
 * 被拆了就补；放不下了才花钱升级，挑最便宜的攻击力 / 射速 / 人数；第 8 波以后钱够就买巨舰。不提前叫波，不叫轰炸。
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

const args = process.argv.slice(2);
const verbose = args.includes('verbose');
const endless = args.includes('endless');
const rest = args.filter((a) => a !== 'verbose' && a !== 'endless');
const maps = rest[0] && FIELDS[rest[0]] ? [rest[0]] : ['training-ground', 'orbital-alpha', 'red-sand-canyon', 'lunar-surface', 'frost-outpost', 'starship-deck', 'cross-highland', 'hive-core'];
const runs = Number(rest.find((a) => /^\d+$/.test(a)) ?? 3);

const DT = 1 / 30;
const THINK = 0.25;
const MAX_TIME = endless ? 60 * 60 : 30 * 60;

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
      for (let x = a; x <= b; x += 8) if (Math.abs(x - LANE_CX) >= 60 + d.w / 2 && sc.placeable(kind, x, y)) out.push({ x, y, k: (y - BUILD_FRONT) + Math.abs(x - LANE_CX) * 0.3 });
    }
  }
  return out.sort((p, q) => p.k - q.k);
}

interface Result {
  map: string;
  seed: number;
  won: boolean;
  wave: number;
  time: number;
  core: number;
  built: number;
  /** 拿到手的晶矿一共多少（开局 + 打虫 + 提前叫波）。 */
  income: number;
  /** 每种守军一共打了多少伤害（看谁太强）。 */
  dmg: Record<string, number>;
  bossKillTimes: number[];
  /** 每种建筑一共投了多少晶矿（造价 + 升级，局末还在的）。 */
  spent: Record<string, number>;
}

function play(mapId: string, s: number): Result {
  seed = s * 7919 + 13;
  useField(mapId);
  const sc = new DefenseScene({ endless });
  sc.view = sc.cross ? { l: CROSS_C.x - 490, t: CROSS_C.y - 490, r: CROSS_C.x + 490, b: CROSS_C.y + 490 } : { l: LANE_CX - 420, t: 147, r: LANE_CX + 420, b: 780 };
  sc.startWaves();
  const f = sc.field;
  const hasAir = f.mix.some(([k]) => k === 'flyer');
  const weight: Record<BuildKind, number> = { barracks: 3, tank: 2, factory: 1.5, artillery: hasAir ? 1.5 : 0.7, cruiser: 0 };
  let think = 0;
  let lastWave = 0;
  let income = f.startCrystals;
  let prevCrystals = sc.crystals;
  const statKeys: StatKey[] = ['dmg', 'rate', 'count'];
  for (let t = 0; t < MAX_TIME && !sc.lost && !sc.won; t += DT) {
    sc.update(DT);
    if (sc.crystals > prevCrystals) income += sc.crystals - prevCrystals;
    think -= DT;
    if (think <= 0) {
      think = THINK;
      for (let guard = 0; guard < 6; guard++) {
        // 1) 铺建筑：数量 / 权重最小的那种，有地方就造。
        const kinds = (['barracks', 'tank', 'factory', 'artillery'] as BuildKind[])
          .map((k) => ({ k, n: sc.structures.filter((o) => o.kind === k).length / weight[k] }))
          .sort((a, b) => a.n - b.n);
        let acted = false;
        let wantBuild = false;
        for (const { k } of kinds) {
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
        // 2) 巨舰。
        if (f.cruiser && !sc.cruiserBought && sc.wave >= 8 && sc.crystals >= 1500) {
          sc.buyCruiser();
          continue;
        }
        // 3) 升级：基地还有空地、钱又不够造的时候先攒着（前 4 座以前）。
        if (wantBuild && sc.structures.length < 6) break;
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
    prevCrystals = sc.crystals;
    if (sc.wave !== lastWave) {
      lastWave = sc.wave;
      if (verbose) {
        const alive = sc.bugs.filter((b) => b.dead < 0).length;
        console.log(`  [${mapId} #${s}] 第 ${String(sc.wave).padStart(2)} 波  ${fmt(t)}  晶矿 ${String(sc.crystals).padStart(5)}  场上 ${String(alive).padStart(3)}  核心 ${sc.coreHp}  建筑 ${sc.structures.length}`);
      }
    }
  }
  return {
    map: mapId,
    seed: s,
    won: sc.won,
    wave: sc.wave,
    time: sc.time,
    core: sc.coreHp,
    built: sc.structures.length,
    income,
    dmg: { ...sc.stats.dmg },
    bossKillTimes: [...(sc.stats.bossTimes ?? [])],
    spent: sc.structures.reduce((o, st) => ((o[st.kind] = (o[st.kind] ?? 0) + st.spent), o), { cruiser: sc.cruiserBought ? sc.cruiserS.spent : 0 } as Record<string, number>),
  };
}

const fmt = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

for (const m of maps) {
  const rs: Result[] = [];
  for (let i = 1; i <= runs; i++) rs.push(play(m, i));
  const f = FIELDS[m];
  const wins = rs.filter((r) => r.won).length;
  console.log(
    `${m.padEnd(16)} ${endless ? '无尽' : `通关 ${wins}/${runs}`}  ` +
      rs.map((r) => (r.won ? `✓${fmt(r.time)} 核心${r.core}` : `✗第${r.wave}${endless ? '' : `/${f.waves}`}波 ${fmt(r.time)}`)).join('  |  '),
  );
  const tot: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.dmg)) tot[k] = (tot[k] ?? 0) + v;
  const sum = Object.values(tot).reduce((a, b) => a + b, 0) || 1;
  console.log(
    `   伤害占比 ${Object.entries(tot)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${((v / sum) * 100).toFixed(0)}%`)
      .join('  ')}   平均总晶矿 ${Math.round(rs.reduce((a, r) => a + r.income, 0) / rs.length)}`,
  );
  // 每 100 晶矿打出多少伤害：兵营 → 步枪，车间 → 机炮 + 导弹，坦克，火炮，巨舰。
  const inv: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.spent)) inv[k] = (inv[k] ?? 0) + v;
  const eff = (k: string, d: number): string => (inv[k] ? `${k} ${((d / inv[k]) * 100).toFixed(1)}` : '');
  console.log(
    `   每 100 晶矿的伤害  ${[eff('barracks', tot.rifle ?? 0), eff('factory', (tot.mech ?? 0) + (tot.missile ?? 0)), eff('tank', tot.tank ?? 0), eff('artillery', tot.aa ?? 0), eff('cruiser', tot.cruiser ?? 0)].filter(Boolean).join('  ')}`,
  );
  const boss = rs.flatMap((r) => r.bossKillTimes);
  if (boss.length) console.log(`   Boss 从第一次挨打到被打死：平均 ${(boss.reduce((a, b) => a + b, 0) / boss.length).toFixed(1)} 秒（${boss.length} 只，最快 ${Math.min(...boss).toFixed(1)}、最慢 ${Math.max(...boss).toFixed(1)}）`);
}
