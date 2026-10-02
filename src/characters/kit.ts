import { type Rgba, lerpColor, rgb } from '../render/color';

/**
 * 人物身上所有的颜色。
 *
 * 规则：**每种材质两个值，落差要大；对比留在部件之间**。动力装甲的上身（装甲色）和内衬（深色）
 * 拉开一大档，面罩用亮橙，才不会糊成一整块蓝。
 */
export interface Kit {
  skin: Rgba;
  skinShade: Rgba;
  hair: Rgba;
  hairShade: Rgba;

  shirt: Rgba;
  shirtShade: Rgba;
  shirtLight: Rgba;
  /** 饰条：面罩、肩甲边、护膝上的那一道亮色。 */
  trim: Rgba;

  trousers: Rgba;
  trousersShade: Rgba;
  belt: Rgba;

  shoe: Rgba;
  shoeDark: Rgba;

  cap: Rgba;
  capShade: Rgba;

  glove: Rgba;
  gloveShade: Rgba;

}

export interface KitSpec {
  shirt: Rgba;
  trim: Rgba;
  trousers: Rgba;
  cap: Rgba;
}

const SHADE_MIX = rgb(18, 22, 34);
const LIGHT_MIX = rgb(255, 252, 244);

const darker = (c: Rgba, t: number): Rgba => lerpColor(c, SHADE_MIX, t);
const lighter = (c: Rgba, t: number): Rgba => lerpColor(c, LIGHT_MIX, t);

export const makeKit = (spec: KitSpec): Kit => ({
  skin: rgb(232, 190, 150),
  skinShade: rgb(150, 108, 78),
  hair: rgb(58, 40, 28),
  hairShade: rgb(28, 20, 14),

  shirt: spec.shirt,
  shirtShade: darker(spec.shirt, 0.42),
  shirtLight: lighter(spec.shirt, 0.24),
  trim: spec.trim,

  trousers: spec.trousers,
  trousersShade: darker(spec.trousers, 0.42),
  belt: rgb(30, 26, 28),

  shoe: rgb(240, 240, 236),
  shoeDark: rgb(70, 72, 80),

  cap: spec.cap,
  capShade: darker(spec.cap, 0.45),

  glove: rgb(246, 246, 242),
  gloveShade: rgb(160, 164, 172),

});
