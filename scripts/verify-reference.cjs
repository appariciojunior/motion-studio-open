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
const { carouselReferenceDurations } = require('../templates/carousel');
const { resolveEasing } = require('../lib/easing');
const { loopCycles } = require('../lib/motion');
const { solveLattice } = require('../templates/lattice');

const SPRITE_BASE = 340;
const FPS = 30;
// The reference stages at 1080x1440; this project normalizes the canvas long
// edge to 1080 (store/useSceneStore dimsFor). Everything measured there is
// scaled by this to land here.
const REF_SCALE = 0.75;

// Offset is stored in the app's own sign convention, which negates the
// reference's x: the reference authors a camera pan, the app authors where the
// picture goes. The y matches on both sides.
// Control values are not all scalars: an xypad carries { x, y }, so identity
// comparison would fail on two structurally equal pads. Compare by shape.
const sameValue = (a, b) => (
  a && b && typeof a === 'object' && typeof b === 'object'
    ? JSON.stringify(a) === JSON.stringify(b)
    : a === b
);

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
//  `planeSize` is the extent ALONG THE TRAVEL AXIS. In this project cardSize is
//  the long edge, so vertical converts by 0.75 while horizontal keeps the raw
//  width. Both axes still land on a 0.75*(planeSize+gap) centre pitch.
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
  const horizontal = v.direction === 'left' || v.direction === 'right';
  near(v.cardSize, horizontal ? planeSize : REF_SCALE * planeSize, 1, name, 'card long edge');
  near(v.gap * (v.cardSize / SPRITE_BASE), REF_SCALE * (planeSize + gapRef), 2, name, 'centre-to-centre pitch');
  const authoredDuration = carouselReferenceDurations[t.meta.id];
  check(Number.isFinite(authoredDuration) && authoredDuration > 0, name, 'missing authored Runway duration');
  // Every reconstructed clip advances the complete six-card set exactly once.
  near(v.speed, 6 / authoredDuration, 0.02, name, 'slot cadence');
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
//  Parallax — a scattered field that flickers, not a scrolling wall
//
//  Read straight from the store's paramsPerModeBaseline (its "Min Size" /
//  "Max Size" panel fields, confirmed against the live Controls tab, not
//  guessed from the schema — Parallax 02/03's own baseline entries omit
//  minSize/maxSize entirely, so the panel falls back to the schema default
//  for all three: 238/442, unconverted). `direction`/`planeSize`/
//  `scaleCenter` sit in the same dict but never surface on the panel — dead
//  keys from an earlier version of the scene, not read by anything here.
//
//  `travel` is carried over UNconverted (not canvas-scaled): a first pass
//  modelled it as a scroll distance, which a 0.5s-apart pair of rasterized
//  frames on Parallax 01 disproved — every visible card sat in the exact
//  same place, unmoved. What actually turns over between samples 2s apart is
//  the whole VISIBLE SET, each card crossfading in/out on its own staggered,
//  fixed position. `travel` now sets how many of those on/off cycles the
//  field runs per loop, fitted to the observed ~2-2.5s turnover — not
//  measured to the schema's own precision, which is why this section does
//  not assert an exact value for it.
// ============================================================
const PARALLAX = {
  // sdx/sdy are the reference's own lit-pixel standard deviations on its
  // 1080x1440 stage, read off its canvas with golden-ratio time sampling
  // (plain k/8 sampling can alias onto a single phase and read a healthy
  // field as collapsed — it did, on our side, during this port).
  'Parallax 01': { count: 133, depth: 60, fade: 0, sdx: 312, sdy: 351, coverMin: 12, coverMax: 32 },
  'Parallax 02': { count: 200, depth: 100, fade: 78, sdx: 281, sdy: 440, coverMin: 15, coverMax: 35 },
  'Parallax 03': { count: 140, depth: 60, fade: 80, sdx: 293, sdy: 408, coverMin: 19, coverMax: 30 },
};
for (const [name, ref] of Object.entries(PARALLAX)) {
  const t = byName(name);
  if (!t) continue;
  const v = defaultsFor(t.meta.id);
  near(v.minSize, REF_SCALE * 238, 1, name, 'min size');
  near(v.maxSize, REF_SCALE * 442, 1, name, 'max size');
  near(v.count, ref.count, 0, name, 'count');
  near(v.depth, ref.depth, 0, name, 'depth');
  near(v.fade, ref.fade, 0, name, 'fade');
  // All three reference presets measure as a scatter over the WHOLE frame,
  // whatever their own `spread` says (180 and 300 both fill it) — so ours
  // carry 100%. This is the assertion the visible fix rests on: an earlier
  // pass read `spread` as a px radius and clumped every card into the middle.
  near(v.spread, 100, 0, name, 'spread (% of frame)');

  const ctx = makeCtx(t.meta.id, { width: 810, height: 1080, duration: 8, cardAspect: 3 / 4 });
  check(loopDrift(t, v, ctx) < 1e-6, name, 'does not return to frame 0 at the loop point');

  // Every card holds a FIXED position and size RELATIVE TO THE OTHERS — that
  // is the property the rasterized-canvas comparison actually measured on
  // the reference (a 0.5s-apart pair of frames, playhead paused, showed every
  // visible card in the same spot). A later pass added a shared camera path
  // on top (the user caught it watching the real export, and it turned out
  // to be a genuine "Camera path" feature — see the header), which moves
  // every card's ABSOLUTE position together — so this checks the ratio
  // between two cards' scales and their separation scaled by that ratio,
  // both of which the shared camera cancels out of, rather than raw x/y/scale.
  // Test the authored motif here: recycled render copies may change tile
  // coordinates together without changing the relative layout. The separate
  // infinite-fields suite checks replacement identity at those boundaries.
  const n = Math.round(v.count);
  const f1 = Math.round(ctx.totalFrames * 0.2), f2 = Math.round(ctx.totalFrames * 0.7);
  // Any single card's own scale ratio between the two frames IS the shared
  // camera's zoom ratio over that span (each card's fixed sizeFactor cancels
  // out of scale(f1)/scale(f2)) — so every other card's own scale ratio, and
  // its separation from this one, has to track that SAME number.
  const i2 = Math.min(n - 1, 1);
  const ref1 = t.transform(f1, i2, n, v, ctx), ref2 = t.transform(f2, i2, n, v, ctx);
  const camRatio = ref1.scale / ref2.scale;
  let moved = 0;
  for (let i = 0; i < n; i++) {
    if (i === i2) continue;
    const a = t.transform(f1, i, n, v, ctx), b = t.transform(f2, i, n, v, ctx);
    const sepA = Math.hypot(a.x - ref1.x, a.y - ref1.y);
    const sepB = Math.hypot(b.x - ref2.x, b.y - ref2.y);
    const scaleOk = Math.abs(a.scale / b.scale - camRatio) < 1e-4;
    const sepOk = sepB < 1e-6 || Math.abs(sepA / sepB - camRatio) < 1e-3;
    if (!scaleOk || !sepOk) moved++;
  }
  check(moved === 0, name,
    `${moved} of ${n} cards moved relative to the others (beyond the shared camera) across the clip`);

  // Nothing fades over time. Measured: consecutive frames align at correlation
  // 0.95-0.99 under a single translation, so a card's opacity is a property of
  // its depth alone. Fade dims the far ones, once and for good.
  let nearest = { d: -1 }, farthest = { d: 2 };
  for (let i = 0; i < n; i++) {
    const p0 = t.transform(0, i, n, v, ctx);
    if (p0.depth > nearest.d) nearest = { i, d: p0.depth };
    if (p0.depth < farthest.d) farthest = { i, d: p0.depth };
  }
  // Fade must DARKEN, never make a card see-through: an alpha-based recede
  // let whatever a far card overlapped ghost straight through it. So alpha
  // stays pinned at 1 and the recede rides `dim`.
  const expectedDim = (d) => (v.fade / 100) * (1 - d);
  let varies = 0;
  for (const i of [nearest.i, farthest.i]) {
    const p0 = t.transform(0, i, n, v, ctx);
    for (let f = 0; f <= ctx.totalFrames; f += 5) {
      const p = t.transform(f, i, n, v, ctx);
      if (Math.abs(p.alpha - p0.alpha) > 1e-6 || Math.abs((p.dim ?? 0) - (p0.dim ?? 0)) > 1e-6) { varies++; break; }
    }
  }
  check(varies === 0, name, 'a card changes brightness over the clip — this family does not flicker');
  for (let i = 0; i < n; i++) {
    if (t.transform(0, i, n, v, ctx).alpha !== 1) {
      check(false, name, 'a card is semi-transparent — Fade must darken, not make cards see-through');
      break;
    }
  }
  near(t.transform(0, nearest.i, n, v, ctx).dim ?? 0, expectedDim(nearest.d), 0.02, name, 'nearest card dim vs. its Fade depth');
  near(t.transform(0, farthest.i, n, v, ctx).dim ?? 0, expectedDim(farthest.d), 0.02, name, 'farthest card dim vs. its Fade depth');
  if (ref.fade > 0) {
    check(expectedDim(farthest.d) > expectedDim(nearest.d) + 0.05, name,
      'a far card is as bright as a near one — Fade is not dimming by depth');
  }

  // THE MOTION SIGNATURE: the camera HOLDS at each pin and lurches between
  // them. Measured on the reference by cross-correlating consecutive frames —
  // the field's velocity hits zero at 0.4/2.5/4.3/7.3/9.7/11.9/14.0s on its
  // 14s clip, which is its six pin times to within a sample. A continuous
  // drift (or a flicker duty cycle) cannot produce that, and two earlier
  // passes of this port shipped exactly those wrong models.
  if (v.camPath && v.camPath !== 'orbit') {
    const speedAt = (u) => {
      const f = u * ctx.totalFrames;
      const a = t.transform(f, 0, n, v, ctx), b = t.transform(f + 1, 0, n, v, ctx);
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    let fastest = 0;
    for (let k = 0; k <= 600; k++) fastest = Math.max(fastest, speedAt(k / 600));
    // At each interior pin the field must be practically stopped, while the
    // clip as a whole is clearly moving.
    check(fastest > 1, name, 'the camera never moves');
    for (let p = 1; p <= 5; p++) {
      const atPin = speedAt(p / 6);
      check(atPin < fastest * 0.12, name,
        `the camera does not rest at pin ${p}/6 (${atPin.toFixed(1)} vs peak ${fastest.toFixed(1)} px/frame)`);
    }
    // ...and the travel must be CONCENTRATED into bursts, not spread evenly.
    // Peak-over-mean speed is the shape-independent way to say that: uniform
    // motion gives 1, a held-and-lurching camera gives well above it. Testing a
    // segment's MIDPOINT instead would have been wrong — Parallax 03's authored
    // bezier [0.33, 0, 0, 1] is an ease-out, so its burst is at the segment's
    // start, and only 01/02's [0.76, 0, 0.24, 1] peaks in the middle.
    let sum = 0;
    for (let k = 0; k < 600; k++) sum += speedAt(k / 600);
    const mean = sum / 600;
    check(fastest > mean * 2, name,
      `the camera crawls uniformly instead of holding and lurching (peak ${fastest.toFixed(1)} vs mean ${mean.toFixed(1)} px/frame)`);
  }

  // THE SPATIAL SIGNATURE. Rasterize our own field the way the reference's
  // canvas was read — lit cards only — and compare the spread and how much of
  // the frame is covered. A uniform scatter over the whole frame gives
  // sd/canvas = 1/sqrt(12) = 0.289 on both axes, which is what the reference
  // measures (0.244-0.306). The bug this guards against read `spread` as a px
  // radius and clumped everything into the middle: the same rasterization gave
  // 0.11-0.16, with a lit bbox that never reached an edge.
  //
  // Measured on OUR canvas and compared as a FRACTION of it, deliberately:
  // our card sizes are scaled for a 1080 long edge, so rasterizing them on the
  // reference's 1440-tall stage understates them and biases every coverage
  // number — a trap this check itself fell into on the first pass.
  {
    const RW = 810, RH = 1080, STEP = 6;
    const rctx = makeCtx(t.meta.id, { width: RW, height: RH, duration: 14, cardAspect: 3 / 4 });
    const rn = layerCountFor(t.meta.id, v, rctx);
    const cols = Math.ceil(RW / STEP), rows = Math.ceil(RH / STEP);
    const sdxs = [], sdys = [], covers = [];
    let touchesEveryEdge = false;
    for (let k = 0; k < 12; k++) {
      const u = (k * 0.6180339887) % 1;             // non-aliasing sampling
      const frame = Math.round(u * rctx.totalFrames);
      const lit = new Uint8Array(cols * rows);
      for (let i = 0; i < rn; i++) {
        const p = t.transform(frame, i, rn, v, rctx);
        if (p.alpha <= 0.05) continue;
        const long = SPRITE_BASE * p.scale;
        const cw = long * (3 / 4), ch = long;
        const x0 = RW / 2 + p.x - cw / 2, y0 = RH / 2 + p.y - ch / 2;
        const gx0 = Math.max(0, Math.ceil(x0 / STEP)), gx1 = Math.min(cols - 1, Math.floor((x0 + cw) / STEP));
        const gy0 = Math.max(0, Math.ceil(y0 / STEP)), gy1 = Math.min(rows - 1, Math.floor((y0 + ch) / STEP));
        for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) lit[gy * cols + gx] = 1;
      }
      let cnt = 0, sx = 0, sy = 0, sxx = 0, syy = 0;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
        if (!lit[gy * cols + gx]) continue;
        const x = gx * STEP, y = gy * STEP;
        cnt++; sx += x; sy += y; sxx += x * x; syy += y * y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (!cnt) continue;
      const mx = sx / cnt, my = sy / cnt;
      sdxs.push(Math.sqrt(Math.max(0, sxx / cnt - mx * mx)) / RW);
      sdys.push(Math.sqrt(Math.max(0, syy / cnt - my * my)) / RH);
      covers.push(100 * cnt / (cols * rows));
      if (minX <= STEP * 2 && minY <= STEP * 2 && maxX >= RW - STEP * 3 && maxY >= RH - STEP * 3) touchesEveryEdge = true;
    }
    const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    check(touchesEveryEdge, name, 'the lit field never reaches all four frame edges — the scatter is not filling the frame');
    near(median(sdxs), ref.sdx / 1080, 0.06, name, 'lit-field spread across (fraction of canvas)');
    near(median(sdys), ref.sdy / 1440, 0.06, name, 'lit-field spread down (fraction of canvas)');
    // Density: the reference's three presets all sit near a quarter of the
    // frame lit despite counting 133/200/140 cards, so the wall grows with the
    // count rather than staying a fixed size. Sizing it independently made the
    // densest preset cover 63% where the reference covers 35%.
    near(median(covers), (ref.coverMin + ref.coverMax) / 2, 10, name, 'share of the frame covered');
  }
}

