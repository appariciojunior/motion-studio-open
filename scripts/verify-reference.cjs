#!/usr/bin/env node
// ============================================================
//  verify-reference — the ported families must still match the geometry
//  that was MEASURED off the reference tool
//
//  Every other suite here asks "is this well-formed?". This one asks "is this
//  still the same motion?", and it is the only kind of check that catches a
//  fidelity regression. Two examples from when these numbers were first taken:
//
//    · Bloom passed loop-closure, finiteness and centring with its entry scale
//      wrong by 5x (66% where the reference measured 12%). Nothing generic could
//      see it; fitting predicted card widths against measured ones did, to 4px.
//    · Grid passed every invariant while playing the same three frames twice per
//      clip, because its lattice period was smaller than its step count.
//
//  The tables below are DATA, read out of the reference's own store and its
//  rendered card rects — not values anybody chose. Provenance is noted per table
//  so a future change can tell "the reference does this" from "we decided this".
//
//  Usage: node scripts/verify-reference.cjs
// ============================================================

const path = require('path');
const Module = require('module');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { templateList, defaultsFor, easingFor, layerCountFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');
const { loopCycles } = require('../lib/motion');
const { solveLattice } = require('../templates/lattice');

const SPRITE_BASE = 340;
const FPS = 30;
// The reference stages at 1080x1440; this project normalizes the canvas long
// edge to 1080 (store/useSceneStore dimsFor). Everything measured there is
// scaled by this to land here.
const REF_SCALE = 0.75;

let assertions = 0;
const failures = [];
function near(actual, expected, tolerance, subject, what) {
  assertions++;
  if (Math.abs(actual - expected) <= tolerance) return;
  failures.push({ subject, message: `${what}: ${actual.toFixed(2)} vs ${expected.toFixed(2)} measured (tolerance ${tolerance})` });
}
function check(ok, subject, message) {
  assertions++;
  if (!ok) failures.push({ subject, message });
}

function byName(name) {
  const t = templateList.find((x) => x.meta.name === name);
  if (!t) failures.push({ subject: name, message: 'preset is missing from the catalogue' });
  return t;
}
function makeCtx(id, { width = 810, height = 1080, duration = 8, cardAspect } = {}) {
  const ease = resolveEasing(easingFor(id));
  const totalFrames = Math.round(duration * FPS);
  return {
    fps: FPS, width, height, duration, totalFrames, ease,
    easedPhase: (p) => Math.floor(p) + ease(p - Math.floor(p)),
    cardAspect,
  };
}
function loopDrift(template, values, ctx) {
  // The layer count comes from the template: the lattice families derive theirs
  // from the canvas and have no `count` control left to read.
  const count = layerCountFor(template.meta.id, values, ctx);
  let worst = 0;
  for (let i = 0; i < count; i++) {
    const a = template.transform(0, i, count, values, ctx);
    const b = template.transform(ctx.totalFrames, i, count, values, ctx);
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y)
      + Math.abs(a.scale - b.scale) + Math.abs(a.alpha - b.alpha));
  }
  return worst;
}

// ============================================================
//  Runway — the reference's Carousel
//
//  Measured on two of its presets that run stagger 0 with centre scaling off, so
//  cards sit at base size and neighbours are unambiguous:
//    planeSize 730, gap 80  -> card 548x730, pitch 810
//    planeSize 850, gap 500 -> card 638x850, pitch 1350
//  which gives card height = planeSize (3:4) and pitch = planeSize + gap.
//  This family's `gap` control is a centre distance AT BASE SIZE, so the 0.75
//  divides out: cardSize = 0.75*planeSize, gap = BASE*(1 + gapRef/planeSize).
// ============================================================
const RUNWAY = {
  'Runway 06': [600, 40], 'Runway 07': [546, 40], 'Runway 08': [568, 235], 'Runway 09': [440, 190],
  'Runway 10': [730, 80], 'Runway 11': [540, 80], 'Runway 12': [850, 500], 'Runway 13': [642, 500],
  'Runway 14': [600, 332], 'Runway 15': [454, 332], 'Runway 16': [568, 235], 'Runway 17': [466, 140],
  'Runway 18': [850, 500], 'Runway 19': [639, 500], 'Runway 20': [614, 0], 'Runway 21': [473, 0],
  'Runway 22': [748, 273], 'Runway 23': [657, 273],
};
for (const [name, [planeSize, gapRef]] of Object.entries(RUNWAY)) {
  const t = byName(name);
  if (!t) continue;
  const v = defaultsFor(t.meta.id);
  // cardSize and gap are integer sliders, so two roundings can compound.
  near(v.cardSize, REF_SCALE * planeSize, 1, name, 'card long edge');
  near(v.gap * (v.cardSize / SPRITE_BASE), REF_SCALE * (planeSize + gapRef), 2, name, 'centre-to-centre pitch');
  const ctx = makeCtx(t.meta.id, { cardAspect: 3 / 4 });
  check(loopDrift(t, v, ctx) < 1e-6, name, 'does not return to frame 0 at the loop point');
}

