import type { Application } from 'pixi.js';
import { BUG_LOOKS, type BugKind, drawBug } from '../game/bugs';
import { field, useField } from '../game/fields';
import { ARM, CROSS_C } from '../game/crossmap';
import { LANE_CX, drawFloor } from '../game/floor';
import { LINE_Y } from '../game/scene';
import { Projection } from '../render/projection';
import { Projector } from '../render/projector';
import { Snapshotter } from '../render/snapshot';
import { save } from '../save';
import { ACHIEVEMENTS, MAPS, type MapInfo, SHOP_ITEMS, isLocked, mapStats, unlockText } from './data';
import { shopIcon } from './shopIcons';
import { MENU_CSS } from './style';

/**
 * 主界面：一层盖在舞台上的 DOM。主界面期间战场不存在、也不更新，点"开始游戏"才开一局。
 *
 *   左   地图列表（新兵训练场的引导走完之前，其余地图锁着）
 *   右   选中地图的详情：地图画面、简介、敌情图鉴、开始游戏
 *   顶   信用点（存档里的）、商城、成就
 *
 * 界面按 1280×720 排版，再整体缩放到舞台大小 —— 舞台是 16:9，所以任何尺寸下排版都一样。
 *
 * 地图预览（只画地图本身，不画单位）和敌人图标都由 Snapshotter 用游戏自己的绘制代码画出来。
 * 商城和成就只有样子。
 */

export interface MenuOptions {
  onStart: (map: MapInfo) => void;
}

const PREVIEW_W = 640;
const PREVIEW_H = 360;
const ICON_W = 56;
const ICON_H = 46;
/** 排版用的设计尺寸。 */
const DESIGN_W = 1280;
const ICON_INTERVAL = 0.08;

const ICONS = {
  shop: '<svg viewBox="0 0 16 16"><path d="M1 2h2l2 8h8l2-6H4.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="5" y="12" width="2" height="2" fill="currentColor"/><rect x="11" y="12" width="2" height="2" fill="currentColor"/></svg>',
  trophy:
    '<svg viewBox="0 0 16 16"><path d="M4 1h8v5a4 4 0 0 1-8 0zM4 3H1v2a3 3 0 0 0 3 3M12 3h3v2a3 3 0 0 1-3 3M8 10v3M5 15h6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M4 2l10 6-10 6z" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 16 16"><path d="M4 7V5a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="2" y="7" width="12" height="8" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2.5"/></svg>',
  credit: '<svg viewBox="0 0 16 16"><path d="M8 1l6 3.5v7L8 15l-6-3.5v-7z" fill="currentColor"/><path d="M8 5l3 1.75v3.5L8 12l-3-1.75v-3.5z" fill="#07090f" opacity=".45"/></svg>',
  emblem:
    '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" fill="#2c4a8a"/><path d="M8 18c4-2 12-2 16 0" stroke="#7fa6ff" stroke-width="2" fill="none"/><ellipse cx="16" cy="16" rx="15" ry="5" transform="rotate(-20 16 16)" fill="none" stroke="#f0963a" stroke-width="2"/><rect x="21" y="6" width="4" height="4" fill="#f0963a"/></svg>',
};

/** 没指着任何敌人时，情报栏里的提示语。 */
const INTEL_IDLE = '将鼠标移到敌人卡片上查看情报。';

const pips = (n: number, max = 5): string => Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');

export class MainMenu {
  private readonly root = document.createElement('div');
  private readonly snap: Snapshotter;
  private selected: MapInfo = MAPS[0];
  private hoverEnemy: BugKind | null = null;
  private visible = true;
  private iconAcc = 0;
  private iconTime = 0;
  /** 每张能玩的地图一张预览图（开界面时画好）。 */
  private readonly previews = new Map<string, HTMLCanvasElement>();
  private readonly thumbs = new Map<string, HTMLCanvasElement>();
  private readonly enemyCanvases = new Map<BugKind, HTMLCanvasElement>();
  private modal: HTMLElement | null = null;

