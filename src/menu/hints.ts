import type { BattleState, CssRect } from '../game/main';

/**
 * 新手引导：一层压暗的遮罩 + 一块引导面板，一步一步来。
 *
 *   遮罩      除了这一步要操作的地方（target），整个画面压暗，而且点不到；target 那一块挖空、
 *             描一圈会呼吸的亮框，里面照常能点、能拖、能滚轮。没有 target 的步骤整屏压暗。
 *   面板      贴在 target 旁边（左、右、下、上，哪边放得下放哪边）；没有 target 就放在左下角。
 *   普通的一步      有"下一步"按钮（最后一步是"开始战斗"）
 *   要玩家动手的一步 没有"下一步"，玩家做到了（比如造好兵营）立刻进入下一步
 *
 * 随时可以"跳过引导"。走完或跳过都会调 onDone —— 外面在那时开始刷怪。
 * target 每帧由外面换算成舞台上的矩形（镜头动了，挖空的地方跟着走）。样式在 style.ts 的 .pdw-hint、.pdw-mask。
 */

/** 要等玩家做到的事。 */
export type GuideWait = 'placing-barracks' | 'built-barracks' | 'rally';
/** 这一步要亮出来的地方：建造列表里的某一项、建造区、某座兵营连同它的集结点范围。 */
export type GuideTarget = 'build:barracks' | 'area:base' | 'rally:barracks';

export interface GuideStep {
  text: string;
  wait?: GuideWait;
  target?: GuideTarget;
}

const DONE: Record<GuideWait, (st: BattleState) => boolean> = {
  'placing-barracks': (st) => st.build?.placing === 'barracks' || (st.build?.built.barracks ?? 0) > 0,
  'built-barracks': (st) => (st.build?.built.barracks ?? 0) > 0,
  rally: (st) => st.build?.rallyEver ?? false,
};

/** 挖空的地方比目标外扩多少、面板离挖空处多远（CSS 像素）。 */
const PAD = 8;
const GAP = 14;

export class TutorialHints {
  private readonly el = document.createElement('div');
  private readonly mask = document.createElement('div');
  private readonly shades: HTMLElement[] = [];
  private readonly frame = document.createElement('div');
  private steps: GuideStep[] = [];
  private index = -1;
  private onDone: (() => void) | null = null;

  constructor(private readonly host: HTMLElement) {
    // 遮罩：上、下、左、右四块压暗的板子围出一个洞；板子挡点击，洞里不挡。
    this.mask.className = 'pdw-mask hidden';
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div');
      d.className = 'pdw-mask-shade';
      d.addEventListener('pointerdown', (e) => e.stopPropagation());
      d.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
      this.shades.push(d);
      this.mask.appendChild(d);
    }
    this.frame.className = 'pdw-mask-frame';
    this.mask.appendChild(this.frame);
    host.appendChild(this.mask);

