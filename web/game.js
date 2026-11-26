/* 桌面抽物 · Desk Pull — 侧视角物理抽物小游戏 */
(() => {
'use strict';

const { Engine, Bodies, Body, Composite, Constraint, Events, Sleeping, Query, Vector } = Matter;

/* ================= 常量 ================= */
let W = 1200, H = 700;
let DESK_TOP = 520;
let COLLECT_TOP = 105;
let FLOOR = 648;
const STEP = 1000 / 60;
const isPortraitWorld = () => W < 1000;
function setWorldDims(portrait = window.innerHeight > window.innerWidth * 1.05) {
  if (portrait) {
    W = 760; H = 980; DESK_TOP = 720; COLLECT_TOP = 150; FLOOR = 940;
  } else {
    W = 1200; H = 700; DESK_TOP = 520; COLLECT_TOP = 105; FLOOR = 648;
  }
}

const COLORS = {
  blue:   { hex: '#4a9fe8', dark: '#2f6fb0', light: '#8cc6f5', name: '蓝' },
  green:  { hex: '#52c48a', dark: '#33875e', light: '#93e0b8', name: '绿' },
  red:    { hex: '#e8604c', dark: '#a83c2c', light: '#f59a86', name: '红' },
  yellow: { hex: '#f2b33d', dark: '#b07a1e', light: '#ffd98a', name: '黄' },
  wood:   { hex: '#b98a5a', dark: '#84592f', light: '#dcb488', name: '木' },
};
const GOAL_POOL = ['blue', 'green', 'red'];

/* ================= 工具 ================= */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const rand = (rng, a, b) => a + rng() * (b - a);

/* ================= 音效（WebAudio 合成） ================= */
const AudioSys = {
  ctx: null, master: null, muted: false, lastKnock: 0, lastRoll: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  },
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.linearRampToValueAtTime(m ? 0 : 0.5, this.ctx.currentTime + 0.08);
  },
  env(g, t0, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  },
  tone(freq, type, peak, a, d, delay = 0, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + a + d);
    this.env(g, t0, a, peak, d);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + a + d + 0.05);
  },
  noise(peak, d, freq, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * d));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = this.ctx.createGain(); this.env(g, t0, 0.004, peak, d);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  },
  knock(vol) {
    const now = performance.now();
    if (now - this.lastKnock < 70) return;
    this.lastKnock = now;
    const v = clamp(vol, 0.05, 0.5);
    this.noise(v * 0.5, 0.06, 900 + Math.random() * 500);
    this.tone(110 + Math.random() * 50, 'sine', v * 0.7, 0.004, 0.09);
  },
  grab() { this.tone(1150, 'sine', 0.12, 0.004, 0.045); },
  collect(mult) {
    const base = 440 * Math.pow(1.19, Math.min(mult, 4));
    this.tone(base, 'triangle', 0.3, 0.006, 0.16);
    this.tone(base * 1.5, 'triangle', 0.24, 0.006, 0.2, 0.07);
    this.noise(0.1, 0.08, 3200, 0.02);
    if (mult >= 2) this.tone(base * 2, 'sine', 0.2, 0.005, 0.24, 0.14);
  },
  fall() {
    this.tone(200, 'sawtooth', 0.22, 0.008, 0.28, 0, 62);
    this.noise(0.3, 0.16, 300, 0.05);
  },
  success() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'triangle', 0.28, 0.01, 0.3, i * 0.095));
    this.noise(0.08, 0.3, 5000, 0.3);
  },
  fail() {
    this.tone(220, 'sine', 0.3, 0.01, 0.4);
    this.tone(174, 'sine', 0.28, 0.01, 0.5, 0.16);
    this.noise(0.2, 0.25, 220, 0.05);
  },
  click() { this.tone(760, 'sine', 0.14, 0.003, 0.05); },
  near() { this.tone(1320, 'sine', 0.1, 0.004, 0.07); this.tone(1760, 'sine', 0.07, 0.004, 0.09, 0.05); },
  dare() {
    this.tone(392, 'triangle', 0.26, 0.006, 0.14);
    this.tone(587, 'triangle', 0.24, 0.006, 0.18, 0.08);
    this.noise(0.09, 0.12, 4200, 0.04);
  },
  star(i) {
    const f = [523, 659, 784][i] || 1047;
    this.tone(f, 'triangle', 0.3, 0.008, 0.34);
    this.tone(f * 2, 'sine', 0.18, 0.008, 0.4, 0.02);
    this.noise(0.1, 0.18, 5200 + i * 900, 0.03);
  },
  // 连锁反应可见时刻的轻音效：支撑被抽走 / 圆物开始滚
  shift() { this.tone(300, 'sine', 0.1, 0.005, 0.12, 0, 180); this.noise(0.06, 0.08, 700, 0.02); },
  roll() {
    const now = performance.now();
    if (now - this.lastRoll < 180) return;
    this.lastRoll = now;
    this.noise(0.07, 0.1, 1400);
  },
};

/* ================= DOM ================= */
const $ = (id) => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const hud = $('hud');
const objectivesEl = $('objectives');
const totalScoreEl = $('totalScore'), roundScoreEl = $('roundScore');
const roundNumEl = $('roundNum'), seedTagEl = $('seedTag');
const comboBanner = $('comboBanner'), toastsEl = $('toasts');

/* ================= 画布适配 ================= */
let view = { scale: 1, ox: 0, oy: 0, dpr: 1, cw: 0, ch: 0 };
function resize() {
  const rect = canvas.getBoundingClientRect();
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.cw = rect.width; view.ch = rect.height;
  const width = Math.round(rect.width * view.dpr), height = Math.round(rect.height * view.dpr);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  view.scale = Math.min(rect.width / W, rect.height / H);
  if (G.round >= 9 && rect.height > rect.width) {
    view.scale = Math.min(rect.width / (deskRight - deskLeft + 48), rect.height / H);
  }
  view.ox = (rect.width - W * view.scale) / 2;
  view.oy = (rect.height - H * view.scale) / 2;
  if (matchMedia('(pointer: coarse)').matches && rect.width > rect.height) {
    const headroom = Math.max(hud.offsetHeight, 54);
    const top = COLLECT_TOP - 36, bottom = DESK_TOP + 72;
    const available = Math.max(1, rect.height - headroom - 8);
    view.scale = Math.min(rect.width / (deskRight - deskLeft + 240), available / (bottom - top));
    view.ox = (rect.width - W * view.scale) / 2;
    view.oy = headroom + (available - (bottom - top) * view.scale) / 2 - top * view.scale;
  }
}
const sizeObserver = new ResizeObserver(resize);
sizeObserver.observe(canvas);
sizeObserver.observe(hud);

const toWorld = (cx, cy) => {
  const r = canvas.getBoundingClientRect();
  return { x: (cx - r.left - view.ox) / view.scale, y: (cy - r.top - view.oy) / view.scale };
};
const toScreen = (p) => {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + p.x * view.scale + view.ox, y: rect.top + p.y * view.scale + view.oy };
};

/* ================= 物理世界 ================= */
const engine = Engine.create({ enableSleeping: true });
engine.gravity.y = 1.2;
const world = engine.world;
let deskBody = null;
let deskLeft = 250, deskRight = 950;

/* ================= 物件定义 ================= */
let itemUid = 0;
function makeDef(rng, kind, color) {
  const d = { id: ++itemUid, kind, color, isGuard: false };
  switch (kind) {
    case 'book':  d.w = rand(rng, 104, 148); d.h = rand(rng, 21, 30); break;
    case 'box':   d.w = d.h = rand(rng, 60, 76); break;
    case 'cup':   d.w = 50; d.h = 62; break;
    case 'ball':  d.r = rand(rng, 24, 32); d.w = d.h = d.r * 2; break;
    case 'pen':   d.w = rand(rng, 122, 152); d.h = 9; break;
    case 'plank': d.w = rand(rng, 168, 200); d.h = 13; break;
    case 'wedge': d.w = 62; d.h = 46; break;
  }
  return d;
}
function makeBody(def, x, y, angle = 0) {
  const opts = { angle, chamfer: def.kind === 'ball' ? undefined : { radius: 2 } };
  let b;
  switch (def.kind) {
    case 'pouch':
      b = Bodies.rectangle(x, y, def.w, def.h, { angle, chamfer: { radius: def.h * 0.4 },
        density: 0.0028, friction: 0.82, frictionStatic: 1.2, restitution: 0.03 });
      break;
    case 'eraser':
      b = Bodies.rectangle(x, y, def.w, def.h, { angle, chamfer: { radius: 4 },
        density: 0.0019, friction: 0.96, frictionStatic: 1.6, restitution: 0 });
      break;
    case 'paper': {
      const width = def.w / 3;
      const opts = { density: 0.0008, friction: 0.45, frictionAir: 0.035,
        collisionFilter: { group: Body.nextGroup(true) } };
      b = Bodies.rectangle(x, y, width, def.h, opts);
      b.plugin.wings = [];
      b.plugin.hinges = [];
      for (const side of [-1, 1]) {
        const wing = Bodies.rectangle(x + side * width, y, width, def.h, opts);
        wing.plugin.sheet = b;
        b.plugin.wings.push(wing);
        b.plugin.hinges.push(Constraint.create({ bodyA: b, bodyB: wing,
          pointA: { x: side * width / 2, y: 0 }, pointB: { x: -side * width / 2, y: 0 },
          length: 0, stiffness: 0.92, damping: 0.18 }));
        // A gentle restoring force lets the strip curl without folding through itself.
        b.plugin.hinges.push(Constraint.create({ bodyA: b, bodyB: wing,
          length: width, stiffness: 0.07, damping: 0.12 }));
      }
      break;
    }
    case 'roller':
    case 'pedestal':
      b = Bodies.fromVertices(x, y, [def.outline.map(([x, y]) => ({ x, y }))],
        { angle, density: 0.0015, friction: def.kind === 'roller' ? 0.33 : 0.62 });
      break;
    case 'ball':
      b = Bodies.circle(x, y, def.r, { density: 0.001, friction: 0.02, frictionAir: 0.006, restitution: 0.42 });
      break;
    case 'cup':
      b = Bodies.rectangle(x, y, def.w, def.h, { ...opts, density: 0.0022, friction: 0.45, restitution: 0.02 });
      break;
    case 'pen':
      b = Bodies.rectangle(x, y, def.w, def.h, { ...opts, density: 0.0009, friction: 0.25, restitution: 0.05 });
      break;
    case 'wedge':
      b = Bodies.fromVertices(x, y, [[{ x: -31, y: 23 }, { x: 31, y: 23 }, { x: 0, y: -23 }]], { density: 0.0013, friction: 0.5, restitution: 0.02 });
      break;
    default:
      b = Bodies.rectangle(x, y, def.w, def.h, { ...opts, density: def.kind === 'box' ? 0.0012 : 0.0016, friction: 0.55, frictionStatic: 0.9, restitution: 0.02 });
  }
  b.plugin.def = def;
  return b;
}

/* ================= 关卡生成（种子化） ================= */
// 第一桌从少量经过试玩的布局里选：一件无人压的目标供首次收取 + 一个「搬开求稳 / 直接带压抽」的看得懂的选择
const TEACH_SEEDS = [5532, 90210, 4242];
const RULER_SEED = 2718;
const RAMP_SEED = 3141;
const LEVELS = [
  { name: '桌面初试' },
  { name: '长尺与杯子', seed: RULER_SEED },
  { name: '斜坡与挡块', seed: RAMP_SEED },
  { name: '双支点桥板', family: 'bridge' },
  { name: '滚球托架', family: 'cradle' },
  { name: '倾倒连锁', family: 'domino' },
  { name: '六角滚轴', family: 'rollers' },
  { name: '错层天平', family: 'balance' },
  { name: '笔袋配重', family: 'pouches' },
  { name: '抽纸书架', family: 'sheets' },
  { name: '三联卸载', family: 'span' },
];
function freshSeed() { return Math.floor(Math.random() * 1e9); }