// ============================================================
//  Wipe — the image never moves; an edge uncovers it
//
//  Measured on the reference by reading its own card rects at 17 points across
//  the loop: every card returned (540, 720) at 1080x1440 EVERY time, with only
//  the slot indices advancing. Nothing translates and nothing scales — what
//  moves is the reveal edge. The sibling Takeover family (templates/wipe.ts)
//  pushes cards in from an edge instead, which is a different mechanic and is
//  deliberately left alone.
//
//  Timing: the slot indices flip every 1.67s while the timeline reads 8.4s, so
//  `duration` there is PER-IMAGE and the clip is duration x count. (Parallax's
//  `duration` is the whole clip — the reference is not consistent between
//  families, so it has to be measured each time.)
// ============================================================
for (const name of ['Wipe 01', 'Wipe 02', 'Wipe 03', 'Wipe 04']) {
  const t = byName(name);
  if (!t) continue;
  const v = defaultsFor(t.meta.id);
  const ctx = makeCtx(t.meta.id, { width: 810, height: 1080, duration: 8, cardAspect: 810 / 1080 });
  const n = layerCountFor(t.meta.id, v, ctx);
  near(v.count, 5, 0, name, 'count');
  near(v.seconds, 1.67, 0.01, name, 'seconds per image');
  check(loopDrift(t, v, ctx) < 1e-6, name, 'does not return to frame 0 at the loop point');

  // Nothing may translate or resize across the whole clip — the entire effect
  // lives in the clip rect. This is the assertion the port rests on: a
  // push-based wipe fails it immediately.
  let moved = 0, resized = 0, everClipped = false, fullyRevealed = false;
  for (let i = 0; i < n; i++) {
    const a = t.transform(0, i, n, v, ctx);
    for (let f = 0; f <= ctx.totalFrames; f += 3) {
      const p = t.transform(f, i, n, v, ctx);
      if (Math.hypot(p.x - a.x, p.y - a.y) > 1e-6) moved++;
      if (Math.abs(p.scale - a.scale) > 1e-6) resized++;
      const c = p.clip;
      if (c && (c.x0 > 0.001 || c.y0 > 0.001 || c.x1 < 0.999 || c.y1 < 0.999)) everClipped = true;
      if (p.alpha > 0.5 && (!c || (c.x0 <= 0.001 && c.y0 <= 0.001 && c.x1 >= 0.999 && c.y1 >= 0.999))) fullyRevealed = true;
    }
  }
  check(moved === 0, name, `${moved} samples translated — a Wipe reveals a still card, it does not push one`);
  check(everClipped, name, 'no card is ever partly clipped — nothing is being wiped');
  check(fullyRevealed, name, 'no card ever reaches full frame — the wipe never completes');
  // `scale` is the only thing allowed to change size, and only where set.
  if ((v.scale ?? 0) === 0) {
    check(resized === 0, name, 'a card resized although Scale is 0');
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
    check(L.motifCols === cols && L.motifRows === rows, 'lattice rule',
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
      const dy = Math.abs(rowsSeen.get(keys[k])[0].y - rowsSeen.get(keys[k - 1])[0].y) % (solveLattice(v, ctx).motifRows * pitchY);
      if (Math.min(dy, solveLattice(v, ctx).motifRows * pitchY - dy) - pitchY > 1e-6) rowGapBreak++;
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
        const motif = solveLattice(v, ctx);
        dx -= pitchX * motif.motifCols * Math.round(dx / (pitchX * motif.motifCols));
        dy -= pitchY * motif.motifRows * Math.round(dy / (pitchY * motif.motifRows));
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

// ============================================================
//  Spinner — the reference's Spinner / Hinge / Fan
//
//  Not fitted: READ. scripts/_scene_spinner.cjs installs three's devtools hook
//  before the reference's page loads, wraps its renderer's render() to catch the
//  camera, and walks the live scene for every card's world matrix. The tables
//  below are those captures verbatim — a camera (fov, z, near, far) and four
//  cards' full world matrices per preset — converted to this app's px by nothing
//  more than the unit scale.
//
//  This is the check that can see what a picture cannot. Sweeping the
//  reference's Perspective from 125 to 2000 moves its measured bounding box by
//  under half a percent, because the cards that balloon under a wide lens are
//  the ones passing edge-on and an edge-on card rasterizes to nothing — so a
//  camera can be wrong by a factor of six and still photograph correctly. Two
//  pixel probes disagreed with the arithmetic here and the scene graph settled
//  it.
//
//  What each row pins down that a looser check would miss:
//    Spinner 01  the belt's radius is HALF the card plus the orbit radius
//                (300 + 35), and each card's own turn equals its ring angle
//    Spinner 03  the rig is a THREE Euler XYZ on a group above the cards, so
//                with three axes live (-60/60/90) the order is not negotiable
//    Hinge 01    hinge offsets the card along its own normal — the centre orbits
//                hypot(300, 282) + 35, not 300 + 35
//    Fan 03      the vertical fold's opposite handedness, a 4:5 card (the aspect
//                moves the WIDTH only), and Offset panning the CAMERA by a share
//                of the frame's half-HEIGHT on both axes
// ============================================================
const SPINNER_SCENES = [
  {
    name: 'Spinner 01', count: 9, aspect: 1,
    values: { count: 9, axis: 'horizontal', hinge: 0, diameter: 70, zoom: 85, perspective: 125 },
    camera: { fov: 32.6674, z: 7045.361, x: 0, y: 0, near: 70.454, far: 9595.4 },
    spin: 1.32063,
    cards: [
      [1, 0, 0, 0, 0, 0.248, 0.969, 0, 0, -0.969, 0.248, 0, 0, 82.934, 324.572, 1],
      [1, 0, 0, 0, 0, -0.433, 0.901, 0, 0, -0.901, -0.433, 0, 0, -145.1, 301.945, 1],
      [1, 0, 0, 0, 0, -0.911, 0.412, 0, 0, -0.412, -0.911, 0, 0, -305.24, 138.035, 1],
      [1, 0, 0, 0, 0, -0.963, -0.27, 0, 0, 0.27, -0.963, 0, 0, -322.554, -90.464, 1],
    ],
  },
  {
    name: 'Spinner 03', count: 32, aspect: 1,
    values: { count: 32, axis: 'vertical', hinge: 0, diameter: 500, zoom: 50, perspective: 1500, rotateX: -60, rotateY: 60, rotateZ: 90 },
    camera: { fov: 137.2401, z: 1374.136, x: 0, y: 0, near: 13.741, far: 4784.1 },
    spin: 0.35507,
    cards: [
      [-0.301, 0.318, -0.899, 0, -0.5, 0.75, 0.433, 0, 0.812, 0.58, -0.067, 0, -165.591, 175.051, -494.405, 1],
      [-0.454, 0.199, -0.869, 0, -0.5, 0.75, 0.433, 0, 0.738, 0.631, -0.241, 0, -249.538, 109.472, -477.752, 1],
      [-0.589, 0.072, -0.805, 0, -0.5, 0.75, 0.433, 0, 0.635, 0.657, -0.406, 0, -323.894, 39.686, -442.739, 1],
      [-0.701, -0.058, -0.71, 0, -0.5, 0.75, 0.433, 0, 0.508, 0.659, -0.555, 0, -385.804, -31.625, -390.711, 1],
    ],
  },
  {
    name: 'Hinge 01', count: 9, aspect: 1,
    values: { count: 9, axis: 'horizontal', hinge: 282, diameter: 70, zoom: 75, perspective: 125, rotateX: -45, rotateY: -45 },
    camera: { fov: 32.6674, z: 7984.742, x: 0, y: 0, near: 79.847, far: 11662.7 },
    spin: 2.18166,
    cards: [
      [0.707, 0.5, 0.5, 0, -0.579, 0.004, 0.815, 0, 0.406, -0.866, 0.292, 0, -64.444, -263.676, 354.813, 1],
      [0.707, 0.5, 0.5, 0, -0.183, -0.554, 0.812, 0, 0.683, -0.666, -0.3, 0, 149.412, -383.969, 172.669, 1],
      [0.707, 0.5, 0.5, 0, 0.299, -0.852, 0.43, 0, 0.641, -0.154, -0.752, 0, 293.356, -324.598, -90.269, 1],
      [0.707, 0.5, 0.5, 0, 0.641, -0.752, -0.154, 0, 0.299, 0.43, -0.852, 0, 300.035, -113.345, -310.969, 1],
    ],
  },
  {
    name: 'Fan 03', count: 9, aspect: 4 / 5,
    values: { count: 9, axis: 'vertical', hinge: 0, diameter: 440, zoom: 127, perspective: 1000, rotateX: -26, rotateY: 120, offset: { x: -34, y: 5 }, fade: 13, backface: 'hide' },
    camera: { fov: 120, z: 797.834, x: 469.843, y: 69.094, near: 7.978, far: 4087.8 },
    spin: 1.71042,
    cards: [
      [-0.788, 0.27, 0.553, 0, 0, 0.899, -0.438, 0, -0.616, -0.345, -0.708, 0, -362.485, 124.149, 254.542, 1],
      [-0.208, 0.429, 0.879, 0, 0, 0.899, -0.438, 0, -0.978, -0.091, -0.187, 0, -95.639, 197.244, 404.41, 1],
      [0.469, 0.387, 0.794, 0, 0, 0.899, -0.438, 0, -0.883, 0.206, 0.422, 0, 215.957, 178.047, 365.05, 1],
      [0.927, 0.164, 0.337, 0, 0, 0.899, -0.438, 0, -0.375, 0.406, 0.833, 0, 426.505, 75.54, 154.879, 1],
    ],
  },
];

// The reference's own frame half-height at z=0 is planeSize/200 * distance, and
// our Zoom is that distance as a percentage of its default 585 — so one
// reference unit is this many px. Derived here independently of the template so
// a change to either side has to be argued, not inherited.
const SPINNER_UNIT = (height, zoom) => height / 2 / ((600 / 200) * ((585 * 100) / zoom));

{
  const spinnerTemplate = byName('Spinner 01');
  const H = 1080, W = 810;
  for (const scene of SPINNER_SCENES) {
    const t = byName(scene.name);
    if (!t || !spinnerTemplate) continue;
    const v = { ...defaultsFor(t.meta.id), ...scene.values };
    const ctx = makeCtx(t.meta.id, { width: W, height: H, cardAspect: scene.aspect });
    const k = SPINNER_UNIT(H, v.zoom);

    // --- camera: four numbers, all read off the live one ---
    const pose = t.camera(v, ctx);
    near(pose.fov, scene.camera.fov, 0.01, scene.name, 'camera fov');
    near(pose.position.z / k, scene.camera.z, 1.5, scene.name, 'camera z in reference units');
    near(pose.position.x / k, scene.camera.x, 1.5, scene.name, 'camera pan x (Offset X is a share of the half-HEIGHT)');
    near(-pose.position.y / k, scene.camera.y, 1.5, scene.name, 'camera pan y');
    // The lookAt has to travel with the eye, or the pan turns into a tilt and
    // the belt keystones instead of sliding.
    near(pose.target.x / k, scene.camera.x, 1.5, scene.name, 'camera target x');
    near(-pose.target.y / k, scene.camera.y, 1.5, scene.name, 'camera target y');
    near(pose.near / k, scene.camera.near, 1.5, scene.name, 'camera near');
    near(pose.far / k, scene.camera.far, 4, scene.name, 'camera far');

    // --- cards: the phase is recovered from the capture, then every card's
    // world matrix has to land on the reference's. With a linear curve the belt
    // turns TAU per loop, so the frame that reproduces a captured spin is
    // exact rather than searched for.
    const frame = (ctx.totalFrames * scene.spin) / (Math.PI * 2);
    const count = scene.count;
    let worstPos = 0, worstRot = 0;
    for (let i = 0; i < scene.cards.length; i++) {
      const m = scene.cards[i];
      const p = t.transform3d(frame, i, count, v, ctx);
      // Our y is canvas-down and the reference's is three's y-up; the
      // quaternion is handed over untouched, so that negation is the whole
      // conversion — and if it were the only half applied, the columns below
      // would be the ones to catch it.
      worstPos = Math.max(worstPos,
        Math.abs(p.x / k - m[12]),
        Math.abs(-p.y / k - m[13]),
        Math.abs(p.z / k - m[14]));
      const q = p.quaternion;
      const col = (bx, by, bz) => {
        const tx = 2 * (q.y * bz - q.z * by);
        const ty = 2 * (q.z * bx - q.x * bz);
        const tz = 2 * (q.x * by - q.y * bx);
        return [
          bx + q.w * tx + (q.y * tz - q.z * ty),
          by + q.w * ty + (q.z * tx - q.x * tz),
          bz + q.w * tz + (q.x * ty - q.y * tx),
        ];
      };
      const cols = [col(1, 0, 0), col(0, 1, 0), col(0, 0, 1)];
      for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) {
          worstRot = Math.max(worstRot, Math.abs(cols[c][r] - m[c * 4 + r]));
        }
      }
    }
    // The captures carry 2 and 3 decimals; anything structural is orders of
    // magnitude coarser than that.
    check(worstPos < 1.2, scene.name, `card centres are ${worstPos.toFixed(2)} reference units off the live scene`);
    check(worstRot < 0.01, scene.name, `card orientations are ${worstRot.toFixed(4)} off the live scene's world matrices`);
  }

  // The card is planeSize TALL whatever its shape — the reference's aspect only
  // moves the width. Checked through the pose the renderer actually consumes:
  // it normalizes a sprite's LONG edge to SPRITE_BASE, so a portrait card and a
  // landscape one reach that height by different routes.
  for (const aspect of [1, 4 / 5, 4 / 3]) {
    const v = defaultsFor('spinner-01');
    const ctx = makeCtx('spinner-01', { width: W, height: H, cardAspect: aspect });
    const p = spinnerTemplate.transform3d(0, 0, v.count, v, ctx);
    const long = p.scale * SPRITE_BASE;
    const height = aspect >= 1 ? long / aspect : long;
    const width = aspect >= 1 ? long : long * aspect;
    near(height, 600 * SPINNER_UNIT(H, v.zoom), 0.01, `Spinner card ${aspect.toFixed(2)}`, 'card height in px');
    near(width, 600 * aspect * SPINNER_UNIT(H, v.zoom), 0.01, `Spinner card ${aspect.toFixed(2)}`, 'card width in px');
  }

  // Every authored preset, as the reference's own table has it. Zoom is its
  // `distance` read back as a percentage (585/distance), which is exact for all
  // fourteen; Diameter is twice its orbitRadius, the way its own panel shows it.
  const SPINNER_PRESETS = {
    'Spinner 01': { count: 6, axis: 'horizontal', hinge: 0, diameter: 70, zoom: 85, perspective: 125, rotateX: 0, rotateY: 0, rotateZ: 0, offset: { x: 0, y: 0 }, motionRotation: 'static', direction: 'forward', fanRotation: 0, fade: 0 },
    'Spinner 02': { count: 6, axis: 'horizontal', hinge: 0, diameter: 70, zoom: 85, perspective: 125, motionRotation: 'rotation' },
    'Spinner 03': { count: 32, axis: 'vertical', hinge: 0, diameter: 500, zoom: 50, perspective: 1500, rotateX: -60, rotateY: 60, rotateZ: 90 },
    'Spinner 04': { count: 18, axis: 'vertical', hinge: 0, diameter: 70, zoom: 85, perspective: 840, rotateX: -18, rotateY: -4, offset: { x: 0, y: 7 } },
    'Spinner 05': { count: 32, axis: 'horizontal', hinge: 0, diameter: 70, zoom: 85, perspective: 1000 },
    'Spinner 06': { count: 40, axis: 'vertical', hinge: 0, diameter: 1000, zoom: 39, perspective: 125, rotateX: 20 },
    'Hinge 01': { count: 9, axis: 'horizontal', hinge: 282, diameter: 70, zoom: 75, perspective: 125, rotateX: -45, rotateY: -45 },
    'Hinge 02': { count: 9, axis: 'horizontal', hinge: 282, diameter: 70, zoom: 75, perspective: 125, rotateX: -45, rotateY: 0 },
    'Hinge 03': { count: 9, axis: 'horizontal', hinge: 282, diameter: 70, zoom: 75, perspective: 125, rotateX: 0, rotateY: -30 },
    'Hinge 04': { count: 12, axis: 'horizontal', hinge: 282, diameter: 70, zoom: 75, perspective: 1345, rotateY: -15, offset: { x: 5, y: 0 } },
    'Hinge 05': { count: 12, axis: 'horizontal', hinge: 280, diameter: 70, zoom: 75, perspective: 1000, rotateX: -115, rotateY: -35, rotateZ: -15 },
    'Fan 01': { count: 12, axis: 'vertical', hinge: 75, diameter: 70, zoom: 125, perspective: 250, rotateY: -60, rotateZ: -180, offset: { x: 16, y: 0 }, fanRotation: 180, direction: 'reverse', backface: 'hide' },
    'Fan 02': { count: 6, axis: 'horizontal', hinge: 0, diameter: 50, zoom: 180, perspective: 150, offset: { x: 0, y: 34 } },
    'Fan 03': { count: 9, axis: 'vertical', hinge: 0, diameter: 440, zoom: 127, perspective: 1000, rotateX: -26, rotateY: 120, offset: { x: -34, y: 5 }, fade: 13, backface: 'hide' },
  };
  // Its card shape is per preset too, and a shape is not a control.
  const SPINNER_SHAPES = { 'Spinner 06': 4 / 3, 'Fan 01': 4 / 5, 'Fan 02': 4 / 5, 'Fan 03': 4 / 5 };
  for (const [name, authored] of Object.entries(SPINNER_PRESETS)) {
    const t = byName(name);
    if (!t) continue;
    const v = defaultsFor(t.meta.id);
    for (const [key, want] of Object.entries(authored)) {
      check(sameValue(v[key], want), name, `${key} is ${JSON.stringify(v[key])}, the reference authors ${JSON.stringify(want)}`);
    }
    const shape = SPINNER_SHAPES[name] ?? 1;
    check(Math.abs((t.meta.cardAspect ?? 1) - shape) < 1e-9, name,
      `card shape is ${t.meta.cardAspect}, the reference authors ${shape.toFixed(3)}`);
  }

  // Loop closure, on every preset: the belt turns a whole number of slots per
  // clip, so frame 0 and frame N have to be the same picture.
  for (const t of templateList.filter((x) => x.meta.group === 'Spinner')) {
    const v = defaultsFor(t.meta.id);
    const aspect = t.meta.cardAspect === 'canvas' ? W / H : (t.meta.cardAspect ?? 1);
    const ctx = makeCtx(t.meta.id, { width: W, height: H, cardAspect: aspect });
    check(loopDrift(t, v, ctx) < 1e-6, t.meta.name, 'does not return to frame 0 at the loop point');
    let finite = true;
    for (let f = 0; f <= ctx.totalFrames; f += 7) {
      for (let i = 0; i < v.count; i++) {
        const p = t.transform3d(f, i, v.count, v, ctx);
        if (![p.x, p.y, p.z, p.scale, p.alpha, p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w]
          .every((n) => Number.isFinite(n))) finite = false;
      }
    }
    check(finite, t.meta.name, 'emits a non-finite pose');
  }

  // The 2D pose has to BE the projection of the 3D one.
  //
  // Spinner is one of the few families whose `transform` does not describe its
  // own motion — it projects the 3D pose the stage renders, because the sprite
  // paths (catalogue thumbnails, Board, the web export) have no camera. Nothing
  // generic can see that projection go wrong: every suite here asks whether one
  // context is well-formed, and both contexts stayed internally consistent
  // while disagreeing with each other. What shipped had the card's short axis
  // up to 90 degrees off its real direction (1.91 on a unit axis, Spinner 02 at
  // frame 199) because the second column's angle was read off the FIRST
  // projected axis and the orientation patched with a negative scaleY.
  //
  // pixi is what defines the four fields (Container._updateSkew):
  //   (a, b) = ( cos(rotation + skewY), sin(rotation + skewY)) * scaleX
  //   (c, d) = (-sin(rotation - skewX), cos(rotation - skewX)) * scaleY
  // so the columns must come out along the card's own two axes, turned by its
  // quaternion and projected. The scales carry the foreshortening, which is why
  // the DIRECTIONS are what get compared here.
  for (const t of templateList.filter((x) => x.meta.group === 'Spinner')) {
    const v = defaultsFor(t.meta.id);
    const aspect = t.meta.cardAspect === 'canvas' ? W / H : (t.meta.cardAspect ?? 1);
    const ctx = makeCtx(t.meta.id, { width: W, height: H, cardAspect: aspect });
    let worstAxis = 0, negativeScale = false;
    for (let f = 0; f <= ctx.totalFrames; f += 11) {
      for (let i = 0; i < v.count; i++) {
        const p2 = t.transform(f, i, v.count, v, ctx);
        const p3 = t.transform3d(f, i, v.count, v, ctx);
        const q = p3.quaternion;
        const axis = (bx, by, bz) => {
          const tx = 2 * (q.y * bz - q.z * by);
          const ty = 2 * (q.z * bx - q.x * bz);
          const tz = 2 * (q.x * by - q.y * bx);
          return [
            bx + q.w * tx + (q.y * tz - q.z * ty),
            by + q.w * ty + (q.z * tx - q.x * tz),
          ];
        };
        // Canvas directions: the card's local +y points up in the reference's
        // frame and down here, so both axes take the same negation on y.
        const [ux, uy] = axis(1, 0, 0), [wx, wy] = axis(0, 1, 0);
        const sx = p2.scaleX ?? 1, sy = p2.scaleY ?? 1;
        // A card that shows its back is a skew past 90 degrees in this
        // parameterization, never a negative scale — a negative one is what the
        // sprite paths cannot draw (a DOM thumbnail collapses it to a hairline).
        if (sx < 0 || sy < 0) negativeScale = true;
        const rs = p2.rotation + (p2.skewY ?? 0), rk = p2.rotation - (p2.skewX ?? 0);
        const dir = (x, y) => { const L = Math.hypot(x, y) || 1; return [x / L, y / L]; };
        const [a1, b1] = dir(Math.cos(rs) * sx, Math.sin(rs) * sx);
        const [c1, d1] = dir(-Math.sin(rk) * sy, Math.cos(rk) * sy);
        const [a0, b0] = dir(ux, -uy), [c0, d0] = dir(wx, -wy);
        worstAxis = Math.max(worstAxis, Math.hypot(a1 - a0, b1 - b0), Math.hypot(c1 - c0, d1 - d0));
      }
    }
    check(worstAxis < 1e-9, t.meta.name,
      `the 2D pose's axes are ${worstAxis.toFixed(4)} off the projection of its own 3D pose`);
    check(!negativeScale, t.meta.name, 'hands a sprite path a negative scale instead of a skew past 90 degrees');
  }
}

// ============================================================
//  ORBIT 3D — the reference's ring, pinned against its LIVE scene graph
//
//  Same method as the Spinner section above, for the same reason: this family's
//  maths was READ out of the reference's own modules (25001 ringRadius /
//  ringSlots / ringCardScale / applyRingCamera / buildCardGeometry, 42981
//  computeRingFrame, 34379 the stage renderer, 51437 computeViewFades) and then
//  checked against the running page — scripts/_scene_orbit.cjs installs three's
//  devtools hook before navigation, wraps render() to catch the camera, and
//  reads every card's world matrix. The capture is .shots/ref-orbit-scene-live.json.
//
//  A pixel box could not have settled any of it. Two of its own presets
//  (Lightroom 05 and 07) photograph completely EMPTY, and its stage's canvas
//  cannot even be read from script — toDataURL comes back cleared, which had
//  two more presets measuring as blank when they are not.
//
//  What each row pins down that a looser check would miss:
//    Pure 01       the radius Gap does NOT move (extent / (TAU/count)), a
//                  three-axis rig as a THREE Euler XYZ above the spin, and the
//                  card scale as 1/(1 + gap/100)
//    Pure 05       Diameter adds to that radius (60 -> 250.99) and grows the
//                  card with the slot (scale 1.143, not 1/1.15)
//    Carousel 04   a flat card spans its CHORD, so the radius uses tan and not
//                  the arc; Gap -50 doubles the card; Billboard is parallel to
//                  the image plane rather than aimed at the lens; and Contrast
//                  shrinks the far cards on the mesh alone
//    Lightroom 04  Flip is a further half turn on the card (its group carries
//                  Ry = PI), a 4:5 card moves the WIDTH only, and the camera
//                  ends up INSIDE the ring: z 675.6 against a radius of 803.8
//    Bloom 01      Bloom swings the card about its lower EDGE — the pivot is
//                  half a card inside the per-card scale, which is the only
//                  reason its centres sit at radius 160.25 and y -1.444 rather
//                  than at the ring's own 149.28 and 0
//    Bloom 03      three rig axes at once AND Offset panning the camera by a
//                  share of the frame's half-width and half-height
// ============================================================
const ORBIT_SCENES = [
  {
    name: 'Ring Pure 01', aspect: 1, spin: -2.58658, cardScale: 0.74074,
    values: {
      count: 18, gap: 35, diameter: 0, cardRotation: 0, cardTilt: 0, surface: 'cylinder',
      facing: 'ring', flip: 'no', tiltX: -10, ringYaw: -10, ringRoll: 50,
      zoom: 100, perspective: 300, offset: { x: 0, y: 0 }, scaleContrast: 0, direction: 'reverse',
    },
    camera: { fov: 60.3009, z: 1297.997, x: 0, y: 0, near: 12.98, far: 3016.9 },
    cards: [
      [-0.466, -0.42, 0.393, 0, -0.559, 0.452, -0.18, 0, -0.138, -0.41, -0.602, 0, -53.283, -158.449, -232.648, 1],
      [-0.391, -0.255, 0.575, 0, -0.559, 0.452, -0.18, 0, -0.289, -0.529, -0.431, 0, -111.75, -204.501, -166.619, 1],
      [-0.269, -0.059, 0.688, 0, -0.559, 0.452, -0.18, 0, -0.405, -0.584, -0.208, 0, -156.737, -225.886, -80.493, 1],
      [-0.114, 0.145, 0.718, 0, -0.559, 0.452, -0.18, 0, -0.473, -0.569, 0.04, 0, -182.821, -220.026, 15.341, 1],
    ],
  },
  {
    name: 'Ring Pure 05', aspect: 1, spin: -1.58033, cardScale: 1.14275,
    values: {
      count: 12, gap: 15, diameter: 120, cardRotation: 0, cardTilt: 0, surface: 'cylinder',
      facing: 'ring', flip: 'no', tiltX: 0, ringYaw: 0, ringRoll: 0,
      zoom: 100, perspective: 500, offset: { x: 0, y: 0 }, scaleContrast: 0, direction: 'reverse',
    },
    camera: { fov: 84.59, z: 552.485, x: 0, y: 0, near: 5.525, far: 1698.4 },
    cards: [
      [-0.011, 0, 1.143, 0, 0, 1.143, 0, 0, -1.143, 0, -0.011, 0, -250.975, 0, -2.392, 1],
      [0.562, 0, 0.995, 0, 0, 1.143, 0, 0, -0.995, 0, 0.562, 0, -218.546, 0, 123.416, 1],
      [0.984, 0, 0.581, 0, 0, 1.143, 0, 0, -0.581, 0, 0.984, 0, -127.559, 0, 216.154, 1],
      [1.143, 0, 0.011, 0, 0, 1.143, 0, 0, -0.011, 0, 1.143, 0, -2.392, 0, 250.975, 1],
    ],
  },
  {
    name: 'Ring Carousel 04', aspect: 1, spin: -2.35619, cardScale: 2,
    values: {
      count: 20, gap: -50, diameter: 0, cardRotation: 0, cardTilt: 0, surface: 'flat',
      facing: 'camera', flip: 'no', tiltX: 0, ringYaw: 0, ringRoll: 90,
      zoom: 41, perspective: 740, offset: { x: 0, y: 0 }, scaleContrast: 200, direction: 'reverse',
    },
    camera: { fov: 105.0526, z: 1203.047, x: 0, y: 0, near: 12.03, far: 3097.2 },
    cards: [
      [0.856, 0, 0, 0, 0, 0.856, 0, 0, 0, 0, 2, 0, 0, -223.225, -223.225, 1],
      [1.027, 0, 0, 0, 0, 1.027, 0, 0, 0, 0, 2, 0, 0, -281.28, -143.319, 1],
      [1.228, 0, 0, 0, 0, 1.228, 0, 0, 0, 0, 2, 0, 0, -311.801, -49.384, 1],
      [1.439, 0, 0, 0, 0, 1.439, 0, 0, 0, 0, 2, 0, 0, -311.801, 49.384, 1],
    ],
  },
  {
    name: 'Ring Lightroom 04', aspect: 4 / 5, spin: -1.99666, cardScale: 2.64566,
    values: {
      count: 24, gap: 0, diameter: 1000, cardRotation: 0, cardTilt: 0, surface: 'flat',
      facing: 'ring', flip: 'yes', tiltX: 0, ringYaw: 0, ringRoll: 0,
      zoom: 25, perspective: 2000, offset: { x: 0, y: 0 }, scaleContrast: 0, direction: 'reverse',
    },
    camera: { fov: 147.0062, z: 675.645, x: 0, y: 0, near: 6.756, far: 2498.6 },
    cards: [
      [1.093, 0, -2.409, 0, 0, 2.646, 0, 0, 2.409, 0, 1.093, 0, -732.035, 0, -332.066, 1],
      [0.432, 0, -2.61, 0, 0, 2.646, 0, 0, 2.61, 0, 0.432, 0, -793.036, 0, -131.286, 1],
      [-0.258, 0, -2.633, 0, 0, 2.646, 0, 0, 2.633, 0, -0.258, 0, -799.994, 0, 78.44, 1],
      [-0.931, 0, -2.476, 0, 0, 2.646, 0, 0, 2.476, 0, -0.931, 0, -752.433, 0, 282.821, 1],
    ],
  },
  {
    name: 'Ring Bloom 01', aspect: 4 / 5, spin: -3.13359, cardScale: 0.84746,
    values: {
      count: 12, gap: 18, diameter: 0, cardRotation: 0, cardTilt: 15, surface: 'flat',
      facing: 'ring', flip: 'no', tiltX: 0, ringYaw: 0, ringRoll: 0,
      zoom: 85.2, perspective: 610, offset: { x: 0, y: 0 }, scaleContrast: 0, direction: 'reverse',
    },
    camera: { fov: 94.9667, z: 398.953, x: 0, y: 0, near: 3.99, far: 1294.6 },
    cards: [
      [-0.847, 0, 0.007, 0, -0.002, 0.819, -0.219, 0, -0.007, -0.219, -0.819, 0, -1.283, -1.444, -160.244, 1],
      [-0.731, 0, 0.43, 0, -0.111, 0.819, -0.189, 0, -0.415, -0.219, -0.706, 0, -81.233, -1.444, -138.134, 1],
      [-0.418, 0, 0.737, 0, -0.191, 0.819, -0.108, 0, -0.712, -0.219, -0.404, 0, -139.417, -1.444, -79.011, 1],
      [0.007, 0, 0.847, 0, -0.219, 0.819, 0.002, 0, -0.819, -0.219, 0.007, 0, -160.244, -1.444, 1.283, 1],
    ],
  },
  {
    name: 'Ring Bloom 03', aspect: 1, spin: -0.03142, cardScale: 1,
    values: {
      count: 12, gap: 0, diameter: 0, cardRotation: 0, cardTilt: 0, surface: 'flat',
      facing: 'camera', flip: 'no', tiltX: 24, ringYaw: 75, ringRoll: 90,
      zoom: 40, perspective: 2000, offset: { x: -5, y: 7 }, scaleContrast: 200, direction: 'reverse',
    },
    camera: { fov: 147.0062, z: 280.2, x: 47.306, y: 66.229, near: 2.802, far: 1399.8 },
    cards: [
      [0.825, 0, 0, 0, 0, 0.825, 0, 0, 0, 0, 1, 0, 180.155, -24.989, 41.715, 1],
      [0.951, 0, 0, 0, 0, 0.951, 0, 0, 0, 0, 1, 0, 158.85, 63.243, 74.75, 1],
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 94.981, 134.53, 87.755, 1],
      [0.96, 0, 0, 0, 0, 0.96, 0, 0, 0, 0, 1, 0, 5.662, 169.769, 77.247, 1],
    ],
  },
];