// ============================================================
//  Pulse — the reference's Flicker
//
//  Measured: its planeSize 100 renders a 1080x1440 card on a 1080x1440 stage and
//  118 renders 1179x1572, so planeSize is a PERCENTAGE of the frame in this
//  family. Rate is the whole set passing `cycles` times over the clip, so
//  cards/sec = count * cycles / duration.
// ============================================================
const PULSE = {
  //            planeSize %, count, cycles, seconds
  'Pulse 03': [100, 6, 1, 6], 'Pulse 04': [73, 12, 2, 4], 'Pulse 05': [118, 6, 1, 6],
  'Pulse 06': [107, 6, 1, 6], 'Pulse 07': [107, 6, 1, 6], 'Pulse 08': [63, 6, 1, 8],
  'Pulse 09': [63, 6, 1, 8], 'Pulse 10': [63, 6, 1, 8], 'Pulse 11': [63, 6, 1, 8],
  'Pulse 12': [63, 6, 1, 3],
};
for (const [name, [planeSize, count, cycles, seconds]] of Object.entries(PULSE)) {
  const t = byName(name);
  if (!t) continue;
  const v = defaultsFor(t.meta.id);
  const W = 810, H = 1080;
  const ctx = makeCtx(t.meta.id, { width: W, height: H, cardAspect: W / H });
  const rest = t.transform(0, 0, layerCountFor(t.meta.id, v, ctx), v, ctx);
  near(rest.scale * SPRITE_BASE, Math.max(W, H) * (planeSize / 100), 2, name, 'card long edge');
  near(v.speed, (count * cycles) / seconds, 0.02, name, 'cards per second');
  check(loopDrift(t, v, ctx) < 1e-6, name, 'does not return to frame 0 at the loop point');
}

// ============================================================
//  Bloom — the reference's Scale
//
//  Measured card WIDTHS on its 1080x1440 stage. Visible cards are 0.4s apart in
//  age and one growth spans 2s (bloom) / 1.88s (recede, fitted). The curve is
//  bezier [0,0,0,0.99]; bloom runs it forward from a 12% entry, recede runs the
//  same curve BACKWARD — not one minus it, which would put a card at 38% a fifth
//  of the way through its life where the reference measured 97%.
// ============================================================
const BLOOM = {
  'Bloom 01': { ages: [0.4, 0.8, 1.2, 1.6, 2.0], widths: [719, 915, 1018, 1067, 1080] },
  'Bloom 02': { ages: [0.0, 0.4, 0.8, 1.2, 1.6], widths: [1079, 1052, 983, 848, 586] },
};
for (const [name, { ages, widths }] of Object.entries(BLOOM)) {
  const t = byName(name);
  if (!t) continue;
  const v = defaultsFor(t.meta.id);
  const W = 1080, H = 1440;         // compare in the reference's own pixels
  const duration = 4;
  const ctx = makeCtx(t.meta.id, { width: W, height: H, duration, cardAspect: W / H });
  for (let k = 0; k < ages.length; k++) {
    // age advances at `speed` lifecycle units per second
    const frame = Math.round((ages[k] * v.speed / (v.speed * duration)) * ctx.totalFrames);
    const pose = t.transform(frame, 0, layerCountFor(t.meta.id, v, ctx), v, ctx);
    const widthPx = pose.scale * SPRITE_BASE * (W / H);
    near(widthPx, widths[k], 14, name, `card width at age ${ages[k]}s`);
  }
  check(loopDrift(t, v, ctx) < 1e-6, name, 'does not return to frame 0 at the loop point');
}

