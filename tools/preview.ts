/**
 * 离线预览：不开浏览器，把 ShapeBatch 的输出自己栅格化成 PNG。
 *
 * 人物、模型、虫子这套东西几乎全是数值调参 —— 比例、色阶、深度偏移 —— 判断一次改动对不对，
 * 唯一的办法是看图。跑一次就能拿到战场全景、近景特写、模型转台、虫子图鉴。
 *
 * 关键是它**跑的是游戏里那份绘制代码**，只换掉最后一步的光栅化。所以图上看到的就是游戏里会
 * 画出来的东西，包括那一圈描边 —— 见下面的 composite，它是 PixelSurface 合成通道的离线版。
 *
 *   npm run figures      输出到项目根目录的 .preview-*.png
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

import { Camera } from '../src/render/camera';
import { type Rgba } from '../src/render/color';
import { ellipseSegments, unitCircle } from '../src/render/ellipseFan';
import { ShapeBatch, type PrimitiveSink } from '../src/render/shapeBatch';
import { type Layers, newLayers } from '../src/render/scene';
import { Mesh3, drawMesh, drawShadow } from '../src/mesh/mesh';
import { aaTurret, barracks, battlecruiser, commandCenter, gunship, siegeTank, walkerMech } from '../src/mesh/models';
import { DefenseScene, LINE_Y } from '../src/game/scene';
import { BUG_LOOKS, type BugKind, drawBug, drawSplat, makeSplat } from '../src/game/bugs';
import { Projector as P3 } from '../src/render/projector';
import { Projection as PJ } from '../src/render/projection';

interface Shape {
  pts: number[];
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 冒充 PrimitiveMesh：把所有东西摊平成多边形。 */
class ShapeSink implements PrimitiveSink {
  readonly shapes: Shape[] = [];

  clear(): this {
    this.shapes.length = 0;
    return this;
  }

  quad(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    color: Rgba,
  ): void {
    this.push([x0, y0, x1, y1, x2, y2, x3, y3], color);
  }

  /** 段数走 ellipseFan，和线上那条路用同一份 —— 出的图才是游戏里真正画出来的样子。 */
  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, color: Rgba): void {
    const n = ellipseSegments(rx, ry);
    const ring = unitCircle(n);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const ex = ring[i * 2] * rx;
      const ey = ring[i * 2 + 1] * ry;
      pts.push(cx + ex * cos - ey * sin, cy + ex * sin + ey * cos);
    }
    this.push(pts, color);
  }

  private push(pts: number[], c: Rgba): void {
    this.shapes.push({ pts, r: c.r, g: c.g, b: c.b, a: c.a / 255 });
  }
}

/** RGBA 画布。要 alpha 是因为球员层得先单独画出来，才能按四个方向偏移着描边。 */
class Canvas {
  readonly data: Uint8Array;

  constructor(readonly width: number, readonly height: number, bg: [number, number, number, number] = [0, 0, 0, 0]) {
    this.data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.data[i * 4] = bg[0];
      this.data[i * 4 + 1] = bg[1];
      this.data[i * 4 + 2] = bg[2];
      this.data[i * 4 + 3] = bg[3];
    }
  }

  /** 在像素中心采样的扫描线填充，不做抗锯齿 —— 和低分辨率缓冲 + 最近邻放大是一回事。 */
  fillPolygon(shape: Shape): void {
    const { pts } = shape;
    const n = pts.length / 2;
    if (n < 3) return;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = pts[i * 2 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.height - 1, Math.ceil(maxY));
    const crossings: number[] = [];

    for (let py = y0; py <= y1; py++) {
      const sy = py + 0.5;
      crossings.length = 0;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2];
        const ay = pts[i * 2 + 1];
        const bx = pts[((i + 1) % n) * 2];
        const by = pts[((i + 1) % n) * 2 + 1];
        if (ay === by) continue;
        if (sy >= Math.min(ay, by) && sy < Math.max(ay, by)) {
          crossings.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a - b);
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        const x0 = Math.max(0, Math.ceil(crossings[c] - 0.5));
        const x1 = Math.min(this.width - 1, Math.floor(crossings[c + 1] - 0.5));
        for (let px = x0; px <= x1; px++) this.blend(px, py, shape);
      }
    }
  }

  private blend(x: number, y: number, s: Shape): void {
    const i = (y * this.width + x) * 4;
    const a = s.a;
    const dst = this.data[i + 3] / 255;
    const out = a + dst * (1 - a);
    this.data[i] = Math.round((s.r * a + this.data[i] * dst * (1 - a)) / (out || 1));
    this.data[i + 1] = Math.round((s.g * a + this.data[i + 1] * dst * (1 - a)) / (out || 1));
    this.data[i + 2] = Math.round((s.b * a + this.data[i + 2] * dst * (1 - a)) / (out || 1));
    this.data[i + 3] = Math.round(out * 255);
  }

  /** 最近邻整数放大，看清像素格子。 */
  upscale(factor: number): Canvas {
    const out = new Canvas(this.width * factor, this.height * factor);
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const si = (Math.floor(y / factor) * this.width + Math.floor(x / factor)) * 4;
        const di = (y * out.width + x) * 4;
        for (let c = 0; c < 4; c++) out.data[di + c] = this.data[si + c];
      }
    }
    return out;
  }
}

