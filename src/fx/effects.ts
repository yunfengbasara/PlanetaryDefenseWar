import { type Vec2, v2 } from '../core/math';
import type { Camera } from '../render/camera';
import { type Rgba, rgb, rgba } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { ShapeBatch } from '../render/shapeBatch';

/** 特效只需要知道某一点脚下有没有地面、地面多高。null = 虚空，碎块会一直往下掉。 */
export interface Ground {
  floorAt(x: number, y: number): number | null;
}

/**
 * 爆炸和它的一切余波。整套效果由五样东西叠出来，每一样负责一种读数：
 *
 *   闪光     一帧半的白：告诉眼睛"这里出事了"，比任何东西都先被看到
 *   火球     三层同心圆（红、橙、黄白）往上飘着缩小 —— 像素画里的火就是几个平涂的圆
 *   冲击环   贴地扩散的一圈：爆炸有多大，看这圈扩到哪儿
 *   碎块     按重力抛出去再落地，落地后在地上躺一会儿；飞出平台的掉进虚空
 *   烟       灰色的圆慢慢变大、往上飘，最后散掉 —— 它让爆炸在画面上停留两秒，而不是一闪就没
 *
 * 碎块画在描边层（它是"物体"），其余画在不描边的特效层（它们是"光"和"雾"）。
 */

interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: Rgba;
  size: number;
  life: number;
  grounded: boolean;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  vz: number;
  r0: number;
  r1: number;
  t: number;
  dur: number;
  shade: number;
}

interface Burst {
  x: number;
  y: number;
  z: number;
  t: number;
  dur: number;
  size: number;
}

const FIRE_OUT = rgb(214, 70, 34);
const FIRE_MID = rgb(250, 150, 40);
const FIRE_CORE = rgb(255, 238, 170);

export class Effects {
  /** 碎块的颜色。 */
  debrisColors: Rgba[] = [rgb(150, 150, 156), rgb(120, 118, 126), rgb(176, 174, 180)];
  /** 爆炸烟的亮度偏移。 */
  smokeLift = 0;
  private readonly debris: Debris[] = [];
  private readonly puffs: Puff[] = [];
  private readonly fireballs: Burst[] = [];
  private readonly rings: Burst[] = [];
  private readonly flashes: Burst[] = [];