// ============================================================
//  Parallax — a scattered field with depth
//
//  Read straight from the store's paramsPerModeBaseline (its "Min Size" /
//  "Max Size" panel fields, confirmed against the live Controls tab, not
//  guessed from the schema — Parallax 02/03's own baseline entries omit
//  minSize/maxSize entirely, so the panel falls back to the schema default
//  for all three: 238/442, unconverted). `direction`/`planeSize`/
//  `scaleCenter` sit in the same dict but never surface on the panel — dead
//  keys from an earlier version of the scene, not read by anything here.
// ============================================================
const PARALLAX = {
  'Parallax 01': { count: 133, spread: 300, travel: 300, depth: 60, fade: 0 },
  'Parallax 02': { count: 200, spread: 300, travel: 150, depth: 100, fade: 78 },
  'Parallax 03': { count: 140, spread: 180, travel: 100, depth: 60, fade: 80 },
};
for (const [name, ref] of Object.entries(PARALLAX)) {
  const t = byName(name);
  if (!t) continue;
  const v = defaultsFor(t.meta.id);
  near(v.minSize, REF_SCALE * 238, 1, name, 'min size');
  near(v.maxSize, REF_SCALE * 442, 1, name, 'max size');
  near(v.count, ref.count, 0, name, 'count');
  near(v.spread, REF_SCALE * ref.spread, 1, name, 'spread');
  near(v.travel, REF_SCALE * ref.travel, 1, name, 'travel');
  near(v.depth, ref.depth, 0, name, 'depth');
  near(v.fade, ref.fade, 0, name, 'fade');

  const ctx = makeCtx(t.meta.id, { width: 810, height: 1080, duration: 8, cardAspect: 3 / 4 });
  check(loopDrift(t, v, ctx) < 1e-6, name, 'does not return to frame 0 at the loop point');

  // The parallax tell: at Depth > 0, a nearer (bigger) card has to cover more
  // ground than a farther one over the same span — that is what makes a
  // scatter read as depth instead of a flat field of random sizes. Compare
  // the two most extreme cards the seeded scatter actually drew, so this
  // measures the SAME hash the transform uses rather than an assumption
  // about its distribution.
  let nearest = { d: -1 }, farthest = { d: 2 };
  const n = layerCountFor(t.meta.id, v, ctx);
  for (let i = 0; i < n; i++) {
    const p0 = t.transform(0, i, n, v, ctx);
    if (p0.depth > nearest.d) nearest = { i, d: p0.depth };
    if (p0.depth < farthest.d) farthest = { i, d: p0.depth };
  }
  // Instantaneous speed, not net displacement: a fast card can complete whole
  // wraps between two sample points and land back near where it started,
  // reading as "barely moved" even though it travelled the most of anyone —
  // the same trap as tracking a lattice by residue mod pitch. A one-frame
  // step is far shorter than any card's wrap period, so unwrapping it by the
  // nearest multiple of the span recovers the real per-frame step.
  const speed = (i) => {
    const f = Math.max(1, Math.round(ctx.totalFrames / 3));
    const a = t.transform(f, i, n, v, ctx);
    const b = t.transform(f + 1, i, n, v, ctx);
    const span = v.spread * 2;
    let dy = b.y - a.y;
    dy -= span * Math.round(dy / span);
    return Math.abs(dy);
  };
  if (ref.depth > 0) {
    check(speed(nearest.i) > speed(farthest.i), name,
      'nearest card does not outrun the farthest one — no parallax read');
  }
}