function lateLayout(rng, round, family) {
  const deskW = isPortraitWorld() ? 520 : Math.min(740 + round * 12, 920);
  const dL = (W - deskW) / 2, dR = dL + deskW;
  const goalColor = pick(rng, GOAL_POOL);
  const direction = rng() < 0.5 ? -1 : 1;
  const rimGap = rand(rng, 43, 55) - Math.min(round - 4, 2) * 12;
  const origin = deskW / 2 - rimGap - 118;
  const defs = [];
  function place(kind, color, x, bottom, w, h, stack, layer = 0, angle = 0) {
    const def = { ...makeDef(rng, kind, color), w, h, isGuard: color === 'yellow' };
    if (kind === 'ball') def.r = w / 2;
    if (kind === 'roller') def.outline = [
      [-w / 2, 0], [-w / 4, -h / 2], [w / 4, -h / 2],
      [w / 2, 0], [w / 4, h / 2], [-w / 4, h / 2],
    ];
    if (kind === 'pedestal') def.outline = [
      [-w / 4, -5 * h / 9], [w / 4, -5 * h / 9],
      [w / 2, 4 * h / 9], [-w / 2, 4 * h / 9],
    ];
    const baseOffset = kind === 'pedestal' ? 4 * h / 9 : h / 2;
    defs.push({ def, x: W / 2 + direction * x, y: DESK_TOP - bottom - baseOffset,
      angle: direction * angle, stack, level: layer });
  }
  const span = rand(rng, 53, 63);
  const height = rand(rng, 55, 64);
  const side = origin - rand(rng, 207, 217);
  let need;
  if (family === 'bridge') {
    // Both feet must come out. The offset book and ball load the same deck.
    need = 3;
    place('box', goalColor, origin - span, 0, 48, height, 0);
    place('cup', goalColor, origin + span, 0, 49, height, 1);
    place('plank', 'wood', origin, height, span * 2 + 80, 16, 0, 1);
    place('book', 'wood', origin + 24, height + 16, 91, 23, 0, 2);
    place('ball', 'yellow', origin + 31, height + 39, 45, 45, 0, 3);
    place('box', 'wood', origin - span, height + 16, 43, 46, 1, 2);
    place('book', 'wood', side, 0, 100, 22, 2);
    place('pen', goalColor, side + 6, 22, 119, 15, 2, 1);
  } else if (family === 'cradle') {
    // The floor of the cradle is a target too. Its two walls carry a lid.
    need = 4;
    const gap = rand(rng, 6, 9);
    place('book', goalColor, origin, 0, 226, 24, 0);
    place('ball', goalColor, origin - 27 - gap, 24, 54, 54, 0, 1);
    place('ball', goalColor, origin + 27 + gap, 24, 54, 54, 1, 1);
    place('ball', 'yellow', origin, 65, 48, 48, 0, 2);
    place('box', 'wood', origin - 77 - gap, 24, 44, 96, 2, 1);
    place('box', 'wood', origin + 77 + gap, 24, 44, 96, 3, 1);
    place('plank', 'wood', origin, 120, 211, 15, 2, 2);
    place('ball', 'wood', origin + 44, 135, 39, 39, 2, 3);
    place('book', goalColor, side, 0, 104, 24, 4);
    place('pen', 'wood', side + 5, 24, 125, 14, 4, 1);
    place('cup', 'wood', side + 14, 38, 45, 57, 4, 2);
    place('book', 'wood', side + 12, 95, 82, 18, 4, 3);
    place('ball', 'wood', side + 20, 113, 31, 31, 4, 4);
  } else if (family === 'domino') {
    // The low key supports a tall column. The second column shares its cap;
    // taking the key first can transfer that load down the line to the cup.
    need = 5;
    const beamHeight = height + 103;
    place('book', 'wood', origin - 70, 0, 60, 22, 0);
    place('box', goalColor, origin - 18, 0, 39, 22, 1);
    place('box', 'wood', origin - 33, 22, 42, height + 42, 0, 1);
    place('book', goalColor, origin - 30, height + 64, 72, 19, 0, 2);
    place('box', 'wood', origin - 32, height + 83, 43, 20, 0, 3);
    place('box', goalColor, origin + 34, 0, 32, beamHeight, 2);
    place('plank', 'wood', origin + 9, beamHeight, 155, 15, 0, 4);
    place('ball', 'yellow', origin + 39, beamHeight + 15, 43, 43, 0, 5);
    place('pen', goalColor, origin + 88, 0, 68, 16, 3);
    place('cup', 'wood', origin + 91, 16, 48, 56, 3, 1);
    place('book', 'wood', origin + 90, 72, 62, 17, 3, 2);
    place('pen', 'wood', origin + 86, 89, 76, 13, 3, 3);
    place('ball', 'wood', origin + 94, 102, 34, 34, 3, 4);
    place('book', goalColor, side, 0, 113, 23, 4);
    place('book', 'wood', side + 7, 23, 82, 22, 4, 1);
    place('plank', 'wood', side + 10, 45, 135, 14, 4, 2);
    place('box', 'wood', side + 24, 59, 50, 37, 4, 3);
    place('ball', 'wood', side + 26, 96, 43, 43, 4, 4);
  } else if (family === 'rollers') {
    need = 6;
    // Two loaded axles on each base. Removing a single axle tips its deck.
    for (const [stack, x] of [side, origin].entries()) {
      const offset = stack === 0 ? -10 : 10;
      place('book', goalColor, x, 0, 168, 21, stack);
      place('roller', goalColor, x - 44, 21, 49, 42, stack, 1);
      place('roller', goalColor, x + 44, 21, 49, 42, stack, 1);
      place('plank', 'wood', x, 63, 169, 15, stack, 2);
      place('box', 'wood', x - 45, 78, 42, 53, stack, 3);
      place('cup', 'wood', x + 45, 78, 44, 53, stack, 3);
      place('book', 'wood', x + offset, 131, 147, 18, stack, 4);
      place('roller', 'wood', x + offset, 149, 51, 44, stack, 5);
      place('pen', 'wood', x + offset, 193, 91, 14, stack, 6);
      place('ball', stack === 0 ? 'yellow' : 'wood', x + offset, 207, 36, 36, stack, 7);
    }
  } else if (family === 'balance') {
    need = 7;
    // The top shelf spans both towers. Its weight shifts between them.
    const mid = (side + origin) / 2;
    for (const [stack, x] of [side, origin].entries()) {
      const inward = stack === 0 ? 1 : -1;
      place('book', goalColor, x, 0, 154, 21, stack);
      place('pedestal', goalColor, x - 36, 21, 63, 48, stack, 1);
      place('pedestal', 'wood', x + 36, 21, 63, 48, stack, 1);
      place('plank', 'wood', x, 69, 154, 16, stack, 2);
      place('cup', 'wood', x - inward * 37, 85, 47, 60, stack, 3);
      place('roller', goalColor, x + inward * 35, 85, 69, 60, stack, 3);
      place('book', 'wood', x + inward * 17, 145, 157, 21, stack, 4);
      place('pedestal', 'wood', x + inward * 38, 166, 70, 49, stack, 5);
    }
    place('plank', goalColor, mid, 215, 199, 18, 2);
    place('pedestal', 'wood', mid - 44, 233, 55, 40, 2, 1);
    place('box', 'wood', mid + 44, 233, 44, 40, 2, 1);
    place('book', 'wood', mid, 273, 141, 18, 2, 2);
    place('roller', 'wood', mid, 291, 48, 42, 2, 3);
    place('pen', 'wood', mid, 333, 90, 13, 2, 4);
    place('ball', 'yellow', mid, 346, 33, 33, 2, 5);
  } else {
    const sheets = family === 'sheets', linked = family === 'span';
    const spacing = rand(rng, 145, 153);
    // Three bays fit the narrow table. Each has a target foot and a loaded tray.
    for (let bay = -1; bay <= 1; bay++) {
      const x = bay * spacing, stack = bay + 1;
      const bias = bay === 1 ? -1 : 1;
      if (linked) {
        place('book', goalColor, x, 0, 142, 12, stack);
        place('plank', 'wood', x, 12, 130, 9, stack, 1);
        place('book', goalColor, x, 21, 133, 10, stack, 2);
      } else place('book', goalColor, x, 0, 133, 18, stack);
      const foot = linked ? 31 : 18;
      place('pouch', goalColor, x + bias * 30, foot, 67, 52 - foot, stack, 1);
      place(linked ? 'eraser' : 'box', 'wood', x - bias * 37, foot, 46, 52 - foot, stack, 1);
      place('book', goalColor, x, 52, 131, 14, stack, 2);
      place('cup', 'wood', x - 32, 66, 43, 52, stack, 3);
      place('pedestal', sheets || linked ? goalColor : 'wood', x + 31, 66, 53, 52, stack, 3);
      place('plank', 'wood', x, 118, 130, 14, stack, 4);
      if (family === 'pouches') {
        place('pouch', 'wood', x + bias * 10, 132, 89, 32, stack, 5);
        place('ball', bay === 0 ? 'yellow' : 'wood', x + bias * 14, 164, 35, 35, stack, 6);
      } else {
        place('pouch', 'wood', x, 132, 96, 32, stack, 5);
        place(sheets ? 'paper' : 'book', sheets ? goalColor : 'wood', x, 164, 117, 17, stack, 6);
        if (!linked) {
          place('eraser', 'wood', x - 29, 181, 48, 40, stack, 7);
          place('box', 'wood', x + 29, 181, 42, 40, stack, 7);
          place('pen', 'wood', x, 221, 96, 12, stack, 8);
          place('ball', bay === 0 ? 'yellow' : 'wood', x, 233, 33, 33, stack, 9);
        }
      }
    }
    if (linked) {
      // Each beam rests across two bays. The centre bay supports both beams.
      for (const side of [-1, 1]) {
        const x = side * spacing / 2, stack = side + 4;
        place('plank', 'wood', x, 181, spacing - 3, 16, stack);
        place('paper', goalColor, x, 197, 124, 12, stack, 1);
        place('pouch', goalColor, x, 209, 102, 22, stack, 2);
        place('book', 'wood', x, 231, 110, 17, stack, 2);
        place('eraser', 'wood', x, 248, 88, 23, stack, 3);
      }
      place('plank', 'wood', 0, 271, spacing + 42, 16, 6);
      // Exposed beam ends tilt together; the lower ball can be struck by a falling one.
      place('ball', 'wood', -spacing / 2 + 5, 287, 28, 28, 6, 1);
      place('ball', 'wood', spacing / 2 - 8, 287, 36, 36, 6, 1);
      place('ball', 'wood', spacing + 32, 181, 32, 32, 2, 7);
      place('pedestal', goalColor, -24, 287, 46, 26, 6, 1);
      place('pedestal', goalColor, 24, 287, 46, 26, 6, 1);
      place('pouch', 'wood', 0, 313, 92, 21, 6, 2);
      place('pouch', 'yellow', 0, 334, 54, 24, 6, 3);
    }
    need = defs.filter(item => item.def.color === goalColor).length - (linked ? 1 : 0);
  }
  for (const item of defs) item.levels = 1 + Math.max(...defs.filter(d => d.stack === item.stack).map(d => d.level));
  return { defs, deskW, dL, dR, goalColor, need, family };
}
function featureLayout(rng, ramp) {
  const deskW = isPortraitWorld() ? 520 : 730;
  const defs = [];
  function place(kind, color, dx, bottom, w, h, stack, level, angle = 0) {
    const def = { ...makeDef(rng, kind, color), w, h, isGuard: color === 'yellow' };
    if (kind === 'ball') def.r = w / 2;
    const layered = stack === 0 || (ramp && stack === 2);
    defs.push({ def, x: W / 2 + dx, y: DESK_TOP - bottom - h / 2, angle, stack, level, levels: layered ? 3 : 1 });
    return def;
  }
  if (ramp) {
    // A book rests on a block. The cup holds the ball on the slope;
    // the free-standing target near the rim can serve as a backstop.
    const edge = deskW / 2;
    place('box', 'wood', edge - 272, 0, 44, 49, 0, 0);
    place('book', 'wood', edge - 188, 23, 225, 16, 0, 1, 0.21);
    place('cup', 'green', edge - 167, 42, 40, 62, 0, 2);
    place('ball', 'yellow', edge - 215, 52, 42, 42, 0, 2);
    place('box', 'green', edge - 44, 0, 56, 64, 1, 0);
    const left = -deskW / 2 + 90;
    place('pen', 'green', left, 0, 108, 12, 2, 0);
    place('book', 'green', left + 12, 12, 80, 23, 2, 1);
    place('box', 'wood', left + 18, 35, 40, 35, 2, 2);
    return { deskW, dL: (W - deskW) / 2, dR: (W + deskW) / 2, need: 3, goalColor: 'green', defs };
  }
  place('box', 'blue', -92, 0, 50, 84, 0, 0);
  place('box', 'yellow', -40, 0, 46, 84, 1, 0);
  place('plank', 'wood', 0, 84, 270, 12, 0, 1).ruler = true;
  place('book', 'blue', -84, 96, 94, 28, 0, 2);
  place('cup', 'blue', 147, 0, 50, 62, 2, 0);
  return { deskW, dL: (W - deskW) / 2, dR: (W + deskW) / 2, need: 2, goalColor: 'blue', defs };
}
function introLayout(rng) {
  const portrait = isPortraitWorld();
  const deskW = portrait ? W - 240 : 660;
  const dL = (W - deskW) / 2, dR = dL + deskW;
  const stacks = [
    { fx: 0.27, items: [['plank', 'wood'], ['cup', 'red'], ['box', 'yellow', true]] },
    { fx: 0.74, items: [['plank', 'wood'], ['cup', 'red'], ['book', 'wood'], ['ball', 'wood']] },
  ];
  const loose = [{ fx: 0.5, kind: 'ball', color: 'red' }];
  const defs = [];
  const margin = portrait ? 100 : 130;
  stacks.forEach((st, si) => {
    const sx = clamp(dL + deskW * st.fx, dL + margin, dR - margin);
    let cum = 0;
    st.items.forEach(([kind, color, guard], lv) => {
      const def = makeDef(rng, kind, color);
      if (guard) def.isGuard = true;
      const h = def.kind === 'ball' ? def.r * 2 : def.h;
      const x = sx + (lv === 0 ? 0 : rand(rng, -13, 13));
      const y = DESK_TOP - cum - h / 2 + 1;
      defs.push({ def, x, y, level: lv, stack: si, levels: st.items.length });
      cum += h - 2;
    });
  });
  for (const L of loose) {
    const def = makeDef(rng, L.kind, L.color);
    const h = def.kind === 'ball' ? def.r * 2 : def.h;
    const x = clamp(dL + deskW * L.fx, dL + (portrait ? 90 : 110), dR - (portrait ? 90 : 110));
    defs.push({ def, x, y: DESK_TOP - h / 2, level: 0, stack: -1, levels: 1 });
  }
  return { deskW, dL, dR, need: 2, goalColor: 'red', defs };
}

