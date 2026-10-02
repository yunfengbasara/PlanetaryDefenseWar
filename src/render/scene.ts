import { type Application, Container } from 'pixi.js';
import { Camera } from './camera';
import { PixelSurface } from './pixelSurface';
import { PrimitiveMesh } from './primitiveMesh';
import { ShapeBatch } from './shapeBatch';

/** 一帧的三层：地面（不描边）、单位（描边）、特效（不描边，压在最上面）。 */
export interface Layers {
  ground: ShapeBatch;
  units: ShapeBatch;
  fx: ShapeBatch;
}

/**
 * 只管 Pixi 那几件事：建缓冲、把批次刷进顶点数组、整像素对齐镜头。画什么由调用方给的
 * 回调决定 —— 所有画面都走这一个 Scene。
 */
export class Scene {
  private readonly surface: PixelSurface;
  private readonly groundMesh = new PrimitiveMesh(160_000);
  private readonly unitMesh = new PrimitiveMesh(60_000);
  private readonly fxMesh = new PrimitiveMesh(20_000);
  private readonly layers: Layers = { ground: new ShapeBatch(), units: new ShapeBatch(), fx: new ShapeBatch() };

  readonly camera: Camera;
  private dpr = 1;
  private readonly root = new Container();

  /** @param camera 换成别的相机实例时传进来。 */
  constructor(
    private readonly app: Application,
    camera: Camera = new Camera(),
  ) {
    this.camera = camera;
    // 描边色用很深的暗色而不是纯黑：暗边要像阴影，纯黑会读作卡通线稿。
    this.surface = new PixelSurface(app.renderer, this.camera.magnify, 0x0c1a10, 0.6);
    this.surface.ground.addChild(this.groundMesh.mesh);
    this.surface.units.addChild(this.unitMesh.mesh);
    this.surface.fx.addChild(this.fxMesh.mesh);
    this.root.addChild(this.surface.view);
    app.stage.addChild(this.root);
  }

  /** 不在游戏里（主界面）时整层藏起来。 */
  set visible(v: boolean) {
    this.root.visible = v;
  }

  resize(): void {
    this.dpr = this.app.renderer.resolution;
    this.surface.scale = this.camera.magnify;
    this.surface.resize(this.app.screen.width, this.app.screen.height, this.dpr);
    this.camera.viewWidth = this.surface.width;
    this.camera.viewHeight = this.surface.height;
  }

  /** CSS 像素 → 缓冲像素。 */
  cssToBuffer(px: number): number {
    return (px * this.dpr) / this.camera.magnify;
  }

  /**
   * @param shakeX 镜头抖动，世界单位。加在整像素对齐之后，所以抖动也是一格一格的。
   */
  draw(paint: (layers: Layers, cam: Camera) => void, shakeX = 0, shakeY = 0): void {
    const cam = this.camera;
    const realX = cam.x;
    const realY = cam.y;
    const snapped = cam.pixelSnapped();
    cam.x = snapped.x + Math.round(shakeX * cam.grain) / cam.grain;
    cam.y = snapped.y + Math.round(shakeY * cam.grain) / cam.grain;

    const { ground, units, fx } = this.layers;
    this.groundMesh.begin();
    this.unitMesh.begin();
    this.fxMesh.begin();
    paint(this.layers, cam);
    ground.flushToMesh(this.groundMesh, this.surface.width, this.surface.height);
    units.flushToMesh(this.unitMesh, this.surface.width, this.surface.height);
    fx.flushToMesh(this.fxMesh, this.surface.width, this.surface.height);
    this.groundMesh.end();
    this.unitMesh.end();
    this.fxMesh.end();
    this.surface.render();

    cam.x = realX;
    cam.y = realY;
  }
}
