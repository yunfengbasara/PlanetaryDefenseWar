import type { Application } from 'pixi.js';
import { v2 } from '../core/math';
import { Camera } from '../render/camera';
import { Projection } from '../render/projection';
import { Scene } from '../render/scene';
import { useField } from './fields';
import { LANE_CX } from './floor';
import { DefenseScene, LINE_Y } from './scene';

/** 主界面拿来开关战场的把手。 */
export interface DefenseHandle {
  /** 在给定战场上开一局新的：建战场、镜头回到默认取景、开始跑。 */
  start(fieldId: string): void;
  /** 停下并藏起战场（回主界面）。 */
  stop(): void;
}

/**
 * 阵地防守。镜头固定在防线后上方，往上看着敌人推过来；滚轮缩放、左键拖动平移。
 *
 * 只在 start() 之后才有战场、才更新；主界面期间什么都不跑。
 */
export function bootDefense(app: Application): DefenseHandle {
  let battle: DefenseScene | null = null;
  const cam = new Camera();
  const scene = new Scene(app, cam);
  let userGrain = 0;
  let pan = v2(0, 0);

  /** 默认取景：横向装下平台和两侧一截虚空；纵向从后方炮位一直看到敌人出现的地方。 */
  const home = (): { grain: number; x: number; y: number } => {
    const y0 = 175;
    const y1 = LINE_Y + 265; // 一直看到后方的兵营和指挥中心
    const lift = (20 * Projection.heightSquash) / Projection.groundSquash;
    return { grain: cam.grainToFit(700, y1 - y0 + lift, 4), x: LANE_CX + 25, y: (y0 + y1) / 2 - lift / 2 };
  };
  const fit = (): void => {
    scene.resize();
    const h = home();
    cam.grain = h.grain;
    userGrain = h.grain;
  };
  scene.visible = false;
  // 画布跟着 16:9 的舞台走，舞台尺寸由 CSS 决定；Pixi 改完尺寸后的那一帧再重新取景。
  let seenW = 0;
  let seenH = 0;

  let drag: { x: number; y: number } | null = null;
  app.canvas.addEventListener('pointerdown', (e) => {
    if (!battle) return;
    drag = { x: e.clientX, y: e.clientY };
    app.canvas.setPointerCapture(e.pointerId);
  });
  app.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const w = cam.screenDeltaToWorld(scene.cssToBuffer(e.clientX - drag.x), scene.cssToBuffer(e.clientY - drag.y));
    pan = v2(pan.x - w.x, pan.y - w.y);
    drag = { x: e.clientX, y: e.clientY };
  });
  app.canvas.addEventListener('pointerup', () => (drag = null));
  app.canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      userGrain = Math.min(Camera.MAX_GRAIN, Math.max(home().grain * 0.8, userGrain * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    },
    { passive: false },
  );

  let last = performance.now();
  app.ticker.add(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!battle) return;
    if (app.screen.width !== seenW || app.screen.height !== seenH) {
      seenW = app.screen.width;
      seenH = app.screen.height;
      fit();
    }
    battle.update(dt);
    // 缩放和平移都直接到位，不做缓动：grain 每变一点，整块地板落在哪些像素上就全变一次，
    // 缓动的那半秒里画面会一格一格地爬、看着发抖。一步到位，每次滚轮只换一次像素网格。
    const h = home();
    cam.grain = userGrain;
    cam.x = h.x + pan.x;
    cam.y = h.y + pan.y;
    const s = battle.shake;
    const b = battle;
    scene.draw((layers, c) => b.draw(layers, c), (Math.random() - 0.5) * s * 5, (Math.random() - 0.5) * s * 5);
  });

  return {
    start: (fieldId) => {
      useField(fieldId);
      battle = new DefenseScene();
      pan = v2(0, 0);
      fit();
      const h = home();
      cam.x = h.x;
      cam.y = h.y;
      seenW = app.screen.width;
      seenH = app.screen.height;
      scene.visible = true;
    },
    stop: () => {
      battle = null;
      drag = null;
      scene.visible = false;
    },
  };
}
