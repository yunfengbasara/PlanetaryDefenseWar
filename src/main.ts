import { createApp, stageElement } from './app';
import { bootDefense } from './game/main';
import { BuildPanel, UpgradeTip } from './menu/build';
import type { MapInfo } from './menu/data';
import { Hud } from './menu/hud';
import { MainMenu } from './menu/menu';
import { TutorialHints } from './menu/hints';
import { save } from './save';

createApp().then((app) => {
  const stage = stageElement();
  const game = bootDefense(app);
  const hints = new TutorialHints(stage);
  const tip = new UpgradeTip(stage, game);
  let current: MapInfo | null = null;
  /** 这一局已经存进存档的信用点（局里挣到的减去它就是还没存的）。 */
  let banked = 0;
  let cleared = false;

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

  const play = (map: MapInfo): void => {
    setPaused(false);
    current = map;
    banked = 0;
    cleared = false;
    menu.hide();
    tip.open(null);
    game.start(map.field);
    hud.show();
    build.show();
    back.classList.remove('hidden');
    // 有引导就跟着引导走，走完 / 跳过才开始刷怪，同时记下"引导过了"（其他地图就此开放）；别的地图直接开打。
    if (map.hints)
      hints.play(map.hints, () => {
        save.finishTutorial();
        game.startWaves();
      });
    else game.startWaves();
  };
  const quit = (): void => {
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
    restart: () => current && play(current),
    quit,
    nextWave: () => game.nextWave(),
    resume: () => setPaused(false),
  });
  const build = new BuildPanel(app, game);
  hud.attach(build.el);
  const menu = new MainMenu(app, stage, { onStart: play });
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
    if (st && st.won && current && !cleared) {
      cleared = true;
      hud.clearReward = save.clearMap(current.id, current.reward);
    }
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
