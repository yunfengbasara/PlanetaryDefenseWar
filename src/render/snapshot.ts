import type { Application } from 'pixi.js';
import { Camera } from './camera';
import { PixelSurface } from './pixelSurface';
import { PrimitiveMesh } from './primitiveMesh';
import { type Layers, newLayers } from './scene';

/**
 * 离屏出一张小图：和 Scene 同一条五层像素管线（含描边），只是不挂到 stage 上，画完把缓冲读回
 * 一张 canvas。主界面的地图预览、敌人图标都走这里 —— 跑的是游戏里那份绘制代码，所以界面上看到的
 * 就是游戏画面本身，不是另做的插图。
 *
 * 一个实例复用同一套缓冲和顶点数组；尺寸只在变化时重建。
 */
export class Snapshotter {
  private readonly surface: PixelSurface;
  private readonly groundMesh = new PrimitiveMesh(160_000);
  private readonly unitMesh = new PrimitiveMesh(60_000);
  private readonly fxMesh = new PrimitiveMesh(20_000);
  private readonly skyMesh = new PrimitiveMesh(20_000);
  private readonly skyFxMesh = new PrimitiveMesh(4_000);
  private readonly layers: Layers = newLayers();

  constructor(private readonly app: Application) {
    this.surface = new PixelSurface(app.renderer, 1, 0x0c1a10, 0.6);
    this.surface.ground.addChild(this.groundMesh.mesh);
    this.surface.units.addChild(this.unitMesh.mesh);
    this.surface.fx.addChild(this.fxMesh.mesh);
    this.surface.sky.addChild(this.skyMesh.mesh);
    this.surface.skyFx.addChild(this.skyFxMesh.mesh);
  }

  /** 新建一台尺寸对得上缓冲的相机。 */
  camera(width: number, height: number): Camera {
    const cam = new Camera();
    cam.viewWidth = width;
    cam.viewHeight = height;
    return cam;
  }

  /** 按 cam 的视口尺寸画一帧，读回成 canvas（一缓冲像素一像素，放大交给 CSS 的 pixelated）。 */
  capture(cam: Camera, paint: (layers: Layers, cam: Camera) => void): HTMLCanvasElement {
    const w = cam.viewWidth;
    const h = cam.viewHeight;
    this.surface.resize(w, h, 1);
    const { ground, units, fx, sky, skyFx } = this.layers;
    const meshes = [this.groundMesh, this.unitMesh, this.fxMesh, this.skyMesh, this.skyFxMesh];
    for (const m of meshes) m.begin();
    paint(this.layers, cam);
    ground.flushToMesh(this.groundMesh, w, h);
    units.flushToMesh(this.unitMesh, w, h);
    fx.flushToMesh(this.fxMesh, w, h);
    sky.flushToMesh(this.skyMesh, w, h);
    skyFx.flushToMesh(this.skyFxMesh, w, h);
    for (const m of meshes) m.end();
    this.surface.render();
    return this.app.renderer.extract.canvas(this.surface.view.texture) as HTMLCanvasElement;
  }

  destroy(): void {
    this.surface.destroy();
    this.groundMesh.destroy();
    this.unitMesh.destroy();
    this.fxMesh.destroy();
    this.skyMesh.destroy();
    this.skyFxMesh.destroy();
  }
}
