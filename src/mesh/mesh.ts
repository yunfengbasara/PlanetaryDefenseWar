import { type Vec2, type Vec3, clamp, v2, v3 } from '../core/math';
import type { Camera } from '../render/camera';
import { type Rgba, lerpColor, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import type { ShapeBatch } from '../render/shapeBatch';

/**
 * 物品的画法：用立方体、楔形和棱柱拼出来，每个面按朝向分档上色。
 *
 * 和人物同一套思路，只是基本形状换了：
 *   - 人物是"一块平涂 + 一条硬边阴影"的肢体；物品是**每个面一个平涂色**，面和面之间的
 *     明暗差就是那条硬边。光从左上方来：顶面最亮、左侧面次之、正对镜头的面中等、右侧面最暗。
 *     四档，不做渐变 —— 渐变在像素网格上读作塑料。
 *   - 圆柱（炮管、车轮、油罐）是八棱柱：每个侧面单独一档明暗，圆的东西就有了一条条硬边色带，
 *     那正是像素画里画圆柱的方式。
 *   - 背面剔除：面的法线背向镜头就不画。剩下的面按"离镜头多近"排画家顺序。
 *   - 描边、像素量化都是那一套合成通道，物品自动得到和人物一样的暗边。
 *
 * 建模用即时模式 + 矩阵栈：push / translate / rotZ / … / box / pop，和画人时的骨架层级一样 ——
 * 炮塔挂在车体上、炮管挂在炮塔上，只要转一下炮塔的矩阵，炮管就跟着走。
 */

export interface Face {
  pts: Vec3[];
  color: Rgba;
  n: Vec3;
  c: Vec3;
  /** 自发光（车灯、尾焰、屏幕）：不参与明暗。 */
  glow: boolean;
  /** 额外的深度偏移：明确"永远压在上面"的部件（坦克炮塔压车体）用，绕开大面按中心排序的错。 */
  bias: number;
}

/** 3×3 旋转 + 平移。 */
interface Mat {
  r: number[];
  t: Vec3;
}

const IDENTITY: Mat = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: v3(0, 0, 0) };

const mulR = (a: number[], b: number[]): number[] => {
  const o = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
};

/**
 * 光：从左上方来，略微偏向镜头。顶面最亮，左侧面次亮，右侧面最暗。
 * 影子朝相反方向（右上）投。
 */
export const LIGHT: Vec3 = (() => {
  const l = v3(-0.55, 0.3, 0.78);
  const n = Math.hypot(l.x, l.y, l.z);
  return v3(l.x / n, l.y / n, l.z / n);
})();

/** 指向镜头的方向：屏幕 y = 地面 y × 压扁 − z × 高度压扁，这两项抵消的方向就是视线。 */
const VIEW: Vec3 = (() => {
  const v = v3(0, Projection.heightSquash, Projection.groundSquash);
  const n = Math.hypot(v.y, v.z);
  return v3(0, v.y / n, v.z / n);
})();

const SHADE_MIX = rgb(22, 26, 40);
const LIGHT_MIX = rgb(255, 250, 230);

/** 四档明暗。和地形一样往冷色里压、往暖白里提。 */
export function shadeFace(base: Rgba, n: Vec3): Rgba {
  const b = n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z;
  if (b > 0.72) return lerpColor(base, LIGHT_MIX, 0.18);
  if (b > 0.32) return base;
  if (b > 0.0) return lerpColor(base, SHADE_MIX, 0.28);
  return lerpColor(base, SHADE_MIX, 0.48);
}

export class Mesh3 {
  readonly faces: Face[] = [];
  private m: Mat = IDENTITY;
  private readonly stack: Mat[] = [];
  /** 之后加的面都带上这个深度偏移，见 Face.bias。 */
  bias = 0;

  push(): this {
    this.stack.push(this.m);
    return this;
  }

  pop(): this {
    this.m = this.stack.pop() ?? IDENTITY;
    return this;
  }

  /** 局部点 → 世界点。 */
  apply(p: Vec3): Vec3 {
    const r = this.m.r;
    return v3(
      r[0] * p.x + r[1] * p.y + r[2] * p.z + this.m.t.x,
      r[3] * p.x + r[4] * p.y + r[5] * p.z + this.m.t.y,
      r[6] * p.x + r[7] * p.y + r[8] * p.z + this.m.t.z,
    );
  }

  translate(x: number, y: number, z: number): this {
    this.m = { r: this.m.r, t: this.apply(v3(x, y, z)) };
    return this;
  }

  private rot(r: number[]): this {
    this.m = { r: mulR(this.m.r, r), t: this.m.t };
    return this;
  }

