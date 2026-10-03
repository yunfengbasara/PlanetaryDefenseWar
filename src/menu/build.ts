import type { Application } from 'pixi.js';
import { v2 } from '../core/math';
import { AIRSTRIKE_COST, BUILDS, BUILD_ORDER, CRUISER_COST, CRUISER_ID, type BuildKind, type StatKey, airstrikeMesh, buildingMesh, cruiserMesh } from '../game/buildings';
import type { BattleState, DefenseHandle } from '../game/main';
import { drawMesh, drawShadow } from '../mesh/mesh';
import type { Mesh3 } from '../mesh/mesh';
import { Projection } from '../render/projection';
import { Snapshotter } from '../render/snapshot';

/**
 * 建造模式的两块界面：
 *
 *   BuildPanel   右上角晶矿下面一列：兵营、机器人车间、坦克、火炮、巨舰、轰炸支援。缩略图用游戏自己的
 *                模型现画。建筑点一下进入放置模式（再点一下取消）；巨舰一局买一次（买了显示"已部署"）；
 *                数字键 1~6 是快捷键。钱不够的项变暗。
 *   UpgradeTip   点了地图上的建筑后，在它头顶弹出的小面板：产量、每条升级线（数量 / 攻击力 / 射程 / 射速）
 *                的等级、当前 → 下一级的数值、升级按钮。面板跟着建筑走（镜头动了也对得上）。
 *                骨架只搭一次，之后每帧只改变了的文字 —— 整块重写会打断鼠标悬停，按钮会闪。
 *                面板半透明，而且除了按钮都让鼠标穿过去：隔着面板也能右键设集结点、点地面。
 *                底部"出售"要点两次（第一次变成"确认出售"）。
 */

const CRYSTAL =
  '<svg viewBox="0 0 16 16"><path d="M8 1l5 5-5 9-5-9z" fill="currentColor"/><path d="M8 1l2 5-2 9z" fill="#fff" opacity=".35"/></svg>';

type Item = BuildKind | 'cruiser' | 'airstrike';
const ITEMS: Item[] = [...BUILD_ORDER, 'cruiser', 'airstrike'];

const ITEM_NAME: Record<'cruiser' | 'airstrike', string> = { cruiser: '巨舰', airstrike: '轰炸支援' };
const ITEM_DESC: Record<'cruiser' | 'airstrike', string> = {
  cruiser: '战列巡航舰：一局一艘，飞到战场旁边待命，隔一阵开一发主炮',
  airstrike: '花晶矿叫一组炮艇，沿虫最多的地方投弹',
};
const itemCost = (item: Item): number => (item === 'airstrike' ? AIRSTRIKE_COST : item === 'cruiser' ? CRUISER_COST : BUILDS[item].cost);

const THUMB_W = 56;
/** 右上角那一列（波次面板、晶矿、建造列表）占多宽（CSS 像素）：升级面板别压上去。 */
const RIGHT_COLUMN = 236;
const THUMB_H = 44;

export class BuildPanel {
  readonly el = document.createElement('div');
  private readonly buttons = new Map<Item, HTMLButtonElement>();
  private visible = false;

  constructor(app: Application, private readonly game: DefenseHandle) {
    this.el.className = 'pdw-build hidden';
    const snap = new Snapshotter(app);
    ITEMS.forEach((item, i) => {
      const b = document.createElement('button');
      b.className = 'pdw-build-item';
      const special = item === 'airstrike' || item === 'cruiser';
      const name = special ? ITEM_NAME[item] : BUILDS[item].name;
      b.title = special ? ITEM_DESC[item] : BUILDS[item].desc;
      b.innerHTML = `<kbd>${i + 1}</kbd><div class="pdw-build-text"><b>${name}</b><span>${CRYSTAL}<i data-f="cost">${itemCost(item)}</i></span></div>`;
      b.prepend(thumb(snap, item));
      b.addEventListener('click', () => this.pick(item));
      this.buttons.set(item, b);
      this.el.appendChild(b);
    });
    snap.destroy();
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      const k = Number(e.key);
      if (k >= 1 && k <= ITEMS.length) this.pick(ITEMS[k - 1]);
    });
  }

  show(): void {
    this.visible = true;
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.visible = false;
    this.el.classList.add('hidden');
  }

  update(st: BattleState | null): void {
    if (!this.visible || !st?.build) return;
    for (const [item, b] of this.buttons) {
      const cost = itemCost(item);
      // 巨舰：这张图不能买就一直暗着；买过了就亮着（点它选中巨舰），价钱那里写"已部署"。
      const bought = item === 'cruiser' && st.build.cruiser === 'bought';
      const none = item === 'cruiser' && st.build.cruiser === 'none';
      b.classList.toggle('off', none || st.lost || (!bought && st.crystals < cost));
      b.classList.toggle('active', st.build.placing === item);
      if (item === 'cruiser') {
        const label = st.build.cruiser === 'bought' ? '已部署' : st.build.cruiser === 'none' ? '本战区不可用' : `${cost}`;
        const el = b.querySelector('[data-f=cost]')!;
        if (el.textContent !== label) el.textContent = label;
      }
    }
  }

  /** 某一项在舞台上的矩形（引导遮罩要把它亮出来）。 */
  itemRect(item: BuildKind, stage: HTMLElement): { x: number; y: number; w: number; h: number } {
    const r = this.buttons.get(item)!.getBoundingClientRect();
    const o = stage.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }

  /** 点了一项：建筑进入（或退出）放置模式；轰炸支援直接叫。 */
  private pick(item: Item): void {
    if (item === 'airstrike') {
      this.game.airstrike();
      return;
    }
    if (item === 'cruiser') {
      // 已经部署了：点这一项就选中巨舰（它常常在画面边上，不好点）。
      if (!this.game.buyCruiser()) this.game.selectById(CRUISER_ID);
      return;
    }
    if (this.buttons.get(item)!.classList.contains('active')) this.game.cancelPlace();
    else this.game.beginPlace(item);
  }
}