/* 难度由「停稳后的实际关系」决定，而非物件数量：
   稳妥档看有几件目标必须动手整理才拿得到；三星档额外看滚球 / 边缘救件等判断。 */
function sheetParts(body) {
  return body.plugin.wings ? [body, ...body.plugin.wings] : [body];
}
function worldPieces(bodies) {
  return bodies.flatMap(body => [...sheetParts(body), ...(body.plugin.hinges || [])]);
}
function loadsOn(base, bodies) {
  if (base.plugin.wings || bodies.some(b => b.plugin.wings)) {
    const parts = bodies.flatMap(sheetParts);
    const owners = new Set(sheetParts(base).flatMap(part => loadsOnPart(part, parts))
      .map(part => part.plugin.sheet || part));
    owners.delete(base);
    return Array.from(owners);
  }
  return loadsOnPart(base, bodies);
}
function loadsOnPart(base, bodies) {
  return bodies.filter(other => {
    if (other === base || other.position.y >= base.position.y) return false;
    const a = base.bounds, b = other.bounds;
    if (b.max.y <= a.min.y + 7 && b.max.y >= a.min.y - 12
        && b.min.x < a.max.x - 5 && b.max.x > a.min.x + 5) return true;
    // Two lower balls can carry a third through diagonal contacts.
    const hit = Query.collides(base, [other])[0];
    if (!hit) return false;
    const normalOnOther = hit.bodyA === other ? hit.normal.y : -hit.normal.y;
    return normalOnOther < -0.35;
  });
}
function analyzeLayout(bodies, layout) {
  const goals = bodies.filter(b => b.plugin.def.color === layout.goalColor);
  const easy = goals.filter(g => loadsOn(g, bodies).length === 0).length;
  const buried = Math.max(0, layout.need - easy);
  const maxLevels = Math.max(...layout.defs.map(d => d.levels));
  const roll = layout.defs.some(d => d.def.kind === 'ball' && d.stack >= 0 && d.level === d.levels - 1);
  const sweep = layout.defs.some(d => (d.def.kind === 'book' || d.def.kind === 'pen') && d.level > 0);
  const precarious = layout.defs.some(d => d.stack === -1 && (d.x < layout.dL + 150 || d.x > layout.dR - 150));
  const safe = clamp(1 + buried + (maxLevels >= 5 ? 1 : 0), 1, 5);
  const star = clamp(1 + buried + (roll ? 1 : 0) + (precarious ? 1 : 0), 1, 5);
  const tags = [];
  if (buried > 0) tags.push('带压抽取');
  if (roll) tags.push('滚球');
  if (sweep) tags.push('长件转动');
  if (precarious) tags.push('边缘救件');
  if (buried > 0 && easy >= 1) tags.push('双路线');
  return { safe, star, easy, buried, roll, sweep, precarious, tags };
}

function buildRound(seed, round) {
  const safeT = clamp(1 + Math.floor(round / 2), 1, 5);
  const starT = clamp(1 + Math.floor(round / 1.3), 1, 5);
  let usedSeed = seed, layout = null, fallback = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    usedSeed = seed + attempt * 7919;
    const rng = mulberry32(usedSeed);
    const rulerTable = round === 2;
    const rampTable = round === 3;
    if (round >= 4) layout = lateLayout(rng, round, LEVELS[round - 1].family);
    else layout = rulerTable || rampTable ? featureLayout(rng, rampTable) : introLayout(rng);
    if ((rulerTable || rampTable) && seed !== LEVELS[round - 1].seed) {
      // Mirror or shift the same puzzle, preserving all contact geometry.
      const direction = rng() < 0.5 ? -1 : 1;
      const offset = rand(rng, -12, 12);
      for (const slot of layout.defs) {
        slot.x = W / 2 + direction * (slot.x - W / 2) + offset;
        slot.angle = direction * (slot.angle || 0);
      }
    }
    Composite.clear(world, false);
    deskLeft = layout.dL; deskRight = layout.dR;
    deskBody = Bodies.rectangle(W / 2, DESK_TOP + 13, layout.deskW, 26, { isStatic: true, friction: 0.7, restitution: 0 });
    Composite.add(world, deskBody);
    const bodies = layout.defs.map(d => makeBody(d.def, d.x, d.y, d.angle));
    Composite.add(world, worldPieces(bodies));
    const settlingSteps = bodies.some(b => b.plugin.wings) ? 840 : 480;
    for (let i = 0; i < settlingSteps; i++) Engine.update(engine, STEP);
    if (bodies.some(b => b.plugin.wings)) {
      // Let overhanging paper settle with the same support checks as live play.
      const pieces = bodies.flatMap(sheetParts);
      let quietWindows = 0;
      for (let pass = 0; pass < 5 && quietWindows < 2; pass++) {
        const starts = pieces.map(b => ({ ...b.position, angle: b.angle }));
        for (let i = 0; i < 160; i++) {
          Engine.update(engine, STEP);
          wakeUnsupported(bodies, null);
        }
        if (pieces.every((b, i) => Math.hypot(b.position.x - starts[i].x, b.position.y - starts[i].y) < 2
            && Math.abs(b.angle - starts[i].angle) < 0.05)) quietWindows++;
        else quietWindows = 0;
      }
      if (quietWindows < 2 && attempt < 11) continue;
    }
    const fell = bodies.filter(b => b.position.y > DESK_TOP + 40 || b.position.x < layout.dL - 30 || b.position.x > layout.dR + 30);
    const liveGoal = bodies.filter(b => !fell.includes(b) && b.plugin.def.color === layout.goalColor).length;
    const liveGuard = bodies.filter(b => !fell.includes(b) && b.plugin.def.isGuard).length;
    if (fell.length === 0 && liveGoal >= layout.need && liveGuard >= 1) {
      const diff = analyzeLayout(bodies, layout);
      // 筛掉：开局自滑 / 目标抓不住 / 任务与奖励无法同路线完成；难度落在目标档±1（相邻档重叠）
      const okBand = round === 1 || (Math.abs(diff.safe - safeT) <= 1 && Math.abs(diff.star - starT) <= 1);
      const okPlay = diff.buried >= 1 && (round > 3 || diff.easy >= 1);
      const cand = { layout, bodies, usedSeed, diff };
      // For the authored families, the post-settle geometry matters more
      // than a generic count of how many goals have a body above them.
      if (layout.family && bodies.every((body, i) => {
        const slot = layout.defs[i];
        return Math.hypot(body.position.x - slot.x, body.position.y - slot.y) < 20
          && Math.abs(body.angle - (slot.angle || 0)) < 0.18
          && body.speed < 0.5;
      })) return cand;
      if (rulerTable || rampTable || (okBand && okPlay)) return cand;
      const distance = Math.abs(diff.safe - safeT) + Math.abs(diff.star - starT) + (okPlay ? 0 : 8);
      if (!fallback || distance < fallback.distance) fallback = { ...cand, distance, deskBody };
    }
  }
  if (fallback) {
    Composite.clear(world, false);
    deskBody = fallback.deskBody;
    deskLeft = fallback.layout.dL;
    deskRight = fallback.layout.dR;
    Composite.add(world, [deskBody, ...worldPieces(fallback.bodies)]);
    return fallback;
  }
  const bodies = Composite.allBodies(world).filter(b => b !== deskBody && !b.plugin.sheet);
  return { layout, bodies, usedSeed, diff: analyzeLayout(bodies, layout) };
}

/* ================= 游戏状态 ================= */
const G = {
  state: 'intro',
  round: 1, seed: 0, usedSeed: 0,
  banked: 0, roundScore: 0, baseSum: 0, comboSum: 0, penaltySum: 0,
  streakColor: null, streak: 0, bestStreak: 0,
  roundsCleared: 0, totalCollected: 0, totalFallen: 0,
  mission: null, bodies: [],
  grabbed: null, grabStart: null, grabConstraint: null, hoverBody: null,
  grabDare: null, dareCandidates: [], dareDone: false, dareLive: false,
  nearPlayed: false, diff: null, offColorDrags: 0, dragCharged: false,
  pendingEnd: null, resolveStart: 0, calmFrames: 0,
  lampOn: true, trayCounts: [0, 0],
  pointer: { x: -999, y: -999 },
};

/* 同桌最佳（持久）与上次尝试（会话），用于结算对比 */
const tableKey = () => `${G.round}:${G.usedSeed}`;
function readRecords(key) {
  try {
    const records = JSON.parse(localStorage.getItem(key));
    if (records && typeof records === 'object' && !Array.isArray(records)) return records;
  } catch (_) { /* Storage may be unavailable. */ }
  return {};
}
const tableBest = readRecords('deskpull.best.catalog.v2');
const levelSeeds = readRecords('deskpull.levels.catalog.v1');
// Old records used a round number unrelated to the physical challenge.
const legacyStars = new Map();
for (const [key, record] of Object.entries(readRecords('deskpull.best.catalog.v1'))) {
  const level = Number(key.split(':')[0]);
  legacyStars.set(level, Math.max(legacyStars.get(level) || 0, record?.stars || 0));
}
const oldSeeds = readRecords('deskpull.levels.v1');
for (const [key, record] of Object.entries(readRecords('deskpull.best.v1'))) {
  const [round, used] = key.split(':').map(Number);
  let level;
  if (round === 1) level = 1;
  else if (round === 2 && used === RULER_SEED) level = 2;
  else if (round === 3 && used === RAMP_SEED) level = 3;
  else if (round >= 4) {
    const seed = oldSeeds[round]?.seed;
    const attempt = (used - seed) / 7919;
    if (Number.isInteger(attempt) && attempt >= 0 && attempt < 12) level = [4, 5, 2, 6][seed % 4];
  }
  if (level && record) legacyStars.set(level, Math.max(legacyStars.get(level) || 0, record.stars || 0));
}
function rememberLayout() {
  levelSeeds[G.round] = { seed: G.seed, portrait: isPortraitWorld() };
  try { localStorage.setItem('deskpull.levels.catalog.v1', JSON.stringify(levelSeeds)); } catch (_) {}
}
const lastAttempt = {};
function saveBest() { try { localStorage.setItem('deskpull.best.catalog.v2', JSON.stringify(tableBest)); } catch (_) { /* 隐私模式忽略 */ } }