    this.el.className = 'pdw-hint hidden';
    this.el.innerHTML = `
      <div class="pdw-hint-head"><b>新兵引导</b><span class="pdw-hint-step"></span></div>
      <p class="pdw-hint-text"></p>
      <div class="pdw-hint-actions">
        <span class="pdw-hint-wait"><i></i>完成高亮处的操作后继续</span>
        <button class="pdw-btn ghost" data-act="skip"><span>跳过引导</span></button>
        <button class="pdw-btn ghost" data-act="next"><span>下一步</span></button>
      </div>`;
    this.el.querySelector('[data-act=skip]')!.addEventListener('click', () => this.finish());
    this.el.querySelector('[data-act=next]')!.addEventListener('click', () => this.show(this.index + 1));
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    host.appendChild(this.el);
  }

  play(steps: GuideStep[], onDone: () => void): void {
    this.steps = steps;
    this.onDone = onDone;
    this.show(0);
  }

  /** 中途离开（回主界面）：只收起来，不算走完。 */
  stop(): void {
    this.index = -1;
    this.onDone = null;
    this.el.classList.add('hidden');
    this.mask.classList.add('hidden');
  }

  /** 每帧：看这一步做到了没有；把遮罩的洞和面板对到 target 现在在屏幕上的位置。 */
  update(_dt: number, st: BattleState | null, locate: (t: GuideTarget) => CssRect | null): void {
    if (this.index < 0 || !st) return;
    // 做到了就立刻翻到下一步，然后当帧就按新的一步摆遮罩：遮罩直接跳过去，不在上一步停留。
    const step = this.steps[this.index];
    if (step.wait && DONE[step.wait](st)) this.show(this.index + 1);
    if (this.index < 0) return;
    const now = this.steps[this.index];
    this.layout(now.target ? locate(now.target) : null);
  }

  /** 摆遮罩和面板。hole 为 null：整屏压暗，面板放左下角。 */
  private layout(target: CssRect | null): void {
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    const [top, bottom, left, right] = this.shades;
    const place = (d: HTMLElement, x: number, y: number, w: number, h: number): void => {
      d.style.left = `${x}px`;
      d.style.top = `${y}px`;
      d.style.width = `${Math.max(0, w)}px`;
      d.style.height = `${Math.max(0, h)}px`;
    };
    const pw = this.el.offsetWidth;
    const ph = this.el.offsetHeight;
    if (!target) {
      place(top, 0, 0, W, H);
      for (const d of [bottom, left, right]) place(d, 0, 0, 0, 0);
      this.frame.style.display = 'none';
      this.el.style.left = '16px';
      this.el.style.top = `${H - ph - 16}px`;
      return;
    }
    // 洞：目标外扩一圈，夹在舞台里。
    const x0 = Math.max(0, Math.round(target.x - PAD));
    const y0 = Math.max(0, Math.round(target.y - PAD));
    const x1 = Math.min(W, Math.round(target.x + target.w + PAD));
    const y1 = Math.min(H, Math.round(target.y + target.h + PAD));
    place(top, 0, 0, W, y0);
    place(bottom, 0, y1, W, H - y1);
    place(left, 0, y0, x0, y1 - y0);
    place(right, x1, y0, W - x1, y1 - y0);
    this.frame.style.display = '';
    place(this.frame, x0, y0, x1 - x0, y1 - y0);
    // 面板：左边放得下放左边，否则右边、下边、上边；都放不下就压在洞的左下角里。
    const midY = Math.min(H - ph - 8, Math.max(8, (y0 + y1) / 2 - ph / 2));
    const midX = Math.min(W - pw - 8, Math.max(8, (x0 + x1) / 2 - pw / 2));
    let px: number;
    let py: number;
    if (x0 - GAP - pw >= 8) [px, py] = [x0 - GAP - pw, midY];
    else if (x1 + GAP + pw <= W - 8) [px, py] = [x1 + GAP, midY];
    else if (y1 + GAP + ph <= H - 8) [px, py] = [midX, y1 + GAP];
    else if (y0 - GAP - ph >= 8) [px, py] = [midX, y0 - GAP - ph];
    else [px, py] = [16, H - ph - 16];
    this.el.style.left = `${Math.round(px)}px`;
    this.el.style.top = `${Math.round(py)}px`;
  }

  private finish(): void {
    const cb = this.onDone;
    this.stop();
    cb?.();
  }

  private show(i: number): void {
    if (i >= this.steps.length) {
      this.finish();
      return;
    }
    this.index = i;
    const step = this.steps[i];
    const last = i === this.steps.length - 1;
    this.el.querySelector('.pdw-hint-step')!.textContent = `${i + 1} / ${this.steps.length}`;
    this.el.querySelector('.pdw-hint-text')!.textContent = step.text;
    this.el.querySelector('[data-act=next] span')!.textContent = last ? '开始战斗' : '下一步';
    this.el.classList.toggle('waiting', !!step.wait);
    this.el.classList.remove('hidden');
    this.mask.classList.remove('hidden');
  }
}