  explode(x: number, y: number, z: number, size: number): void {
    this.flashes.push({ x, y, z: z + 4, t: 0, dur: 0.1, size });
    this.fireballs.push({ x, y, z: z + 2, t: 0, dur: 0.42, size });
    this.rings.push({ x, y, z, t: 0, dur: 0.38, size });
    const n = Math.round(26 * size);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 90 * size;
      this.debris.push({
        x, y, z: z + 1,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: 60 + Math.random() * 120 * size,
        color: this.debrisColors[Math.floor(Math.random() * this.debrisColors.length)],
        size: 0.7 + Math.random() * 1.1,
        life: 2.5 + Math.random() * 1.5,
        grounded: false,
      });
    }
    for (let i = 0; i < 9; i++) {
      this.puffs.push({
        x: x + (Math.random() - 0.5) * 14 * size,
        y: y + (Math.random() - 0.5) * 10 * size,
        z: z + 2 + Math.random() * 6,
        vz: 6 + Math.random() * 10,
        r0: 3 + Math.random() * 3,
        r1: 9 + Math.random() * 8 * size,
        t: -Math.random() * 0.15,
        dur: 1.6 + Math.random() * 1.2,
        shade: Math.random(),
      });
    }
  }

  /** 炮口焰：一个小火球 + 两团烟。 */
  muzzle(x: number, y: number, z: number): void {
    this.fireballs.push({ x, y, z, t: 0, dur: 0.16, size: 0.35 });
    for (let i = 0; i < 3; i++) {
      this.puffs.push({ x: x + (Math.random() - 0.5) * 4, y: y + (Math.random() - 0.5) * 4, z, vz: 8, r0: 1.5, r1: 5 + Math.random() * 3, t: 0, dur: 0.9, shade: 0.8 });
    }
  }

  /** 拖尾的一缕烟（导弹、烟囱）。 */
  trail(x: number, y: number, z: number): void {
    this.puffs.push({ x, y, z, vz: 2, r0: 0.8, r1: 2.6, t: 0, dur: 0.6, shade: 0.9 });
  }

  /** 一小团烟：地刺冒头、酸液落地用。 */
  poof(x: number, y: number, z: number, size = 1): void {
    for (let i = 0; i < 4; i++) {
      this.puffs.push({
        x: x + (Math.random() - 0.5) * 6 * size,
        y: y + (Math.random() - 0.5) * 4 * size,
        z: z + 1 + Math.random() * 4 * size,
        vz: 6 + Math.random() * 6,
        r0: 1.5 * size,
        r1: (4 + Math.random() * 3) * size,
        t: 0,
        dur: 0.5 + Math.random() * 0.3,
        shade: 0.7 + Math.random() * 0.3,
      });
    }
  }

  update(dt: number, ground: Ground): void {
    const age = <T extends { t: number; dur: number }>(list: T[]): void => {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].t += dt;
        if (list[i].t >= list[i].dur) list.splice(i, 1);
      }
    };
    age(this.flashes);
    age(this.fireballs);
    age(this.rings);

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt;
      p.z += p.vz * dt;
      if (p.t >= p.dur) this.puffs.splice(i, 1);
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      if (d.grounded) {
        d.life -= dt;
        if (d.life <= 0) this.debris.splice(i, 1);
        continue;
      }
      d.vz -= 260 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      const g = ground.floorAt(d.x, d.y);
      if (g === null) {
        if (d.z < -150) this.debris.splice(i, 1);
      } else if (d.z <= g && d.vz < 0) {
        d.z = g;
        d.grounded = true;
      }
    }
  }

  draw(units: ShapeBatch, fx: ShapeBatch, cam: Camera): void {
    const g = cam.grain;
    const at = (x: number, y: number, z: number): Vec2 => cam.worldToScreenZ(x, y, z);
    const row = (y: number): number => cam.worldToScreen(0, y).y * Projector.DEPTH_PER_ROW;

    for (const d of this.debris) {
      const alpha = d.grounded ? Math.min(1, d.life) : 1;
      const s = Math.max(1, d.size * g);
      const c = alpha < 1 ? rgba(d.color.r, d.color.g, d.color.b, Math.round(255 * alpha)) : d.color;
      units.rect(at(d.x, d.y, d.z), s, s, 0, c, row(d.y) + 2);
    }

    for (const r of this.rings) {
      const u = r.t / r.dur;
      const rad = (6 + 44 * r.size * (1 - (1 - u) * (1 - u))) * g;
      fx.ellipseRing(at(r.x, r.y, r.z + 0.5), rad, rad * Projection.groundSquash, 0, Math.max(1, g * 0.9 * (1 - u)), rgba(255, 246, 220, Math.round(200 * (1 - u))), 1, 32);
    }

    for (const p of this.puffs) {
      if (p.t < 0) continue;
      const u = p.t / p.dur;
      const r = (p.r0 + (p.r1 - p.r0) * Math.sqrt(u)) * g;
      const base = Math.round(70 + p.shade * 40 + this.smokeLift);
      const a = Math.round(190 * (1 - u) * Math.min(1, p.t * 8));
      const c = at(p.x, p.y, p.z);
      // 两个色阶：暗底 + 往光源偏的一块亮面 —— 和人物、模型同一条规矩。
      fx.disc(c, r, rgba(base, base, base - 6, a), 2 + p.z * 0.001);
      fx.disc(v2(c.x - r * 0.25, c.y - r * 0.25), r * 0.62, rgba(base + 40, base + 40, base + 34, a), 2.0005 + p.z * 0.001);
    }

    for (const f of this.fireballs) {
      const u = f.t / f.dur;
      const rise = u * 10 * f.size;
      const c = at(f.x, f.y, f.z + rise);
      const r = (5 + 9 * f.size) * g * (u < 0.25 ? 0.6 + u * 1.6 : 1 - (u - 0.25) * 0.9);
      fx.disc(c, r, FIRE_OUT, 4);
      fx.disc(v2(c.x - r * 0.12, c.y - r * 0.14), r * 0.72, FIRE_MID, 4.001);
      if (u < 0.6) fx.disc(v2(c.x - r * 0.2, c.y - r * 0.24), r * 0.42 * (1 - u), FIRE_CORE, 4.002);
    }

    for (const f of this.flashes) {
      const u = f.t / f.dur;
      const r = (16 + 30 * f.size) * g * (0.6 + u);
      fx.disc(at(f.x, f.y, f.z), r, rgba(255, 252, 230, Math.round(170 * (1 - u))), 5);
    }
  }
}