const effects = { floats: [], particles: [], collectAnims: [], shake: 0, dust: [] };
for (let i = 0; i < 26; i++) {
  effects.dust.push({ x: Math.random() * W, y: 120 + Math.random() * 380, s: 0.6 + Math.random() * 1.6, ph: Math.random() * Math.PI * 2, sp: 0.1 + Math.random() * 0.25 });
}

const CLEAR_BONUS = 400;
const DRAG_COST = 30;
function newMission(layout) {
  const bonuses = [];
  bonuses.push({ id: 'guard', label: '守住★黄件', reward: 250, voided: false, done: false });
  bonuses.push({ id: 'perfect', label: '零坠落', reward: 300, voided: false, done: false });
  bonuses.push({ id: 'dare', label: '冒险抽', reward: 150, voided: false, done: false });

  // 满分只按「收齐必做目标即结算」之前真正能完成的动作计算：need 件满连取 + 全部奖励 + 过关
  let goalMax = 0;
  for (let i = 1; i <= layout.need; i++) goalMax += 100 * Math.min(i, 3);
  const maxScore = goalMax + 150 + 250 + 300 + CLEAR_BONUS;
  return { need: layout.need, goalColor: layout.goalColor, got: 0, bonuses, maxScore };
}

function startRound(seed, round, keepBanked = true, sameLayout = false) {
  // Multi-bay puzzles share one physics layout across devices; fit the camera.
  if (round >= 9) setWorldDims(false);
  else if (!sameLayout) setWorldDims();
  G.round = round;
  G.seed = seed;
  const baseSeed = round === 1 ? TEACH_SEEDS[Math.abs(seed) % TEACH_SEEDS.length] : seed;
  const built = buildRound(baseSeed, round);
  resize();
  G.usedSeed = built.usedSeed;
  G.bodies = built.bodies;
  G.diff = built.diff;
  G.mission = newMission(built.layout);
  if (G.state !== 'intro') rememberLayout();
  if (!keepBanked) G.banked = 0;
  G.roundScore = 0; G.baseSum = 0; G.comboSum = 0; G.penaltySum = 0;
  G.streakColor = null; G.streak = 0;
  G.grabbed = null; G.grabStart = null; G.grabConstraint = null; G.hoverBody = null;
  G.grabDare = null; G.dareCandidates = []; G.dareDone = false; G.dareLive = false; G.nearPlayed = false;
  G.offColorDrags = 0; G.dragCharged = false;
  G.pendingEnd = null; G.calmFrames = 0;
  G.trayCounts = [0, 0];
  collectedThisRound = 0;
  effects.floats = []; effects.particles = []; effects.collectAnims = []; effects.shake = 0;
  roundNumEl.textContent = round;
  seedTagEl.textContent = '#' + String(G.usedSeed % 10000).padStart(4, '0');
  buildObjectiveChips();
  updateHUD();
}

/* ================= HUD ================= */
function buildObjectiveChips() {
  const m = G.mission;
  const c = COLORS[m.goalColor];
  objectivesEl.innerHTML = '';
  const goal = document.createElement('div');
  goal.className = 'chip chip-goal';
  goal.id = 'chipGoal';
  goal.style.setProperty('--chip-c', c.hex);
  goal.innerHTML = `<span class="swatch"></span><span>取出${c.name}件 <b id="goalProg">0/${m.need}</b></span>`;
  objectivesEl.appendChild(goal);

}
function updateChips() {
  const m = G.mission;
  const gp = $('goalProg');
  if (gp) gp.textContent = `${Math.min(m.got, m.need)}/${m.need}`;

}
function pulseChip(id) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}
function updateHUD() {
  totalScoreEl.textContent = G.banked + G.roundScore;
  roundScoreEl.textContent = G.roundScore !== 0 ? `本桌 ${G.roundScore > 0 ? '+' : ''}${G.roundScore}` : '';
  updateChips();
}
function toast(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  toastsEl.appendChild(el);
  setTimeout(() => el.remove(), 2700 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--site-motion')) || 1));
  while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
}
function showCombo(mult) {
  comboBanner.textContent = `同色连取 ×${mult}`;
  comboBanner.classList.remove('hidden');
  comboBanner.style.animation = 'none';
  void comboBanner.offsetWidth;
  comboBanner.style.animation = '';
  clearTimeout(showCombo._t);
  showCombo._t = setTimeout(() => comboBanner.classList.add('hidden'), 950);
}

/* ================= 特效 ================= */
function addFloat(x, y, text, color, size = 24) {
  effects.floats.push({ x, y, text, color, size, t: 0 });
}
function addSparkle(x, y, color, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3.4;
    effects.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.4, life: 1, decay: 0.02 + Math.random() * 0.02, color, size: 2 + Math.random() * 3, kind: 'spark' });
  }
}
function addDustPuff(x, y, n = 10) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 0.5 + Math.random() * 2;
    effects.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 0.6, life: 1, decay: 0.015 + Math.random() * 0.015, color: '#c9b39a', size: 3 + Math.random() * 5, kind: 'dust' });
  }
}
function addConfetti() {
  const cols = ['#f2b33d', '#4a9fe8', '#52c48a', '#e8604c', '#ffd98a'];
  for (let i = 0; i < 90; i++) {
    effects.particles.push({
      x: W / 2 + rand(Math.random, -260, 260), y: 140 + Math.random() * 80,
      vx: rand(Math.random, -3, 3), vy: rand(Math.random, -4, 1),
      life: 1, decay: 0.006 + Math.random() * 0.006, color: pick(Math.random, cols),
      size: 4 + Math.random() * 5, kind: 'confetti', rot: Math.random() * 6, vr: rand(Math.random, -0.2, 0.2),
    });
  }
}

/* ================= 收取 / 坠落 ================= */
function collectBody(body) {
  const def = body.plugin.def;
  const m = G.mission;
  const isGoal = def.color === m.goalColor;
  // 冒险抽：收取瞬间只记录「带压抽取正在发生」，是否成立等连锁停稳后判定（成功反馈留到那时）
  if (isGoal && body === G.grabbed && G.grabDare && G.grabDare.loads.length) {
    G.dareCandidates.push(G.grabDare);
    G.grabDare = null;
    G.dareLive = true;
  }
  let pts = 0, mult = 1;
  if (isGoal) {
    if (def.color === G.streakColor) G.streak++; else { G.streak = 1; G.streakColor = def.color; }
    G.bestStreak = Math.max(G.bestStreak, G.streak);
    mult = Math.min(G.streak, 3);
    pts = 100 * mult;
    G.roundScore += pts; G.baseSum += 100; G.comboSum += pts - 100;
    m.got++; pulseChip('chipGoal');
  }
  // A collected obstacle belongs to the current drag, including at the table edge.
  G.totalCollected++; collectedThisRound++;
  if (!isGoal && G.grabbed === body) chargeOffColorDrag();
  if (def.isGuard) {
    const b = m.bonuses.find(x => x.id === 'guard');
    if (b && !b.voided) { b.voided = true; toast('守护件被收走，那份奖励放弃了', 'info'); }
  }
  const p = body.position;
  const lifted = p.y < COLLECT_TOP;
  if (isGoal) {
    addFloat(p.x, p.y - 20, `+${pts}`, mult >= 2 ? '#ffd98a' : '#b8f0d2', mult >= 2 ? 30 : 24);
    addSparkle(p.x, p.y, COLORS[def.color].light, (mult >= 2 ? 22 : 12) + (lifted ? 10 : 0));
    AudioSys.collect(mult);
    if (mult >= 2) showCombo(mult);
  } else {
    addFloat(p.x, p.y - 16, '清障', '#c9b39a', 18);
    addSparkle(p.x, p.y, '#dcb488', 8);
    AudioSys.collect(1);
  }
  if (lifted) addFloat(p.x, p.y - 44, '收下!', '#ffd98a', 20);
  // 收纳入盒动画
  const side = p.x < W / 2 ? 0 : 1;
  const target = lifted ? { x: p.x, y: -50 } : { x: trayCX(side), y: DESK_TOP - 26 };
  effects.collectAnims.push({ def, from: { x: p.x, y: p.y, angle: body.angle }, to: target, t: 0, side, lifted });
  if (!lifted) G.trayCounts[side]++;
  removeBody(body);
  if (G.grabbed === body) releaseGrab();
  updateHUD();
  if (m.got >= m.need && !G.pendingEnd) beginResolve('success');
}

function fallBody(body) {
  const def = body.plugin.def;
  const m = G.mission;
  G.roundScore -= 80; G.penaltySum += 80; G.totalFallen++;
  G.streak = 0; G.streakColor = null;
  const perfect = m.bonuses.find(x => x.id === 'perfect');
  if (perfect && !perfect.voided) perfect.voided = true;
  const p = body.position;
  addFloat(clamp(p.x, 60, W - 60), Math.min(p.y, DESK_TOP + 40), '−80', '#ff9d8a', 26);
  addDustPuff(clamp(p.x, 40, W - 40), DESK_TOP + 30, 12);
  effects.shake = Math.max(effects.shake, 7);
  AudioSys.fall();
  if (def.isGuard) {
    const b = m.bonuses.find(x => x.id === 'guard');
    if (b && !b.voided) { b.voided = true; toast('★守护件坠桌了！', 'bad'); }
  } else {
    toast(`${COLORS[def.color].name}件意外坠桌 −80`, 'bad');
  }
  removeBody(body);
  if (G.grabbed === body) releaseGrab();
  updateHUD();
  if (m.got >= m.need) { if (!G.pendingEnd) beginResolve('success'); return; }
  const liveGoal = G.bodies.filter(b => b.plugin.def.color === m.goalColor).length;
  if (G.bodies.length === 0) {
    beginResolve('fail-collapse');
  } else if (m.got + liveGoal < m.need) {
    beginResolve('fail-target');
  } else if (def.color === m.goalColor) {
    toast(`桌上还有 ${liveGoal} 件${COLORS[m.goalColor].name}件，目标仍能完成`, 'info');
  }
}

function removeBody(body) {
  const carriedLoad = loadsOn(body, G.bodies).length;
  Composite.remove(world, worldPieces([body]));
  G.bodies = G.bodies.filter(b => b !== body);
  if (carriedLoad) AudioSys.shift();
}

function beginResolve(kind) {
  if (G.pendingEnd) return;
  G.pendingEnd = kind;
  G.state = 'resolving';
  G.resolveStart = performance.now();
  G.calmFrames = 0;
  releaseGrab();
}