// ============================================================
//  The lattice rule — cells grow, the gap holds
//
//  Four reference states, read off its Grid with the playhead paused. Its stage
//  is 1080x1440, cards 3:4, gap pinned at 80 throughout; only planeSize moved:
//
//      planeSize 700 -> 3x3    400 -> 3x3    200 -> 5x5    100 -> 7x7
//
//  So shrinking a card ADDS cells and never touches the gap — its Grid ships no
//  count control at all. Converted to this project's canvas (810x1080, a 0.75
//  factor; cardSize is the card's LONG edge, which for a 3:4 portrait equals
//  planeSize exactly) the derived rule has to land on the same four walls. This
//  is the assertion the whole change rests on: everything else here checks that
//  the wall is well-formed, only this checks that it is the RIGHT wall.
// ============================================================
{
  const W = 810, H = 1080;
  for (const [cardSize, cols, rows] of [[700, 3, 3], [400, 3, 3], [200, 5, 5], [100, 7, 7]]) {
    const L = solveLattice({ cardSize, gap: 60 }, { width: W, height: H, cardAspect: 3 / 4 });
    check(L.cols === cols && L.rows === rows, 'lattice rule',
      `Plane Size ${cardSize} solves to ${L.cols}x${L.rows}, but the reference measured ${cols}x${rows}`);
    check(Math.abs((L.pitchX - L.cardW) - 60) < 1e-6, 'lattice rule',
      `Plane Size ${cardSize} moved the 60px gap to ${(L.pitchX - L.cardW).toFixed(1)}px`);
  }

  // The board and web-export surfaces do NOT derive their card total — it is
  // however many elements the user placed in their own markup. Handed one, the
  // lattice has to tile a complete rectangle of exactly that many: short of it
  // and empty cells scroll through the frame, over it and the extra cards land
  // exactly on top of earlier ones. Both were live regressions of this change
  // until `solveLattice` took the caller's count.
  for (const t of templateList.filter((x) => ['Frames', 'Grid'].includes(x.meta.group))) {
    const v = defaultsFor(t.meta.id);
    for (const n of [3, 4, 7, 12, 24]) {
      const L = solveLattice(v, { width: W, height: H, cardAspect: 3 / 4 }, 3 / 4, n);
      check(L.cols * L.rows === n, t.meta.name,
        `a fixed ${n}-card board tiles ${L.cols}x${L.rows} = ${L.cols * L.rows} cells`);
      const ctx = makeCtx(t.meta.id, { width: W, height: H, cardAspect: 3 / 4 });
      const cells = new Set();
      for (let i = 0; i < n; i++) {
        const p = t.transform(0, i, n, v, ctx);
        cells.add(`${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`);
      }
      check(cells.size === n, t.meta.name, `a fixed ${n}-card board stacks two cards in one cell`);
    }
  }
}

// ============================================================
//  Frames — a woven wall
//
//  Measured: the gap between rows never changes across a clip, while the
//  horizontal offset BETWEEN rows does (three sampled rows sat +277/+148 apart,
//  later +109/-395, later -200/+61). So the stack scrolls as one block and each
//  row drifts sideways on its own. A rigid diagonal pan reads mechanical.
// ============================================================
for (const t of templateList.filter((x) => x.meta.group === 'Frames')) {
  const v = defaultsFor(t.meta.id);
  const W = 810, H = 1080;
  const ctx = makeCtx(t.meta.id, { width: W, height: H, duration: 10, cardAspect: 3 / 4 });
  const { cols, rows, cardW, pitchX, pitchY } = solveLattice(v, { width: W, height: H, cardAspect: 3 / 4 });
  const count = layerCountFor(t.meta.id, v, { width: W, height: H, cardAspect: 3 / 4 });

  check(cols * rows === count, t.meta.name, 'the sprite pool and the lattice disagree, so cells scroll through frame empty');
  check(cols * pitchX >= W - 1e-6 && rows * pitchY >= H - 1e-6, t.meta.name, 'lattice is smaller than the canvas, so it cannot cover');
  // Coverage now comes from having enough CELLS, so the gap stays exactly where
  // the control put it. The old model bought coverage by inflating the gutter,
  // which silently overrode the user's Gap.
  check(Math.abs((pitchX - cardW) - v.gap) < 1e-6, t.meta.name,
    `gap came out ${(pitchX - cardW).toFixed(0)}px, not the ${v.gap}px the preset sets`);
  check(loopDrift(t, v, ctx) < 1e-6, t.meta.name, 'does not return to frame 0 at the loop point');

  // A tilted wall rotates as one piece, so screen-space y carries the roll and
  // row spacing only reads as rigid once it is undone. Frames 05 runs tilt -15.
  const roll = ((v.tilt ?? 0) * Math.PI) / 180;
  const toWall = (p) => {
    const ux = p.x - v.offset.x, uy = p.y - v.offset.y;
    return {
      x: ux * Math.cos(-roll) - uy * Math.sin(-roll),
      y: ux * Math.sin(-roll) + uy * Math.cos(-roll),
    };
  };

  let rowGapBreak = 0;
  const interRow = [];
  for (let f = 0; f <= ctx.totalFrames; f += 6) {
    const rowsSeen = new Map();
    const cells = new Set();
    for (let i = 0; i < count; i++) {
      const p = toWall(t.transform(f, i, count, v, ctx));
      cells.add(`${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`);
      const r = Math.floor(i / cols);
      if (!rowsSeen.has(r)) rowsSeen.set(r, []);
      rowsSeen.get(r).push(p);
    }
    check(cells.size === count, t.meta.name, 'two cards share a cell');
    const keys = [...rowsSeen.keys()].sort((a, b) => a - b);
    // vertical spacing must be rigid: exactly one pitch between adjacent rows
    for (let k = 1; k < keys.length; k++) {
      const dy = Math.abs(rowsSeen.get(keys[k])[0].y - rowsSeen.get(keys[k - 1])[0].y) % (rows * pitchY);
      if (Math.min(dy, rows * pitchY - dy) - pitchY > 1e-6) rowGapBreak++;
    }
    if (keys.length > 1) {
      const a = Math.min(...rowsSeen.get(keys[0]).map((p) => p.x));
      const b = Math.min(...rowsSeen.get(keys[1]).map((p) => p.x));
      interRow.push(b - a);
    }
  }
  check(rowGapBreak === 0, t.meta.name, 'row spacing is not rigid — the stack must scroll as one block');
  if (v.sweep > 0 && rows > 1) {
    const spread = Math.max(...interRow) - Math.min(...interRow);
    check(spread > pitchX * 0.2, t.meta.name,
      'rows move together — the weave is what distinguishes this family from Grid');
  }
}