  /** 整体缩放（同一个模型在不同场景里比例不同：展厅里的战斗机要大，战场上空的要小）。 */
  scale(k: number): this {
    return this.rot([k, 0, 0, 0, k, 0, 0, 0, k]);
  }

  /** 绕竖直轴转（偏航）。 */
  rotZ(a: number): this {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return this.rot([c, -s, 0, s, c, 0, 0, 0, 1]);
  }

  /** 绕局部 X（前向）轴转（横滚）。 */
  rotX(a: number): this {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return this.rot([1, 0, 0, 0, c, -s, 0, s, c]);
  }

  /** 绕局部 Y 轴转（俯仰 / 车轮滚动）。 */
  rotY(a: number): this {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return this.rot([c, 0, s, 0, 1, 0, -s, 0, c]);
  }

  /** 加一个面（局部坐标）。法线按"背离 inside 点"定向，所以顶点顺序不重要。 */
  private face(local: Vec3[], color: Rgba, inside: Vec3, glow = false): void {
    const pts = local.map((p) => this.apply(p));
    const a = pts[0];
    const b = pts[1];
    const c = pts[2];
    let n = v3(
      (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
      (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
    );
    const l = Math.hypot(n.x, n.y, n.z) || 1;
    n = v3(n.x / l, n.y / l, n.z / l);
    const cen = v3(
      pts.reduce((s, p) => s + p.x, 0) / pts.length,
      pts.reduce((s, p) => s + p.y, 0) / pts.length,
      pts.reduce((s, p) => s + p.z, 0) / pts.length,
    );
    const ins = this.apply(inside);
    if ((cen.x - ins.x) * n.x + (cen.y - ins.y) * n.y + (cen.z - ins.z) * n.z < 0) n = v3(-n.x, -n.y, -n.z);
    this.faces.push({ pts, color, n, c: cen, glow, bias: this.bias });
  }

  /**
   * 任意六面体：8 个角，先底面 4 个（后左、前左、前右、后右），再顶面 4 个（同样顺序）。
   * 楔形、梯形、斜装甲、收窄的机身全靠它。
   */
  hexa(c: Vec3[], color: Rgba, glow = false): this {
    const inside = v3(
      c.reduce((s, p) => s + p.x, 0) / 8,
      c.reduce((s, p) => s + p.y, 0) / 8,
      c.reduce((s, p) => s + p.z, 0) / 8,
    );
    const quads = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    for (const q of quads) {
      const pts = q.map((i) => c[i]);
      // 退化的面（两个角重合成一条线）跳过。
      const area = Math.hypot(pts[2].x - pts[0].x, pts[2].y - pts[0].y, pts[2].z - pts[0].z);
      if (area < 1e-3) continue;
      this.face(pts, color, inside, glow);
    }
    return this;
  }

  /** 轴对齐的盒子：x0..x1、y0..y1、z0..z1（局部坐标）。 */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: Rgba, glow = false): this {
    return this.hexa(
      [
        v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y1, z0), v3(x0, y1, z0),
        v3(x0, y0, z1), v3(x1, y0, z1), v3(x1, y1, z1), v3(x0, y1, z1),
      ],
      color,
      glow,
    );
  }

