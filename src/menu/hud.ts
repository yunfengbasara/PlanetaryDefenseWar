import type { BattleState } from '../game/main';

/**
 * 局内 HUD：
 *
 *   右上角   波次面板（当前第几波、场上还剩多少虫；下一波第几波、多少只、倒计时；"下一波"按钮，
 *            提前叫按剩余秒数给晶矿，上一波刚来时要等几秒才能再叫；下面一排 1× / 2× / 4× 游戏速度）→ 晶矿数 → 本局挣到的信用点 → （外面挂上来的）建造列表
 *   上方正中 每来一波闪一行"第 N 波来袭"；刚突破里程碑的话下面再加一行"突破第 N 波 · 信用点 +M"，Boss 波再加一行"首领出现"；
 *            场上有 Boss 时下方正中常驻一条 Boss 血条（放上面会挡住刚走进画面的 Boss）
 *   无尽模式 波次面板不写总波数，多一行当前虫群强化（血量倍率、防御）；结算写坚持到第几波、最佳纪录
 *   暂停     局内按 Esc（没在放建筑、没选中东西时）弹：继续游戏 / 重新开始 / 返回主界面，再按 Esc 也是继续
 *   结算     核心碎了（失败）或者打完最后一波（通关）之后弹：用时、波次、本局信用点（通关再加首通奖励）；
 *            重新开始 / 返回主界面
 *
 * 核心血条画在战场里核心的正下方，不在这儿。只管显示，每帧从 state() 读数；样式在 style.ts 的
 * .pdw-hud、.pdw-wave、.pdw-banner、.pdw-over。
 */

/** 核心碎了多久之后弹结算（等爆炸演完）。 */
const OVER_DELAY = 1.6;
/** "第 N 波来袭"停留多久。 */
const BANNER_TIME = 2.2;

const CREDIT_ICON =
  '<svg viewBox="0 0 16 16"><path d="M8 1l6 3.5v7L8 15l-6-3.5v-7z" fill="currentColor"/><path d="M8 5l3 1.75v3.5L8 12l-3-1.75v-3.5z" fill="#07090f" opacity=".45"/></svg>';
const CRYSTAL_ICON =
  '<svg viewBox="0 0 16 16"><path d="M8 1l5 5-5 9-5-9z" fill="currentColor"/><path d="M8 1l2 5-2 9z" fill="#fff" opacity=".35"/></svg>';

export interface HudActions {
  restart(): void;
  quit(): void;
  /** 提前叫下一波。 */
  nextWave(): void;
  /** 暂停界面上点"继续游戏"。 */
  resume(): void;
  /** 换游戏速度（1 / 2 / 4）。 */
  setSpeed(speed: number): void;
}