/**
 * PixelSurface 合成通道的离线版：把球员层按四个方向各偏移一像素、染黑叠到底图上，
 * 再把原色的那一层压上去。
 *
 * 必须照做，不能省。那一圈暗边不是装饰 —— 它是球衣色和草地色之间唯一的明度分界（见
 * PixelSurface 顶上那段）。少了它，出的图会比游戏里糊一大截，而那正好会让人得出
 * "这套画法不行"的错误结论。
 */
const OUTLINE_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function composite(ground: Canvas, layer: Canvas): Canvas {
  const out = new Canvas(ground.width, ground.height);
  out.data.set(ground.data);

  const blendPixel = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    if (x < 0 || x >= out.width || y < 0 || y >= out.height || a <= 0) return;
    const i = (y * out.width + x) * 4;
    out.data[i] = Math.round(out.data[i] * (1 - a) + r * a);
    out.data[i + 1] = Math.round(out.data[i + 1] * (1 - a) + g * a);
    out.data[i + 2] = Math.round(out.data[i + 2] * (1 - a) + b * a);
    out.data[i + 3] = 255;
  };

  // 描边：0x101610，alpha 0.55，和 PixelSurface 的构造参数一致。
  for (const [dx, dy] of OUTLINE_OFFSETS) {
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        const a = layer.data[(y * layer.width + x) * 4 + 3] / 255;
        if (a <= 0) continue;
        blendPixel(x + dx, y + dy, 0x10, 0x16, 0x10, a * 0.55);
      }
    }
  }

  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      const i = (y * layer.width + x) * 4;
      const a = layer.data[i + 3] / 255;
      if (a <= 0) continue;
      blendPixel(x, y, layer.data[i], layer.data[i + 1], layer.data[i + 2], a);
    }
  }

  return out;
}

// ---------------------------------------------------------------- PNG 编码

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, body: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
};