// The ring's own geometry, rederived here so a change on either side has to be
// argued rather than inherited. The card is 100 tall whatever its shape; the
// radius is whatever makes each slot exactly one card wide — the ARC for a
// wrapped card and the CHORD for a flat one; and the frame's half-height is
// that radius times the reference's zoom curve, with the gap deliberately left
// out because its applyRingCamera leaves it out too.
const ORBIT_EXTENT = (aspect, cardRotation) => {
  const r = (cardRotation * Math.PI) / 180;
  return Math.abs(100 * aspect * Math.cos(r)) + Math.abs(100 * Math.sin(r));
};
const ORBIT_PER_UNIT = (count, surface) =>
  (surface === 'cylinder' ? (Math.PI * 2) / count : 2 * Math.tan(Math.PI / count));
const ORBIT_W = (v, aspect) => ORBIT_EXTENT(aspect, v.cardRotation) / ORBIT_PER_UNIT(v.count, v.surface);
const ORBIT_ZOOM_FACTOR = (zoom) => {
  const c = (((247 * 100) / zoom) / 1000) * 3;
  return c <= 0.02 ? 0.35 : 1.05 + ((c - 0.02) / 0.98) * 2.15;
};
// The frame the viewer gets is the ARTBOARD's window onto that frame — its
// export clones the camera and calls setViewOffset(canvasW, canvasH, board...),
// and its stage canvas is a square sized to the browser while the artboard is a
// smaller box inside it. Measured 0.4675 at the 1600x1000 window every probe
// here uses. Restated independently of the template on purpose: this is the one
// number in the port that came from a measurement.
const ORBIT_BOARD_CROP = 0.4675;
const ORBIT_FRAME = (v, aspect) => ORBIT_W(v, aspect) * ORBIT_ZOOM_FACTOR(v.zoom);
const ORBIT_UNIT = (height, v, aspect) => height / 2 / (ORBIT_FRAME(v, aspect) * ORBIT_BOARD_CROP);

