import { v2 } from '../core/math';
import { drawMarine } from '../characters/renderer';
import { Pose } from '../characters/rig';
import { buildingMesh, cruiserMesh } from '../game/buildings';
import { MARINE_KIT, MARINE_SCALE, aimPose } from '../game/scene';
import { Mesh3, drawMesh, drawShadow } from '../mesh/mesh';
import { LIVERY_BLUE, type Livery, siegeTank, walkerMech } from '../mesh/models';
import { rgb } from '../render/color';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import type { Snapshotter } from '../render/snapshot';

/**
 * 商城的商品图标：和建造列表、敌人图标一样，用游戏自己的模型和像素管线现画（带描边、四档明暗）。
 *
 *   marine    强化装甲     一名举枪的动力装甲机枪兵
 *   ammo      穿甲弹匣     一个弹药箱，箱上立着三发铜弹
 *   barracks  快速征召     开着门的兵营
 *   mech      导弹巢扩容   步行机甲
 *   cruiser   主炮校准     战列巡航舰
 *   livery    涂装：猩红   换上红黑涂装的坦克
 */

export type ShopIcon = 'marine' | 'ammo' | 'barracks' | 'mech' | 'cruiser' | 'livery';

/** 图标的缓冲尺寸（CSS 里放大两倍显示）。 */
const ICON_W = 64;
const ICON_H = 36;

/** 红黑涂装：深灰的车体、猩红的装甲板、发红光的灯。 */
const LIVERY_RED: Livery = {
  base: rgb(70, 72, 80),
  panel: rgb(196, 40, 40),
  dark: rgb(22, 22, 26),
  stripeA: rgb(196, 40, 40),
  stripeB: rgb(18, 18, 22),
  glow: rgb(255, 120, 90),
};

/** 弹药箱：军绿色的木箱、两道深色箍、箱盖上的黄字标，上面立着三发铜壳尖头的弹。 */
function ammoCrate(): Mesh3 {
  const m = new Mesh3().rotZ(-0.5);
  const olive = rgb(92, 104, 64);
  const dark = rgb(54, 60, 40);
  m.box(-11, 11, -7, 7, 0, 8, olive);
  for (const x of [-7, 7]) m.box(x - 1, x + 1, -7.3, 7.3, 0, 8.3, dark);
  m.box(-4, 4, -7.4, -7.2, 2.5, 5.5, rgb(230, 190, 60));
  for (const [x, y] of [[-5, 0], [0, -1.5], [5, 0.5]]) {
    m.prism('z', 8, 15, x, y, 1.7, rgb(214, 160, 70), 8);
    m.prism('z', 15, 18, x, y, 1.1, rgb(176, 96, 60), 8);
  }
  return m;
}

/** 画一个商品图标，返回一张 canvas（缓冲 64×36，显示时放大两倍）。 */
export function shopIcon(snap: Snapshotter, icon: ShopIcon): HTMLCanvasElement {
  const grain = { marine: 1.55, ammo: 1.3, barracks: 0.62, mech: 0.56, cruiser: 0.6, livery: 0.82 }[icon];
  const tall = { marine: 18, ammo: 14, barracks: 38, mech: 46, cruiser: 0, livery: 22 }[icon];
  const cam = snap.camera(ICON_W, ICON_H);
  cam.grain = grain;
  cam.x = 0;
  cam.y = -((tall * Projection.heightSquash) / Projection.groundSquash) / 2;
  const src = snap.capture(cam, (layers, c) => {
    if (icon === 'marine') {
      // 举枪的姿势，身子朝镜头偏一点。
      const pose = new Pose();
      aimPose(pose, 0);
      const p = new Projector(c.worldToScreenZ(0, 0, 0), -Math.PI / 2 + 2.5, Projection.groundSquash, c.grain * MARINE_SCALE, c.worldToScreen(0, 0).y);
      drawMarine(layers.units, pose, p, MARINE_KIT);
      return;
    }
    const mesh =
      icon === 'ammo'
        ? ammoCrate()
        : icon === 'barracks'
          ? buildingMesh('barracks', 0, 0, 1.2, 1)
          : icon === 'mech'
            ? walkerMech(new Mesh3().rotZ(Math.PI / 2 + 0.5), { torso: 0, step: 0.25, recoil: 0, stride: 0 }, LIVERY_BLUE)
            : icon === 'cruiser'
              ? cruiserMesh()
              : siegeTank(new Mesh3().rotZ(-Math.PI / 2 - 0.5), { turret: 0.4, recoil: 0, deploy: 1 }, LIVERY_RED);
    if (icon !== 'cruiser') drawShadow(layers.ground, c, mesh, 0, 9e5, 70);
    drawMesh(icon === 'cruiser' ? layers.sky : layers.units, c, mesh, v2(0, 0));
  });
  const out = document.createElement('canvas');
  out.width = ICON_W;
  out.height = ICON_H;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0);
  return out;
}
