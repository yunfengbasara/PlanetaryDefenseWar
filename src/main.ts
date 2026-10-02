import { createApp, stageElement } from './app';
import { bootDefense } from './game/main';
import { MainMenu } from './menu/menu';
import { TutorialHints } from './menu/hints';

createApp().then((app) => {
  const stage = stageElement();
  const game = bootDefense(app);
  const hints = new TutorialHints(stage);

  // 游戏内左上角的"主界面"按钮。
  const back = document.createElement('button');
  back.className = 'pdw-btn ghost pdw-ingame hidden';
  back.innerHTML = '<span>◀ 主界面</span>';
  stage.appendChild(back);

  const menu = new MainMenu(app, stage, {
    onStart: (map) => {
      menu.hide();
      game.start(map.field);
      back.classList.remove('hidden');
      if (map.hints) hints.play(map.hints);
    },
  });
  back.addEventListener('click', () => {
    game.stop();
    hints.stop();
    back.classList.add('hidden');
    menu.show();
  });
  app.ticker.add((t) => {
    const dt = t.deltaMS / 1000;
    menu.update(dt);
    hints.update(dt);
  });
});