/* ================= 抓取 ================= */
function pickBody(point, tolerance) {
  const pieces = G.bodies.flatMap(sheetParts);
  const exact = Query.point(pieces, point);
  if (exact.length) return exact[exact.length - 1];
  let nearest = null, best = Infinity;
  for (const body of pieces) {
    const vertices = body.vertices;
    const def = (body.plugin.sheet || body).plugin.def;
    const reach = tolerance + (Math.min(def.w, def.h) < 14 ? 8 : 0);
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      const distance = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
      if (distance <= reach && distance <= best) { best = distance; nearest = body; }
    }
  }
  return nearest;
}
function tryGrab(wp, tol = 12) {
  if (G.state !== 'playing' || G.grabbed) return;
  const grip = pickBody(wp, tol);
  if (!grip) { tryLamp(wp); return; }
  const body = grip.plugin.sheet || grip;
  G.grabStart = { ...wp };
  G.dragCharged = false;
  // A change of balance can propagate beyond the first touching neighbour.
  for (const item of G.bodies.flatMap(sheetParts)) Sleeping.set(item, false);
  G.grabbed = body;
  G.nearPlayed = false;
  // 记录此刻压在这件上方的承重件：直接从它们底下抽走才算冒险抽
  const loads = loadsOn(body, G.bodies)
    .map(o => ({ body: o, x0: o.position.x, y0: o.position.y, a0: o.angle }));
  G.grabDare = { loads };
  G.grabConstraint = Constraint.create({
    pointA: { x: wp.x, y: wp.y },
    bodyB: grip,
    pointB: { x: wp.x - grip.position.x, y: wp.y - grip.position.y },
    stiffness: 0.03, damping: 0.18, length: 0,
  });
  Composite.add(world, G.grabConstraint);
  canvas.classList.add('grabbing');
  AudioSys.grab();
}
function chargeOffColorDrag() {
  if (!G.grabbed || G.dragCharged || G.grabbed.plugin.def.color === G.mission.goalColor) return;
  G.dragCharged = true;
  G.offColorDrags++;
  G.roundScore -= DRAG_COST;
  G.streak = 0; G.streakColor = null;
  const { x, y } = G.grabbed.position;
  addFloat(x, y - 22, `搬动 −${DRAG_COST}`, '#ff9d8a', 18);
  updateHUD();
}
function trackDrag(wp) {
  G.pointer = wp;
  if (G.grabStart && Math.hypot(wp.x - G.grabStart.x, wp.y - G.grabStart.y) * view.scale >= 5)
    chargeOffColorDrag();
}
function releaseGrab() {
  G.grabStart = null;
  if (G.grabConstraint) Composite.remove(world, G.grabConstraint);
  G.grabConstraint = null;
  G.grabbed = null;
  G.grabDare = null;
  canvas.classList.remove('grabbing');
}
function tryLamp(wp) {
  const l = lampPos();
  if (Math.hypot(wp.x - l.x, wp.y - l.y) < 52) {
    G.lampOn = !G.lampOn;
    AudioSys.click();
    toast(G.lampOn ? '台灯亮了，看清楚了' : '台灯关了，月色也够用', 'info');
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary || e.button !== 0) return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件无活动指针 */ }
  const wp = toWorld(e.clientX, e.clientY);
  G.pointer = wp;
  tryGrab(wp, e.pointerType === 'touch' ? clamp(20 / view.scale, 12, 46) : 12);
});
canvas.addEventListener('pointermove', (e) => {
  if (!e.isPrimary) return;
  const wp = toWorld(e.clientX, e.clientY);
  trackDrag(wp);
  if (G.grabConstraint && G.grabbed) {
    Sleeping.set(G.grabbed, false);
  } else if (G.state === 'playing') {
    const hit = pickBody(wp, 0);
    G.hoverBody = hit?.plugin.sheet || hit;
    canvas.style.cursor = G.hoverBody ? 'grab' : 'default';
  }
});
function edgeDistance(x, side) {
  return side === 0 ? deskLeft - x : x - deskRight;
}
const EDGE_CLEARANCE = 8;
function finishDrag() {
  if (!G.grabbed) return;
  const x = G.grabbed.position.x;
  if (G.state === 'playing' && Math.max(edgeDistance(x, 0), edgeDistance(x, 1)) >= EDGE_CLEARANCE) {
    collectBody(G.grabbed);
  } else releaseGrab();
}
function endPointer(e) {
  if (!e.isPrimary || !G.grabConstraint) return;
  if (e.type === 'pointerup') finishDrag();
  else releaseGrab();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* ================= 每帧逻辑 ================= */
// 抓点限速跟随：指针再快，拖拽也是沉稳的拉力，不是瞬移铁球
Events.on(engine, 'beforeUpdate', () => {
  if (!G.grabConstraint || !G.grabbed) return;
  const c = G.grabConstraint;
  const dx = G.pointer.x - c.pointA.x, dy = G.pointer.y - c.pointA.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.01) {
    const step = Math.min(d, 12);
    c.pointA.x += dx / d * step;
    c.pointA.y += dy / d * step;
  }
});

function wakeUnsupported(bodies = G.bodies, held = G.grabbed) {
  const pieces = bodies.flatMap(sheetParts);
  if (!pieces.some(b => b.isSleeping)) return;
  // A sleeping pile can keep internal contacts after its entire base is gone.
  // Walk current contacts from the desk, including a held object as a support.
  const pending = new Set(pieces);
  const supports = [deskBody];
  if (held) { pending.delete(held); supports.push(held); }
  while (supports.length && pending.size) {
    const base = supports.pop();
    if (base.plugin.sheet || base.plugin.wings) {
      for (const part of sheetParts(base.plugin.sheet || base)) {
        if (pending.delete(part)) supports.push(part);
      }
    }
    for (const hit of Query.collides(base, Array.from(pending))) {
      const other = hit.bodyA === base ? hit.bodyB : hit.bodyA;
      if (pending.delete(other)) supports.push(other);
    }
  }
  for (const item of pending) if (item.isSleeping) Sleeping.set(item, false);
}

function gameTick() {
  wakeUnsupported();
  // 限制拖拽速度：手感沉稳，避免拖件变成横扫一切的铁球
  if (G.grabbed) {
    const v = G.grabbed.velocity;
    const sp = Math.hypot(v.x, v.y);
    if (sp > 14) Body.setVelocity(G.grabbed, { x: v.x * 14 / sp, y: v.y * 14 / sp });
    const p = G.grabbed.position;
    // 高举接近收取线：一次性轻提示
    if (!G.nearPlayed && p.y < COLLECT_TOP + 70 && p.y > COLLECT_TOP) { G.nearPlayed = true; AudioSys.near(); }
    if (p.y < COLLECT_TOP) collectBody(G.grabbed);
  }
  // 圆物开始滚的可见时刻：轻音提示，让玩家来得及停手或换角度
  for (const b of G.bodies) {
    if (b === G.grabbed || b.isSleeping) continue;
    if (b.plugin.def.kind === 'ball' && b.angularSpeed > 0.12) AudioSys.roll();
  }
  // 坠落判定
  for (const b of [...G.bodies]) {
    if (b === G.grabbed) continue;
    const p = b.position;
    if (p.y > DESK_TOP + 80 || p.x < -80 || p.x > W + 80) fallBody(b);
  }
  // 结算等待：连锁反应停稳
  if (G.state === 'resolving') {
    const calm = G.bodies.flatMap(sheetParts).every(b => b.isSleeping || (b.speed < 0.22 && b.angularSpeed < 0.045));
    G.calmFrames = calm ? G.calmFrames + 1 : 0;
    const elapsed = performance.now() - G.resolveStart;
    if (G.calmFrames > 42 || elapsed > 5200) showSettle();
  }
}

/* ================= 结算 ================= */
let collectedThisRound = 0;
// 冒险抽成立：候选承重件中，至少一件停稳后仍在桌上且明显位移过（晃了/滚了又稳住）
function confirmDare() {
  for (const cand of G.dareCandidates) {
    for (const L of cand.loads) {
      if (!G.bodies.includes(L.body)) continue;
      const moved = Math.hypot(L.body.position.x - L.x0, L.body.position.y - L.y0) > 9
        || Math.abs(L.body.angle - L.a0) > 0.12;
      if (moved) return true;
    }
  }
  return false;
}
function bonusResult(b) {
  const m = G.mission;
  if (b.id === 'guard') return !b.voided && G.bodies.some(x => x.plugin.def.isGuard);
  if (b.id === 'perfect') return !b.voided;
  if (b.id === 'dare') return G.dareDone;
  return false;
}
function starCount(success, perfectDone, guardDone, dareDone) {
  if (!success) return 0;
  if (perfectDone && guardDone && dareDone) return 3;
  if (perfectDone) return 2;
  return 1;
}