{
  const H = 1080, W = 810;
  for (const scene of ORBIT_SCENES) {
    const t = byName(scene.name);
    if (!t) continue;
    // Linear, no hold: the pose is a function of the ring's ANGLE, and this is
    // the only way to solve for the frame that reproduces a captured one
    // exactly instead of searching for it. It changes the cadence, not one
    // number of the geometry being compared.
    const v = { ...defaultsFor(t.meta.id), ...scene.values, hold: 0 };
    const ctx = { ...makeCtx(t.meta.id, { width: W, height: H, cardAspect: scene.aspect }), ease: (x) => x };
    const k = ORBIT_UNIT(H, v, scene.aspect);

    // --- camera: six numbers, all read off the live one ---
    const pose = t.camera(v, ctx);
    // The fov we emit is the reference's NARROWED by the artboard crop: its
    // export renders the artboard rectangle of a bigger frame
    // (camera.setViewOffset), and the full-frame equivalent of a window is a
    // narrower lens at the same distance — tan(fov/2) scales by the crop. Every
    // other number below is in reference units and the crop cancels out of it.
    const viewFov = (2 * Math.atan(ORBIT_BOARD_CROP * Math.tan((scene.camera.fov * Math.PI) / 360)) * 180) / Math.PI;
    near(pose.fov, viewFov, 0.01, scene.name, 'camera fov, narrowed by the artboard crop');
    near(pose.position.z / k, scene.camera.z, 1.5, scene.name, 'camera z in reference units');
    // Offset pans by a share of the FULL frame's half-height on BOTH axes: its
    // own x factor is the canvas aspect, and its canvas is square. Reading that
    // as the artboard's aspect instead reported Bloom 03's correct pan as 4/3
    // too small.
    near(pose.position.x / k, scene.camera.x, 1.5, scene.name, 'camera pan x (a share of the FULL frame half-height)');
    near(-pose.position.y / k, scene.camera.y, 1.5, scene.name, 'camera pan y');
    // The lookAt has to travel with the eye, or the pan turns into a tilt.
    near(pose.target.x / k, scene.camera.x, 1.5, scene.name, 'camera target x');
    near(-pose.target.y / k, scene.camera.y, 1.5, scene.name, 'camera target y');
    near(pose.near / k, scene.camera.near, 1.5, scene.name, 'camera near');
    near(pose.far / k, scene.camera.far, 4, scene.name, 'camera far');

    // --- the frame that reproduces the captured spin. With a linear curve the
    // ring advances `slots` slots over the clip, so this is exact.
    const slots = Math.max(1, Math.round((v.speed * ctx.duration) / v.count)) * v.count;
    const frameForSpin = (scene.spin / ((v.direction === 'forward' ? 1 : -1) * slots * ((Math.PI * 2) / v.count))) * ctx.totalFrames;

    let worstPos = 0, worstRot = 0, worstScale = 0;
    for (let i = 0; i < scene.cards.length; i++) {
      const m = scene.cards[i];
      const p = t.transform3d(frameForSpin, i, v.count, v, ctx);
      // Our y is canvas-down and the reference's is three's y-up; the
      // quaternion is handed over untouched, so that negation is the whole
      // conversion — and if it were the only half applied, the columns below
      // would be the ones to catch it.
      worstPos = Math.max(worstPos,
        Math.abs(p.x / k - m[12]),
        Math.abs(-p.y / k - m[13]),
        Math.abs(p.z / k - m[14]));
      const q = p.quaternion;
      const col = (bx, by, bz) => {
        const tx = 2 * (q.y * bz - q.z * by);
        const ty = 2 * (q.z * bx - q.x * bz);
        const tz = 2 * (q.x * by - q.y * bx);
        return [
          bx + q.w * tx + (q.y * tz - q.z * ty),
          by + q.w * ty + (q.z * tx - q.x * tz),
          bz + q.w * tz + (q.x * ty - q.y * tx),
        ];
      };
      const cols = [col(1, 0, 0), col(0, 1, 0), col(0, 0, 1)];
      for (let c = 0; c < 3; c++) {
        // The captured matrix carries the card's SCALE as well as its turn —
        // the ring's per-card scale on every column, and Contrast on the two
        // in the card's own plane. Normalize to compare directions.
        const len = Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]) || 1;
        for (let r = 0; r < 3; r++) {
          worstRot = Math.max(worstRot, Math.abs(cols[c][r] - m[c * 4 + r] / len));
        }
      }
      // ...and that scale is a number this port has to reproduce too: it is the
      // gap law and the Contrast law multiplied together. The pose says it as a
      // sprite scale, so undo the renderer's long-edge normalization.
      const ours = (p.scale * SPRITE_BASE) / (k * Math.max(1, scene.aspect) * 100);
      worstScale = Math.max(worstScale, Math.abs(ours - Math.hypot(m[0], m[1], m[2])));
    }
    // The captures carry 2 and 3 decimals; anything structural is orders of
    // magnitude coarser than that.
    check(worstPos < 1.2, scene.name, `card centres are ${worstPos.toFixed(2)} reference units off the live scene`);
    check(worstRot < 0.01, scene.name, `card orientations are ${worstRot.toFixed(4)} off the live scene's world matrices`);
    check(worstScale < 0.01, scene.name, `card scale is ${worstScale.toFixed(4)} off the live scene (ringCardScale x Contrast)`);
  }

  // Every authored preset, as the reference's own table has it
  // (.shots/ref-orbit-presets-authored.json). Zoom is its `distance` read back
  // as a percentage of 247, Diameter is twice its orbitRadius, and Speed is
  // count/loopDuration — cards per second, which is what its Duration pins.
  const ORBIT_PRESETS = {
    'Ring Pure 01': { count: 18, gap: 35, diameter: 0, surface: 'cylinder', facing: 'ring', flip: 'no', fade: 30, fadeMode: 'solid', tiltX: -10, ringYaw: -10, ringRoll: 50, zoom: 100, perspective: 300, direction: 'reverse', speed: 0.9, hold: 0, backface: 'show', shape: 1 },
    'Ring Pure 02': { count: 6, gap: 15, diameter: 0, surface: 'cylinder', facing: 'ring', fade: 15, tiltX: -10, ringYaw: -10, ringRoll: 50, zoom: 75, perspective: 500, speed: 0.3, shape: 1 },
    'Ring Pure 03': { count: 9, gap: 15, surface: 'cylinder', facing: 'ring', fade: 15, tiltX: -7, offset: { x: 0, y: 4 }, zoom: 75, perspective: 500, speed: 0.5, shape: 1 },
    'Ring Pure 04': { count: 18, gap: 15, surface: 'cylinder', facing: 'ring', fade: 15, tiltX: 0, zoom: 100, perspective: 500, speed: 0.5, shape: 1 },
    'Ring Pure 05': { count: 12, gap: 15, diameter: 120, surface: 'cylinder', facing: 'ring', zoom: 100, perspective: 500, speed: 0.35, shape: 1 },
    'Ring Pure 06': { count: 18, gap: 0, diameter: 120, cardRotation: 90, surface: 'cylinder', ringRoll: -90, zoom: 65, perspective: 300, direction: 'forward', cornerRadius: 0, shape: 1 },
    'Ring Carousel 01': { count: 18, gap: 35, surface: 'flat', facing: 'camera', fade: 30, tiltX: -10, ringYaw: -10, ringRoll: 50, zoom: 100, perspective: 300, speed: 0.9, shape: 1 },
    'Ring Carousel 02': { count: 9, gap: 15, surface: 'flat', facing: 'camera', fade: 15, zoom: 75, perspective: 500, speed: 0.45, shape: 1 },
    'Ring Carousel 03': { count: 6, gap: 15, surface: 'flat', facing: 'camera', scaleContrast: 50, ringRoll: 56, zoom: 50, perspective: 500, speed: 0.55, hold: 13.5, shape: 1 },
    'Ring Carousel 04': { count: 20, gap: -50, surface: 'flat', facing: 'camera', scaleContrast: 200, ringRoll: 90, zoom: 41, perspective: 740, speed: 0.8, hold: 20, shape: 1 },
    'Ring Carousel 05': { count: 6, gap: -15, surface: 'flat', facing: 'camera', scaleContrast: 200, zoom: 25, perspective: 0, speed: 0.8, hold: 20, shape: 1 },
    'Ring Lightroom 01': { count: 10, gap: 6, surface: 'cylinder', facing: 'ring', flip: 'yes', fade: 0, fadeMode: 'alpha', zoom: 100, perspective: 1600, speed: 0.5, shape: 1 },
    'Ring Lightroom 02': { count: 10, gap: 6, cardRotation: -90, surface: 'flat', flip: 'yes', fadeMode: 'alpha', ringRoll: 90, zoom: 110, perspective: 1500, speed: 0.5, shape: 1 },
    'Ring Lightroom 03': { count: 10, gap: 6, cardRotation: -90, surface: 'flat', flip: 'yes', ringRoll: 51, zoom: 105, perspective: 1500, speed: 0.5, hold: 12.5, shape: 1 },
    'Ring Lightroom 04': { count: 24, gap: 0, diameter: 1000, surface: 'flat', flip: 'yes', fadeMode: 'alpha', zoom: 25, perspective: 2000, speed: 0.8, cornerRadius: 0, shape: 4 / 5 },
    'Ring Lightroom 05': { count: 6, gap: 15, diameter: 120, surface: 'flat', flip: 'yes', backface: 'hide', fadeMode: 'solid', zoom: 125, perspective: 2000, speed: 0.35, direction: 'forward', shape: 4 / 5 },
    'Ring Lightroom 06': { count: 6, gap: 15, diameter: 120, cardRotation: 90, flip: 'yes', backface: 'hide', ringRoll: -90, zoom: 125, perspective: 2000, direction: 'forward', shape: 4 / 5 },
    'Ring Lightroom 07': { count: 12, gap: 15, diameter: 58, flip: 'no', backface: 'hide', zoom: 37, perspective: 2000, direction: 'forward', shape: 4 / 5 },
    'Ring Lightroom 08': { count: 12, gap: 15, diameter: 58, cardRotation: -90, backface: 'hide', ringRoll: 90, zoom: 42, perspective: 2000, direction: 'forward', shape: 4 / 5 },
    'Ring Bloom 01': { count: 12, gap: 18, cardTilt: 15, surface: 'flat', facing: 'ring', fade: 25, zoom: 85.2, perspective: 610, speed: 0.6, hold: 12.5, shape: 4 / 5 },
    'Ring Bloom 02': { count: 12, gap: 0, facing: 'camera', fadeMode: 'alpha', scaleContrast: 200, ringYaw: 85, ringRoll: 90, offset: { x: -5, y: 0 }, zoom: 40, perspective: 2000, speed: 1.2, shape: 1 },
    'Ring Bloom 03': { count: 12, gap: 0, facing: 'camera', scaleContrast: 200, tiltX: 24, ringYaw: 75, ringRoll: 90, offset: { x: -5, y: 7 }, zoom: 40, perspective: 2000, speed: 1.2, shape: 1 },
    'Ring Bloom 04': { count: 12, cardTilt: -44, facing: 'camera', tiltX: 97, ringYaw: -40, ringRoll: 0, zoom: 55, perspective: 2000, speed: 1.2, shape: 1 },
    'Ring Bloom 05': { count: 16, gap: 49, facing: 'ring', fade: 0, fadeMode: 'alpha', tiltX: 90, zoom: 119.3, perspective: 610, speed: 1.35, shape: 9 / 16 },
  };
  for (const [name, authored] of Object.entries(ORBIT_PRESETS)) {
    const t = byName(name);
    check(!!t, name, 'is missing from the catalogue');
    if (!t) continue;
    const v = defaultsFor(t.meta.id);
    for (const [key, want] of Object.entries(authored)) {
      if (key === 'shape') continue;
      check(sameValue(v[key], want), name, `${key} is ${JSON.stringify(v[key])}, the reference authors ${JSON.stringify(want)}`);
    }
    // Its card shape is per preset too, and a shape is not a control.
    check(Math.abs((t.meta.cardAspect ?? 1) - authored.shape) < 1e-9, name,
      `card shape is ${t.meta.cardAspect}, the reference authors ${authored.shape.toFixed(4)}`);
  }

  // Loop closure and finiteness on every preset in the family: the ring turns a
  // whole number of slots per clip, so frame 0 and frame N are the same picture.
  const orbitFamily = templateList.filter((x) => x.meta.id.startsWith('orbit-3d-'));
  check(orbitFamily.length === 27, 'Orbit 3D', `has ${orbitFamily.length} presets, expected 3 of ours plus the reference's 24`);
  for (const t of orbitFamily) {
    const v = defaultsFor(t.meta.id);
    const aspect = t.meta.cardAspect === 'canvas' ? W / H : (t.meta.cardAspect ?? 4 / 5);
    const ctx = makeCtx(t.meta.id, { width: W, height: H, cardAspect: aspect });
    check(loopDrift(t, v, ctx) < 1e-6, t.meta.name, 'does not return to frame 0 at the loop point');
    let finite = true, everVisible = false;
    for (let f = 0; f <= ctx.totalFrames; f += 7) {
      for (let i = 0; i < v.count; i++) {
        const p = t.transform3d(f, i, v.count, v, ctx);
        if (![p.x, p.y, p.z, p.scale, p.alpha, p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w]
          .every((n) => Number.isFinite(n))) finite = false;
        if (p.alpha > 0.02 && p.scale > 0) everVisible = true;
      }
    }
    check(finite, t.meta.name, 'emits a non-finite pose');
    // Four of the reference's own presets render EMPTY in its shipped build
    // (Lightroom 05-08: its ringFacing culls the wrong side once Flip and
    // Backface are both in play). Reproducing that faithfully is worth nothing,
    // so this is the assertion that keeps them drawn.
    check(everVisible, t.meta.name, 'draws nothing at all');
  }

  // The 2D pose has to BE the projection of the 3D one — the sprite paths
  // (catalogue thumbnails, Board, the web export) have no camera of their own,
  // and nothing generic can see that projection go wrong: both contexts stay
  // internally consistent while disagreeing with each other.
  for (const t of orbitFamily) {
    const v = defaultsFor(t.meta.id);
    const aspect = t.meta.cardAspect === 'canvas' ? W / H : (t.meta.cardAspect ?? 4 / 5);
    const ctx = makeCtx(t.meta.id, { width: W, height: H, cardAspect: aspect });
    let worstAxis = 0, negativeScale = false;
    for (let f = 0; f <= ctx.totalFrames; f += 11) {
      for (let i = 0; i < v.count; i++) {
        const p2 = t.transform(f, i, v.count, v, ctx);
        const p3 = t.transform3d(f, i, v.count, v, ctx);
        const q = p3.quaternion;
        const axis = (bx, by, bz) => {
          const tx = 2 * (q.y * bz - q.z * by);
          const ty = 2 * (q.z * bx - q.x * bz);
          const tz = 2 * (q.x * by - q.y * bx);
          return [
            bx + q.w * tx + (q.y * tz - q.z * ty),
            by + q.w * ty + (q.z * tx - q.x * tz),
          ];
        };
        const [ux, uy] = axis(1, 0, 0), [wx, wy] = axis(0, 1, 0);
        const sx = p2.scaleX ?? 1, sy = p2.scaleY ?? 1;
        if (sx < 0 || sy < 0) negativeScale = true;
        const rs = p2.rotation + (p2.skewY ?? 0), rk = p2.rotation - (p2.skewX ?? 0);
        const dir = (x, y) => { const L = Math.hypot(x, y) || 1; return [x / L, y / L]; };
        const [a1, b1] = dir(Math.cos(rs) * sx, Math.sin(rs) * sx);
        const [c1, d1] = dir(-Math.sin(rk) * sy, Math.cos(rk) * sy);
        const [a0, b0] = dir(ux, -uy), [c0, d0] = dir(wx, -wy);
        worstAxis = Math.max(worstAxis, Math.hypot(a1 - a0, b1 - b0), Math.hypot(c1 - c0, d1 - d0));
      }
    }
    check(worstAxis < 1e-9, t.meta.name,
      `the 2D pose's axes are ${worstAxis.toFixed(4)} off the projection of its own 3D pose`);
    check(!negativeScale, t.meta.name, 'hands a sprite path a negative scale instead of a skew past 90 degrees');
  }
}

