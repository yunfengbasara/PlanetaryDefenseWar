import { type Vec3, clamp, frac, lerp, smoothStep, v3 } from '../core/math';
import { type Pose, RigSpec } from './rig';

/**
 * 走路和倒地。
 *
 * 走路的思路：脚的落点由相位推出来，踩在地上的那只脚从身前滑到身后 —— 相位推进跟着速度走，
 * 所以任何速度下都不打滑。一个步态周期身体前进 2 × stride（左右脚各踩一次）。
 */

const SPINE = RigSpec.chestZ - RigSpec.hipZ;

/** 一个步态周期身体前进多远（身体单位）。调用方用它把移动速度换算成相位推进。 */
export function strideCycle(gait: number): number {
  return 2 * (2.2 + gait * 5.2);
}

export function walkPose(pose: Pose, phase: number, gait: number): void {
  const stride = 2.2 + gait * 5.2;
  const lift = 0.5 + gait * 1.2;
  const half = stride * 0.5;
  const step = (p: number, sideX: number): Vec3 => {
    const ph = frac(p);
    if (ph < 0.5) return v3(sideX, lerp(half, -half, ph / 0.5), 0);
    const t = (ph - 0.5) / 0.5;
    return v3(sideX, lerp(-half, half, smoothStep(t)), lift * Math.sin(Math.PI * t));
  };
  const hw = RigSpec.hipHalfWidth;
  const idleL = v3(-hw * 1.05, 0, 0);
  const idleR = v3(hw * 1.05, 0, 0);
  const sL = step(phase, -hw);
  const sR = step(phase + 0.5, hw);
  pose.footL = v3(lerp(idleL.x, sL.x, gait), lerp(idleL.y, sL.y, gait), lerp(idleL.z, sL.z, gait));
  pose.footR = v3(lerp(idleR.x, sR.x, gait), lerp(idleR.y, sR.y, gait), lerp(idleR.z, sR.z, gait));

  const bob = -0.45 * gait * Math.cos(Math.PI * 4 * phase);
  const swayX = -0.35 * gait * Math.sin(Math.PI * 2 * phase);
  pose.hip = v3(swayX, 0, RigSpec.hipZ - 0.25 * gait + bob);

  const lean = 0.1 + 0.12 * gait;
  pose.spineLean = lean;
  pose.spineYaw = 0;
  pose.chest = v3(pose.hip.x, pose.hip.y + Math.sin(lean) * SPINE, pose.hip.z + Math.cos(lean) * SPINE);
  pose.head = headOnSpine(pose);
  pose.gunButt = null;
  pose.gunMuzzle = null;

  const sL0 = pose.shoulderSocket(0);
  const sR0 = pose.shoulderSocket(1);
  const swing = (pose.footR.y - pose.footL.y) * 0.5 * gait;
  const hang = RigSpec.armLength * lerp(0.94, 0.8, gait);
  pose.handL = v3(sL0.x - 0.75, sL0.y + lerp(-0.2, 1.0, gait) + swing, sL0.z - hang);
  pose.handR = v3(sR0.x + 0.75, sR0.y + lerp(-0.2, 1.0, gait) - swing, sR0.z - hang);
  pose.solveLimbs();
}

/**
 * 倒地：先被打得往后一仰，再横着躺下。顺着前后轴躺在压扁的地面上，看起来和站着一样大。
 */
export function fallPose(pose: Pose, t: number): void {
  const down = smoothStep(clamp(t / 0.35, 0, 1));
  pose.hip = v3(0, -0.6 * down, lerp(RigSpec.hipZ, 1.3, down));
  pose.chest = v3(lerp(0, -SPINE, down), lerp(-1.5, 0, down), lerp(RigSpec.chestZ - 0.5, 1.6, down));
  pose.head = headOnSpine(pose);
  pose.spineLean = 0;
  pose.spineYaw = 0;
  pose.handL = v3(lerp(-3.5, -3, down), lerp(-1, -5.4, down), lerp(13, 0.6, down));
  pose.handR = v3(lerp(3.5, -4.6, down), lerp(-1, 5.2, down), lerp(13, 0.6, down));
  pose.footL = v3(lerp(-2.2, 7.4, down), lerp(0.5, -2.2, down), lerp(0, 0.5, down));
  pose.footR = v3(lerp(2.2, 6.8, down), lerp(0.5, 2.6, down), lerp(0, 0.5, down));
  pose.gunButt = null;
  pose.gunMuzzle = null;
  pose.solveLimbs();
}

function headOnSpine(pose: Pose): Vec3 {
  const dx = pose.chest.x - pose.hip.x;
  const dy = pose.chest.y - pose.hip.y;
  const dz = pose.chest.z - pose.hip.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const neck = RigSpec.headZ - RigSpec.chestZ;
  return v3(pose.chest.x + (dx / len) * neck, pose.chest.y + (dy / len) * neck, pose.chest.z + (dz / len) * neck);
}