function showSettle() {
  const kind = G.pendingEnd;
  const m = G.mission;
  const success = kind === 'success';
  G.state = success ? 'success' : 'fail';
  G.dareDone = success && confirmDare();
  if (G.dareDone) AudioSys.dare();
  const organized = G.offColorDrags;
  // 奖励判定
  let bonusSum = 0;
  for (const b of m.bonuses) {
    b.done = success && bonusResult(b);
    if (b.done) bonusSum += b.reward;
  }
  const guardDone = m.bonuses.find(x => x.id === 'guard').done;
  const perfectDone = m.bonuses.find(x => x.id === 'perfect').done;
  const dareDone = G.dareDone;
  const clearBonus = success ? CLEAR_BONUS : 0;
  G.roundScore += bonusSum + clearBonus;
  const stars = starCount(success, perfectDone, guardDone, dareDone);
  const fallen = G.penaltySum / 80;
  const score = G.roundScore;
  const key = tableKey();
  const prev = lastAttempt[key];
  const prevBest = tableBest[key] || null;
  // 最佳先比星数，同星再比分数
  const newRecord = success && (!prevBest || typeof prevBest === 'number' || stars > prevBest.stars || (stars === prevBest.stars && score > prevBest.score));
  if (success) { G.roundsCleared++; AudioSys.success(); addConfetti(); }
  else AudioSys.fail();
  if (newRecord) { tableBest[key] = { stars, score }; saveBest(); }
  lastAttempt[key] = { stars, score, fallen, dareDone, guardKept: guardDone, organized };
  updateHUD();

  const stamp = $('settleStamp'), title = $('settleTitle');
  stamp.className = 'settle-stamp' + (success ? '' : ' stamp-fail');
  stamp.textContent = success ? '过 关' : '失 手';
  const cName = COLORS[m.goalColor].name;

  // 一句点评：优先讲这次最值得注意的表现；同桌重试时优先讲与上次的差别
  let highlight, hint;
  if (success) {
    if (dareDone) highlight = guardDone
      ? '你从承重件底下抽出了目标，上面的晃了晃又稳住了，★件也守住了。'
      : '你从承重件底下抽出了目标，上面的晃了晃又稳住了——这就是冒险抽。';
    else if (guardDone && perfectDone) highlight = '★件守住了，桌面一件没掉，稳。';
    else if (perfectDone) highlight = '零坠落，干干净净收下了目标。';
    else if (G.bestStreak >= 2) highlight = `同色连取 ×${Math.min(G.bestStreak, 3)}，手感不错。`;
    else highlight = '目标到手，这桌拿下了。';
    if (prev) {
      if (stars > prev.stars) highlight = `比上次多亮了 ${stars - prev.stars} 颗星！` + (dareDone && !prev.dareDone ? '这次你敢从底下抽了。' : '');
      else if (prev.fallen > 0 && fallen === 0) highlight = '上次掉下去的物件，这次全保住了。';
      else if (stars === prev.stars && organized < prev.organized && newRecord) highlight = `同为 ${stars} 星，这次拖动挡物少了 ${prev.organized - organized} 次。`;
      else if (stars === prev.stars && score > prev.score) highlight = `同为 ${stars} 星，这次多了 ${score - prev.score} 分。`;
      else if (stars < prev.stars) highlight = `这次 ${stars} 星，上次是 ${prev.stars} 星——换条路线再试试。`;
    }
    hint = score === m.maxScore ? '本桌满分' : '';
    title.textContent = `第 ${G.round} 桌拿下了！`;
  } else if (kind === 'fail-collapse') {
    title.textContent = '整桌崩盘！';
    highlight = '剩余物件全部意外跌下了桌，一件不剩。';
    hint = '';
  } else {
    title.textContent = '目标坠落';
    highlight = `需要的${cName}件掉下了桌，必做目标无法完成了。`;
    hint = '';
  }

  // 星级（第一视觉）
  const starRow = $('starRow');
  starRow.innerHTML = '';
  starRow.classList.toggle('perfect', stars === 3);
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('div');
    s.className = 'settle-star' + (i < stars ? ' lit' : '');
    s.style.setProperty('--d', (i * 280 + 120) + 'ms');
    s.innerHTML = '<div class="star-shape"></div><div class="star-ring"></div>';
    if (i < stars) {
      for (let k = 0; k < 9; k++) {
        const sp = document.createElement('span');
        sp.className = 'star-spark';
        sp.style.setProperty('--a', (k * 40 + Math.random() * 18) + 'deg');
        sp.style.setProperty('--dist', (30 + Math.random() * 26) + 'px');
        s.appendChild(sp);
      }
      setTimeout(() => AudioSys.star(i), i * 280 + 140);
    }
    starRow.appendChild(s);
  }
  $('starCaption').textContent = success
    ? ['完成目标', '完成目标 · 零坠落', '零坠落 · 守住★ · 冒险抽'][stars - 1] || ''
    : '目标未达成';

  $('settleHighlight').textContent = highlight;
  $('settleHint').textContent = hint;
  $('settleHint').hidden = !hint;
  $('scoreDetails').open = false;

  const lines = $('settleLines');
  lines.innerHTML = '';
  let idx = 0;
  const addLine = (label, val, cls, note = '', missed = false) => {
    const el = document.createElement('div');
    el.className = 'sline' + (missed ? ' missed' : '');
    el.style.animationDelay = (idx++ * 60 + 500) + 'ms';
    el.innerHTML = `<span class="sl-label">${label}${note ? `<span class="sl-note">${note}</span>` : ''}</span><span class="sl-val ${cls}">${val}</span>`;
    lines.appendChild(el);
  };
  addLine('目标收益', `+${G.baseSum}`, G.baseSum > 0 ? 'plus' : 'zero', `${m.got} 件${cName}件`);
  if (G.comboSum > 0) addLine('同色连取加成', `+${G.comboSum}`, 'plus', `最高 ×${Math.min(G.bestStreak, 3)}`);
  for (const b of m.bonuses) {
    const note = b.id === 'dare' ? '从承重件底下抽' : '';
    if (b.done) addLine(`奖励 · ${b.label}`, `+${b.reward}`, 'plus', note);
    else addLine(`奖励 · ${b.label}`, '错过', 'zero', b.voided ? '已放弃' : '未达成', true);
  }
  if (organized) addLine('拖动非目标', `−${organized * DRAG_COST}`, 'minus', `${organized} 次`);
  if (G.penaltySum > 0) addLine('意外坠落', `−${G.penaltySum}`, 'minus', `${fallen} 件`);
  if (success) addLine('过关奖励', `+${CLEAR_BONUS}`, 'plus');
  $('settleScore').textContent = (score > 0 ? '+' : '') + score;
  $('scoreMax').textContent = m.maxScore;
  const bestNow = tableBest[key] || null;
  $('scoreBest').textContent = typeof bestNow === 'number' ? String(bestNow) : bestNow ? `${'★'.repeat(bestNow.stars)} ${bestNow.score}` : '—';
  $('recordBadge').classList.toggle('hidden', !newRecord);

  const btns = $('settleBtns');
  btns.innerHTML = '';
  const mkBtn = (text, cls, fn) => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = text;
    b.addEventListener('click', () => { AudioSys.click(); fn(); });
    btns.appendChild(b);
  };
  if (success) {
    if (G.round < LEVELS.length) mkBtn('挑战下一桌', 'btn-primary', () => {
      G.banked += G.roundScore;
      hideOverlays();
      collectedThisRound = 0;
      const nextSeed = seedForLevel(G.round + 1);
      startRound(nextSeed, G.round + 1);
      G.state = 'playing';
    });
    mkBtn('同桌再来', '', () => retrySame());
    mkBtn('收手结算', 'btn-ghost', () => endRun());
  } else {
    mkBtn('同桌再来', 'btn-primary', () => retrySame());
    mkBtn('换个摆法', '', () => {
      hideOverlays();
      collectedThisRound = 0;
      startRound(freshSeed(), G.round);
      G.state = 'playing';
      toast('已换桌', 'info');
    });
  }
  mkBtn('关卡', 'btn-ghost', openLevels);
  $('settleOverlay').classList.remove('hidden');
}

function retrySame() {
  hideOverlays();
  collectedThisRound = 0;
  startRound(G.seed, G.round, true, true);
  G.state = 'playing';
  toast('一模一样的摆法，验证你的新拿法', 'info');
}
function endRun() {
  G.banked += G.roundScore;
  G.state = 'runend';
  hideOverlays();
  $('runendScore').textContent = G.banked;
  $('runendStats').innerHTML = `
    <div class="rstat"><b>${G.roundsCleared}</b><span>过关桌数</span></div>
    <div class="rstat"><b>${G.totalCollected}</b><span>收取物件</span></div>
    <div class="rstat"><b>×${Math.min(G.bestStreak, 3)}</b><span>最高连取</span></div>
    <div class="rstat"><b>${G.totalFallen}</b><span>意外坠落</span></div>`;
  $('runendOverlay').classList.remove('hidden');
}
function hideOverlays() {
  ['introOverlay', 'settleOverlay', 'runendOverlay'].forEach(id => $(id).classList.add('hidden'));
}

