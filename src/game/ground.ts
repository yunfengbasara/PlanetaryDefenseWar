import type { Ground } from '../fx/effects';
import { field } from './fields';
import { spanAt } from './floor';

/**
 * 地面是平的（z = 0）。金属平台两侧是虚空，掉出去的碎块会一直往下坠；行星地表哪儿都有地。
 */
export class PlatformGround implements Ground {
  heightAt(_x: number, _y: number): number {
    return 0;
  }

  floorAt(x: number, y: number): number | null {
    if (field().theme !== 'space') return 0;
    const [a, b] = spanAt(y);
    return x < a || x > b ? null : 0;
  }
}