// ============================================================
//  Grid — a stepped diagonal conveyor
//
//  Measured by following one identified cell through a cycle: (540,-293) at t=0
//  to (-241,719) at t=3.18, a displacement of (-781,+1012) = exactly one cell
//  diagonally. Six cycles per clip, with a hold at the start of each step.
//  Columns stay ALIGNED, which is what separates it from Frames.
// ============================================================
for (const t of templateList.filter((x) => x.meta.group === 'Grid')) {
  const v = defaultsFor(t.meta.id);
  const W = 810, H = 1080;
  for (const duration of [17.6, 20]) {
    const ctx = makeCtx(t.meta.id, { width: W, height: H, duration, cardAspect: 3 / 4 });
    const { cols, rows, pitchX, pitchY } = solveLattice(v, { width: W, height: H, cardAspect: 3 / 4 });
    const count = layerCountFor(t.meta.id, v, { width: W, height: H, cardAspect: 3 / 4 });

    check(loopDrift(t, v, ctx) < 1e-6, t.meta.name, `does not loop at a ${duration}s clip`);

    let aligned = true, travX = 0, travY = 0, prev = null;
    for (let f = 0; f <= ctx.totalFrames; f++) {
      const poses = [];
      for (let i = 0; i < count; i++) poses.push(t.transform(f, i, count, v, ctx));
      const s = poses[0].scale / (v.cardSize / SPRITE_BASE);
      if (cols > 1) {
        // adjacent columns must sit a whole pitch apart; compare to the NEAREST
        // multiple, since a modulo reads an exact multiple as ~m once it drifts
        const r = (poses[1].x - poses[0].x) / (pitchX * s);
        if (Math.abs(r - Math.round(r)) > 1e-9) aligned = false;
      }
      const cur = { x: poses[0].x / s, y: poses[0].y / s };
      if (prev) {
        let dx = cur.x - prev.x, dy = cur.y - prev.y;
        dx -= pitchX * cols * Math.round(dx / (pitchX * cols));
        dy -= pitchY * rows * Math.round(dy / (pitchY * rows));
        travX += Math.abs(dx); travY += Math.abs(dy);
      }
      prev = cur;
    }
    check(aligned, t.meta.name, 'columns are not aligned — that is Frames, not Grid');
    const cellsX = travX / pitchX, cellsY = travY / pitchY;
    check(Math.abs(cellsX - Math.round(cellsX)) < 0.02, t.meta.name, `travels ${cellsX.toFixed(2)} cells across, not a whole number`);
    check(Math.abs(cellsY - Math.round(cellsY)) < 0.02, t.meta.name, `travels ${cellsY.toFixed(2)} cells down, not a whole number`);
  }
}

