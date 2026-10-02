/**
 * 教学关的提示条：画面下方一块面板，逐条显示，几秒自动翻下一条，也可以点"下一条"或"跳过"。
 * 只管显示，不读游戏状态。样式在 style.ts 的 .pdw-hint。
 */

/** 每条提示停留多久（秒）。 */
const HOLD = 7;

export class TutorialHints {
  private readonly el = document.createElement('div');
  private lines: string[] = [];
  private index = -1;
  private t = 0;

  constructor(host: HTMLElement) {
    this.el.className = 'pdw-hint hidden';
    this.el.innerHTML = `
      <div class="pdw-hint-head"><b>新兵引导</b><span class="pdw-hint-step"></span></div>
      <p class="pdw-hint-text"></p>
      <div class="pdw-hint-bar"><i></i></div>
      <div class="pdw-hint-actions">
        <button class="pdw-btn ghost" data-act="skip"><span>跳过</span></button>
        <button class="pdw-btn ghost" data-act="next"><span>下一条</span></button>
      </div>`;
    this.el.querySelector('[data-act=skip]')!.addEventListener('click', () => this.stop());
    this.el.querySelector('[data-act=next]')!.addEventListener('click', () => this.show(this.index + 1));
    host.appendChild(this.el);
  }

  play(lines: string[]): void {
    this.lines = lines;
    this.show(0);
  }

  stop(): void {
    this.index = -1;
    this.el.classList.add('hidden');
  }

  update(dt: number): void {
    if (this.index < 0) return;
    this.t += dt;
    (this.el.querySelector('.pdw-hint-bar i') as HTMLElement).style.width = `${Math.min(100, (this.t / HOLD) * 100)}%`;
    if (this.t >= HOLD) this.show(this.index + 1);
  }

  private show(i: number): void {
    if (i >= this.lines.length) {
      this.stop();
      return;
    }
    this.index = i;
    this.t = 0;
    this.el.querySelector('.pdw-hint-step')!.textContent = `${i + 1} / ${this.lines.length}`;
    this.el.querySelector('.pdw-hint-text')!.textContent = this.lines[i];
    this.el.querySelector('[data-act=next] span')!.textContent = i === this.lines.length - 1 ? '开始战斗' : '下一条';
    this.el.classList.remove('hidden');
  }
}
