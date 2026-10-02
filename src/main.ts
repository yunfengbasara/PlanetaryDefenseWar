import { createApp, stageElement } from './app';
import { bootDefense } from './game/main';
import type { MapInfo } from './menu/data';
import { Hud } from './menu/hud';
import { MainMenu } from './menu/menu';
import { TutorialHints } from './menu/hints';

createApp().then((app) => {
  const stage = stageElement();
  const game = bootDefense(app);
  const hints = new TutorialHints(stage);
  let current: MapInfo | null = null;

  // 游戏内左上角的"主界面"按钮。
  const back = document.createElement('button');
  back.className = 'pdw-btn ghost pdw-ingame hidden';
  back.innerHTML = '<span>◀ 主界面</span>';
  stage.appendChild(back);

  const play = (map: MapInfo): void => {
    current = map;
    menu.hide();
    game.start(map.field);
    hud.show();
    back.classList.remove('hidden');
    if (map.hints) hints.play(map.hints);
  };
  const quit = (): void => {
    current = null;
    game.stop();
    hints.stop();
    hud.hide();
    back.classList.add('hidden');
    menu.show();
  };

  const hud = new Hud(stage, {
    restart: () => current && play(current),
    quit,
  });
  const menu = new MainMenu(app, stage, { onStart: play });
  back.addEventListener('click', quit);

  app.ticker.add((t) => {
    const dt = t.deltaMS / 1000;
    menu.update(dt);
    hints.update(dt);
    hud.update(game.state());
  });
});
