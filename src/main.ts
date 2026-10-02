import { createApp, stageElement } from './app';
import { bootDefense } from './game/main';
import { BuildPanel, UpgradeTip } from './menu/build';
import type { MapInfo } from './menu/data';
import { Hud } from './menu/hud';
import { MainMenu } from './menu/menu';
import { TutorialHints } from './menu/hints';

createApp().then((app) => {
  const stage = stageElement();
  const game = bootDefense(app);
  const hints = new TutorialHints(stage);
  const tip = new UpgradeTip(stage, game);
  let current: MapInfo | null = null;

  // 游戏内左上角的"主界面"按钮。
  const back = document.createElement('button');
  back.className = 'pdw-btn ghost pdw-ingame hidden';
  back.innerHTML = '<span>◀ 主界面</span>';
  stage.appendChild(back);

  const play = (map: MapInfo): void => {
    current = map;
    menu.hide();
    tip.open(null);
    game.start(map.field);
    hud.show();
    const st = game.state();
    if (st?.build) build.show();
    else build.hide();
    back.classList.remove('hidden');
    // 有引导就跟着引导走，走完 / 跳过才开始刷怪；没有引导的建造模式直接开打。
    if (map.hints) hints.play(map.hints, () => game.startWaves());
    else if (st?.build) game.startWaves();
  };
  const quit = (): void => {
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
  });
  const build = new BuildPanel(app, game);
  hud.attach(build.el);
  const menu = new MainMenu(app, stage, { onStart: play });
  back.addEventListener('click', quit);
  game.onSelect((id) => tip.open(id));

  app.ticker.add((t) => {
    const dt = t.deltaMS / 1000;
    const st = game.state();
    menu.update(dt);
    hints.update(dt, st, (t) => {
      if (t === 'build:barracks') return build.itemRect('barracks', stage);
      if (t === 'area:base') return game.buildAreaRect();
      if (t === 'rally:barracks') return game.rallyAreaRect('barracks');
      return game.structureRect('barracks');
    });
    hud.update(st);
    build.update(st);
    tip.update(st);
  });
});
