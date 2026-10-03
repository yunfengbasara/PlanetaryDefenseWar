import type { Application } from 'pixi.js';
import { v2 } from '../core/math';
import { Camera } from '../render/camera';
import { Projection } from '../render/projection';
import { Scene } from '../render/scene';
import { AIRSTRIKE_COST, BUILDS, CRUISER_ID, type BuildKind, type StatKey } from './buildings';
import { ARM, CROSS_C } from './crossmap';
import { field, useField } from './fields';
import { END_Y, LANE_CX, TOP_Y } from './floor';
import { BUILD_FRONT, CORE, DefenseScene, RALLY_MAX, type StructureInfo } from './scene';

/** 主界面拿来开关战场的把手。 */
export interface DefenseHandle {
  /** 在给定战场上开一局新的：建战场、镜头回到默认取景、开始跑。 */
  start(fieldId: string): void;
  /** 停下并藏起战场（回主界面）。 */
  stop(): void;
  /** 局内状态（HUD 用）；没在打就是 null。 */
  state(): BattleState | null;

  // ---- 建造模式 ----
  /** 进入放置模式：鼠标下出现 kind 的虚影，左键放下、右键 / Esc 取消。钱不够返回 false。 */
  beginPlace(kind: BuildKind): boolean;
  cancelPlace(): void;
  /** 叫一次轰炸支援。 */
  airstrike(): boolean;
  /** 买巨舰（一局一次）。 */
  buyCruiser(): boolean;
  /** 卖掉一座建筑（退 70% 总花费）。 */
  sell(id: number): boolean;
  /** 升级一座建筑的某条升级线。 */
  upgrade(id: number, stat: StatKey): boolean;
  /** 一座建筑的现状，外加它头顶在舞台上的位置（CSS 像素，弹出面板对准这里）。 */
  structure(id: number): (StructureInfo & { anchorX: number; anchorY: number }) | null;
  /** 取消选中。 */
  deselect(): void;
  /** 选中某座建筑（或者 CRUISER_ID = 巨舰）。 */
  selectById(id: number): void;
  /** 升级面板上鼠标停在"射程"那一行：在地上多画一圈升级后的射程。 */
  previewRange(on: boolean): void;
  /** 虫群开始进攻（引导走完 / 跳过）。 */
  startWaves(): void;
  /** 提前叫下一波：返回给的晶矿（叫不了是 -1）。 */
  nextWave(): number;
  /** 选中的建筑变了（点到建筑 / 点到空地）。 */
  onSelect(fn: (id: number | null) => void): void;
  /** 引导遮罩用：建造区在舞台上的矩形。CSS 像素。 */
  buildAreaRect(): CssRect | null;
  /** 某种出兵建筑（第一座）连同它整个集结点范围在舞台上的矩形。 */
  rallyAreaRect(kind: BuildKind): CssRect | null;
}

export interface CssRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BattleState {
  crystals: number;
  coreHp: number;
  coreMax: number;
  lost: boolean;
  /** 核心碎了多久（秒）。 */
  lostT: number;
  /** 这一局打了多久（秒）。 */
  time: number;
  /** 波次：当前第几波（0 = 还没开始）、离下一波几秒、下一波多少只、场上 + 排队的虫、提前叫能拿多少晶矿；虫群开始进攻了没有。 */
  wave: { current: number; nextIn: number; nextSize: number; left: number; bonus: number; started: boolean };
  /** 建造相关的状态（放置中、造了什么、巨舰、引导用的标记）。 */
  build: BuildState;
}

export interface BuildState {
  /** 虫群开始进攻了没有。 */
  waves: boolean;
  /** 正在放的建筑。 */
  placing: BuildKind | null;
  /** 每种建筑造了几座。 */
  built: Record<BuildKind, number>;
  /** 防线上的机枪兵（活着的）。 */
  marines: number;
  /** 巨舰：这张图能不能买、买了没有。 */
  cruiser: 'available' | 'bought' | 'none';
  /** 当前选中的建筑；rallyEver：玩家设过集结点（引导用）。 */
  selected: number | null;
  rallyEver: boolean;
}

/** 核心碎了以后战场再演多久（爆炸、碎片落地），然后定格。 */
const LOST_FREEZE = 2.5;
/** 按下到松开移动超过这么多 CSS 像素算拖动，否则算点击。 */
const CLICK_SLOP = 4;
/** 放置时坐标对齐到几个世界单位，虚影不会一像素一像素地抖。 */
const SNAP = 4;