// ============================================================
//  ARC — the reference's other ported engine, pinned against its live scene
//
//  Same method again (module 41034 read, then checked against the running page
//  with scripts/_scene_orbit.cjs at MS_FAMILY=Wheel — capture in
//  .shots/ref-scene-wheel.json). Two things separate it from the ring and both
//  are measured rather than assumed:
//
//    · its canvas IS the artboard. The live camera comes back with aspect
//      0.7995 against its 4:5 board where every ring capture came back square,
//      so the ring's BOARD_CROP must NOT be applied here — and its stage
//      photograph agrees (card 0.35 of the frame height, not 0.75).
//    · its panel states the wheel as a DIAMETER, twice the radius the maths
//      uses: 2500 on screen for the 1250 the cards actually sit on.
//
//  What the capture pins: 13 card meshes (its slotCount for count 9, which is
//  what its editor forces the count to), every one of them exactly 1250.0 from
//  the wheel's centre, and a camera at z 2264.519 with near 45.29 and far
//  13058.1 — 0.02·z and 4·z + 4000 to the digit.
// ============================================================
const ARC_UNIT = (height, zoom) => height / 2 / ((350 / 200) * ((408 * 100) / zoom));

{
  const H = 1080, W = 864;             // its own 4:5 artboard
  const ARC_ASPECT = 5 / 7;            // Custom 500x700
  const t = byName('Arc 01');
  if (t) {
    const v = defaultsFor(t.meta.id);
    const ctx = makeCtx(t.meta.id, { width: W, height: H, duration: 4.2, cardAspect: ARC_ASPECT });
    const k = ARC_UNIT(H, v.zoom);
    const R = v.diameter / 2;

    // --- the wheel. Every card is glued to the rim, and the rim's centre sits
    // one radius BELOW the crest — which is the whole mechanic: they ride over
    // a hill rather than round a ring.
    let worstRim = 0, worstTangent = 0;
    for (let i = 0; i < v.count; i++) {
      const p = t.transform(0, i, v.count, v, ctx);
      const x = p.x / k, y = p.y / k;
      worstRim = Math.max(worstRim, Math.abs(Math.hypot(x, y - R) - R));
      // ...and each card is turned by its own angle on that rim, so it stays
      // tangent to it. Stated as x = R·sin and y = R·(1 − cos) of the very
      // rotation the pose carries.
      worstTangent = Math.max(worstTangent,
        Math.abs(x - R * Math.sin(p.rotation)),
        Math.abs(y - R * (1 - Math.cos(p.rotation))));
    }
    check(worstRim < 0.5, 'Arc 01', `cards sit ${worstRim.toFixed(2)} units off the wheel's rim`);
    check(worstTangent < 0.5, 'Arc 01', `card turn is ${worstTangent.toFixed(2)} units out of tangent with the rim`);

    // --- the pitch is an ANGLE, and Gap sets the whole sweep: 55 degrees at
    // Gap 4 walking to 105 at Gap 80, shared out between the cards. At frame 0
    // every stagger delay is still unspent, so the angles are exactly the
    // nominal ones and this comparison is not approximate.
    const sweep = 55 + ((v.gap - 4) / 76) * 50;
    const pitch = ((2 * sweep) / v.count) * (Math.PI / 180);
    let worstPitch = 0;
    for (let i = 0; i < v.count; i++) {
      const p = t.transform(0, i, v.count, v, ctx);
      worstPitch = Math.max(worstPitch, Math.abs(p.rotation - (i - (v.count - 1) / 2) * pitch));
    }
    check(worstPitch < 1e-9, 'Arc 01', `pitch is ${worstPitch.toFixed(6)} rad off ${(pitch * 180 / Math.PI).toFixed(3)} degrees per card`);

    // The coincidence that proves the reading: at its authored Gap 20 with 8
    // cards on a 1250 wheel the arc between neighbours is 357.4 units and the
    // card is 500 x 5/7 = 357.1 wide. They just touch. A wrong sweep or a wrong
    // radius would not land there.
    near(pitch * R, 500 * ARC_ASPECT, 0.5, 'Arc 01', 'neighbours exactly one card apart at the authored Gap');

    // --- the card's drawn size. The renderer normalizes a sprite's LONG edge
    // to SPRITE_BASE, and this card is portrait, so the long edge is its height.
    const p0 = t.transform(0, 0, v.count, v, ctx);
    near(p0.scale * SPRITE_BASE, 500 * k, 0.01, 'Arc 01', 'card height in px');
    // Its frame is 1.75 x distance tall whatever the lens — the same
    // cancellation the ring and the belt have — so the card covers this much of
    // it, which is what its stage photographs.
    near((500 * k) / H, 0.35, 0.01, 'Arc 01', 'card as a share of the frame height');
  }

  // Every authored preset, off its own table (.shots/ref-arc-presets-authored.json).
  // All three share one geometry and differ only in how they move.
  const ARC_PRESETS = {
    'Arc 01': { count: 8, gap: 20, cardSize: 500, diameter: 2500, zoom: 100, movement: 'boomerang', direction: 'forward', pause: 0.25, stagger: 0.05, staggerMode: 'pull', cornerRadius: 10 },
    'Arc 02': { count: 8, gap: 20, cardSize: 500, diameter: 2500, zoom: 100, movement: 'normal', direction: 'forward', pause: 0.25, stagger: 0.05, staggerMode: 'pull', cornerRadius: 10 },
    'Arc 03': { count: 8, gap: 20, cardSize: 500, diameter: 2500, zoom: 100, movement: 'normal', direction: 'forward', pause: 0, stagger: 0, staggerMode: 'pull', cornerRadius: 10 },
  };
  for (const [name, authored] of Object.entries(ARC_PRESETS)) {
    const preset = byName(name);
    check(!!preset, name, 'is missing from the catalogue');
    if (!preset) continue;
    const v = defaultsFor(preset.meta.id);
    for (const [key, want] of Object.entries(authored)) {
      check(sameValue(v[key], want), name, `${key} is ${JSON.stringify(v[key])}, the reference authors ${JSON.stringify(want)}`);
    }
    check(Math.abs((preset.meta.cardAspect ?? 1) - ARC_ASPECT) < 1e-9, name,
      `card shape is ${preset.meta.cardAspect}, the reference authors 500x700`);
  }

  // Loop closure and finiteness. The boomerang closes because it swings out and
  // all the way back; the normal mode closes because a whole number of steps
  // brings every card back to its own start — and the wrap that makes that true
  // is the one place this port restates the reference's model rather than
  // copying it (its slots stand still and its textures rotate; here the cards
  // travel and wrap).
  for (const preset of templateList.filter((x) => x.meta.id.startsWith('arc-'))) {
    const v = defaultsFor(preset.meta.id);
    const duration = preset.meta.id === 'arc-01' ? 4.2 : 13.5;
    const ctx = makeCtx(preset.meta.id, { width: W, height: H, duration, cardAspect: ARC_ASPECT });
    check(loopDrift(preset, v, ctx) < 1e-6, preset.meta.name, 'does not return to frame 0 at the loop point');
    let finite = true, everVisible = false;
    for (let f = 0; f <= ctx.totalFrames; f += 5) {
      for (let i = 0; i < v.count; i++) {
        const p = preset.transform(f, i, v.count, v, ctx);
        if (![p.x, p.y, p.scale, p.alpha, p.rotation].every(Number.isFinite)) finite = false;
        if (p.alpha > 0.02 && p.scale > 0) everVisible = true;
      }
    }
    check(finite, preset.meta.name, 'emits a non-finite pose');
    check(everVisible, preset.meta.name, 'draws nothing at all');
  }
}