/** 一个建筑（或炮艇）的缩略图：透明底，模型居中，竖着高的东西往上挪一点。 */
function thumb(snap: Snapshotter, item: Item): HTMLCanvasElement {
  const grain = { barracks: 0.72, factory: 0.56, tank: 0.78, artillery: 1.2, cruiser: 0.62, airstrike: 0.85 }[item];
  const top = item === 'airstrike' || item === 'cruiser' ? 0 : BUILDS[item].top;
  const cam = snap.camera(THUMB_W, THUMB_H);
  cam.grain = grain;
  cam.x = 0;
  cam.y = -((top * Projection.heightSquash) / Projection.groundSquash) / 2;
  const mesh: Mesh3 = item === 'airstrike' ? airstrikeMesh() : item === 'cruiser' ? cruiserMesh() : buildingMesh(item, 0, 0, 0.6, 0);
  const src = snap.capture(cam, (layers, c) => {
    if (item !== 'airstrike' && item !== 'cruiser') drawShadow(layers.ground, c, mesh, 0, 9e5, 70);
    drawMesh(layers.units, c, mesh, v2(0, 0));
  });
  const out = document.createElement('canvas');
  out.width = THUMB_W;
  out.height = THUMB_H;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0);
  return out;
}

/** 一条升级线的数值怎么写：数量是个数，其余是倍率。 */
const fmt = (key: StatKey, v: number): string => (key === 'count' ? `${v}` : `×${v}`);

