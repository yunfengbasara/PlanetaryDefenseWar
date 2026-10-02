/**
 * 主界面的样式。配色取自游戏里的守军涂装：深空底色、装甲蓝、面罩橙；切角面板、两像素硬边框，
 * 和像素画面放在一起不打架。
 */
export const MENU_CSS = `
:root {
  --bg: #07090f;
  --panel: rgba(9, 14, 26, 0.86);
  --panel-2: rgba(16, 24, 42, 0.9);
  --line: #24365a;
  --line-hi: #3e5a92;
  --text: #dfe6f5;
  --muted: #7c8bab;
  --dim: #4a5878;
  --blue: #4a6ab0;
  --blue-hi: #82a6f0;
  --orange: #f0963a;
  --orange-hi: #ffb45c;
  --green: #6fd06a;
  --cut: 10px;
}
.pdw-menu {
  /* 按 1280×720 排版，整体缩放到舞台大小（--k 由脚本按舞台宽度给）。 */
  position: absolute; left: 0; top: 0; z-index: 10;
  width: 1280px; height: 720px; transform: scale(var(--k, 1)); transform-origin: 0 0;
  display: grid; grid-template-rows: auto 1fr auto;
  gap: 14px; padding: 16px 20px 12px;
  color: var(--text);
  font: 14px/1.5 "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
  background:
    radial-gradient(ellipse 60% 50% at 78% 30%, rgba(60, 50, 120, .28), transparent 70%),
    radial-gradient(ellipse 50% 60% at 15% 85%, rgba(30, 70, 120, .25), transparent 70%),
    radial-gradient(1px 1px at 12% 18%, #cfd8ff 50%, transparent 51%),
    radial-gradient(1px 1px at 37% 72%, #9fb0e0 50%, transparent 51%),
    radial-gradient(1px 1px at 64% 12%, #ffffff 50%, transparent 51%),
    radial-gradient(1px 1px at 86% 64%, #b8c4f0 50%, transparent 51%),
    radial-gradient(1px 1px at 52% 46%, #8090c0 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 24% 52%, #ffffff 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 74% 88%, #dfe6ff 50%, transparent 51%),
    #07090f;
  transition: opacity .25s ease;
  overflow: hidden;
  cursor: default;
  user-select: none;
}
.pdw-menu.hidden { opacity: 0; pointer-events: none; }
.pdw-menu, .pdw-menu * { box-sizing: border-box; }
.pdw-menu svg { width: 16px; height: 16px; flex: none; shape-rendering: crispEdges; }
.pdw-menu b, .pdw-menu h1, .pdw-menu h2, .pdw-menu h3 { font-weight: 700; }
.pdw-menu h1, .pdw-menu h2, .pdw-menu h3, .pdw-menu p { margin: 0; }

.pdw-vignette {
  position: absolute; inset: 0; pointer-events: none; z-index: -1;
  background:
    radial-gradient(ellipse at 50% 40%, transparent 30%, rgba(3, 4, 8, .85) 100%),
    repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 3px);
}

/* ---------------------------------------------------------------- 顶栏 */
.pdw-top { display: flex; align-items: center; gap: 18px; }
.pdw-brand { display: flex; align-items: center; gap: 12px; margin-right: auto; }
.pdw-emblem svg { width: 44px; height: 44px; }
.pdw-brand h1 {
  font-size: 26px; letter-spacing: 6px; line-height: 1.1;
  color: #fff; text-shadow: 2px 2px 0 #1b2b52, 0 0 18px rgba(130,166,240,.35);
}
.pdw-brand small { display: block; font: 600 10px/1.6 Consolas, monospace; letter-spacing: 4px; color: var(--orange); }
.pdw-res { display: flex; gap: 8px; }
.pdw-chip {
  display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px;
  background: var(--panel); border: 2px solid var(--line);
  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
}
.pdw-chip b { font: 700 15px Consolas, monospace; }
.pdw-chip em { font-style: normal; font-size: 12px; color: var(--muted); }
.pdw-chip.gold svg { color: var(--orange); }
.pdw-chip.cyan svg { color: #5fd8e8; }
.pdw-nav { display: flex; gap: 8px; }

/* ---------------------------------------------------------------- 按钮 */
.pdw-btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 38px; padding: 0 16px; border: 0; cursor: pointer;
  font: inherit; font-weight: 700; color: var(--text); letter-spacing: 2px;
  background: var(--line-hi);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  transition: background .12s, color .12s, transform .08s;
}
.pdw-btn::before {
  content: ""; position: absolute; inset: 2px; z-index: -1; background: var(--panel-2);
  clip-path: inherit;
}
.pdw-btn { isolation: isolate; }
.pdw-btn:hover { background: var(--blue-hi); color: #fff; }
.pdw-btn:active { transform: translateY(1px); }
.pdw-btn:focus-visible { outline: 2px solid var(--orange); outline-offset: 2px; }
.pdw-btn:disabled { cursor: not-allowed; background: var(--line); color: var(--dim); }
.pdw-badge {
  position: absolute; top: 4px; right: 6px; min-width: 14px; height: 14px; padding: 0 3px;
  font: 700 10px/14px Consolas, monospace; font-style: normal; text-align: center;
  background: var(--orange); color: #1a0e02;
}

.pdw-btn.start {
  height: 52px; min-width: 240px; padding: 0 32px; font-size: 20px; letter-spacing: 8px;
  color: #1a0e02; background: var(--orange);
  clip-path: polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px);
  box-shadow: 0 0 0 2px rgba(240,150,58,.3);
}
.pdw-btn.start::before {
  inset: 3px; background: linear-gradient(180deg, var(--orange-hi), var(--orange) 55%, #c86f1c);
}
.pdw-btn.start svg { width: 20px; height: 20px; }
.pdw-btn.start:hover { background: #fff1d6; color: #1a0e02; }
.pdw-btn.start:hover::before { background: linear-gradient(180deg, #ffd08a, var(--orange-hi) 55%, var(--orange)); }
.pdw-btn.start:not(:disabled) { animation: pdw-pulse 2.4s ease-in-out infinite; }
.pdw-btn.start:disabled { color: var(--dim); background: var(--line); animation: none; }
.pdw-btn.start:disabled::before { background: var(--panel-2); }
@keyframes pdw-pulse { 50% { filter: brightness(1.12) drop-shadow(0 0 10px rgba(240,150,58,.55)); } }

/* ---------------------------------------------------------------- 面板 */
.pdw-body { display: grid; grid-template-columns: 320px 1fr; gap: 14px; min-height: 0; }
.pdw-panel {
  position: relative; display: flex; flex-direction: column; min-height: 0;
  padding: 14px 16px; background: var(--panel);
  border: 2px solid var(--line);
  clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut));
  backdrop-filter: blur(3px);
}
.pdw-panel::before {
  content: ""; position: absolute; left: 0; top: 0; width: 64px; height: 3px; background: var(--orange);
}
.pdw-head {
  display: flex; align-items: baseline; gap: 12px; padding-bottom: 10px; margin-bottom: 12px;
  border-bottom: 2px solid var(--line);
}
.pdw-head h2 { font-size: 18px; letter-spacing: 3px; }
.pdw-head span { font: 600 11px Consolas, monospace; letter-spacing: 2px; color: var(--muted); }
.pdw-sub { display: flex; align-items: baseline; gap: 10px; margin: 2px 0 8px; }
.pdw-sub h3 { font-size: 14px; letter-spacing: 2px; padding-left: 8px; border-left: 3px solid var(--orange); }
.pdw-sub span { font-size: 12px; color: var(--muted); }

.pdw-pips { display: inline-flex; gap: 3px; vertical-align: middle; }
.pdw-pips i, .pdw-threat i { display: block; width: 8px; height: 10px; background: var(--line); transform: skewX(-15deg); }
.pdw-pips i.on { background: var(--orange); }
.pdw-pips.sm i { width: 6px; height: 8px; }

/* ---------------------------------------------------------------- 地图列表 */
.pdw-list { list-style: none; margin: 0 -8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.pdw-map {
  position: relative; display: flex; gap: 10px; padding: 8px; cursor: pointer;
  background: rgba(20, 30, 52, .55); border: 2px solid transparent;
  transition: background .12s, border-color .12s;
}
.pdw-map:hover { background: rgba(36, 54, 90, .6); border-color: var(--line-hi); }
.pdw-map.active { background: rgba(48, 72, 128, .45); border-color: var(--blue-hi); }
.pdw-map.active::after {
  content: ""; position: absolute; left: -2px; top: -2px; bottom: -2px; width: 4px; background: var(--orange);
}
.pdw-thumb {
  position: relative; flex: none; width: 96px; height: 54px; overflow: hidden;
  background: #0b1020 repeating-linear-gradient(45deg, #111a30 0 6px, #0b1020 6px 12px);
  border: 2px solid #000;
}
.pdw-thumb canvas { width: 100%; height: 100%; display: block; }
.pdw-lock { position: absolute; inset: 0; display: grid; place-items: center; color: var(--dim); }
.pdw-lock svg { width: 20px; height: 20px; }
.pdw-map-text { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; }
.pdw-map-row { display: flex; align-items: center; gap: 6px; }
.pdw-map-row.sub { justify-content: space-between; margin-top: 2px; }
.pdw-map-text small { font: 600 9px Consolas, monospace; letter-spacing: 1px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pdw-idx { font: 700 11px Consolas, monospace; color: var(--orange); }
.pdw-status { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pdw-status.ok { color: var(--green); }
.pdw-status.ok::before { content: "● "; }
.pdw-status.locked { color: var(--dim); }
.pdw-map.locked b { color: var(--muted); }
.pdw-map.locked .pdw-pips i.on { background: var(--dim); }
.pdw-list-foot { margin-top: auto; padding-top: 10px; font-size: 11px; color: var(--dim); text-align: center; }

/* ---------------------------------------------------------------- 地图详情 */
.pdw-detail { overflow: hidden; }
.pdw-detail-grid {
  display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
  gap: 18px; flex: 1; min-height: 0;
}
/* 右边那一栏（敌情侦测）自己滚，详情面板本身不滚；滚动条落在面板的内边距里。 */
.pdw-scroll { overflow-y: auto; overflow-x: hidden; margin-right: -12px; padding-right: 4px; }
.pdw-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.pdw-preview {
  position: relative; aspect-ratio: 16 / 9; background: #000; border: 2px solid #000;
  outline: 2px solid var(--line-hi); outline-offset: 0; overflow: hidden;
}
.pdw-preview canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.pdw-preview::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 1px, transparent 1px 3px);
  box-shadow: inset 0 0 40px rgba(0,0,0,.6);
}
.pdw-corner { position: absolute; width: 14px; height: 14px; border: 0 solid var(--orange); z-index: 2; }
.pdw-corner.tl { left: 6px; top: 6px; border-width: 2px 0 0 2px; }
.pdw-corner.tr { right: 6px; top: 6px; border-width: 2px 2px 0 0; }
.pdw-corner.bl { left: 6px; bottom: 6px; border-width: 0 0 2px 2px; }
.pdw-corner.br { right: 6px; bottom: 6px; border-width: 0 2px 2px 0; }
.pdw-live, .pdw-coord {
  position: absolute; z-index: 2; padding: 2px 6px;
  font: 700 10px Consolas, "Microsoft YaHei", monospace; letter-spacing: 1px;
  background: rgba(0,0,0,.6);
}
.pdw-live { top: 12px; left: 26px; color: var(--blue-hi); display: flex; align-items: center; gap: 5px; }
.pdw-live i { width: 7px; height: 7px; background: var(--blue-hi); animation: pdw-blink 1.6s steps(2) infinite; }
.pdw-coord { bottom: 12px; right: 26px; color: var(--muted); }
@keyframes pdw-blink { 50% { opacity: 0; } }

.pdw-preview.offline { display: grid; place-items: center; max-width: 720px; }
.pdw-noise {
  position: absolute; inset: 0;
  background:
    repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 2px, transparent 2px 4px),
    repeating-linear-gradient(90deg, #0b1020 0 3px, #101830 3px 5px, #0a0e1a 5px 9px);
  animation: pdw-roll .4s steps(4) infinite;
}
@keyframes pdw-roll { to { background-position: 0 8px, 9px 0; } }
.pdw-offline { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--muted); }
.pdw-offline svg { width: 32px; height: 32px; color: var(--dim); }
.pdw-offline b { font-size: 18px; letter-spacing: 6px; color: var(--text); }
.pdw-locked-info { margin-top: 14px; color: var(--muted); }
.pdw-kv { display: flex; align-items: center; gap: 10px; margin-top: 8px; }

.pdw-menu .pdw-desc { margin: 12px 0; color: #b6c2dc; font-size: 13px; line-height: 1.7; }
.pdw-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.pdw-stat {
  display: flex; flex-direction: column; gap: 2px; padding: 6px 10px;
  background: rgba(20,30,52,.6); border-left: 2px solid var(--line-hi);
}
.pdw-stat span { font-size: 11px; color: var(--muted); }
.pdw-stat b { font-size: 15px; }

.pdw-enemies { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.pdw-enemy {
  display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 4px 8px;
  background: rgba(20,30,52,.55); border: 2px solid transparent; outline: none;
  transition: background .12s, border-color .12s;
}
.pdw-enemy:hover, .pdw-enemy.active { background: rgba(60,40,70,.5); border-color: #8a5a9a; }
.pdw-enemy-icon {
  width: 84px; max-width: 100%; aspect-ratio: 56 / 46;
  background: radial-gradient(ellipse at 50% 70%, rgba(130,166,240,.12), transparent 70%);
}
.pdw-enemy-icon canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.pdw-enemy-text { display: flex; flex-direction: column; align-items: center; text-align: center; }
.pdw-enemy-text b { font-size: 13px; }
.pdw-enemy-text small { font-size: 10px; color: var(--muted); }
.pdw-threat { display: inline-flex; gap: 2px; margin-top: 3px; }
.pdw-threat i { width: 6px; height: 6px; }
.pdw-threat i.on { background: #e0505a; }
.pdw-intel {
  min-height: 38px; margin: 8px 0 12px; padding: 8px 10px; font-size: 12px; color: #c8b8d8;
  background: rgba(60,40,70,.25); border-left: 2px solid #8a5a9a;
}

.pdw-actions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: auto; padding-top: 12px; border-top: 2px solid var(--line); }

.pdw-foot { display: flex; justify-content: space-between; font: 11px Consolas, "Microsoft YaHei", monospace; color: var(--dim); }

/* ---------------------------------------------------------------- 弹窗 */
.pdw-modal {
  position: absolute; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px;
  background: rgba(3,5,10,.72); animation: pdw-fade .15s ease;
}
@keyframes pdw-fade { from { opacity: 0; } }
.pdw-dialog { width: min(820px, 100%); max-height: min(640px, 100%); overflow: auto; padding-right: 8px; }

/* ---------------------------------------------------------------- 滚动条
 * 能滚动的地方一律预留滚动条的位置（scrollbar-gutter: stable）：出不出滚动条，里面的控件都不挪。
 * 样式做成游戏里的样子：窄、方角、深色槽、装甲蓝滑块，悬停变橙。
 * Chrome 只要设了标准的 scrollbar-color 就不再认 ::-webkit-scrollbar，所以标准写法只留给不支持后者的浏览器。 */
.pdw-list, .pdw-scroll, .pdw-dialog { scrollbar-gutter: stable; }
.pdw-menu ::-webkit-scrollbar, html::-webkit-scrollbar { width: 8px; height: 8px; }
.pdw-menu ::-webkit-scrollbar-track, html::-webkit-scrollbar-track {
  background: #0b1020; border-left: 1px solid var(--line); margin: 6px 0;
}
.pdw-menu ::-webkit-scrollbar-thumb, html::-webkit-scrollbar-thumb {
  background: var(--line-hi); border: 2px solid #0b1020; border-left-width: 3px;
}
.pdw-menu ::-webkit-scrollbar-thumb:hover, html::-webkit-scrollbar-thumb:hover { background: var(--orange); }
.pdw-menu ::-webkit-scrollbar-thumb:active, html::-webkit-scrollbar-thumb:active { background: var(--orange-hi); }
.pdw-menu ::-webkit-scrollbar-button, html::-webkit-scrollbar-button { display: none; }
.pdw-menu ::-webkit-scrollbar-corner, html::-webkit-scrollbar-corner { background: #0b1020; }
@supports not selector(::-webkit-scrollbar) {
  .pdw-menu *, html { scrollbar-width: thin; scrollbar-color: var(--line-hi) #0b1020; }
}
.pdw-x {
  margin-left: auto; align-self: center; display: grid; place-items: center; width: 30px; height: 30px;
  background: transparent; border: 2px solid var(--line); color: var(--muted); cursor: pointer;
}
.pdw-x:hover { color: #fff; border-color: var(--blue-hi); }
.pdw-shop { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.pdw-item {
  position: relative; display: flex; flex-direction: column; gap: 4px; padding: 10px;
  background: rgba(20,30,52,.6); border: 2px solid var(--line);
}
.pdw-item-art {
  height: 72px; margin-bottom: 4px;
  background:
    linear-gradient(135deg, transparent 45%, rgba(240,150,58,.35) 45% 55%, transparent 55%),
    repeating-linear-gradient(45deg, #121c34 0 6px, #0e1628 6px 12px);
}
.pdw-item small { color: var(--muted); font-size: 12px; min-height: 2.8em; }
.pdw-tag { position: absolute; top: 14px; left: 14px; padding: 1px 6px; font-size: 10px; background: var(--blue); }
.pdw-btn.buy { height: 30px; font-size: 13px; letter-spacing: 1px; }
.pdw-btn.buy svg { color: var(--orange); }
.pdw-ach { display: flex; flex-direction: column; gap: 8px; }
.pdw-ach-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  background: rgba(20,30,52,.6); border: 2px solid var(--line);
}
.pdw-ach-row.done { border-color: #7a5a24; background: rgba(240,150,58,.08); }
.pdw-ach-icon { display: grid; place-items: center; width: 40px; height: 40px; flex: none; background: #0b1020; color: var(--dim); }
.pdw-ach-icon svg { width: 22px; height: 22px; }
.pdw-ach-row.done .pdw-ach-icon { color: var(--orange); }
.pdw-ach-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pdw-ach-text small { color: var(--muted); font-size: 12px; }
.pdw-bar { height: 6px; margin-top: 6px; background: #0b1020; }
.pdw-bar i { display: block; height: 100%; background: var(--blue-hi); }
.pdw-ach-row.done .pdw-bar i { background: var(--orange); }
.pdw-ach-num { font: 700 12px Consolas, monospace; color: var(--muted); white-space: nowrap; }
.pdw-ach-row.done .pdw-ach-num { color: var(--orange); }

/* ---------------------------------------------------------------- 游戏内返回按钮 */
.pdw-ingame {
  position: absolute; color: var(--text); top: 12px; left: 12px; z-index: 5;
  font: 700 13px "Microsoft YaHei", sans-serif; transition: opacity .2s;
}
.pdw-ingame.hidden { opacity: 0; pointer-events: none; }

/* ---------------------------------------------------------------- 教学提示 */
.pdw-hint {
  /* 位置由脚本摆：贴在这一步要操作的地方旁边；没有要操作的地方就在左下角。 */
  position: absolute; left: 16px; top: 16px; z-index: 9; width: 340px;
  padding: 12px 16px 12px;
  color: var(--text); font: 14px/1.6 "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif;
  background: rgba(9, 14, 26, .9); border: 2px solid var(--line-hi);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
  transition: opacity .2s; box-sizing: border-box;
}
.pdw-hint::before { content: ""; position: absolute; left: 0; top: 0; width: 64px; height: 3px; background: var(--orange); }
.pdw-hint.hidden { opacity: 0; pointer-events: none; }
.pdw-hint-head { display: flex; align-items: baseline; gap: 10px; }
.pdw-hint-head b { color: var(--orange); letter-spacing: 2px; }
.pdw-hint-step { font: 700 11px Consolas, monospace; color: var(--muted); }
.pdw-hint-text { margin: 6px 0 8px; font-size: 15px; }
.pdw-hint-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 10px; }
/* 要玩家动手的那一步：不给"下一步"，显示一个在等的小灯；做到了变绿。 */
.pdw-hint-wait { display: none; align-items: center; gap: 6px; margin-right: auto; font-size: 12px; color: var(--muted); }
.pdw-hint-wait i { width: 7px; height: 7px; background: var(--orange); animation: pdw-blink 1s steps(2) infinite; }
.pdw-hint.waiting .pdw-hint-wait { display: flex; }
.pdw-hint.waiting [data-act=next] { display: none; }
.pdw-hint.done { border-color: var(--green); }
.pdw-hint.done .pdw-hint-wait { color: var(--green); }
.pdw-hint.done .pdw-hint-wait i { background: var(--green); animation: none; }
.pdw-hint-actions .pdw-btn { height: 30px; padding: 0 12px; font-size: 12px; }

/* ---------------------------------------------------------------- 局内 HUD */
.pdw-hud {
  position: absolute; inset: 12px 12px auto auto; z-index: 5; pointer-events: none;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  color: var(--text); font: 13px/1.4 "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  transition: opacity .2s;
}
.pdw-hud.hidden { opacity: 0; }
.pdw-crystal {
  display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px;
  background: rgba(9, 14, 26, .86); border: 2px solid var(--line);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
}
.pdw-crystal svg { width: 16px; height: 16px; color: #5fd8e8; }
.pdw-crystal b { min-width: 48px; font: 700 18px Consolas, monospace; color: #dff8ff; text-align: right; }
.pdw-crystal em { font-style: normal; font-size: 12px; color: var(--muted); }

/* ---------------------------------------------------------------- 波次面板（右上角，晶矿上面） */
.pdw-wave {
  width: 210px; padding: 8px 10px 9px; pointer-events: auto;
  background: rgba(9, 14, 26, .86); border: 2px solid var(--line);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
}
.pdw-wave.hidden { display: none; }
.pdw-wave-now { display: flex; align-items: baseline; gap: 8px; }
.pdw-wave-now span { font-size: 11px; color: var(--muted); letter-spacing: 2px; }
.pdw-wave-now b { font-size: 17px; letter-spacing: 2px; color: #fff; }
.pdw-wave-now em { margin-left: auto; font: 700 12px Consolas, "Microsoft YaHei", monospace; font-style: normal; color: #e0909a; }
.pdw-wave-next { display: flex; align-items: baseline; gap: 6px; margin-top: 4px; font-size: 11px; color: var(--muted); }
.pdw-wave-next b { margin-left: auto; font: 700 16px Consolas, monospace; color: #ffc446; }
.pdw-wave.soon .pdw-wave-next b { color: #ff6a5a; animation: pdw-blink .6s steps(2) infinite; }
.pdw-wave-bar { height: 4px; margin: 5px 0 7px; background: #0b1020; }
.pdw-wave-bar i { display: block; height: 100%; width: 100%; background: #ffc446; transition: width .2s linear; }
.pdw-wave-call { width: 100%; height: 30px; justify-content: space-between; padding: 0 10px; font-size: 13px; letter-spacing: 2px; }
.pdw-wave-call em { display: flex; align-items: center; gap: 3px; font: 700 12px Consolas, monospace; font-style: normal; color: #8fe6ff; letter-spacing: 0; }
.pdw-wave-call em i { font-style: normal; }
.pdw-wave-call svg { width: 11px; height: 11px; color: #5fd8e8; }

/* ---------------------------------------------------------------- "第 N 波来袭" */
.pdw-banner {
  position: absolute; left: 50%; top: 14%; z-index: 6; pointer-events: none;
  transform: translateX(-50%); text-align: center; color: #fff;
  font: 14px/1.3 "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
}
.pdw-banner.hidden { display: none; }
.pdw-banner small { display: block; font: 700 12px Consolas, monospace; letter-spacing: 6px; color: #ff6a5a; }
.pdw-banner b { display: block; font-size: 30px; letter-spacing: 8px; text-shadow: 2px 2px 0 #4a0e14, 0 0 18px rgba(255, 90, 80, .6); }
.pdw-banner.show { animation: pdw-banner 2.2s ease-out forwards; }
@keyframes pdw-banner {
  0% { opacity: 0; transform: translate(-50%, -8px) scale(1.2); }
  12% { opacity: 1; transform: translate(-50%, 0) scale(1); }
  80% { opacity: 1; }
  100% { opacity: 0; }
}

/* ---------------------------------------------------------------- 失败结算 */
.pdw-over {
  position: absolute; inset: 0; z-index: 10; display: grid; place-items: center;
  background: radial-gradient(ellipse at center, rgba(40, 6, 10, .55), rgba(3, 4, 8, .85));
  color: var(--text); font: 14px/1.5 "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  animation: pdw-fade .4s ease;
}
.pdw-over.hidden { display: none; }
.pdw-over-panel {
  position: relative; width: 440px; padding: 22px 26px 20px; text-align: center;
  background: rgba(9, 14, 26, .94); border: 2px solid #8a2a34;
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
}
.pdw-over-panel::before { content: ""; position: absolute; left: 0; top: 0; width: 80px; height: 3px; background: #e0505a; }
.pdw-over-panel small { font: 700 11px Consolas, monospace; letter-spacing: 4px; color: #e0505a; }
.pdw-over-panel h2 { margin: 4px 0 16px; font-size: 26px; letter-spacing: 6px; color: #fff; text-shadow: 2px 2px 0 #4a0e14; }
.pdw-over-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 18px; }
.pdw-over-stats div { display: flex; flex-direction: column; gap: 2px; padding: 8px; background: rgba(20, 30, 52, .6); border-left: 2px solid var(--line-hi); }
.pdw-over-stats span { font-size: 11px; color: var(--muted); }
.pdw-over-stats b { font: 700 20px Consolas, monospace; }
.pdw-over-actions { display: flex; justify-content: center; gap: 10px; }
.pdw-over-actions .pdw-btn { min-width: 130px; }

/* ---------------------------------------------------------------- 建造列表 */
.pdw-build { display: flex; flex-direction: column; gap: 6px; pointer-events: auto; transition: opacity .2s; }
.pdw-build.hidden { display: none; }
.pdw-build-item {
  position: relative; display: flex; align-items: center; gap: 8px; width: 176px; padding: 4px 10px 4px 4px;
  color: var(--text); font: inherit; text-align: left; cursor: pointer;
  background: rgba(9, 14, 26, .86); border: 2px solid var(--line);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  transition: border-color .12s, background .12s;
}
.pdw-build-item:hover { border-color: var(--blue-hi); background: rgba(36, 54, 90, .9); }
.pdw-build-item.active { border-color: var(--orange); background: rgba(80, 50, 20, .85); }
.pdw-build-item.off { opacity: .45; cursor: not-allowed; }
.pdw-build-item.off:hover { border-color: var(--line); background: rgba(9, 14, 26, .86); }
.pdw-build-item canvas {
  flex: none; width: 56px; height: 44px; image-rendering: pixelated;
  background: radial-gradient(ellipse at 50% 65%, rgba(130, 166, 240, .16), transparent 70%);
}
.pdw-build-text { display: flex; flex-direction: column; min-width: 0; }
.pdw-build-text b { font-size: 13px; letter-spacing: 1px; white-space: nowrap; }
.pdw-build-text span { display: flex; align-items: center; gap: 3px; font: 700 12px Consolas, monospace; color: #8fe6ff; }
.pdw-build-text svg { width: 11px; height: 11px; color: #5fd8e8; }
.pdw-build-text i { font-style: normal; }
.pdw-build-item kbd {
  position: absolute; right: 6px; top: 4px; font: 700 10px Consolas, monospace; color: var(--dim);
}

/* ---------------------------------------------------------------- 建筑升级面板（头顶弹出） */
.pdw-tip {
  /* 半透明、不挡鼠标：隔着面板也能看到后面、右键设集结点；只有按钮能点（见下面的 pointer-events: auto）。 */
  position: absolute; z-index: 8; width: 268px; padding: 8px 10px 10px; pointer-events: none;
  transform: translate(-50%, -100%);
  color: var(--text); font: 12px/1.5 "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  background: rgba(9, 14, 26, .62); border: 2px solid rgba(130, 166, 240, .75);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
}
.pdw-tip.hidden { display: none; }
.pdw-tip::before { content: ""; position: absolute; left: 0; top: 0; width: 48px; height: 3px; background: var(--orange); }
.pdw-tip-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.pdw-tip-head b { font-size: 14px; letter-spacing: 2px; }
.pdw-tip button { pointer-events: auto; }
.pdw-tip-x {
  margin-left: auto; width: 20px; height: 20px; padding: 0; line-height: 16px; cursor: pointer;
  color: var(--muted); background: transparent; border: 1px solid var(--line); font-size: 14px;
}
.pdw-tip-x:hover { color: #fff; border-color: var(--blue-hi); }
.pdw-tip-prod { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; padding: 4px 8px; background: rgba(20, 30, 52, .4); border-left: 2px solid var(--line-hi); }
.pdw-tip-prod span { color: var(--muted); }
.pdw-tip-prod b { font: 700 14px Consolas, monospace; }
.pdw-tip-prod em { margin-left: auto; font-style: normal; color: #6ed2ff; }
.pdw-tip-prod em.ok { color: var(--green); }
.pdw-tip-prod em.warn { color: var(--orange); }
.pdw-tip-hint { margin: -2px 0 6px; font-size: 11px; color: #ffc446; }
.pdw-tip-stats { display: flex; flex-direction: column; gap: 3px; }
.pdw-tip-stat {
  display: grid; grid-template-columns: 56px 30px 1fr 64px; align-items: center; gap: 4px;
  height: 28px; padding: 0 2px 0 8px; background: rgba(20, 30, 52, .32);
}
.pdw-tip-foot { margin-top: 6px; display: flex; justify-content: flex-end; }
.pdw-tip-sell { height: 24px; padding: 0 10px; font-size: 12px; letter-spacing: 1px; background: #7a3a2a; }
.pdw-tip-sell:hover { background: #e0705a; }
.pdw-tip-sell.armed { background: #e0505a; color: #fff; }
.pdw-tip-name { color: #c8d4ee; white-space: nowrap; }
.pdw-tip-lv { font: 700 11px Consolas, monospace; color: #ffc446; }
.pdw-tip-val { font: 700 11px Consolas, monospace; color: var(--muted); white-space: nowrap; }
.pdw-tip-up { height: 24px; padding: 0 6px; gap: 3px; font: 700 11px Consolas, monospace; letter-spacing: 0; }
.pdw-tip-up svg { width: 10px; height: 10px; color: #5fd8e8; }
.pdw-tip-max { display: none; text-align: center; font-size: 11px; color: #ffc446; letter-spacing: 2px; }
.pdw-tip-stat.max .pdw-tip-up { display: none; }
.pdw-tip-stat.max .pdw-tip-max { display: block; }

/* ---------------------------------------------------------------- 新手引导遮罩 */
.pdw-mask { position: absolute; inset: 0; z-index: 7; pointer-events: none; }
.pdw-mask.hidden { display: none; }
/* 四块压暗的板子围出一个洞：板子挡点击、挡滚轮，洞里照常操作。 */
.pdw-mask-shade { position: absolute; background: rgba(2, 4, 10, .66); pointer-events: auto; }
.pdw-mask-frame {
  position: absolute; pointer-events: none; box-sizing: border-box;
  border: 2px solid var(--orange); box-shadow: 0 0 0 2px rgba(0, 0, 0, .5), 0 0 16px rgba(240, 150, 58, .55);
  animation: pdw-breathe 1.2s ease-in-out infinite;
}
@keyframes pdw-breathe { 50% { border-color: #ffe0a0; box-shadow: 0 0 0 2px rgba(0, 0, 0, .5), 0 0 26px rgba(255, 190, 90, .8); } }
`;