function writePng(path: string, canvas: Canvas): void {
  const stride = canvas.width * 4;
  const raw = Buffer.alloc(canvas.height * (stride + 1));
  for (let y = 0; y < canvas.height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    Buffer.from(canvas.data.buffer, y * stride, stride).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// ---------------------------------------------------------------- 出图

const sink = new ShapeSink();

function flush(batch: ShapeBatch, canvas: Canvas): void {
  sink.clear();
  batch.flushToMesh(sink, canvas.width, canvas.height);
  for (const s of sink.shapes) canvas.fillPolygon(s);
}

const W = 640;
const H = 360;

function sheet(cells: Canvas[], columns: number, pad = 2): Canvas {
  const cw = cells[0].width;
  const ch = cells[0].height;
  const rows = Math.ceil(cells.length / columns);
  const out = new Canvas(columns * (cw + pad) + pad, rows * (ch + pad) + pad, [20, 20, 24, 255]);
  cells.forEach((c, i) => {
    const ox = pad + (i % columns) * (cw + pad);
    const oy = pad + Math.floor(i / columns) * (ch + pad);
    for (let y = 0; y < ch; y++) out.data.set(c.data.subarray(y * cw * 4, (y + 1) * cw * 4), ((oy + y) * out.width + ox) * 4);
  });
  return out;
}

/**
 * 五层合成：地面 → 描边的单位层 → 不描边的特效层 → 描边的天空层 → 天上的光。
 * 和 PixelSurface.render 同一个顺序。
 */
function layered(cam: Camera, paint: (layers: Layers) => void, w = W, h = H): Canvas {
  const layers = newLayers();
  paint(layers);
  const g = new Canvas(w, h, [7, 9, 15, 255]);
  const u = new Canvas(w, h);
  flush(layers.ground, g);
  flush(layers.units, u);
  let out = composite(g, u);
  flush(layers.fx, out);
  const sky = new Canvas(w, h);
  flush(layers.sky, sky);
  out = composite(out, sky);
  flush(layers.skyFx, out);
  return out;
}

// ---------------------------------------------------------------- 物品：转台

{
  const models: [string, (m: Mesh3) => Mesh3, number][] = [
    ['walker', (m) => walkerMech(m, { torso: 0.2, step: 0.1, recoil: 0, stride: 0.6 }), 3.4],
    ['siege', (m) => siegeTank(m, { turret: 0.4, recoil: 0, deploy: 1 }), 2.6],
    ['aa', (m) => aaTurret(m, { yaw: 0.3, pitch: 0.8, recoil: 0 }, { r: 214, g: 220, b: 230, a: 255 }, { r: 52, g: 88, b: 168, a: 255 }), 3.4],
    ['gunship', (m) => gunship(m, { bank: 0, thrust: 1 }), 2.6],
    ['battlecruiser', (m) => battlecruiser(m, { charge: 0.6, thrust: 1 }), 1.1],
    ['command', (m) => commandCenter(m, { t: 1 }), 1.5],
    ['barracks', (m) => barracks(m, { t: 1, door: 0.6 }), 2],
  ];
  const cells: Canvas[] = [];
  for (const [, build, grain] of models) {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 4]) {
      const c = new Camera();
      c.viewWidth = 180;
      c.viewHeight = 130;
      c.grain = grain;
      c.x = 0;
      c.y = -14;
      const m = build(new Mesh3().rotZ(yaw));
      cells.push(
        layered(
          c,
          (layers) => {
            layers.ground.quad(c.worldToScreen(-400, -400), c.worldToScreen(400, -400), c.worldToScreen(400, 400), c.worldToScreen(-400, 400), { r: 108, g: 114, b: 126, a: 255 }, 0);
            drawShadow(layers.ground, c, m, 0, 10, 80);
            drawMesh(layers.units, c, m, { x: 0, y: 0 });
          },
          180,
          130,
        ),
      );
    }
  }
  writePng('.preview-models.png', sheet(cells, 8).upscale(2));
}

// ---------------------------------------------------------------- 战场

/**
 * 摆好一局：开局是空地图，这里直接用场景接口造两座兵营、一座车间、两辆坦克、一门火炮，把兵营和车间的
 * 数量升满，买巨舰，然后开打（连叫几波）。兵营一个个出兵，大约四十秒后防线成形。
 */
function setupBattle(): DefenseScene {
  const b = new DefenseScene();
  b.crystals = 1e6;
  const built = [
    b.place('barracks', 240, 660),
    b.place('barracks', 420, 650),
    b.place('factory', 450, 770),
    b.place('tank', 200, 570),
    b.place('tank', 460, 570),
    b.place('artillery', 130, 610),
  ];
  for (const s of built) {
    if (!s) throw new Error('preview: 摆建筑失败（位置放不下）');
    if (s.kind === 'barracks' || s.kind === 'factory') {
      b.upgrade(s.id, 'count');
      b.upgrade(s.id, 'count');
    }
  }
  b.buyCruiser();
  b.startWaves();
  // 连叫几波，场上一开始就有足够的虫可拍。
  for (let i = 0; i < 6; i++) b.callNextWave();
  return b;
}