/** 改一个节点的文字 / 属性：没变就不碰 DOM（鼠标悬停、按下的状态才不会被打断）。 */
function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export class UpgradeTip {
  private readonly el = document.createElement('div');
  private id: number | null = null;
  /** 当前面板是给哪种建筑搭的（换了建筑才重搭结构）。 */
  private builtFor: string | null = null;
  /** 出售按钮第一次点下去的时间（2 秒内再点才真卖）。 */
  private sellArmed = 0;

  constructor(
    host: HTMLElement,
    private readonly game: DefenseHandle,
  ) {
    this.el.className = 'pdw-tip hidden';
    this.el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!btn) return;
      // 关闭只收起面板：建筑还选着（射程圈还在、照样能右键设集结点），再左键点一下别处才取消选中。
      if (btn.dataset.act === 'close') this.open(null);
      if (btn.dataset.act === 'up' && this.id !== null) this.game.upgrade(this.id, btn.dataset.k as StatKey);
      if (btn.dataset.act === 'sell' && this.id !== null) {
        if (performance.now() - this.sellArmed < 2000) this.game.sell(this.id);
        else this.sellArmed = performance.now();
      }
    });
    // 面板上的左键点击别漏到画布上（不然会被当成"点了空地"取消选中，点到满级的那一行面板就没了）。
    // 右键和滚轮转给画布：隔着面板照样能右键设集结点 / 挪巨舰、滚轮缩放。
    const canvas = (): HTMLCanvasElement | null => host.querySelector('canvas');
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button === 2) canvas()?.dispatchEvent(new PointerEvent('pointerdown', e));
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        canvas()?.dispatchEvent(new WheelEvent('wheel', e));
      },
      { passive: false },
    );
    host.appendChild(this.el);
  }

  open(id: number | null): void {
    if (id !== this.id) this.game.previewRange(false);
    this.id = id;
    this.el.classList.toggle('hidden', id === null);
  }

  /** 搭面板的骨架：标题、（出兵类）产量一行、每条升级线一行。只在换了建筑时搭一次。 */
  private build(id: number, kind: BuildKind): void {
    const d = BUILDS[kind];
    const prod = d.unit
      ? `<div class="pdw-tip-prod"><span>${d.unit}</span><b data-f="count"></b><em data-f="state"></em></div>
         <div class="pdw-tip-hint">右键点击地面设置集结点</div>`
      : kind === 'cruiser'
        ? '<div class="pdw-tip-hint">右键点击地面移动巨舰</div>'
        : '';
    const rows = d.stats
      .map(
        (st) => `
        <div class="pdw-tip-stat" data-k="${st.key}">
          <span class="pdw-tip-name">${st.name}</span>
          <span class="pdw-tip-lv" data-f="lv"></span>
          <span class="pdw-tip-val" data-f="val"></span>
          <button class="pdw-btn pdw-tip-up" data-act="up" data-k="${st.key}">${CRYSTAL}<span data-f="cost"></span></button>
          <span class="pdw-tip-max">满级</span>
        </div>`,
      )
      .join('');
    this.el.innerHTML = `
      <div class="pdw-tip-head"><b>${d.name}</b><button class="pdw-tip-x" data-act="close" aria-label="关闭">×</button></div>
      ${prod}
      <div class="pdw-tip-stats">${rows}</div>
      <div class="pdw-tip-foot"><button class="pdw-btn pdw-tip-sell" data-act="sell"><span data-f="sell"></span></button></div>`;
    this.sellArmed = 0;
    this.builtFor = `${id}`;
    // 鼠标停在"射程"那一行：地上预览升级后的射程。
    const range = this.el.querySelector('.pdw-tip-stat[data-k=range] button');
    if (range) {
      range.addEventListener('pointerenter', () => this.game.previewRange(true));
      range.addEventListener('pointerleave', () => this.game.previewRange(false));
    }
  }

  /** 每帧：跟着建筑挪位置；只改变了的文字和按钮状态。 */
  update(st: BattleState | null): void {
    if (this.id === null || !st) return;
    const s = this.game.structure(this.id);
    if (!s) {
      this.open(null);
      return;
    }
    if (this.builtFor !== `${s.id}`) this.build(s.id, s.kind);
    // 面板夹在舞台里，并且让开右边那一列（波次、晶矿、建造列表）：靠右的建筑和巨舰，面板往左挪。
    const host = this.el.parentElement!;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const right = host.clientWidth - RIGHT_COLUMN - 8;
    const x = Math.min(right - w / 2, Math.max(w / 2 + 8, s.anchorX));
    const y = Math.max(h + 8, Math.min(host.clientHeight - 8, s.anchorY));
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
    const count = this.el.querySelector('[data-f=count]');
    if (count) {
      setText(count, `${s.count} / ${s.cap}`);
      const state = this.el.querySelector('[data-f=state]')!;
      const full = s.count >= s.cap;
      setText(state, full ? '已满' : s.blocked ? '防线站满' : `生产中 ${Math.floor(s.prog * 100)}%`);
      state.className = full ? 'ok' : s.blocked ? 'warn' : '';
    }
    // 巨舰不能卖（refund < 0）：整行藏起来。
    (this.el.querySelector('.pdw-tip-foot') as HTMLElement).style.display = s.refund < 0 ? 'none' : '';
    const armed = performance.now() - this.sellArmed < 2000;
    setText(this.el.querySelector('[data-f=sell]')!, armed ? `确认出售？+${s.refund}` : `出售 +${s.refund}`);
    this.el.querySelector('.pdw-tip-sell')!.classList.toggle('armed', armed);
    for (const info of s.stats) {
      const row = this.el.querySelector(`.pdw-tip-stat[data-k=${info.key}]`)!;
      setText(row.querySelector('[data-f=lv]')!, `Lv${info.level}`);
      setText(row.querySelector('[data-f=val]')!, info.next === null ? fmt(info.key, info.value) : `${fmt(info.key, info.value)} → ${fmt(info.key, info.next)}`);
      row.classList.toggle('max', info.cost === null);
      if (info.cost !== null) {
        setText(row.querySelector('[data-f=cost]')!, `${info.cost}`);
        const btn = row.querySelector('button') as HTMLButtonElement;
        const off = st.crystals < info.cost;
        if (btn.disabled !== off) btn.disabled = off;
      }
    }
  }
}