// ============================================================
//  WHEEL — the reference's third ported engine, pinned against its live scene
//
//  Read out of module 24248 (WHEEL_FOV, WHEEL_BANK_DEG, cameraZ, computeFrame,
//  computeWheelContrastScales), its preset table in 478 and its stage renderer
//  in 44392, then checked against the running page (scripts/_scene_orbit.cjs at
//  MS_FAMILY=Wheel, capture in .shots/ref-scene-wheel.json).
//
//  What the capture pins, and what each row here would catch:
//    Wheel 01  the ellipse radius is orbitRadius + HALF A CARD + Gap — its
//              first card's frame group sits at x 387.5 for orbitRadius 350 and
//              a 75 card, which no other reading of "radius" lands on. Its mesh
//              is turned -PI/2 and the next by -PI/2 + one slot, which is the
//              radial alignment. And the ring group carries axis + spin.
//    Wheel 05  the same expression with Ellipticity 0.33 puts its frame group
//              at (-202.792, 250.243), exactly on rx 425 / ry 284.75. Its ring
//              group carries the axis ALONE, because `static` coupling walks
//              the cards round a wheel that stands still — so its cards ride a
//              FIXED ellipse, which is the assertion below and the one thing
//              that separates a fairground wheel from a turning plate.
//
//  Its camera has no separate check because this family is flat: with every
//  card at z=0 the only thing the camera decides is scale, and that is the unit
//  scale asserted through the card's height in px.
// ============================================================
const WHEEL_UNIT = (height, zoom) => height / 2 / ((170 / 200) * ((631 * 100) / zoom));

