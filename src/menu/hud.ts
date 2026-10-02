import type { BattleState } from '../game/main';

/**
 * 局内 HUD：右上角是晶矿数（核心血条画在战场里核心的正下方，不在这儿）。核心碎了之后弹结算面板
 * （重新开始 / 返回主界面）。只管显示，每帧从 state() 读数；样式在 style.ts 的 .pdw-hud、.pdw-over。
 */

/** 核心碎了多久之后弹结算（等爆炸演完）。 */
const OVER_DELAY = 1.6;

const CRYSTAL_ICON =
  '<svg viewBox="0 0 16 16"><path d="M8 1l5 5-5 9-5-9z" fill="currentColor"/><path d="M8 1l2 5-2 9z" fill="#fff" opacity=".35"/></svg>';

export interface HudActions {
  restart(): void;
  quit(): void;
}

export class Hud {
  private readonly bar = document.createElement('div');
  private readonly over = document.createElement('div');
  private readonly crystalText: HTMLElement;
  private shownCrystals = -1;
  private overShown = false;

  constructor(host: HTMLElement, actions: HudActions) {
    this.bar.className = 'pdw-hud hidden';
    this.bar.innerHTML = `<div class="pdw-crystal">${CRYSTAL_ICON}<b></b><em>晶矿</em></div>`;
    this.crystalText = this.bar.querySelector('.pdw-crystal b')!;

    this.over.className = 'pdw-over hidden';
    this.over.innerHTML = `
      <div class="pdw-over-panel">
        <small>MISSION FAILED</small>
        <h2>核心被摧毁</h2>
        <div class="pdw-over-stats">
          <div><span>坚守时间</span><b data-k="time"></b></div>
          <div><span>获得晶矿</span><b data-k="crystals"></b></div>
        </div>
        <div class="pdw-over-actions">
          <button class="pdw-btn ghost" data-act="quit"><span>返回主界面</span></button>
          <button class="pdw-btn" data-act="restart"><span>重新开始</span></button>
        </div>
      </div>`;
    this.over.querySelector('[data-act=restart]')!.addEventListener('click', () => actions.restart());
    this.over.querySelector('[data-act=quit]')!.addEventListener('click', () => actions.quit());

    host.appendChild(this.bar);
    host.appendChild(this.over);
  }

  show(): void {
    this.bar.classList.remove('hidden');
    this.over.classList.add('hidden');
    this.overShown = false;
    this.shownCrystals = -1;
  }

  hide(): void {
    this.bar.classList.add('hidden');
    this.over.classList.add('hidden');
    this.overShown = false;
  }

  update(st: BattleState | null): void {
    if (!st) return;
    // 数字没变就不碰 DOM。
    if (st.crystals !== this.shownCrystals) {
      this.shownCrystals = st.crystals;
      this.crystalText.textContent = st.crystals.toLocaleString();
    }
    if (st.lost && st.lostT >= OVER_DELAY && !this.overShown) {
      this.overShown = true;
      const t = Math.floor(st.time);
      this.over.querySelector('[data-k=time]')!.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      this.over.querySelector('[data-k=crystals]')!.textContent = st.crystals.toLocaleString();
      this.over.classList.remove('hidden');
    }
  }
}