// ============================================================
//  Ticker — the reference's Marquee
//
//  Measured over its full authored 20s clip by unwrapping a lane's position:
//  8201px = 11 cells at a dead-constant 410 reference px/s. Eleven is its asset
//  count, which is why its loop closes. Reading `cycles` as cells instead put
//  every preset at a third of its real pace.
//
//  Invariant here: no lane may ever show its own end, or the band stops reading
//  as endless.
// ============================================================
for (const t of templateList.filter((x) => x.meta.group === 'Ticker')) {
  const v = defaultsFor(t.meta.id);
  const W = 810, H = 1080;
  const aspect = t.meta.cardAspect === 'canvas' ? W / H : (t.meta.cardAspect ?? 4 / 5);
  const ctx = makeCtx(t.meta.id, { width: W, height: H, cardAspect: aspect });
  const count = layerCountFor(t.meta.id, v, ctx);
  const rows = Math.max(1, Math.round(v.rows));
  const horizontal = v.direction === 'left' || v.direction === 'right';
  const extent = horizontal ? W : H;

  check(loopDrift(t, v, ctx) < 1e-6, t.meta.name, 'does not return to frame 0 at the loop point');

  let worstOverscan = Infinity;
  const lanePhase = [];
  for (let f = 0; f <= ctx.totalFrames; f += 15) {
    for (let lane = 0; lane < rows; lane++) {
      const pts = [];
      for (let i = lane; i < count; i += rows) {
        const p = t.transform(f, i, count, v, ctx);
        const long = p.scale * SPRITE_BASE;
        pts.push({ a: horizontal ? p.x : p.y, s: horizontal ? long * aspect : long });
      }
      if (!pts.length) continue;
      pts.sort((m, n) => m.a - n.a);
      const lo = pts[0].a - pts[0].s / 2;
      const hi = pts[pts.length - 1].a + pts[pts.length - 1].s / 2;
      worstOverscan = Math.min(worstOverscan, -extent / 2 - lo, hi - extent / 2);
      if (f === 0 && pts.length > 1) {
        const pitch = pts[1].a - pts[0].a;
        lanePhase.push(((pts[0].a % pitch) + pitch) % pitch);
      }
    }
  }
  check(worstOverscan >= 0, t.meta.name,
    `a lane runs out ${Math.abs(Math.round(worstOverscan))}px short of the canvas`);
  if (rows > 1 && (v.laneOffset !== 0 || v.flow === 'staggered')) {
    check(Math.max(...lanePhase) - Math.min(...lanePhase) > 1, t.meta.name,
      'lanes are all in phase — the rows line up into columns and the band reads as a table');
  }
}

// ============================================================
//  Takeover — the reference's Wipe
//
//  The three presets that shipped before the reference ports must be untouched.
//  This reproduces the transform exactly as it was and demands a bit-for-bit
//  match on a PORTRAIT canvas. On a landscape one they deliberately differ: the
//  full-bleed scale now follows the canvas long edge, which is the fix that
//  stopped them leaving a band down the sides.
// ============================================================
function takeoverOriginal(frame, index, count, v, ctx) {
  const scale = (ctx.height / SPRITE_BASE) * 1.15 * (v.zoom / 100);
  const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count));
  const w = (((phase - index) % count) + count) % count;
  let ox = 0, oy = 0, depth = -w;
  const arriving = count - w;
  if (arriving < 1) {
    const e = arriving;
    const horizontal = v.direction === 'left' || v.direction === 'right';
    const span = horizontal ? ctx.width : ctx.height;
    const sgn = v.direction === 'left' || v.direction === 'up' ? 1 : -1;
    if (horizontal) ox = sgn * e * span; else oy = sgn * e * span;
    depth = 10;
  }
  return { x: ox + v.offset.x, y: oy + v.offset.y, scale, depth };
}
for (const id of ['wipe-01', 'wipe-02', 'wipe-03']) {
  const t = templateList.find((x) => x.meta.id === id);
  if (!t) { failures.push({ subject: id, message: 'shipped preset is missing' }); continue; }
  const v = defaultsFor(id);
  const ctx = makeCtx(id, { width: 810, height: 1080, cardAspect: 810 / 1080 });
  let worst = 0;
  for (let f = 0; f <= ctx.totalFrames; f++) {
    const n = layerCountFor(id, v, ctx);
    for (let i = 0; i < n; i++) {
      const a = t.transform(f, i, n, v, ctx);
      const b = takeoverOriginal(f, i, n, v, ctx);
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y), Math.abs(a.scale - b.scale), Math.abs(a.depth - b.depth));
    }
  }
  check(worst === 0, t.meta.name, `drifted from the transform it shipped with by ${worst.toExponential(1)} on a portrait canvas`);
}

// ---------- report ----------
if (failures.length) {
  console.error(`\nReference verification FAILED — ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  ${f.subject}: ${f.message}`);
  process.exit(1);
}

const ported = Object.keys(RUNWAY).length + Object.keys(PULSE).length + Object.keys(BLOOM).length;
console.log(
  `Reference verification passed (${assertions} assertions; ${ported} presets fitted against measured`
  + ` geometry, plus family invariants for Frames, Grid, Ticker and Takeover).`,
);
