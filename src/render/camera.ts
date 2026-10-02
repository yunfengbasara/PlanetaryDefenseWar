import { type Vec2, clamp, v2 } from '../core/math';
import { Projection } from './projection';

/**
 * 世界坐标和缓冲像素之间的全部换算：会跟随、会缩放。
 */
export class Camera {
  static readonly MIN_GRAIN = 0.9;
  static readonly MAX_GRAIN = 3.6;
  /**
   * 默认档：人 19 个单位高，grain 2.2 时 42 个缓冲像素，放大 2 倍后约 84 个物理像素。
   */
  static readonly DEFAULT_GRAIN = 2.2;
  static readonly DEFAULT_MAGNIFY = 2;

  grain = Camera.DEFAULT_GRAIN;
  magnify = Camera.DEFAULT_MAGNIFY;

  /** 镜头中心的世界坐标。 */
  x = 0;
  y = 0;

  viewWidth = 0;
  viewHeight = 0;

  get halfW(): number {
    return (this.viewWidth * 0.5) / this.grain;
  }
  get halfH(): number {
    return (this.viewHeight * 0.5) / (this.grain * Projection.groundSquash);
  }

  get rootX(): number {
    return Math.round(this.viewWidth * 0.5);
  }
  get rootY(): number {
    return Math.round(this.viewHeight * 0.5);
  }

  /** 朝目标点缓动。lag 是每帧追上的比例。 */
  follow(targetX: number, targetY: number, lag: number): void {
    this.x += (targetX - this.x) * lag;
    this.y += (targetY - this.y) * lag;
  }

  /**
   * 把镜头中心对齐到整像素。
   *
   * 地板是几千个四边形拼的，镜头以小数像素滚动时，每个四边形落在哪些像素上逐帧在变 ——
   * 面板的边缘会"爬"。对齐之后滚动是一格一格的，那正是像素画该有的滚动。
   */
  pixelSnapped(): { x: number; y: number } {
    const gy = this.grain * Projection.groundSquash;
    return { x: Math.round(this.x * this.grain) / this.grain, y: Math.round(this.y * gy) / gy };
  }

  worldToScreen(worldX: number, worldY: number): Vec2 {
    return v2(
      this.rootX + (worldX - this.x) * this.grain,
      this.rootY + (worldY - this.y) * Projection.groundSquash * this.grain,
    );
  }

  /** 世界上一点加上高度。地形、球、旗杆全走这里。 */
  worldToScreenZ(worldX: number, worldY: number, z: number): Vec2 {
    return v2(
      this.rootX + (worldX - this.x) * this.grain,
      this.rootY + ((worldY - this.y) * Projection.groundSquash - z * Projection.heightSquash) * this.grain,
    );
  }

  /** 缓冲像素的位移 → 地面上的世界位移（忽略高度）。拖拽瞄准要用。 */
  screenDeltaToWorld(dx: number, dy: number): Vec2 {
    return v2(dx / this.grain, dy / (this.grain * Projection.groundSquash));
  }

  /** 缓冲像素 → 地面（z = 0 平面）上的世界点。 */
  screenToWorld(sx: number, sy: number): Vec2 {
    return v2(
      this.x + (sx - this.rootX) / this.grain,
      this.y + (sy - this.rootY) / (this.grain * Projection.groundSquash),
    );
  }

  /** 能装下一段世界距离的 grain（两点都要在画面里，四周留 margin 缓冲像素）。 */
  grainToFit(dxWorld: number, dyWorld: number, margin: number): number {
    const gx = (this.viewWidth - margin * 2) / Math.max(1, Math.abs(dxWorld));
    const gy = (this.viewHeight - margin * 2) / Math.max(1, Math.abs(dyWorld) * Projection.groundSquash);
    return clamp(Math.min(gx, gy), Camera.MIN_GRAIN, Camera.MAX_GRAIN);
  }
}
