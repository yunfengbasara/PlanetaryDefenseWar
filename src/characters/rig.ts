import { type Vec3, v3 } from '../core/math';
import { solveTwoBoneIk } from './twoBoneIk';

/**
 * 骨骼比例，单位是虚拟像素。整个人大约 19 单位高 —— 在 1 倍缩放下就是像素缓冲里的 19 px。
 *
 * 这套数值是被截图反复对出来的，动任何一个都会让人物退回"卡通娃娃"。
 * 不同的兵种是同一具身体，不同的只是穿什么、怎么动 —— 所以这个文件很少需要改。
 * 真正该改的是 kit.ts（穿什么）、renderer.ts（装甲怎么画）和 poses.ts（怎么动）。
 *
 * 局部空间是右手系、以身体为基准：X = 角色的右手边，Y = 面朝方向，Z = 上。
 */
export const RigSpec = {
  // 身高大致按 40% 腿 / 29% 躯干 / 31% 头颈 划分，总高约 18.8。
  hipZ: 7.6,

  hipHalfWidth: 2.05,
  thigh: 4.35,
  shin: 4.35,

  // 比看上去该有的更细。高度被压缩后腿在屏幕上变短了，宽度却没变，一条和长度差不多宽的
  // 大腿就是根香肠。
  legThickness: 2.45,

  chestZ: 13.1,
  shoulderHalfWidth: 3.5,
  upperArm: 2.9,
  forearm: 2.9,
  armThickness: 1.85,

  // 躯干上的三个横截面，不是一个。从胯到胸一个胶囊就是个鸡蛋，而鸡蛋没有腰、没有肩、
  // 也没有臀。
  torsoHalfWidth: 3.95,
  torsoHalfDepth: 2.5,
  waistHalfWidth: 3.15,
  waistHalfDepth: 2.0,
  pelvisHalfWidth: 3.65,
  pelvisHalfDepth: 2.45,

  /** 腰的收束点落在胯到胸之间的哪个位置。 */
  waistFrac: 0.4,

  headZ: 15.8,

  // 人群里眼睛数的是脑袋，所以头保持大方 —— 但和肩同宽的头骨是最响的卡通信号。
  headRadius: 2.5,

  shadowRadius: 5.4,

  get legLength(): number {
    return this.thigh + this.shin;
  },
  get armLength(): number {
    return this.upperArm + this.forearm;
  },
  get handRadius(): number {
    return this.armThickness * 0.46;
  },
};

/** 一帧的骨骼状态，全部在身体局部空间里。 */
export class Pose {
  hip: Vec3 = v3(0, 0, RigSpec.hipZ);
  chest: Vec3 = v3(0, 0, RigSpec.chestZ);
  /** 躯干绕 Z 的扭转。射门时上半身拧过来，是"这一脚有力量"的主要来源。 */
  spineYaw = 0;
  /** 前倾，弧度。 */
  spineLean = 0;

  footL: Vec3 = v3(0, 0, 0);
  footR: Vec3 = v3(0, 0, 0);
  kneeL: Vec3 = v3(0, 0, 0);
  kneeR: Vec3 = v3(0, 0, 0);
  handL: Vec3 = v3(0, 0, 0);
  handR: Vec3 = v3(0, 0, 0);
  elbowL: Vec3 = v3(0, 0, 0);
  elbowR: Vec3 = v3(0, 0, 0);
  head: Vec3 = v3(0, 0, RigSpec.headZ);

  /** 手里的枪：枪托末端和枪口。没拿枪（走路空手、倒地）时为 null。 */
  gunButt: Vec3 | null = null;
  gunMuzzle: Vec3 | null = null;

  /** 胯部关节窝。 */
  hipSocket(side: number): Vec3 {
    const x = side === 0 ? -RigSpec.hipHalfWidth : RigSpec.hipHalfWidth;
    return { x: this.hip.x + x, y: this.hip.y, z: this.hip.z };
  }

  /** 肩关节窝，已经应用了脊柱扭转。 */
  shoulderSocket(side: number): Vec3 {
    const x = side === 0 ? -RigSpec.shoulderHalfWidth : RigSpec.shoulderHalfWidth;
    const cos = Math.cos(this.spineYaw);
    const sin = Math.sin(this.spineYaw);
    return { x: this.chest.x + x * cos, y: this.chest.y + x * sin, z: this.chest.z };
  }

  /** 跑两腿两臂的 IK，填出膝和肘。 */
  solveLimbs(): void {
    // 膝盖只朝正前方弯，外撇分量必须是 0：外撇会把膝盖顶到比胯还宽半个单位，而脚却收在
    // 胯的内侧 —— 膝外脚内正是罗圈腿的定义。
    this.kneeL = solveTwoBoneIk(this.hipSocket(0), this.footL, RigSpec.thigh, RigSpec.shin, v3(0, 1, 0));
    this.kneeR = solveTwoBoneIk(this.hipSocket(1), this.footR, RigSpec.thigh, RigSpec.shin, v3(0, 1, 0));

    // 肘朝后、并往外侧折。
    this.elbowL = solveTwoBoneIk(this.shoulderSocket(0), this.handL, RigSpec.upperArm, RigSpec.forearm, v3(-0.7, -1, -0.15));
    this.elbowR = solveTwoBoneIk(this.shoulderSocket(1), this.handR, RigSpec.upperArm, RigSpec.forearm, v3(0.7, -1, -0.15));
  }
}