/* ================= 渲染 ================= */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawItem(def, x, y, angle, alpha = 1, scale = 1, highlight = 0) {
  const c = COLORS[def.color];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  const w = def.w, h = def.h;
  switch (def.kind) {
    case 'pouch': {
      const fabric = ctx.createLinearGradient(0, -h/2, 0, h/2);
      fabric.addColorStop(0, c.light); fabric.addColorStop(0.45, c.hex); fabric.addColorStop(1, c.dark);
      ctx.fillStyle = fabric; roundRect(-w/2, -h/2, w, h, h*0.4); ctx.fill();
      ctx.strokeStyle = c.dark; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-w*0.36, -h*0.19); ctx.lineTo(w*0.33, -h*0.19); ctx.stroke();
      ctx.fillStyle = '#efdbac'; roundRect(w*0.23,-h*0.23,5,h*0.3,2); ctx.fill();
      break;
    }
    case 'paper':
      ctx.fillStyle = c.light; roundRect(-w/2,-h/2,w,h,2); ctx.fill();
      ctx.fillStyle = c.hex; ctx.fillRect(-w/2, h*0.12, w, h*0.32);
      break;
    case 'eraser':
      roundRect(-w/2,-h/2,w,h,4); ctx.fillStyle = c.hex; ctx.fill(); ctx.save(); ctx.clip();
      ctx.fillStyle = c.light; ctx.fillRect(-w/2,-h/2,w*0.28,h);
      ctx.fillStyle = c.dark; ctx.fillRect(-w*0.19,-h/2,3,h);
      ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(-w*0.07,-2,w*0.28,3);
      ctx.restore(); break;
    case 'roller':
    case 'pedestal': {
      const gradient = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      gradient.addColorStop(0, c.light); gradient.addColorStop(1, c.dark);
      ctx.fillStyle = gradient;
      traceOutline(def.outline); ctx.fill();
      ctx.strokeStyle = c.dark; ctx.lineWidth = 2; ctx.stroke();
      if (def.kind === 'roller') {
        ctx.beginPath(); ctx.arc(0, 0, h * 0.21, 0, 2 * Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -h * 0.21); ctx.lineTo(w / 6, -h * 0.43); ctx.stroke();
      } else {
        ctx.fillStyle = c.light; ctx.fillRect(-w / 4, h / 8, w / 2, 3);
      }
      break;
    }
    case 'ball': {
      const r = def.r;
      const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.15, 0, 0, r * 1.15);
      g.addColorStop(0, c.light); g.addColorStop(0.55, c.hex); g.addColorStop(1, c.dark);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.62, -0.5, 1.9); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath(); ctx.arc(-r * 0.38, -r * 0.42, r * 0.14, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'cup': {
      ctx.strokeStyle = c.dark; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(w / 2 + 4, 0, 13, -1.25, 1.25); ctx.stroke();
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, c.light); g.addColorStop(0.4, c.hex); g.addColorStop(1, c.dark);
      ctx.fillStyle = g;
      roundRect(-w / 2, -h / 2, w, h, 5); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      roundRect(-w / 2 + 5, -h / 2 + 7, w - 10, 7, 3); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      roundRect(-w / 2, h / 2 - 7, w, 7, 3); ctx.fill();
      break;
    }
    case 'pen': {
      const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, c.light); g.addColorStop(0.5, c.hex); g.addColorStop(1, c.dark);
      ctx.fillStyle = g;
      roundRect(-w / 2, -h / 2, w - 14, h, 4); ctx.fill();
      ctx.fillStyle = '#3a2c22';
      ctx.beginPath();
      ctx.moveTo(w / 2 - 14, -h / 2); ctx.lineTo(w / 2, 0); ctx.lineTo(w / 2 - 14, h / 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      roundRect(-w / 2 + 6, -h / 2 - 2.5, 20, 3, 1.5); ctx.fill();
      break;
    }
    case 'wedge': {
      ctx.fillStyle = c.hex;
      ctx.beginPath(); ctx.moveTo(-31, 23); ctx.lineTo(31, 23); ctx.lineTo(0, -23); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.beginPath(); ctx.moveTo(-31, 23); ctx.lineTo(0, -23); ctx.lineTo(-6, -14); ctx.lineTo(-24, 20); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      ctx.beginPath(); ctx.moveTo(31, 23); ctx.lineTo(0, -23); ctx.lineTo(6, -14); ctx.lineTo(24, 20); ctx.closePath(); ctx.fill();
      break;
    }
    case 'box': {
      const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, c.light); g.addColorStop(0.45, c.hex); g.addColorStop(1, c.dark);
      ctx.fillStyle = g;
      roundRect(-w / 2, -h / 2, w, h, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2 + h * 0.28); ctx.lineTo(w / 2, -h / 2 + h * 0.28); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.fillRect(-5, -h / 2, 10, h);
      break;
    }
    case 'plank': {
      const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, '#d3a877'); g.addColorStop(0.5, '#b98a5a'); g.addColorStop(1, '#84592f');
      ctx.fillStyle = def.color === 'wood' ? g : c.hex;
      roundRect(-w / 2, -h / 2, w, h, 6); ctx.fill();
      if (def.ruler) {
        ctx.fillStyle = '#5e412b';
        for (let x = 10; x < w - 6; x += 5) ctx.fillRect(x - w / 2, -h / 2, 1, x % 25 === 0 ? 7 : 3);
        break;
      }
      ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(-w / 2 + 10, i * 3.4); ctx.lineTo(w / 2 - 10, i * 3.4); ctx.stroke();
      }
      break;
    }
    default: { // book
      const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, c.light); g.addColorStop(0.42, c.hex); g.addColorStop(1, c.dark);
      ctx.fillStyle = g;
      roundRect(-w / 2, -h / 2, w, h, 3); ctx.fill();
      ctx.fillStyle = '#f3e9d2';
      roundRect(w / 2 - 9, -h / 2 + 2.5, 7, h - 5, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.14)'; ctx.lineWidth = 0.8;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.moveTo(w / 2 - 8, -h / 2 + 2.5 + i * (h - 5) / 4); ctx.lineTo(w / 2 - 3, -h / 2 + 2.5 + i * (h - 5) / 4); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      roundRect(-w / 2, -h / 2, 11, h, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      roundRect(-w / 2 + 18, -2.2, w * 0.4, 4.4, 2); ctx.fill();
    }
  }
  if (def.isGuard) {
    ctx.globalAlpha = alpha;
    drawStar(0, 0, Math.min(8, h * 0.38));
  }
  if (highlight > 0) {
    ctx.globalAlpha = alpha * highlight;
    ctx.strokeStyle = '#ffd98a';
    ctx.lineWidth = 2.6;
    ctx.shadowColor = 'rgba(242,179,61,.8)'; ctx.shadowBlur = 12;
    if (def.kind === 'ball') { ctx.beginPath(); ctx.arc(0, 0, def.r + 3, 0, Math.PI * 2); ctx.stroke(); }
    else if (def.outline) { traceOutline(def.outline); ctx.stroke(); }
    else if (def.kind === 'wedge') { ctx.beginPath(); ctx.moveTo(-33, 25); ctx.lineTo(33, 25); ctx.lineTo(0, -26); ctx.closePath(); ctx.stroke(); }
    else { roundRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 6); ctx.stroke(); }
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}
function traceOutline(points) {
  ctx.beginPath(); ctx.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
  ctx.closePath();
}
function drawStar(x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#ffd98a';
  ctx.strokeStyle = '#8a5a10';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawBackground(t) {
  const portrait = isPortraitWorld();
  // 可视世界矩形（含 letterbox 外区域，背景满铺无缝）
  const vx = -view.ox / view.scale, vy = -view.oy / view.scale;
  const vw = view.cw / view.scale, vh = view.ch / view.scale;
  // 房间
  const g = ctx.createLinearGradient(0, vy, 0, vy + vh);
  g.addColorStop(0, '#2c2130'); g.addColorStop(0.62, '#241b26'); g.addColorStop(1, '#1a121e');
  ctx.fillStyle = g;
  ctx.fillRect(vx, vy, vw, vh);
  // 墙面装饰线
  ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(vx, DESK_TOP - 50); ctx.lineTo(vx + vw, DESK_TOP - 50); ctx.stroke();

  // 窗与月
  const wx = W - 240;
  ctx.fillStyle = '#171a2e';
  roundRect(wx, 96, 168, 210, 10); ctx.fill();
  const wg = ctx.createLinearGradient(wx, 96, wx, 306);
  wg.addColorStop(0, '#232a4d'); wg.addColorStop(1, '#141830');
  ctx.fillStyle = wg;
  roundRect(wx + 8, 104, 152, 194, 7); ctx.fill();
  ctx.fillStyle = '#f5ead9';
  ctx.beginPath(); ctx.arc(wx + 118, 152, 21, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#232a4d';
  ctx.beginPath(); ctx.arc(wx + 128, 146, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(245,234,217,.8)';
  [[30, 130], [50, 180], [80, 120], [25, 230], [130, 240], [95, 262]].forEach(([sx, sy], i) => {
    const tw = 0.5 + 0.5 * Math.sin(t * 0.001 + i * 1.7);
    ctx.globalAlpha = 0.3 + tw * 0.6;
    ctx.fillRect(wx + sx, sy, 2.2, 2.2);
  });
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#3c3044'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(wx + 84, 104); ctx.lineTo(wx + 84, 298); ctx.moveTo(wx + 8, 200); ctx.lineTo(wx + 160, 200); ctx.stroke();
  ctx.strokeStyle = '#4a3c52'; ctx.lineWidth = 8;
  roundRect(wx, 96, 168, 210, 10); ctx.stroke();

  // 置物架剪影
  const sx0 = Math.round(W * 0.28);
  ctx.fillStyle = '#332838';
  roundRect(sx0, 150, 200, 10, 3); ctx.fill();
  ctx.fillStyle = '#3d3045';
  roundRect(sx0 + 18, 112, 16, 38, 2); ctx.fill();
  roundRect(sx0 + 38, 120, 14, 30, 2); ctx.fill();
  roundRect(sx0 + 56, 106, 18, 44, 2); ctx.fill();
  ctx.fillStyle = '#463850';
  ctx.beginPath(); ctx.arc(sx0 + 130, 132, 18, Math.PI, 0); ctx.fill();
  ctx.fillRect(sx0 + 112, 132, 36, 18);

  // 台灯
  const lamp = lampPos();
  if (portrait) {
    // 吊灯：从天花板垂下
    ctx.strokeStyle = '#6a5638'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(lamp.x, vy); ctx.lineTo(lamp.x, lamp.y - 40); ctx.stroke();
  } else {
    ctx.fillStyle = '#5a3c24';
    roundRect(70, DESK_TOP, 116, FLOOR - DESK_TOP, 5); ctx.fill();
    ctx.fillStyle = '#6d4a2c';
    roundRect(64, DESK_TOP - 10, 128, 14, 4); ctx.fill();
    ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(128, DESK_TOP - 10); ctx.lineTo(128, lamp.y + 28); ctx.stroke();
  }
  // 灯罩
  ctx.fillStyle = G.lampOn ? '#e8a83e' : '#6a5a48';
  ctx.beginPath();
  ctx.moveTo(lamp.x - 36, lamp.y + 28); ctx.lineTo(lamp.x + 36, lamp.y + 28);
  ctx.lineTo(lamp.x + 18, lamp.y - 10); ctx.lineTo(lamp.x - 18, lamp.y - 10);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = G.lampOn ? '#ffd98a' : '#7a6a58';
  ctx.beginPath(); ctx.ellipse(lamp.x, lamp.y + 28, 36, 7, 0, 0, Math.PI * 2); ctx.fill();
  if (G.lampOn) {
    const lg = ctx.createRadialGradient(lamp.x, lamp.y + 34, 10, lamp.x, lamp.y + 34, 420);
    lg.addColorStop(0, 'rgba(255,214,140,.34)');
    lg.addColorStop(0.4, 'rgba(255,190,110,.12)');
    lg.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(lamp.x, lamp.y + 34, 420, 0, Math.PI * 2); ctx.fill();
    // 光锥（渐变柔边）
    const cg = ctx.createLinearGradient(0, lamp.y + 30, 0, DESK_TOP);
    cg.addColorStop(0, 'rgba(255,214,140,.10)');
    cg.addColorStop(1, 'rgba(255,214,140,.02)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(lamp.x - 32, lamp.y + 32); ctx.lineTo(lamp.x + 32, lamp.y + 32);
    ctx.lineTo(lamp.x + 290, DESK_TOP); ctx.lineTo(lamp.x - 110, DESK_TOP);
    ctx.closePath(); ctx.fill();
  }

  // 地板
  ctx.fillStyle = '#1c1320';
  ctx.fillRect(vx, FLOOR, vw, vy + vh - FLOOR);
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(vx, FLOOR); ctx.lineTo(vx + vw, FLOOR); ctx.stroke();

  // 尘埃
  for (const d of effects.dust) {
    d.x += d.sp * 0.4; d.y += Math.sin(t * 0.0006 + d.ph) * 0.12;
    if (d.x > W + 10) d.x = -10;
    if (d.y > DESK_TOP - 60) d.y = 130;
    const a = G.lampOn ? (0.1 + 0.12 * Math.sin(t * 0.0012 + d.ph)) : 0.05;
    ctx.fillStyle = `rgba(255,224,170,${Math.max(0, a)})`;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.s, 0, Math.PI * 2); ctx.fill();
  }
}
function lampPos() {
  return isPortraitWorld() ? { x: 91, y: 262 } : { x: 128, y: 316 };
}

function drawDesk() {
  const legH = FLOOR - DESK_TOP - 20;
  // 桌腿
  ctx.fillStyle = '#5f3f24';
  roundRect(deskLeft + 26, DESK_TOP + 24, 22, legH, 4); ctx.fill();
  roundRect(deskRight - 48, DESK_TOP + 24, 22, legH, 4); ctx.fill();
  // 桌板阴影
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  roundRect(deskLeft - 4, DESK_TOP + 24, deskRight - deskLeft + 8, 10, 5); ctx.fill();
  // 桌板
  const g = ctx.createLinearGradient(0, DESK_TOP, 0, DESK_TOP + 26);
  g.addColorStop(0, '#b07a44'); g.addColorStop(0.35, '#a06c3e'); g.addColorStop(1, '#6d4626');
  ctx.fillStyle = g;
  roundRect(deskLeft, DESK_TOP, deskRight - deskLeft, 26, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,224,170,.22)';
  roundRect(deskLeft + 3, DESK_TOP + 1.5, deskRight - deskLeft - 6, 3.5, 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = DESK_TOP + 8 + i * 3.6;
    ctx.beginPath();
    ctx.moveTo(deskLeft + 14 + i * 30, y);
    ctx.bezierCurveTo(deskLeft + (deskRight - deskLeft) * 0.35, y + 1.6, deskLeft + (deskRight - deskLeft) * 0.7, y - 1.4, deskRight - 14 - i * 22, y);
    ctx.stroke();
  }
  // 收纳盒（左右）
  drawTray(trayCX(0), 0);
  drawTray(trayCX(1), 1);
}
function trayCX(side) {
  const off = isPortraitWorld() ? 64 : 84;
  return side === 0 ? deskLeft - off : deskRight + off;
}
function drawTray(cx, side) {
  const distance = G.grabbed ? edgeDistance(G.grabbed.position.x, side) : -Infinity;
  const ready = distance >= EDGE_CLEARANCE;
  // 边柜
  ctx.fillStyle = '#4e3520';
  roundRect(cx - 52, DESK_TOP + 4, 104, FLOOR - DESK_TOP - 4, 5); ctx.fill();
  ctx.fillStyle = '#5f4128';
  roundRect(cx - 58, DESK_TOP - 6, 116, 12, 4); ctx.fill();
  // 盒体
  const glow = clamp((distance + 92) / (92 + EDGE_CLEARANCE), 0, 1);
  if (glow > 0) {
    ctx.shadowColor = 'rgba(242,179,61,.9)'; ctx.shadowBlur = 22 * glow;
  }
  ctx.fillStyle = '#7a5230';
  ctx.beginPath();
  ctx.moveTo(cx - 44, DESK_TOP - 44); ctx.lineTo(cx + 44, DESK_TOP - 44);
  ctx.lineTo(cx + 36, DESK_TOP - 6); ctx.lineTo(cx - 36, DESK_TOP - 6);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#3a2716';
  ctx.beginPath(); ctx.ellipse(cx, DESK_TOP - 44, 44, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,224,170,.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 44, DESK_TOP - 44); ctx.lineTo(cx + 44, DESK_TOP - 44); ctx.stroke();
  // 已收数量
  const n = G.trayCounts[side];
  if (n > 0) {
    ctx.fillStyle = '#ffd98a';
    ctx.font = '700 15px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`×${n}`, cx, DESK_TOP + 26);
  }
  ctx.fillStyle = 'rgba(245,234,217,.4)';
  ctx.font = '600 12px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('收纳', cx, DESK_TOP + 46);
  if (ready) {
    ctx.fillStyle = '#ffe2a8';
    ctx.font = '700 19px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = side === 0 ? 'left' : 'right';
    ctx.fillText('松手收下', side === 0 ? deskLeft : deskRight, DESK_TOP + 46);
  }
}

// 正在发生物理变化的物件：柔和琥珀描边（不是危险红框），让玩家看见书角翘 / 球滚
function drawMotionCues() {
  if (G.state !== 'playing' && G.state !== 'resolving') return;
  for (const b of G.bodies) {
    if (b === G.grabbed || b.isSleeping) continue;
    const sp = Math.hypot(b.velocity.x, b.velocity.y);
    const act = Math.max(sp / 3, b.angularSpeed / 0.3);
    if (act < 0.25) continue;
    const a = clamp(act, 0, 1) * 0.4;
    const bd = b.bounds;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffd98a';
    ctx.lineWidth = 2;
    ctx.strokeRect(bd.min.x - 3, bd.min.y - 3, bd.max.x - bd.min.x + 6, bd.max.y - bd.min.y + 6);
    ctx.restore();
  }
}
function drawLiftFeedback(t) {
  const b = G.grabbed;
  if (!b || G.state !== 'playing') return;
  const y = b.position.y;
  if (y > DESK_TOP - 30) return; // 还贴着桌面，不打扰
  const prox = clamp((DESK_TOP - 30 - y) / (DESK_TOP - 30 - COLLECT_TOP), 0, 1);
  const def = b.plugin.def;
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.008);
  // 收取线：越接近越亮
  ctx.save();
  ctx.globalAlpha = prox * (0.4 + 0.2 * pulse);
  ctx.strokeStyle = '#ffd98a';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -t * 0.02;
  ctx.beginPath(); ctx.moveTo(deskLeft, COLLECT_TOP); ctx.lineTo(deskRight, COLLECT_TOP); ctx.stroke();
  ctx.setLineDash([]);
  if (prox > 0.35) {
    ctx.globalAlpha = clamp((prox - 0.35) / 0.4, 0, 1) * 0.9;
    ctx.fillStyle = '#ffd98a';
    ctx.font = '700 15px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('举过这里收下', (deskLeft + deskRight) / 2, COLLECT_TOP - 10);
  }
  // 物件光晕：越接近越强
  const r = Math.max(def.w, def.h) * 0.6 + prox * 22;
  const hg = ctx.createRadialGradient(b.position.x, y, r * 0.2, b.position.x, y, r);
  hg.addColorStop(0, `rgba(255,217,138,${0.28 * prox + 0.1 * pulse * prox})`);
  hg.addColorStop(1, 'rgba(255,217,138,0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(b.position.x, y, r, 0, Math.PI * 2); ctx.fill();
  // 上升箭头提示
  if (prox > 0.15 && prox < 0.98) {
    ctx.globalAlpha = prox * 0.8;
    ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    const ax = b.position.x, ay = y - Math.max(def.w, def.h) * 0.6 - 14 - pulse * 4;
    ctx.beginPath();
    ctx.moveTo(ax - 7, ay + 6); ctx.lineTo(ax, ay); ctx.lineTo(ax + 7, ay + 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSheet(body, highlight) {
  const def = body.plugin.def, [left, right] = body.plugin.wings;
  const half = def.w / 6;
  const edge = (piece, side) => ({
    x: piece.position.x + side * half * Math.cos(piece.angle),
    y: piece.position.y + side * half * Math.sin(piece.angle),
  });
  const join = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const line = [edge(left, -1), join(edge(left, 1), edge(body, -1)),
    join(edge(body, 1), edge(right, -1)), edge(right, 1)];
  function trace() {
    ctx.beginPath(); ctx.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < line.length - 1; i++) {
      const mid = join(line[i], line[i + 1]);
      ctx.quadraticCurveTo(line[i].x, line[i].y, mid.x, mid.y);
    }
    ctx.lineTo(line[3].x, line[3].y); ctx.stroke();
  }
  ctx.save(); ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  ctx.strokeStyle = highlight ? '#ffd98a' : COLORS[def.color].dark;
  ctx.lineWidth = def.h + (highlight ? 3 : 0); trace();
  ctx.strokeStyle = COLORS[def.color].light; ctx.lineWidth = def.h - 2; trace();
  ctx.strokeStyle = COLORS[def.color].hex; ctx.lineWidth = 2; trace();
  ctx.restore();
}

function render(t) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.cw, view.ch);
  // 屏幕底
  ctx.fillStyle = '#1a121e';
  ctx.fillRect(0, 0, view.cw, view.ch);
  ctx.save();
  const sh = effects.shake;
  ctx.translate(view.ox + (sh > 0.3 ? (Math.random() - 0.5) * sh : 0), view.oy + (sh > 0.3 ? (Math.random() - 0.5) * sh : 0));
  ctx.scale(view.scale, view.scale);
  effects.shake *= 0.86;

  drawBackground(t);
  drawDesk();

  // 物件阴影
  for (const b of G.bodies) {
    const def = b.plugin.def;
    const p = b.position;
    if (p.x > deskLeft - 20 && p.x < deskRight + 20 && p.y < DESK_TOP) {
      const hgt = DESK_TOP - p.y;
      const a = clamp(0.3 - hgt / 900, 0.05, 0.3);
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.beginPath();
      ctx.ellipse(p.x, DESK_TOP + 4, def.w * 0.46 * clamp(1 - hgt / 700, 0.5, 1), 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 物件
  for (const b of G.bodies) {
    const hl = b === G.grabbed ? 0.95 : (b === G.hoverBody && G.state === 'playing' ? 0.4 : 0);
    if (b.plugin.wings) drawSheet(b, hl);
    else drawItem(b.plugin.def, b.position.x, b.position.y, b.angle, 1, 1, hl);
  }
  drawMotionCues();
  drawLiftFeedback(t);
  // 收取动画
  for (const a of effects.collectAnims) {
    const tt = a.t;
    const ease = 1 - Math.pow(1 - tt, 3);
    const x = lerp(a.from.x, a.to.x, ease);
    const y = lerp(a.from.y, a.to.y, ease) - Math.sin(tt * Math.PI) * 40;
    drawItem(a.def, x, y, a.from.angle + tt * 0.6, 1 - tt * tt, 1 - tt * 0.55, 0);
  }
  // 粒子
  for (const p of effects.particles) {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    if (p.kind === 'confetti') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.kind === 'dust' ? (2 - p.life) : p.life), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // 浮动文字
  for (const f of effects.floats) {
    const a = f.t < 0.15 ? f.t / 0.15 : 1 - Math.max(0, (f.t - 0.55) / 0.45);
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = `900 ${f.size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 4;
    ctx.strokeText(f.text, f.x, f.y - f.t * 46);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y - f.t * 46);
  }
  ctx.globalAlpha = 1;
  // 关灯压暗
  if (!G.lampOn) {
    ctx.fillStyle = 'rgba(12,14,36,.4)';
    ctx.fillRect(-view.ox / view.scale, -view.oy / view.scale, view.cw / view.scale, view.ch / view.scale);
  }
  ctx.restore();
}

/* ================= 主循环 ================= */
let last = performance.now(), acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  let dt = t - last; last = t;
  if (rulesDialog.open || levelsDialog.open) return;
  if (dt > 60) dt = 60;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 3) { Engine.update(engine, STEP); acc -= STEP; steps++; }
  if (steps === 3) acc = 0;
  if (G.state === 'playing' || G.state === 'resolving') gameTick();
  // 特效推进
  for (const f of effects.floats) f.t += dt / 1100;
  effects.floats = effects.floats.filter(f => f.t < 1);
  for (const p of effects.particles) {
    p.x += p.vx; p.y += p.vy;
    if (p.kind === 'confetti') { p.vy += 0.09; p.rot += p.vr; }
    else if (p.kind === 'dust') { p.vy -= 0.01; p.vx *= 0.98; }
    else { p.vy += 0.06; p.vx *= 0.97; }
    p.life -= p.decay;
  }
  effects.particles = effects.particles.filter(p => p.life > 0);
  for (const a of effects.collectAnims) a.t += dt / 480;
  effects.collectAnims = effects.collectAnims.filter(a => a.t < 1);
  render(t);
}

/* ================= 碰撞音效 ================= */
Events.on(engine, 'collisionStart', (ev) => {
  if (G.state === 'intro') return;
  let maxV = 0;
  for (const pair of ev.pairs) {
    const va = pair.bodyA.velocity, vb = pair.bodyB.velocity;
    const rel = Math.hypot(va.x - vb.x, va.y - vb.y);
    if (rel > maxV) maxV = rel;
  }
  if (maxV > 2.6) AudioSys.knock((maxV - 2.6) / 14);
});

/* ================= UI 接线 ================= */
$('startBtn').addEventListener('click', () => {
  if (matchMedia('(pointer: coarse) and (orientation: portrait)').matches &&
      screen.orientation?.lock && document.fullscreenEnabled) {
    document.documentElement.requestFullscreen()
      .then(() => screen.orientation.lock('landscape'))
      .catch(() => { /* The browser may leave orientation to the player. */ });
  }
  if (isPortraitWorld() !== (innerHeight > innerWidth * 1.05)) startRound(G.seed, 1);
  AudioSys.init(); AudioSys.click();
  hideOverlays();
  hud.classList.remove('hidden');
  G.state = 'playing';
  rememberLayout();
});
$('soundBtn').addEventListener('click', () => {
  AudioSys.init();
  AudioSys.setMuted(!AudioSys.muted);
  $('soundBtn').classList.toggle('muted', AudioSys.muted);
  if (!AudioSys.muted) AudioSys.click();
});
const rulesDialog = $('helpOverlay');
const levelsDialog = $('levelsDialog');
let dialogOpenedAt = 0;
function openPaused(dialog) {
  releaseGrab();
  dialogOpenedAt = performance.now();
  dialog.showModal();
}
function resumeClock() {
  const now = performance.now();
  if (G.state === 'resolving') G.resolveStart += now - dialogOpenedAt;
  last = now;
}
$('helpBtn').addEventListener('click', () => openPaused(rulesDialog));
rulesDialog.addEventListener('close', resumeClock);
levelsDialog.addEventListener('close', resumeClock);

function seedForLevel(round) {
  return levelSeeds[round]?.seed ?? LEVELS[round - 1].seed ?? freshSeed();
}
function renderLevels() {
  const best = new Map(legacyStars);
  for (const [key, record] of Object.entries(tableBest)) {
    const round = Number(key.split(':')[0]);
    if (!record) continue;
    best.set(round, Math.max(best.get(round) || 0, record.stars || 0));
  }
  const list = $('levelChoices');
  list.replaceChildren();
  for (const [index, level] of LEVELS.entries()) {
    const round = index + 1;
    const seed = seedForLevel(round);
    const name = level.name;
    const stars = best.get(round);
    const current = G.state === 'playing' && G.round === round;
    const button = document.createElement('button');
    button.className = 'level-choice';
    const title = document.createElement('strong');
    title.textContent = `第 ${round} 桌 · ${name}`;
    const status = document.createElement('span');
    status.textContent = stars ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : best.has(round) ? '已通关' : '未通关';
    if (current) status.textContent += ' · 当前';
    button.append(title, status);
    button.addEventListener('click', () => {
      levelsDialog.close();
      if (current) return;
      AudioSys.init();
      G.roundsCleared = 0; G.totalCollected = 0; G.totalFallen = 0; G.bestStreak = 0;
      hideOverlays();
      hud.classList.remove('hidden');
      G.state = 'playing';
      const saved = levelSeeds[round];
      if (saved) setWorldDims(saved.portrait);
      startRound(seed, round, false, Boolean(saved));
    });
    list.append(button);
  }
}
function openLevels() {
  renderLevels();
  openPaused(levelsDialog);
}
$('introLevels').addEventListener('click', openLevels);
$('levelsBtn').addEventListener('click', openLevels);
$('shuffleBtn').addEventListener('click', () => {
  if (G.state !== 'playing' && G.state !== 'resolving') return;
  AudioSys.click();
  collectedThisRound = 0;
  startRound(freshSeed(), G.round);
  G.state = 'playing';
  toast('已换桌', 'info');
});
$('againBtn').addEventListener('click', () => {
  AudioSys.click();
  G.banked = 0; G.roundsCleared = 0; G.totalCollected = 0; G.totalFallen = 0; G.bestStreak = 0;
  collectedThisRound = 0;
  hideOverlays();
  startRound((Math.random() * 1e9) | 0, 1, false);
  G.state = 'playing';
});

/* ================= 启动 ================= */
startRound((Math.random() * 1e9) | 0, 1);
requestAnimationFrame(frame);

// 供自动化试玩读取状态
window.__DESK = {
  G,
  toScreen,
  desk: () => ({ left: deskLeft, right: deskRight }),
  bodies: () => G.bodies.map(b => ({ id: b.plugin.def.id, kind: b.plugin.def.kind, color: b.plugin.def.color, isGuard: b.plugin.def.isGuard, x: b.position.x, y: b.position.y, angle: b.angle })),
  collect: collectBody,
  startRound: (seed, round) => { startRound(seed, round); G.state = 'playing'; },
  grab: (id) => { const b = G.bodies.find(x => x.plugin.def.id === id); if (b) tryGrab({ x: b.position.x, y: b.position.y }); return !!G.grabbed; },
  movePointer: (x, y) => { trackDrag({ x, y }); if (G.grabbed) Sleeping.set(G.grabbed, false); },
  release: finishDrag,
  dareLoads: () => G.grabDare ? G.grabDare.loads.map(L => L.body.plugin.def.id) : [],
  settleInfo: () => ({ stars: starCount(G.state === 'success', G.mission.bonuses.find(b => b.id === 'perfect').done, G.mission.bonuses.find(b => b.id === 'guard').done, G.dareDone), score: G.roundScore, max: G.mission.maxScore, dareDone: G.dareDone, organized: G.offColorDrags, diff: G.diff }),
  organized: () => G.offColorDrags,
};
})();