  /**
   * 顶面收窄的盒子：底面 x0..x1 × y0..y1，顶面四边各往里收 inset（可以每边不同）。
   * 炮塔、车头、机库的屋顶都是它。
   */
  taper(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, back: number, front: number, side: number, color: Rgba): this {
    return this.hexa(
      [
        v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y1, z0), v3(x0, y1, z0),
        v3(x0 + back, y0 + side, z1), v3(x1 - front, y0 + side, z1), v3(x1 - front, y1 - side, z1), v3(x0 + back, y1 - side, z1),
      ],
      color,
    );
  }

  /**
   * 多棱柱（近似圆柱）。axis 是它沿哪根局部轴，从 a 到 b；sides 一般取 8。
   * 每个侧面单独一档明暗 —— 圆的东西就有了一条条硬边色带。
   */
  prism(axis: 'x' | 'y' | 'z', a: number, b: number, cu: number, cv: number, r: number, color: Rgba, sides = 8, cap?: Rgba): this {
    const at = (t: number, ang: number): Vec3 => {
      const u = cu + Math.cos(ang) * r;
      const w = cv + Math.sin(ang) * r;
      return axis === 'x' ? v3(t, u, w) : axis === 'y' ? v3(u, t, w) : v3(u, w, t);
    };
    const mid = (a + b) / 2;
    const inside = axis === 'x' ? v3(mid, cu, cv) : axis === 'y' ? v3(cu, mid, cv) : v3(cu, cv, mid);
    for (let i = 0; i < sides; i++) {
      const a0 = ((i + 0.5) / sides) * Math.PI * 2;
      const a1 = ((i + 1.5) / sides) * Math.PI * 2;
      this.face([at(a, a0), at(b, a0), at(b, a1), at(a, a1)], color, inside);
    }
    const ring = (t: number): Vec3[] => Array.from({ length: sides }, (_, i) => at(t, ((i + 0.5) / sides) * Math.PI * 2));
    this.face(ring(a), cap ?? color, inside);
    this.face(ring(b), cap ?? color, inside);
    return this;
  }

  /** 一块单面的板（标志、窗户、旗子）：两面都算，永远看得见。 */
  plate(pts: Vec3[], color: Rgba, glow = false): this {
    const n = pts.length;
    const c = v3(pts.reduce((s, p) => s + p.x, 0) / n, pts.reduce((s, p) => s + p.y, 0) / n, pts.reduce((s, p) => s + p.z, 0) / n);
    // 两面各加一次：inside 点分别放在板的两侧。
    const a = pts[0];
    const b = pts[1];
    const cc = pts[2];
    const nx = (b.y - a.y) * (cc.z - a.z) - (b.z - a.z) * (cc.y - a.y);
    const ny = (b.z - a.z) * (cc.x - a.x) - (b.x - a.x) * (cc.z - a.z);
    const nz = (b.x - a.x) * (cc.y - a.y) - (b.y - a.y) * (cc.x - a.x);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.face(pts, color, v3(c.x - (nx / l) * 0.1, c.y - (ny / l) * 0.1, c.z - (nz / l) * 0.1), glow);
    this.face([...pts].reverse(), color, v3(c.x + (nx / l) * 0.1, c.y + (ny / l) * 0.1, c.z + (nz / l) * 0.1), glow);
    return this;
  }
}

/**
 * 把一个模型画进描边层。
 *
 * @param origin  模型在地面上的位置：决定它和别的物体之间的前后（地面行），和人物一样。
 * @param airborne 飞在空中的东西永远画在地面物体之后 —— 它的"地面行"是影子所在的那一行，
 *                 按那一行排的话，一架从机库上空飞过的飞机会被机库盖住。
 */
export function drawMesh(shapes: ShapeBatch, cam: Camera, mesh: Mesh3, origin: Vec2, airborne = false): void {
  const row = cam.worldToScreen(origin.x, origin.y).y * 32;
  const base = airborne ? 170000 + row : row;
  for (const f of mesh.faces) {
    const vis = f.n.x * VIEW.x + f.n.y * VIEW.y + f.n.z * VIEW.z;
    if (vis <= 0.015) continue;
    const color = f.glow ? f.color : shadeFace(f.color, f.n);
    const depth = base + clamp((f.c.y - origin.y) * VIEW.y + f.c.z * VIEW.z, -60, 60) * 0.25 + f.bias;
    const p = f.pts.map((q) => cam.worldToScreenZ(q.x, q.y, q.z));
    if (p.length === 3) shapes.quad(p[0], p[1], p[2], p[2], color, depth);
    else if (p.length === 4) shapes.quad(p[0], p[1], p[2], p[3], color, depth);
    else for (let i = 1; i + 1 < p.length; i++) shapes.quad(p[0], p[i], p[i + 1], p[i + 1], color, depth);
  }
}

/**
 * 影子：把所有顶点顺着光线压到地面上，取凸包，画成一块半透明的暗色。
 *
 * 一个凸包而不是每个面一块：每个面单独投影会互相叠，半透明叠半透明就成了一块块深浅不一的
 * 污渍。凸包对炮管、机翼这种细长东西会稍微"填满"一点，但在这个尺寸下看不出来。
 */
export function drawShadow(shapes: ShapeBatch, cam: Camera, mesh: Mesh3, groundZ = 0, depth = 9e5, alpha = 80): void {
  const pts: Vec2[] = [];
  for (const f of mesh.faces) {
    for (const p of f.pts) {
      const h = Math.max(0, p.z - groundZ);
      const gx = p.x - (LIGHT.x / LIGHT.z) * h;
      const gy = p.y - (LIGHT.y / LIGHT.z) * h;
      pts.push(cam.worldToScreenZ(gx, gy, groundZ));
    }
  }
  const hull = convexHull(pts);
  if (hull.length < 3) return;
  const color = rgba(8, 16, 10, alpha);
  for (let i = 1; i + 1 < hull.length; i++) shapes.quad(hull[0], hull[i], hull[i + 1], hull[i + 1], color, depth);
}

function convexHull(points: Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper).map((q) => v2(q.x, q.y));
}