{
  const battle = setupBattle();
  const cam = new Camera();
  cam.viewWidth = W;
  cam.viewHeight = H;
  cam.grain = cam.grainToFit(700, LINE_Y + 265 - 175 + 21, 4);
  cam.x = 355;
  cam.y = (175 + LINE_Y + 265) / 2 - 10;
  const frame = (): Canvas => layered(cam, (layers) => battle.draw(layers, cam));
  const cells: Canvas[] = [];
  for (const t of [40, 44, 48, 52]) {
    while (battle.time < t) battle.update(1 / 60);
    cells.push(frame());
  }
  writePng('.preview-defense.png', sheet(cells, 2));
  // 防线特写。
  const close = new Camera();
  close.viewWidth = W;
  close.viewHeight = H;
  close.grain = 3.2;
  close.x = 300;
  close.y = LINE_Y + 20;
  writePng('.preview-defense-close.png', layered(close, (layers) => battle.draw(layers, close)).upscale(2));
  // 出兵：跑到兵营正升着门、新兵刚走出门口的时候，拍兵营这一段。
  {
    const b2 = setupBattle();
    const walkingOut = (): boolean => b2.defenders.some((d) => d.kind === 'rifle' && (d.path?.length ?? 0) > 0 && d.y > LINE_Y + 120);
    while (b2.time < 6 || (!walkingOut() && b2.time < 60)) b2.update(1 / 60);
    const mid = new Camera();
    mid.viewWidth = W;
    mid.viewHeight = H;
    mid.grain = 1.9;
    mid.x = 300;
    mid.y = LINE_Y + 150;
    writePng('.preview-defense-reinforce.png', layered(mid, (layers) => b2.draw(layers, mid)).upscale(2));
  }
  // 交火特写：防线前方，看子弹在飞、火星、枪口焰。多拍几帧挑子弹多的瞬间。
  const fire = new Camera();
  fire.viewWidth = W;
  fire.viewHeight = H;
  fire.grain = 2.6;
  fire.x = 330;
  fire.y = LINE_Y - 60;
  const shots: Canvas[] = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 4; i++) battle.update(1 / 60);
    shots.push(layered(fire, (layers) => battle.draw(layers, fire)));
  }
  writePng('.preview-defense-fire.png', sheet(shots, 2));
}

// ---------------------------------------------------------------- 虫子图鉴

{
  const cells: Canvas[] = [];
  const cell = (draw: (layers: Layers, c: Camera) => void): void => {
    const c = new Camera();
    c.viewWidth = 120;
    c.viewHeight = 100;
    c.grain = 3.4;
    c.x = 0;
    c.y = -6;
    cells.push(
      layered(
        c,
        (layers) => {
          layers.ground.quad(c.worldToScreen(-200, -200), c.worldToScreen(200, -200), c.worldToScreen(200, 200), c.worldToScreen(-200, 200), { r: 146, g: 146, b: 152, a: 255 }, 0);
          draw(layers, c);
        },
        120,
        100,
      ),
    );
  };
  const bug = (kind: BugKind, st: Partial<{ phase: number; dead: number; airborne: boolean; emerge: number; spit: number }>, lift = 0): void =>
    cell((layers, c) => {
      const p = new P3(c.worldToScreenZ(0, 0, lift), Math.PI / 2, PJ.groundSquash, c.grain, 50);
      drawBug(layers.units, p, kind, BUG_LOOKS[kind][0], { phase: 0.2, dead: -1, airborne: false, emerge: 1, spit: 0, ...st }, 1.3);
    });
  for (const k of ['crawler', 'hopper', 'beetle', 'flyer', 'serpent', 'spitter'] as BugKind[]) bug(k, {}, k === 'flyer' ? 10 : 0);
  bug('hopper', { airborne: true }, 10);
  bug('serpent', { spit: 0.5 });
  bug('serpent', { spit: 1 });
  bug('serpent', { dead: 1 });
  bug('spitter', { spit: 1 });
  bug('crawler', { dead: 1 });
  bug('beetle', { dead: 1 });
  for (let i = 0; i < 4; i++) {
    cell((layers, c) => {
      const blobs = makeSplat(5 + i, Math.cos(i * 1.7), Math.sin(i * 1.7), i % 2 === 0);
      drawSplat(layers.ground, c.worldToScreen(0, 0), blobs, BUG_LOOKS[(['crawler', 'beetle', 'serpent', 'spitter'] as BugKind[])[i]][0].blood, c.grain, PJ.groundSquash, 1, 10);
    });
  }
  writePng('.preview-bugs.png', sheet(cells, 8).upscale(2));
}

console.log('ok');