/**
 * 阵地防守。镜头固定在防线后上方，往上看着敌人推过来；滚轮缩放、左键拖动平移。
 * 建造模式下：左键点空地放建筑（放置模式时）或者点选建筑（弹升级面板），右键 / Esc 取消放置；
 * 选中兵营 / 车间时右键地面设集结点；选中巨舰时右键让它慢慢开过去。
 *
 * 只在 start() 之后才有战场、才更新；主界面期间什么都不跑。
 */
export function bootDefense(app: Application): DefenseHandle {
  let battle: DefenseScene | null = null;
  const cam = new Camera();
  const scene = new Scene(app, cam);
  let userGrain = 0;
  let pan = v2(0, 0);
  let placing: BuildKind | null = null;
  let rallyEver = false;
  const selectHooks: ((id: number | null) => void)[] = [];

  /** 默认取景：横向装下平台和两侧一截虚空；纵向从敌人压过来的地方一直看到后方的核心。 */
  const home = (): { grain: number; x: number; y: number } => {
    // 十字高地：框住整个十字（核心在正中）。
    if (field().layout === 'cross') {
      const lift = (40 * Projection.heightSquash) / Projection.groundSquash;
      return { grain: cam.grainToFit(ARM * 2 + 40, ARM * 2 + lift, 4), x: CROSS_C.x, y: CROSS_C.y - lift / 2 };
    }
    const y0 = 175;
    const y1 = CORE.y + 62; // 一直看到后方的核心和它下面的血条、读数
    const lift = (20 * Projection.heightSquash) / Projection.groundSquash;
    return { grain: cam.grainToFit(700, y1 - y0 + lift, 4), x: LANE_CX + 25, y: (y0 + y1) / 2 - lift / 2 };
  };
  /**
   * 镜头能去的范围（世界坐标）：横向到地图最宽处再留一点边，但至少装得下默认取景（右边的巡航舰
   * 在默认取景里）；纵向从地图顶边到底边。镜头的可视范围必须落在这里面，比它大就居中。
   */
  const bounds = (): { l: number; r: number; t: number; b: number } => {
    if (field().layout === 'cross') return { l: CROSS_C.x - ARM - 40, r: CROSS_C.x + ARM + 40, t: CROSS_C.y - ARM - 40, b: CROSS_C.y + ARM + 40 };
    const h = home();
    const homeHalfW = cam.viewWidth / 2 / h.grain;
    const wide = field().wide;
    const edge = field().edge ?? 30;
    return {
      l: Math.min(LANE_CX - wide - edge, h.x - homeHalfW),
      r: Math.max(LANE_CX + wide + edge, h.x + homeHalfW),
      t: TOP_Y,
      b: END_Y + 20,
    };
  };
  /** 世界里一块地（可以带高度）在舞台上的外框，CSS 像素。 */
  const boxToCss = (x0: number, y0: number, x1: number, y1: number, top: number): CssRect => {
    const pts = [cam.worldToScreenZ(x0, y0, top), cam.worldToScreenZ(x1, y0, top), cam.worldToScreenZ(x0, y1, 0), cam.worldToScreenZ(x1, y1, 0)];
    const xs = pts.map((p) => scene.bufferToCss(p.x));
    const ys = pts.map((p) => scene.bufferToCss(p.y));
    const l = Math.min(...xs);
    const t = Math.min(...ys);
    return { x: l, y: t, w: Math.max(...xs) - l, h: Math.max(...ys) - t };
  };
  const clampAxis = (v: number, half: number, lo: number, hi: number): number => (hi - lo <= half * 2 ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, v)));

  const fit = (): void => {
    scene.resize();
    const h = home();
    cam.grain = h.grain;
    userGrain = h.grain;
  };
  scene.visible = false;
  // 画布跟着 16:9 的舞台走，舞台尺寸由 CSS 决定；Pixi 改完尺寸后的那一帧再重新取景。
  let seenW = 0;
  let seenH = 0;

  /** 鼠标事件 → 地面上的世界坐标。 */
  const toWorld = (e: PointerEvent): { x: number; y: number } => {
    const r = app.canvas.getBoundingClientRect();
    return cam.screenToWorld(scene.cssToBuffer(e.clientX - r.left), scene.cssToBuffer(e.clientY - r.top));
  };
  const select = (id: number | null): void => {
    if (!battle) return;
    battle.selected = id;
    for (const fn of selectHooks) fn(id);
  };
  /** 鼠标最后在地面上的哪儿（换了要放的建筑时，虚影立刻出现在这里，不用等鼠标动）。 */
  let pointer: { x: number; y: number } | null = null;
  const refreshGhost = (): void => {
    if (!battle || !placing || !pointer) return;
    const x = Math.round(pointer.x / SNAP) * SNAP;
    const y = Math.round(pointer.y / SNAP) * SNAP;
    battle.ghost = { kind: placing, x, y, valid: battle.placeable(placing, x, y) && battle.crystals >= BUILDS[placing].cost };
  };
  const updateGhost = (e: PointerEvent): void => {
    if (!battle) return;
    pointer = toWorld(e);
    refreshGhost();
  };
  const cancelPlace = (): void => {
    placing = null;
    if (battle) battle.ghost = null;
  };

  let press: { x: number; y: number; lastX: number; lastY: number; moved: boolean } | null = null;
  app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  app.canvas.addEventListener('pointerdown', (e) => {
    if (!battle) return;
    if (e.button === 2) {
      // 右键：放置模式下取消；选中了兵营 / 车间就把集结点设到这儿。
      if (placing) cancelPlace();
      else if (battle.selected === CRUISER_ID) battle.moveCruiser(toWorld(e).x, toWorld(e).y);
      else if (battle.selected !== null && battle.setRally(battle.selected, toWorld(e).x, toWorld(e).y)) rallyEver = true;
      return;
    }
    if (e.button !== 0) return;
    press = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
    app.canvas.setPointerCapture(e.pointerId);
  });
  app.canvas.addEventListener('pointermove', (e) => {
    updateGhost(e);
    if (!press) return;
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP) press.moved = true;
    if (!press.moved) return;
    const w = cam.screenDeltaToWorld(scene.cssToBuffer(e.clientX - press.lastX), scene.cssToBuffer(e.clientY - press.lastY));
    pan = v2(pan.x - w.x, pan.y - w.y);
    press.lastX = e.clientX;
    press.lastY = e.clientY;
  });
  app.canvas.addEventListener('pointerup', (e) => {
    const p = press;
    press = null;
    if (!battle || !p || p.moved) return;
    // 一次点击：放置模式下放建筑；否则点选建筑（点到空地就取消选中）。
    const w = toWorld(e);
    // 放置模式下点到已有的建筑：退出放置，改成选中它。
    const hitStruct = battle.structureAt(w.x, w.y);
    if (placing && hitStruct) {
      cancelPlace();
      select(hitStruct.id);
      return;
    }
    if (placing) {
      const x = Math.round(w.x / SNAP) * SNAP;
      const y = Math.round(w.y / SNAP) * SNAP;
      const s = battle.place(placing, x, y);
      if (s) {
        cancelPlace();
        select(s.id);
      }
      return;
    }
    // 没点到建筑：看看是不是点到了巨舰（它浮在战场旁边）。
    select(hitStruct?.id ?? (battle.cruiserAt(w.x, w.y) ? CRUISER_ID : null));
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && battle) {
      if (placing) cancelPlace();
      else select(null);
    }
  });
  app.canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      userGrain = Math.min(Camera.MAX_GRAIN, Math.max(home().grain * 0.8, userGrain * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    },
    { passive: false },
  );

  let last = performance.now();
  app.ticker.add(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!battle) return;
    if (app.screen.width !== seenW || app.screen.height !== seenH) {
      seenW = app.screen.width;
      seenH = app.screen.height;
      fit();
    }
    if (!(battle.lost && battle.lostT > LOST_FREEZE)) battle.update(dt);
    // 钱被花掉了（比如刚升级）：虚影跟着变红。
    if (battle.ghost && placing) battle.ghost.valid = battle.placeable(placing, battle.ghost.x, battle.ghost.y) && battle.crystals >= BUILDS[placing].cost;
    // 缩放和平移都直接到位，不做缓动：grain 每变一点，整块地板落在哪些像素上就全变一次，
    // 缓动的那半秒里画面会一格一格地爬、看着发抖。一步到位，每次滚轮只换一次像素网格。
    const h = home();
    cam.grain = userGrain;
    // 限位：拖到头就停住，pan 也跟着收回来，免得往回拖时要先"还掉"拖过头的那一截。
    const bd = bounds();
    cam.x = clampAxis(h.x + pan.x, cam.halfW, bd.l, bd.r);
    cam.y = clampAxis(h.y + pan.y, cam.halfH, bd.t, bd.b);
    pan = v2(cam.x - h.x, cam.y - h.y);
    const s = battle.shake;
    const b = battle;
    scene.draw((layers, c) => b.draw(layers, c), (Math.random() - 0.5) * s * 5, (Math.random() - 0.5) * s * 5);
  });

  return {
    start: (fieldId) => {
      useField(fieldId);
      battle = new DefenseScene();
      placing = null;
      rallyEver = false;
      pan = v2(0, 0);
      fit();
      const h = home();
      cam.x = h.x;
      cam.y = h.y;
      seenW = app.screen.width;
      seenH = app.screen.height;
      scene.visible = true;
    },
    stop: () => {
      battle = null;
      press = null;
      placing = null;
      scene.visible = false;
    },
    state: () => {
      if (!battle) return null;
      const b = battle;
      return {
        crystals: b.crystals,
        coreHp: b.coreHp,
        coreMax: b.coreMax,
        lost: b.lost,
        lostT: b.lostT,
        time: b.time,
        wave: { current: b.wave, nextIn: b.nextIn, nextSize: b.nextWaveSize, left: b.bugsLeft, bonus: b.earlyBonus, started: b.waves },
        build: {
          waves: b.waves,
          placing,
          built: {
            barracks: b.structures.filter((s) => s.kind === 'barracks').length,
            factory: b.structures.filter((s) => s.kind === 'factory').length,
            tank: b.structures.filter((s) => s.kind === 'tank').length,
            artillery: b.structures.filter((s) => s.kind === 'artillery').length,
            cruiser: b.cruiserBought ? 1 : 0,
          },
          marines: b.defenders.filter((d) => d.kind === 'rifle' && d.deadT < 0).length,
          cruiser: !b.field.cruiser ? 'none' : b.cruiserBought ? 'bought' : 'available',
          selected: b.selected,
          rallyEver,
        }
      };
    },
    beginPlace: (kind) => {
      if (!battle || battle.lost || battle.crystals < BUILDS[kind].cost) return false;
      placing = kind;
      select(null);
      refreshGhost();
      return true;
    },
    cancelPlace,
    airstrike: () => !!battle && battle.crystals >= AIRSTRIKE_COST && battle.callAirstrike(),
    buyCruiser: () => !!battle && battle.buyCruiser(),
    upgrade: (id, stat) => !!battle && battle.upgrade(id, stat),
    sell: (id) => {
      if (!battle?.sell(id)) return false;
      select(null);
      return true;
    },
    structure: (id) => {
      const info = battle?.structureInfo(id);
      if (!info) return null;
      const top = cam.worldToScreenZ(info.x, info.y - BUILDS[info.kind].h * 0.25, BUILDS[info.kind].top + 18);
      return { ...info, anchorX: scene.bufferToCss(top.x), anchorY: scene.bufferToCss(top.y) };
    },
    deselect: () => select(null),
    selectById: (id) => {
      if (battle?.structureInfo(id)) {
        cancelPlace();
        select(id);
      }
    },
    previewRange: (on) => {
      if (battle) battle.rangePreview = on;
    },
    startWaves: () => battle?.startWaves(),
    nextWave: () => battle?.callNextWave() ?? -1,
    onSelect: (fn) => selectHooks.push(fn),
    rallyAreaRect: (kind) => {
      const s = battle?.structures.find((o) => o.kind === kind);
      if (!s) return null;
      return boxToCss(s.x - RALLY_MAX, s.y - RALLY_MAX, s.x + RALLY_MAX, s.y + RALLY_MAX, 0);
    },
    buildAreaRect: () => {
      if (!battle) return null;
      const wide = field().wide;
      return boxToCss(LANE_CX - wide + 8, BUILD_FRONT, LANE_CX + wide - 8, CORE.y + 40, 0);
    },
  };
}
