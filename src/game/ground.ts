import type { Ground } from '../fx/effects';
import { field } from './fields';
import { spanAt } from './floor';
import { HULL_SIDE } from './starship';

/**
 * 地面是平的（z = 0）。金属平台两侧是虚空，掉出去的碎块会一直往下坠；星舰的船舷外面也是太空；
 * 行星地表哪儿都有地。
 */
export class PlatformGround implements Ground {
  heightAt(_x: number, _y: number): number {
    return 0;
  }

  floorAt(x: number, y: number): number | null {
    const theme = field().theme;
    if (theme !== 'space' && theme !== 'starship') return 0;
    const [a, b] = spanAt(y);
    // 星舰：通道外还有一截往下弯的船舷接着，再往外才是太空。
    if (theme === 'starship') return x < a - HULL_SIDE || x > b + HULL_SIDE ? null : 0;
    return x < a || x > b ? null : 0;
  }
}
