import { Application } from 'pixi.js';

/**
 * 整个游戏（画布和主界面）都放在一块固定 16:9 的舞台里：窗口里能放多大放多大，但夹在
 * 最小和最大视图之间。窗口比最小视图还小就出滚动条；比最大视图大就居中、四周留黑边。
 */
export const VIEW_MIN = { width: 960, height: 540 };
export const VIEW_MAX = { width: 1920, height: 1080 };

const STYLE = `
  html, body { margin: 0; min-height: 100%; background: #000; }
  body { display: flex; min-height: 100vh; overflow: auto; }
  #app { display: flex; flex: 1; }
  #stage {
    position: relative; flex: none; margin: auto; overflow: hidden; background: #07090f;
    width: clamp(${VIEW_MIN.width}px, min(100vw, calc(100vh * 16 / 9)), ${VIEW_MAX.width}px);
    aspect-ratio: 16 / 9;
  }
  #stage > canvas { display: block; cursor: crosshair; touch-action: none; }
`;

/** 舞台元素：画布和所有界面层都挂在它下面。 */
export function stageElement(): HTMLElement {
  return document.getElementById('stage')!;
}

export async function createApp(): Promise<Application> {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const stage = document.createElement('div');
  stage.id = 'stage';
  document.getElementById('app')!.appendChild(stage);

  const app = new Application();
  await app.init({
    background: 0x07090f,
    resizeTo: stage,
    antialias: false,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  stage.appendChild(app.canvas);
  return app;
}