  constructor(
    app: Application,
    host: HTMLElement,
    private readonly opts: MenuOptions,
  ) {
    this.snap = new Snapshotter(app);
    const style = document.createElement('style');
    style.textContent = MENU_CSS;
    document.head.appendChild(style);

    this.root.className = 'pdw-menu';
    this.root.innerHTML = this.shell();
    host.appendChild(this.root);
    const fit = (): void => this.root.style.setProperty('--k', String(host.clientWidth / DESIGN_W));
    new ResizeObserver(fit).observe(host);
    fit();

    this.root.querySelector('[data-act=shop]')!.addEventListener('click', () => this.openModal('shop'));
    this.root.querySelector('[data-act=ach]')!.addEventListener('click', () => this.openModal('ach'));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal) this.closeModal();
    });

    this.refresh();
    this.drawMaps();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.root.classList.remove('hidden');
    this.refresh();
  }

  /** 存档变了（信用点、引导进度）就重画一遍：顶上的信用点、地图的锁。 */
  private refresh(): void {
    this.root.querySelector('[data-credits]')!.textContent = save.credits.toLocaleString();
    this.root.querySelector('[data-sectors]')!.textContent = `SECTORS · ${MAPS.filter((m) => !isLocked(m)).length}/${MAPS.length}`;
    this.renderList();
    this.renderDetail();
  }

  hide(): void {
    this.visible = false;
    this.closeModal();
    this.root.classList.add('hidden');
  }

  /** 主循环每帧调一次：悬停中的敌人图标动起来。 */
  update(dt: number): void {
    if (!this.visible) return;
    this.iconTime += dt;
    this.iconAcc += dt;
    if (this.hoverEnemy && this.iconAcc >= ICON_INTERVAL) {
      this.iconAcc = 0;
      this.drawEnemy(this.hoverEnemy, this.iconTime);
    }
  }

  // ------------------------------------------------------------ 结构

  private shell(): string {
    return `
      <div class="pdw-vignette"></div>
      <header class="pdw-top">
        <div class="pdw-brand">
          <span class="pdw-emblem">${ICONS.emblem}</span>
          <div>
            <h1>行星防卫战</h1>
            <small>PLANETARY DEFENSE WAR</small>
          </div>
        </div>
        <div class="pdw-res">
          <span class="pdw-chip gold">${ICONS.credit}<b data-credits>${save.credits.toLocaleString()}</b><em>信用点</em></span>
        </div>
        <nav class="pdw-nav">
          <button class="pdw-btn ghost" data-act="shop">${ICONS.shop}<span>商城</span></button>
          <button class="pdw-btn ghost" data-act="ach">${ICONS.trophy}<span>成就</span><i class="pdw-badge">2</i></button>
        </nav>
      </header>
      <main class="pdw-body">
        <section class="pdw-panel pdw-maps">
          <div class="pdw-head"><h2>作战区域</h2><span data-sectors></span></div>
          <ul class="pdw-list"></ul>
          <div class="pdw-list-foot">更多战区将在后续版本开放</div>
        </section>
        <section class="pdw-panel pdw-detail"></section>
      </main>
      <footer class="pdw-foot"><span>v0.1.0 · 原型</span><span>滚轮缩放 · 左键拖动平移</span></footer>
    `;
  }

  private renderList(): void {
    const list = this.root.querySelector('.pdw-list')!;
    list.innerHTML = '';
    for (const m of MAPS) {
      const li = document.createElement('li');
      const locked = isLocked(m);
      li.className = `pdw-map${locked ? ' locked' : ''}${m === this.selected ? ' active' : ''}`;
      li.innerHTML = `
        <div class="pdw-thumb">${locked ? `<span class="pdw-lock">${ICONS.lock}</span>` : ''}</div>
        <div class="pdw-map-text">
          <div class="pdw-map-row"><span class="pdw-idx">${m.index}</span><b>${m.name}</b></div>
          <small>${m.code}</small>
          <div class="pdw-map-row sub">
            ${locked ? `<span class="pdw-status locked">${unlockText(m)}</span>` : save.isCleared(m.id) ? '<span class="pdw-status ok">已通关</span>' : '<span class="pdw-status ok">可部署</span>'}
            <span class="pdw-pips sm">${pips(m.difficulty)}</span>
          </div>
        </div>`;
      const thumb = li.querySelector('.pdw-thumb')!;
      if (!locked) thumb.prepend(this.thumb(m));
      li.addEventListener('click', () => {
        if (this.selected === m) return;
        this.selected = m;
        this.renderList();
        this.renderDetail();
      });
      list.appendChild(li);
    }
  }

  private renderDetail(): void {
    const m = this.selected;
    const el = this.root.querySelector('.pdw-detail')!;
    if (isLocked(m)) {
      el.innerHTML = `
        <div class="pdw-head"><h2>${m.index} · ${m.name}</h2><span>${m.code}</span></div>
        <div class="pdw-preview offline">
          <div class="pdw-noise"></div>
          <div class="pdw-offline">${ICONS.lock}<b>信号丢失</b><small>${unlockText(m)}</small></div>
          <span class="pdw-corner tl"></span><span class="pdw-corner tr"></span><span class="pdw-corner bl"></span><span class="pdw-corner br"></span>
        </div>
        <div class="pdw-locked-info">
          <p>该战区的侦察数据尚未解密。</p>
          <div class="pdw-kv"><span>预估难度</span><span class="pdw-pips">${pips(m.difficulty)}</span></div>
        </div>
        <div class="pdw-actions"><button class="pdw-btn start" disabled>${ICONS.lock}<span>未解锁</span></button></div>`;
      return;
    }

    el.innerHTML = `
      <div class="pdw-head"><h2>${m.index} · ${m.name}</h2><span>${m.code}</span></div>
      <div class="pdw-detail-grid">
        <div class="pdw-col">
          <div class="pdw-preview">
            <span class="pdw-corner tl"></span><span class="pdw-corner tr"></span><span class="pdw-corner bl"></span><span class="pdw-corner br"></span>
            <span class="pdw-live"><i></i>侦察影像</span>
            <span class="pdw-coord">SEC-${m.index} · 防线 Y${LINE_Y}</span>
          </div>
          <p class="pdw-desc">${m.desc}</p>
          <div class="pdw-stats">
            <div class="pdw-stat"><span>难度</span><b class="pdw-pips">${pips(m.difficulty)}</b></div>
            ${mapStats(m).map((s) => `<div class="pdw-stat"><span>${s.label}</span><b>${s.value}</b></div>`).join('')}
          </div>
        </div>
        <div class="pdw-col pdw-scroll">
          <div class="pdw-sub"><h3>敌情侦测</h3><span>${m.enemies.length} 种已识别</span></div>
          <div class="pdw-enemies">
            ${m.enemies
              .map(
                (e) => `
              <div class="pdw-enemy" data-kind="${e.kind}" tabindex="0">
                <div class="pdw-enemy-icon"></div>
                <div class="pdw-enemy-text">
                  <b>${e.name}</b>
                  <small>${e.tag}</small>
                  <span class="pdw-threat">${pips(e.threat)}</span>
                </div>
              </div>`,
              )
              .join('')}
          </div>
          <div class="pdw-intel">${INTEL_IDLE}</div>
        </div>
      </div>
      <div class="pdw-actions">
        <button class="pdw-btn start" data-act="start">${ICONS.play}<span>开始游戏</span></button>
      </div>`;

    const preview = this.previews.get(m.id);
    if (preview) el.querySelector('.pdw-preview')!.prepend(preview);
    el.querySelector('[data-act=start]')!.addEventListener('click', () => this.opts.onStart(m));

    const intel = el.querySelector('.pdw-intel')!;
    for (const card of el.querySelectorAll<HTMLElement>('.pdw-enemy')) {
      const kind = card.dataset.kind as BugKind;
      const info = m.enemies.find((e) => e.kind === kind)!;
      card.querySelector('.pdw-enemy-icon')!.appendChild(this.enemyCanvas(kind));
      const enter = (): void => {
        this.hoverEnemy = kind;
        intel.textContent = `${info.name}：${info.note}`;
        el.querySelectorAll('.pdw-enemy').forEach((c) => c.classList.toggle('active', c === card));
      };
      // 移开就复位：取消高亮、情报栏回到提示语、图标回到静止的那一帧。
      const leave = (): void => {
        if (this.hoverEnemy === kind) this.hoverEnemy = null;
        card.classList.remove('active');
        if (!el.querySelector('.pdw-enemy.active')) intel.textContent = INTEL_IDLE;
        this.drawEnemy(kind, 1.3);
      };
      card.addEventListener('pointerenter', enter);
      card.addEventListener('focus', enter);
      card.addEventListener('pointerleave', leave);
      card.addEventListener('blur', leave);
    }
  }

  // ------------------------------------------------------------ 画面

  /**
   * 地图预览：只画地图（平台和虚空），和游戏默认取景同一个框法。地图是静态的，开界面时画一次，
   * 同时缩一份给列表当缩略图。
   */
  private drawMaps(): void {
    const keep = field().id;
    const cam = this.snap.camera(PREVIEW_W, PREVIEW_H);
    const y0 = 175;
    const y1 = LINE_Y + 265;
    const lift = (20 * Projection.heightSquash) / Projection.groundSquash;
    cam.grain = cam.grainToFit(700, y1 - y0 + lift, 4);
    cam.x = LANE_CX + 25;
    cam.y = (y0 + y1) / 2 - lift / 2;
    for (const m of MAPS) {
      if (m.locked) continue;
      // 地板画法和通道宽窄都读当前战场：临时切过去画，画完切回来。
      useField(m.field);
      // 十字高地：框住整个十字；别的图是从敌人压过来的地方看到后方核心。
      if (field().layout === 'cross') {
        cam.grain = cam.grainToFit(ARM * 2 + 40, ARM * 2 + 40, 4);
        cam.x = CROSS_C.x;
        cam.y = CROSS_C.y - 14;
      } else {
        cam.grain = cam.grainToFit(700, y1 - y0 + lift, 4);
        cam.x = LANE_CX + 25;
        cam.y = (y0 + y1) / 2 - lift / 2;
      }
      const src = this.snap.capture(cam, (layers, c) => drawFloor(layers.ground, c, 0));
      const big = document.createElement('canvas');
      big.width = PREVIEW_W;
      big.height = PREVIEW_H;
      const ctx = big.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0);
      this.previews.set(m.id, big);
      const t = this.thumb(m).getContext('2d')!;
      t.imageSmoothingEnabled = true;
      t.drawImage(src, 0, 0, PREVIEW_W / 5, PREVIEW_H / 5);
    }
    useField(keep);
    this.renderDetail();
  }

  /** 列表里的缩略图（锁着的图也先画好，解锁时直接用）。 */
  private thumb(m: MapInfo): HTMLCanvasElement {
    let c = this.thumbs.get(m.id);
    if (!c) {
      c = document.createElement('canvas');
      c.width = PREVIEW_W / 5;
      c.height = PREVIEW_H / 5;
      this.thumbs.set(m.id, c);
    }
    return c;
  }

  private enemyCanvas(kind: BugKind): HTMLCanvasElement {
    let c = this.enemyCanvases.get(kind);
    if (!c) {
      c = document.createElement('canvas');
      c.width = ICON_W;
      c.height = ICON_H;
      this.enemyCanvases.set(kind, c);
      this.drawEnemy(kind, 1.3);
    }
    return c;
  }

  /** 一只虫的图鉴图：透明底，飞虫抬离地面。time 往前走，腿就跟着迈。 */
  private drawEnemy(kind: BugKind, time: number): void {
    const out = this.enemyCanvases.get(kind);
    if (!out) return;
    const cam = this.snap.camera(ICON_W, ICON_H);
    cam.grain = kind === 'beetle' ? 1.35 : 1.7;
    cam.x = 0;
    cam.y = kind === 'serpent' ? -9 : -5;
    const lift = kind === 'flyer' ? 10 : 0;
    const src = this.snap.capture(cam, (layers, c) => {
      const p = new Projector(c.worldToScreenZ(0, 0, lift), Math.PI / 2, Projection.groundSquash, c.grain, 50);
      drawBug(layers.units, p, kind, BUG_LOOKS[kind][0], { phase: time * 1.6, dead: -1, airborne: false, emerge: 1, spit: 0 }, time);
    });
    const ctx = out.getContext('2d')!;
    ctx.clearRect(0, 0, ICON_W, ICON_H);
    ctx.drawImage(src, 0, 0);
  }

  // ------------------------------------------------------------ 商城 / 成就（只有样子）

  private openModal(which: 'shop' | 'ach'): void {
    this.closeModal();
    const m = document.createElement('div');
    m.className = 'pdw-modal';
    const body =
      which === 'shop'
        ? `<div class="pdw-shop">${SHOP_ITEMS.map(
            (it) => `
            <div class="pdw-item">
              <span class="pdw-tag">${it.tag}</span>
              <div class="pdw-item-art"></div>
              <b>${it.name}</b>
              <small>${it.desc}</small>
              <button class="pdw-btn buy" disabled>${ICONS.credit}<span>${it.price.toLocaleString()}</span></button>
            </div>`,
          ).join('')}</div>`
        : `<div class="pdw-ach">${ACHIEVEMENTS.map((a) => {
            const done = a.progress >= a.goal;
            const pct = Math.min(100, (a.progress / a.goal) * 100);
            return `
            <div class="pdw-ach-row${done ? ' done' : ''}">
              <span class="pdw-ach-icon">${ICONS.trophy}</span>
              <div class="pdw-ach-text">
                <b>${a.name}</b><small>${a.desc}</small>
                <div class="pdw-bar"><i style="width:${pct}%"></i></div>
              </div>
              <span class="pdw-ach-num">${done ? '已达成' : `${a.progress.toLocaleString()} / ${a.goal.toLocaleString()}`}</span>
            </div>`;
          }).join('')}</div>`;
    m.innerHTML = `
      <div class="pdw-panel pdw-dialog">
        <div class="pdw-head">
          <h2>${which === 'shop' ? '军需商城' : '战功成就'}</h2>
          <span>${which === 'shop' ? 'ARMORY · 暂未开放' : `ACHIEVEMENTS · ${ACHIEVEMENTS.filter((a) => a.progress >= a.goal).length}/${ACHIEVEMENTS.length}`}</span>
          <button class="pdw-x" aria-label="关闭">${ICONS.close}</button>
        </div>
        ${body}
      </div>`;
    m.addEventListener('click', (e) => {
      if (e.target === m) this.closeModal();
    });
    m.querySelector('.pdw-x')!.addEventListener('click', () => this.closeModal());
    // 商城：每件商品的图标用游戏模型现画。
    if (which === 'shop') {
      m.querySelectorAll('.pdw-item-art').forEach((art, i) => art.appendChild(shopIcon(this.snap, SHOP_ITEMS[i].icon)));
    }
    this.root.appendChild(m);
    this.modal = m;
  }

  private closeModal(): void {
    this.modal?.remove();
    this.modal = null;
  }
}