const clock = (sec: number): string => {
  const t = Math.max(0, Math.ceil(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** 改一个节点的文字：没变就不碰 DOM（不打断按钮的悬停 / 按下）。 */
const setText = (el: Element, text: string): void => {
  if (el.textContent !== text) el.textContent = text;
};

export class Hud {
  private readonly bar = document.createElement('div');
  private readonly over = document.createElement('div');
  private readonly pause = document.createElement('div');
  private readonly banner = document.createElement('div');
  private readonly bossBar = document.createElement('div');
  private shownBoss = '';
  private readonly crystalText: HTMLElement;
  private readonly creditText: HTMLElement;
  private shownCredits = -1;
  private readonly waveEl: HTMLElement;
  private shownCrystals = -1;
  private shownWave = 0;
  private bannerT = 0;
  private overShown = false;
  /** 这一局的首通奖励（通关时外面填进来，结算里加到信用点上）。 */
  clearReward = 0;
  /** 无尽模式结束时外面填进来：最佳纪录、这次是不是破了纪录。 */
  endlessRecord: { best: number; isNew: boolean } | null = null;

  constructor(host: HTMLElement, actions: HudActions) {
    this.bar.className = 'pdw-hud hidden';
    this.bar.innerHTML = `
      <div class="pdw-wave">
        <div class="pdw-wave-now"><b data-f="now"></b><em data-f="left"></em></div>
        <div class="pdw-wave-next">
          <span data-f="next"></span>
          <b data-f="time"></b>
        </div>
        <div class="pdw-wave-buff" data-f="buff"></div>
        <div class="pdw-wave-bar"><i data-f="bar"></i></div>
        <button class="pdw-btn pdw-wave-call" data-act="next"><span data-f="call">下一波</span><em>${CRYSTAL_ICON}<i data-f="bonus"></i></em></button>
        <div class="pdw-speed">${[1, 2, 4].map((n) => `<button class="pdw-btn" data-speed="${n}">${n}×</button>`).join('')}</div>
      </div>
      <div class="pdw-crystal">${CRYSTAL_ICON}<b></b><em>晶矿</em></div>
      <div class="pdw-crystal pdw-credit">${CREDIT_ICON}<b></b><em>信用点</em></div>`;
    this.crystalText = this.bar.querySelector('.pdw-crystal b')!;
    this.creditText = this.bar.querySelector('.pdw-credit b')!;
    this.waveEl = this.bar.querySelector('.pdw-wave')!;
    this.bar.querySelector('[data-act=next]')!.addEventListener('click', () => actions.nextWave());
    this.bar.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.addEventListener('click', () => actions.setSpeed(Number(b.dataset.speed))));
    this.bar.querySelector('.pdw-wave')!.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.banner.className = 'pdw-banner hidden';
    this.bossBar.className = 'pdw-bossbar hidden';
    this.bossBar.innerHTML = '<div class="pdw-bossbar-head"><small>BOSS</small><b data-f="name"></b><em data-f="hp"></em></div><div class="pdw-bossbar-track"><i data-f="fill"></i></div>';

    this.over.className = 'pdw-over hidden';
    this.over.innerHTML = `
      <div class="pdw-over-panel">
        <small data-k="tag"></small>
        <h2 data-k="title"></h2>
        <div class="pdw-over-stats">
          <div><span data-k="timeLabel"></span><b data-k="time"></b></div>
          <div><span data-k="waveLabel"></span><b data-k="wave"></b></div>
          <div><span>获得信用点</span><b data-k="credits"></b></div>
        </div>
        <div class="pdw-over-actions">
          <button class="pdw-btn ghost" data-act="quit"><span>返回主界面</span></button>
          <button class="pdw-btn" data-act="restart"><span>重新开始</span></button>
        </div>
      </div>`;
    this.over.querySelector('[data-act=restart]')!.addEventListener('click', () => actions.restart());
    this.over.querySelector('[data-act=quit]')!.addEventListener('click', () => actions.quit());

    this.pause.className = 'pdw-over pdw-pause hidden';
    this.pause.innerHTML = `
      <div class="pdw-over-panel">
        <small>PAUSED</small>
        <h2>游戏暂停</h2>
        <div class="pdw-pause-actions">
          <button class="pdw-btn" data-act="resume"><span>继续游戏</span></button>
          <button class="pdw-btn ghost" data-act="restart"><span>重新开始</span></button>
          <button class="pdw-btn ghost" data-act="quit"><span>返回主界面</span></button>
        </div>
        <p class="pdw-pause-tip">按 Esc 继续</p>
      </div>`;
    this.pause.querySelector('[data-act=resume]')!.addEventListener('click', () => actions.resume());
    this.pause.querySelector('[data-act=restart]')!.addEventListener('click', () => actions.restart());
    this.pause.querySelector('[data-act=quit]')!.addEventListener('click', () => actions.quit());

    host.appendChild(this.bar);
    host.appendChild(this.banner);
    host.appendChild(this.bossBar);
    host.appendChild(this.over);
    host.appendChild(this.pause);
  }

  /** 结算面板弹出来了没有（弹了就不能再暂停）。 */
  get isOver(): boolean {
    return this.overShown;
  }

  /** 显示 / 收起暂停界面。 */
  setPaused(on: boolean): void {
    this.pause.classList.toggle('hidden', !on);
  }

  /** 把别的面板（建造列表）挂在晶矿下面。 */
  attach(el: HTMLElement): void {
    this.bar.appendChild(el);
  }

  show(): void {
    this.bar.classList.remove('hidden');
    this.over.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.banner.classList.add('hidden');
    this.overShown = false;
    this.clearReward = 0;
    this.endlessRecord = null;
    this.bossBar.classList.add('hidden');
    this.shownBoss = '';
    this.shownCrystals = -1;
    this.shownCredits = -1;
    this.shownWave = 0;
    this.bannerT = 0;
  }

  hide(): void {
    this.bar.classList.add('hidden');
    this.over.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.banner.classList.add('hidden');
    this.bossBar.classList.add('hidden');
    this.overShown = false;
  }

  update(st: BattleState | null, dt = 0): void {
    if (!st) return;
    // 数字没变就不碰 DOM。
    if (st.crystals !== this.shownCrystals) {
      this.shownCrystals = st.crystals;
      this.crystalText.textContent = st.crystals.toLocaleString();
    }
    if (st.credits !== this.shownCredits) {
      // 涨了就闪一下。
      if (this.shownCredits >= 0) {
        this.creditText.parentElement!.classList.remove('gain');
        void this.creditText.offsetWidth;
        this.creditText.parentElement!.classList.add('gain');
      }
      this.shownCredits = st.credits;
      this.creditText.textContent = `+${st.credits.toLocaleString()}`;
    }
    this.updateWave(st);
    // 新的一波来了：上方正中闪一行。
    if (st.wave.current > this.shownWave) {
      this.shownWave = st.wave.current;
      const m = st.milestone;
      const bonus = m && m.wave === st.wave.current - 1 ? `<em>${CREDIT_ICON}突破第 ${m.wave} 波 · 信用点 +${m.amount}</em>` : '';
      const last = st.wave.current === st.wave.total;
      const boss = st.bossWave === st.wave.current ? `<em class="boss">首领出现 · 小心重甲</em>` : '';
      this.banner.innerHTML = `<small>${last ? 'FINAL WAVE' : `WAVE ${st.wave.current}`}</small><b>${last ? '最终波来袭' : `第 ${st.wave.current} 波来袭`}</b>${bonus}${boss}`;
      this.banner.classList.remove('hidden');
      // 重播动画：去掉再加回 class。
      this.banner.classList.remove('show');
      void this.banner.offsetWidth;
      this.banner.classList.add('show');
      this.bannerT = BANNER_TIME;
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.add('hidden');
    }
    this.updateBoss(st);
    const lost = st.lost && st.lostT >= OVER_DELAY;
    const won = st.won && st.wonT >= OVER_DELAY;
    if ((lost || won) && !this.overShown) {
      this.overShown = true;
      const t = Math.floor(st.time);
      const k = (key: string, text: string): void => {
        this.over.querySelector(`[data-k=${key}]`)!.textContent = text;
      };
      this.over.classList.toggle('win', won);
      k('tag', st.endless ? 'ENDLESS MODE' : won ? 'MISSION COMPLETE' : 'MISSION FAILED');
      k('title', st.endless ? '防线最终失守' : won ? '防线守住了' : '核心被摧毁');
      k('timeLabel', won ? '用时' : '坚守时间');
      k('time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
      k('waveLabel', won ? '击退' : '坚持到');
      const rec = this.endlessRecord;
      k(
        'wave',
        st.endless
          ? `第 ${st.wave.current} 波${rec ? (rec.isNew ? ' · 新纪录！' : ` · 最佳 ${rec.best}`) : ''}`
          : won
            ? `${st.wave.total} 波`
            : `第 ${st.wave.current}/${st.wave.total} 波`,
      );
      k('credits', `+${(st.credits + (won ? this.clearReward : 0)).toLocaleString()}`);
      this.over.classList.remove('hidden');
    }
  }

  /** 下方的 Boss 血条：场上有 Boss 就显示血最多的那只。 */
  private updateBoss(st: BattleState): void {
    const b = st.lost || st.won ? null : st.boss;
    this.bossBar.classList.toggle('hidden', !b);
    if (!b) return;
    const pct = Math.max(0, Math.min(1, b.hp / b.max));
    const key = `${b.name}|${Math.ceil(pct * 200)}`;
    if (key === this.shownBoss) return;
    this.shownBoss = key;
    setText(this.bossBar.querySelector('[data-f=name]')!, b.name);
    setText(this.bossBar.querySelector('[data-f=hp]')!, `${Math.ceil(pct * 100)}%`);
    (this.bossBar.querySelector('[data-f=fill]') as HTMLElement).style.width = `${pct * 100}%`;
  }

  /** 波次面板：没开始（引导中）整块藏起来；第一波来之前写"准备时间"。 */
  private updateWave(st: BattleState): void {
    const w = st.wave;
    this.waveEl.classList.toggle('hidden', !w.started);
    if (!w.started) return;
    const q = (f: string): Element => this.waveEl.querySelector(`[data-f=${f}]`)!;
    // 无尽模式 total = 0：没有最后一波。
    const last = !st.endless && w.current >= w.total;
    setText(q('now'), w.current === 0 ? '准备中' : st.endless ? `第 ${w.current} 波 · 无尽` : `第 ${w.current}/${w.total} 波`);
    const buff = q('buff') as HTMLElement;
    buff.classList.toggle('hidden', st.buff.hp <= 1);
    setText(buff, `虫群强化 · 血量 ×${st.buff.hp.toFixed(1)} · 防御 ${st.buff.armor.toFixed(2)}`);
    setText(q('left'), w.current === 0 ? '' : `剩余 ${w.left}`);
    setText(q('next'), last ? '最终波 · 清光虫群即通关' : `下一波 · ${w.nextSize} 只`);
    setText(q('time'), last ? '' : clock(w.nextIn));
    (q('bar') as HTMLElement).style.width = `${last ? 0 : Math.max(0, Math.min(1, w.nextIn / w.timer)) * 100}%`;
    setText(q('bonus'), `+${w.bonus}`);
    const btn = this.waveEl.querySelector('button') as HTMLButtonElement;
    // 上一波刚来（或还没刷完）时要等一会儿才能再叫，按钮上倒数。
    setText(q('call'), !last && w.lock > 0 ? `下一波 ${Math.ceil(w.lock)}s` : '下一波');
    const off = st.lost || st.won || last || w.lock > 0;
    if (btn.disabled !== off) btn.disabled = off;
    this.waveEl.classList.toggle('soon', !last && w.nextIn <= 5);
    // 游戏速度：当前档位高亮。
    this.waveEl.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === st.speed));
  }
}
