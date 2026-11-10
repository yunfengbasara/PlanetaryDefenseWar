import { type Kit, makeKit } from '../characters/kit';
import { rgb } from '../render/color';
import { LIVERY_BLUE, type Livery } from '../mesh/models';
import { MARINE_KIT } from './scene';

/**
 * 全军涂装。所有模型都直接读 LIVERY_BLUE、机枪兵读 MARINE_KIT（几十处调用），换涂装就地改这两个对象的颜色，
 * 不用把涂装一路传下去。默认是蓝白黑；商城买了"涂装：猩红"可以换成红黑。开局前和在商城里切换时调 applyLivery。
 */

/** 红黑涂装：深灰的车体、猩红的装甲板、发红光的灯。 */
export const LIVERY_RED: Livery = {
  base: rgb(70, 72, 80),
  panel: rgb(196, 40, 40),
  dark: rgb(22, 22, 26),
  stripeA: rgb(196, 40, 40),
  stripeB: rgb(18, 18, 22),
  glow: rgb(255, 120, 90),
};

const BLUE: Livery = { ...LIVERY_BLUE };
const BLUE_KIT: Kit = { ...MARINE_KIT };
/** 红黑的动力装甲：暗红甲片、黑色饰条，面罩换成发红光的。 */
const RED_KIT: Kit = {
  ...makeKit({ shirt: rgb(150, 36, 40), trim: rgb(30, 30, 36), trousers: rgb(46, 44, 50), cap: rgb(168, 44, 46) }),
  capShade: rgb(255, 110, 80),
  shirtLight: rgb(214, 90, 84),
  skin: rgb(150, 36, 40),
  skinShade: rgb(90, 20, 26),
  glove: rgb(60, 60, 66),
  gloveShade: rgb(34, 34, 40),
  shoe: rgb(40, 38, 44),
  shoeDark: rgb(20, 18, 22),
};

export function applyLivery(which: 'blue' | 'red'): void {
  Object.assign(LIVERY_BLUE, which === 'red' ? LIVERY_RED : BLUE);
  Object.assign(MARINE_KIT, which === 'red' ? RED_KIT : BLUE_KIT);
}
