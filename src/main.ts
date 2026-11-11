import { createApp, stageElement } from './app';
import { bootDefense } from './game/main';
import { BuildPanel, UpgradeTip } from './menu/build';
import { type MapInfo, currentPerks } from './menu/data';
import { applyLivery } from './game/livery';
import { Hud } from './menu/hud';
import { MainMenu } from './menu/menu';
import { TutorialHints } from './menu/hints';
import { save } from './save';
import { checkAchievements } from './achievements';
import type { BattleState } from './game/main';

createApp().then((app) => {
  // 存档里换过涂装的话，开机就换上（建造列表、商城的图标也按它画）。
  applyLivery(save.livery);
  const stage = stageElement();
  const game = bootDefense(app);
  const hints = new TutorialHints(stage);
  const tip = new UpgradeTip(stage, game);
  let current: MapInfo | null = null;
  /** 这一局已经存进存档的信用点（局里挣到的减去它就是还没存的）。 */
  let banked = 0;
  let cleared = false;
  /** 这一局是不是无尽模式；无尽模式的纪录记过没有。 */
  let endless = false;
  let recorded = false;
  /** 这一局已经存进存档的战绩（击杀、精英、Boss、飞虫、水晶升满）；离上次存过了多久。 */
  let tallied = { kills: 0, elites: 0, bosses: 0, flyers: 0, coreMaxed: false };
  let tallyT = 0;
  /** 把这一局新增的战绩存进存档（隔一秒存一次，结束、退出时也存）。 */
  const bankTally = (st: BattleState | null): void => {
    if (!st) return;
    const t = st.tally;
    save.addStats({
      kills: t.kills - tallied.kills,
      elites: t.elites - tallied.elites,
      bosses: t.bosses - tallied.bosses,
      flyers: t.flyers - tallied.flyers,
      coreMaxed: t.coreMaxed && !tallied.coreMaxed ? 1 : 0,
    });
    tallied = { ...t };
  };

  // 成就达成的提示：舞台上方正中一条一条往下排，几秒后淡出（主界面、局内都弹）。
  const toasts = document.createElement('div');
  toasts.className = 'pdw-toasts';
  stage.appendChild(toasts);
  const TROPHY =
    '<svg viewBox="0 0 16 16"><path d="M4 1h8v5a4 4 0 0 1-8 0zM4 3H1v2a3 3 0 0 0 3 3M12 3h3v2a3 3 0 0 1-3 3M8 10v3M5 15h6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

  // 游戏内左上角的"主界面"按钮。
  const back = document.createElement('button');
  back.className = 'pdw-btn ghost pdw-ingame hidden';
  back.innerHTML = '<span>◀ 主界面</span>';
  stage.appendChild(back);

  /** 暂停：战场停住、弹暂停界面。 */
  let paused = false;
  const setPaused = (on: boolean): void => {
    paused = on;
    game.setPaused(on);
    hud.setPaused(on);
  };

  const play = (map: MapInfo, mode = false): void => {
    setPaused(false);
    current = map;
    endless = mode;
    banked = 0;
    cleared = false;
    recorded = false;
    tallied = { kills: 0, elites: 0, bosses: 0, flyers: 0, coreMaxed: false };
    applyLivery(save.livery);
    menu.hide();
    tip.open(null);
    game.start(map.field, { endless, perks: currentPerks() });
    hud.show();
    build.show();
    back.classList.remove('hidden');
    // 有引导就跟着引导走，走完 / 跳过才开始刷怪，同时记下"引导过了"（其他地图就此开放）；别的地图直接开打。
    if (map.hints && !endless)
      hints.play(map.hints, () => {
        save.finishTutorial();
        game.startWaves();
      });
    else game.startWaves();
  };
  const quit = (): void => {
    bankTally(game.state());
    setPaused(false);
    current = null;
    game.stop();
    hints.stop();
    tip.open(null);
    hud.hide();
    build.hide();
    back.classList.add('hidden');
    menu.show();
  };

  const hud = new Hud(stage, {
    restart: () => {
      bankTally(game.state());
      if (current) play(current, endless);
    },
    quit,
    nextWave: () => game.nextWave(),
    resume: () => setPaused(false),
    setSpeed: (n) => game.setSpeed(n),
  });
  const build = new BuildPanel(app, game);
  hud.attach(build.el);
  const menu = new MainMenu(app, stage, { onStart: (m, e) => play(m, e) });
  back.addEventListener('click', quit);
  game.onSelect((id) => tip.open(id));
  // Esc：没在放建筑、没选中东西时开 / 关暂停界面（结算弹出来以后不管）。
  game.onEscape(() => {
    if (!current || hud.isOver) return;
    setPaused(!paused);
  });

  app.ticker.add((t) => {
    const dt = t.deltaMS / 1000;
    const st = game.state();
    // 局里挣到的信用点随挣随存：中途退出、刷新页面也不丢。
    if (st && st.credits > banked) {
      save.addCredits(st.credits - banked);
      banked = st.credits;
    }
    // 通关：记进存档，第一次通关发首通奖励（结算里一起显示）。
    // 通关：记进存档（通关次数 +1；核心满血算一次完美防守），第一次通关发首通奖励（结算里一起显示）。
    if (st && st.won && current && !cleared) {
      cleared = true;
      hud.clearReward = save.clearMap(current.id, current.reward, st.coreHp >= st.coreMax);
    }
    // 无尽模式打到核心碎掉：完成次数 +1，记下打到第几波（破纪录结算里标出来）。
    if (st && st.lost && endless && current && !recorded) {
      recorded = true;
      const best = save.endlessBest(current.id);
      hud.endlessRecord = save.recordEndless(current.id, st.wave.current) ? { best: st.wave.current, isNew: true } : { best, isNew: false };
    }
    // 战绩隔一秒存一次；一局结束马上存。
    tallyT += dt;
    if (st && (tallyT >= 1 || st.won || st.lost)) {
      tallyT = 0;
      bankTally(st);
    }
    // 成就：有新达成的就弹提示（奖励已经发进存档），主界面开着的话刷新信用点和成就角标。
    const got = checkAchievements();
    for (const a of got) {
      const el = document.createElement('div');
      el.className = 'pdw-toast';
      el.innerHTML = `${TROPHY}<div><small>成就达成</small><b>${a.name}</b></div><em>+${a.reward} 信用点</em>`;
      toasts.appendChild(el);
      setTimeout(() => el.remove(), 3700);
    }
    if (got.length) menu.saveChanged();
    menu.update(dt);
    hints.update(dt, st, (t) => {
      if (t === 'build:barracks') return build.itemRect('barracks', stage);
      if (t === 'area:base') return game.buildAreaRect();
      return game.rallyAreaRect('barracks');
    });
    hud.update(st, dt);
    build.update(st);
    tip.update(st);
  });
});