{
  const H = 1080, W = 1080;            // its own artboard for this family is 1:1
  const wheelScenes = [
    { name: 'Wheel 01', aspect: 4 / 5, rx: 387.5, ellipticity: 0, axis: 45, radial: true },
    { name: 'Wheel 05', aspect: 1, rx: 425, ellipticity: 0.33, axis: 37, radial: false },
  ];
  for (const scene of wheelScenes) {
    const t = byName(scene.name);
    if (!t) { check(false, scene.name, 'is missing from the catalogue'); continue; }
    const v = defaultsFor(t.meta.id);
    const ctx = makeCtx(t.meta.id, { width: W, height: H, cardAspect: scene.aspect });
    const k = WHEEL_UNIT(H, v.zoom);
    const ry = scene.rx * (1 - scene.ellipticity);
    const axis = scene.axis * (Math.PI / 180);

    // At frame 0 the spin is still zero, so the ring carries the axis alone and
    // the cards are exactly where the ellipse puts them. Nothing approximate.
    let worstEllipse = 0, worstTurn = 0;
    for (let i = 0; i < v.count; i++) {
      const p = t.transform(0, i, v.count, v, ctx);
      // Back out of the canvas: y runs down here and up in the reference.
      const x = p.x / k, y = -p.y / k;
      // Un-turn the ring, then the point must sit on rx x ry.
      const lx = x * Math.cos(-axis) - y * Math.sin(-axis);
      const ly = x * Math.sin(-axis) + y * Math.cos(-axis);
      worstEllipse = Math.max(worstEllipse,
        Math.abs((lx / scene.rx) ** 2 + (ly / ry) ** 2 - 1));
      // Radial points the card along its own spoke (turned a quarter so the
      // card's top faces out); Normal keeps it upright whatever the ring does.
      const spoke = (i / Math.max(3, Math.round(v.count))) * Math.PI * 2;
      const want = scene.radial ? -(axis + spoke - Math.PI / 2) : 0;
      worstTurn = Math.max(worstTurn, Math.abs(Math.atan2(
        Math.sin(p.rotation - want), Math.cos(p.rotation - want))));
    }
    check(worstEllipse < 1e-9, scene.name,
      `cards are ${worstEllipse.toFixed(6)} off the ellipse rx ${scene.rx} / ry ${ry.toFixed(2)}`);
    check(worstTurn < 1e-9, scene.name,
      `card turn is ${worstTurn.toFixed(6)} rad off its ${scene.radial ? 'radial' : 'upright'} alignment`);

    // The card is `cardSize` TALL in the reference's units whatever its shape,
    // and the frame is 170/200 x distance tall for any lens — so this one
    // number carries the whole camera for a flat family.
    const p0 = t.transform(0, 0, v.count, v, ctx);
    const long = p0.scale * SPRITE_BASE;
    const heightPx = scene.aspect >= 1 ? long / scene.aspect : long;
    near(heightPx, v.cardSize * k, 0.01, scene.name, 'card height in px');
  }

  // `static` coupling is what makes a fairground wheel: the hub stands still
  // and the cards walk round it, so every card stays on ONE ellipse for the
  // whole clip. With `rotate` the ellipse itself turns and this would fail at
  // any frame but 0 — which is exactly the confusion worth pinning.
  {
    const t = byName('Wheel 05');
    if (t) {
      const v = defaultsFor(t.meta.id);
      const ctx = makeCtx(t.meta.id, { width: W, height: H, duration: 12, cardAspect: 1 });
      const k = WHEEL_UNIT(H, v.zoom);
      const rx = 425, ry = rx * (1 - 0.33), axis = 37 * (Math.PI / 180);
      let worst = 0;
      for (let f = 0; f <= ctx.totalFrames; f += 9) {
        for (let i = 0; i < v.count; i++) {
          const p = t.transform(f, i, v.count, v, ctx);
          const x = p.x / k, y = -p.y / k;
          const lx = x * Math.cos(-axis) - y * Math.sin(-axis);
          const ly = x * Math.sin(-axis) + y * Math.cos(-axis);
          worst = Math.max(worst, Math.abs((lx / rx) ** 2 + (ly / ry) ** 2 - 1));
        }
      }
      check(worst < 1e-9, 'Wheel 05', `leaves its fixed ellipse by ${worst.toFixed(6)} — static coupling must walk the cards, not turn the ring`);
    }
  }

  // Every authored preset, off its own table (module 478). Diameter is twice its
  // orbitRadius; Speed is count/loopDuration, cards per second; Hold is its
  // implicit pause, an eighth of a step on the presets that carry a curve.
  const WHEEL_PRESETS = {
    'Wheel 01': { count: 20, cardSize: 75, diameter: 700, gap: 0, ellipticity: 0, axis: 45, cardAlign: 'radial', spinCoupling: 'rotate', zoom: 100, scaleContrast: 0, direction: 'forward', speed: 1, hold: 12.5, shape: 4 / 5 },
    'Wheel 02': { count: 24, cardSize: 60, diameter: 400, gap: 200, ellipticity: 0, axis: 45, cardAlign: 'normal', spinCoupling: 'rotate', speed: 2, hold: 0, shape: 4 / 5 },
    'Wheel 03': { count: 12, cardSize: 170, diameter: 400, gap: 0, ellipticity: 0, axis: 45, cardAlign: 'normal', spinCoupling: 'rotate', speed: 1, hold: 12.5, shape: 1 },
    'Wheel 04': { count: 10, cardSize: 170, diameter: 340, gap: 38, ellipticity: 0, axis: 45, cardAlign: 'radial', spinCoupling: 'rotate', speed: 1, hold: 12.5, shape: 4 / 5 },
    'Wheel 05': { count: 12, cardSize: 200, diameter: 650, gap: 0, ellipticity: 0.33, axis: 37, cardAlign: 'normal', spinCoupling: 'static', speed: 1, hold: 0, shape: 1 },
  };
  for (const [name, authored] of Object.entries(WHEEL_PRESETS)) {
    const preset = byName(name);
    check(!!preset, name, 'is missing from the catalogue');
    if (!preset) continue;
    const v = defaultsFor(preset.meta.id);
    for (const [key, want] of Object.entries(authored)) {
      if (key === 'shape') continue;
      check(sameValue(v[key], want), name, `${key} is ${JSON.stringify(v[key])}, the reference authors ${JSON.stringify(want)}`);
    }
    check(Math.abs((preset.meta.cardAspect ?? 1) - authored.shape) < 1e-9, name,
      `card shape is ${preset.meta.cardAspect}, the reference authors ${authored.shape.toFixed(3)}`);
  }

  // Loop closure and finiteness across the family.
  for (const preset of templateList.filter((x) => x.meta.id.startsWith('wheel-r'))) {
    const v = defaultsFor(preset.meta.id);
    const aspect = preset.meta.cardAspect ?? 4 / 5;
    const ctx = makeCtx(preset.meta.id, { width: W, height: H, duration: 12, cardAspect: aspect });
    check(loopDrift(preset, v, ctx) < 1e-6, preset.meta.name, 'does not return to frame 0 at the loop point');
    let finite = true, everVisible = false;
    for (let f = 0; f <= ctx.totalFrames; f += 7) {
      for (let i = 0; i < v.count; i++) {
        const p = preset.transform(f, i, v.count, v, ctx);
        if (![p.x, p.y, p.scale, p.alpha, p.rotation].every(Number.isFinite)) finite = false;
        if (p.alpha > 0.02 && p.scale > 0) everVisible = true;
      }
    }
    check(finite, preset.meta.name, 'emits a non-finite pose');
    check(everVisible, preset.meta.name, 'draws nothing at all');
  }
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
