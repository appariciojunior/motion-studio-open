import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { TAU, clamp, hash2, lerp } from '@/lib/motion';
import { canvasScale } from './lattice';
import { repeatCopies, repeatCoordinate } from './infiniteField';
import { variant } from './variant';

const BASE = 340;

// ============================================================
//  PARALLAX — a still field of photos, walked by a stopping camera
//
//  Controls, read off the reference's live panel (Count, Min Size, Max Size,
//  Corner Radius, Spread, Travel, Depth, Fade, Seed) with their authored
//  values from its own store:
//
//      Parallax 01: count 133, spread 300, travel 300, depth 60,  fade 0,
//                   seed 10, duration 14s, bezier [0.76, 0, 0.24, 1]
//      Parallax 02: count 200, spread 300, travel 150, depth 100, fade 78,
//                   seed 10, duration 16s, bezier [0.76, 0, 0.24, 1]
//      Parallax 03: count 140, spread 180, travel 100, depth 60,  fade 80,
//                   seed 10, duration 16s, bezier [0.33, 0, 0,    1]
//
//  Min/Max Size are not in any preset's baseline — all three fall back to the
//  schema defaults 238/442. `planeSize`/`scaleCenter`/`direction` sit in the
//  baseline but never surface on the panel; dead keys from an older version.
//
//  THE MOTION, measured off its canvas by cross-correlating consecutive
//  frames (normalized correlation over the overlap, so a clean translation is
//  distinguishable from content simply changing):
//
//  · The whole field TRANSLATES as one piece — correlation peaks at 0.95-0.99
//    through the slow phases, and a single (dx, dy) aligns one frame onto the
//    next. Nothing fades in or out. Two earlier passes modelled this family as
//    per-card flicker; that was wrong, and it is why it never looked right.
//
//  · The camera STOPS and LURCHES. Sampling velocity every 0.2s across the
//    clip, the field rests (v = 0) and then bursts, and the rests land exactly
//    on the camera-path pins:
//
//        rest measured   0.4   2.5   4.3   7.3   9.7   11.9   14.0
//        pin  predicted  0     2.33  4.67  7.0   9.33  11.67  14.0
//
//    That is the authored bezier [0.76, 0, 0.24, 1] — near-zero slope at both
//    ends — applied per segment between pins. This hold-and-lurch rhythm IS
//    the family's signature, and no amount of tuning a continuous drift or a
//    flicker duty cycle would have produced it.
//
//  · Coverage drifts slowly (10-40% of lit pixels) over one clip rather than
//    oscillating. That falls out of a camera crossing a random field's denser
//    and sparser patches — another thing a flicker model gets wrong, since
//    flicker would oscillate at its own rate.
//
//  · Peak speed runs ~1000-1500 px/s on its 1080x1440 stage. Per-segment
//    displacement measured 300-900 px per grid cell, too noisy to pin down
//    exactly (the correlation saturates at peak velocity, and a scatter of
//    similar cards offers false peaks at large displacement), so PAN_PER_CELL
//    below is calibrated to the cleanest segment and is approximate.
//
//  THE CAMERA PATH is a real, dedicated feature, and not a slider — it never
//  appears in the Controls panel. It lives in its own store slice,
//  `useAnimatorStore.getState().waypointsPerModeBaseline[modeId]`, as {c, r, t}
//  triples: grid column, row, and time fraction. All three presets carry a
//  CLOSED six-pin loop over a 7x7 grid centred at (3,3):
//
//    Parallax 01: (3,3)->(5,2)->(6,5)->(3,5)->(1,4)->(2,0)->(3,3)
//    Parallax 02: (1,3)->(4,0)->(6,4)->(3,6)->(3,3)->(0,6)->(1,3)
//    Parallax 03: (1,0)->(4,0)->(5,4)->(3,6)->(3,3)->(0,6)->(1,0)
//
//  SCATTER EXTENT, measured from lit-pixel statistics on its own stage:
//  medSdx 281-312 and medSdy 351-440, against the 1080/sqrt(12) = 312 and
//  1440/sqrt(12) = 416 a uniform full-frame scatter predicts — so the field is
//  uniform, and `spread` 180 vs 300 does not change that (all three fill the
//  frame). Ours is a percentage, and the reference presets carry 100.
// ============================================================

// {c, r, t}: grid column/row (0..6, centre 3) and time fraction 0..1, read
// verbatim from the reference's own waypointsPerModeBaseline.
const CAMERA_PATHS: Record<string, { c: number; r: number; t: number }[]> = {
  p1: [
    { c: 3, r: 3, t: 0 }, { c: 5, r: 2, t: 1 / 6 }, { c: 6, r: 5, t: 2 / 6 },
    { c: 3, r: 5, t: 0.5 }, { c: 1, r: 4, t: 4 / 6 }, { c: 2, r: 0, t: 5 / 6 }, { c: 3, r: 3, t: 1 },
  ],
  p2: [
    { c: 1, r: 3, t: 0 }, { c: 4, r: 0, t: 1 / 6 }, { c: 6, r: 4, t: 2 / 6 },
    { c: 3, r: 6, t: 0.5 }, { c: 3, r: 3, t: 4 / 6 }, { c: 0, r: 6, t: 5 / 6 }, { c: 1, r: 3, t: 1 },
  ],
  p3: [
    { c: 1, r: 0, t: 0 }, { c: 4, r: 0, t: 1 / 6 }, { c: 5, r: 4, t: 2 / 6 },
    { c: 3, r: 6, t: 0.5 }, { c: 3, r: 3, t: 4 / 6 }, { c: 0, r: 6, t: 5 / 6 }, { c: 1, r: 0, t: 1 },
  ],
};
const GRID_CENTRE = 3;
const GRID_REACH = 3;   // furthest a pin sits from centre, in cells
// Canvas long edges per grid cell, at Travel 100. Calibrated to the cleanest
// measured segment; approximate — see the header.
const PAN_PER_CELL = 0.20;
// Roughly how many cards fall inside one frame, at Spread 100%. The wall is
// sized FROM the card count to hold this density, rather than being a fixed
// size — the reference's three presets cover 22 / 25 / 24.5% of the frame on
// average despite counting 133 / 200 / 140 cards, which is constant density,
// not a constant wall. Sizing the wall independently made the densest preset
// cover 63% where the reference covers 35%.
const CARDS_PER_FRAME = 4;
// How far a card may wander inside its own grid cell, in cell widths. Above 1
// the cells overlap and the grid stops being readable as a grid; at 0 it is a
// bare lattice.
const JITTER = 1.15;

// The pin the path is on at `u`, and how far it has eased toward the next.
// Each leg lands exactly on its pin, and `shape` (the scene's easing curve)
// is what turns the legs into the measured hold-and-lurch.
function cameraPathAt(
  path: { c: number; r: number; t: number }[],
  u: number,
  shape: (t: number) => number,
): { nx: number; ny: number } {
  let seg = path.length - 2;
  for (let i = 0; i < path.length - 1; i++) {
    if (u >= path[i].t && u <= path[i + 1].t) { seg = i; break; }
  }
  const a = path[seg], b = path[seg + 1];
  const span = Math.max(1e-6, b.t - a.t);
  const local = shape(clamp((u - a.t) / span, 0, 1));
  return {
    nx: lerp(a.c, b.c, local) - GRID_CENTRE,
    ny: lerp(a.r, b.r, local) - GRID_CENTRE,
  };
}

function fieldGeometry(v: Record<string, any>, ctx: {width:number; height:number}) {
  const n = Math.max(1, Math.round(v.count));
  const k = canvasScale(ctx);
  const density = Math.sqrt(n / CARDS_PER_FRAME) * clamp(v.spread ?? 100, 20, 400) / 100;
  const width = ctx.width * density, height = ctx.height * density;
  const card = Math.max(v.minSize, v.maxSize) * k * 1.06;
  return {n,k,width,height,
    copiesX:repeatCopies(ctx.width,width,card,(v.offset?.x ?? 0)*k),
    copiesY:repeatCopies(ctx.height,height,card,(v.offset?.y ?? 0)*k)};
}

const parallax: Template = {
  meta: { id: 'parallax-01', name: 'Drift 01', group: 'Drift', repeatAssets: true, defaultEasing: { id: 'smooth' } },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 3, max: 250, step: 1,   default: 100 },
    { key: 'minSize',      label: 'Min Size',      type: 'slider', min: 10, max: 900, step: 5,  default: 110 },
    { key: 'maxSize',      label: 'Max Size',      type: 'slider', min: 10, max: 900, step: 5,  default: 300 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 150, step: 1,   default: 0 },
    { key: 'spread',       label: 'Spread',        type: 'slider', min: 20, max: 200, step: 5,  default: 100, unit: '%', description: '100% scatters the cards across the whole frame.' },
    { key: 'travel',       label: 'Travel',        type: 'slider', min: 20, max: 350, step: 5,  default: 130, description: 'How far the camera moves between pins.' },
    { key: 'depth',        label: 'Depth',         type: 'slider', min: 0, max: 100, step: 1,   default: 60, description: '0 makes every card the same size; 100 is the full near/far spread.' },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,   default: 45, description: 'Dims far cards toward the background.' },
    { key: 'seed',         label: 'Seed',          type: 'slider', min: 1, max: 999, step: 1,   default: 1 },
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    { key: 'camPath',      label: 'Camera Path',   type: 'select', options: ['orbit','p1','p2','p3'], default: 'orbit', section: 'Motion', description: 'orbit is a generic drift; p1-p3 replay the reference’s own authored pin paths.' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  layerCount: (v, ctx) => {const g=fieldGeometry(v,ctx);return g.n*g.copiesX*g.copiesY;},
  mediaCount: (v) => Math.max(1,Math.round(v.count)),
  mediaIndex: (index,_count,v) => index % Math.max(1,Math.round(v.count)),
  transform: (frame, index, count, v, ctx) => {
    const geo=fieldGeometry(v,ctx);
    const repeated=count===geo.n*geo.copiesX*geo.copiesY;
    const copy=Math.floor(index/geo.n);
    if(repeated){index%=geo.n;count=geo.n;}
    const seed = v.seed ?? 1;
    // How much per-card variety `depth` buys: at 0 every card collapses to one
    // middling depth (uniform size), at 100 the full seeded spread applies.
    const strength = clamp(v.depth, 0, 100) / 100;
    const d = lerp(0.5, hash2(index, seed * 91.7), strength);

    const sizeFactor = lerp(v.minSize, v.maxSize, d) * geo.k / BASE;

    // The field is FIXED — measured: one (dx, dy) aligns consecutive frames at
    // correlation 0.95-0.99, so nothing moves relative to anything else and
    // nothing fades. It extends past the frame by the camera's full reach, so
    // walking to any pin still finds photos rather than a bare edge.
    const long = Math.max(ctx.width, ctx.height);
    const spreadFactor = clamp(v.spread ?? 100, 0, 400) / 100;
    // Frames across the wall, solved so density stays put as Count changes.
    const fieldScale = Math.sqrt(Math.max(1, count) / CARDS_PER_FRAME) * spreadFactor;
    const fieldW = ctx.width * fieldScale;
    const fieldH = ctx.height * fieldScale;
    // Jittered grid, not pure random. A purely random scatter clumps (Poisson),
    // and measuring it that way gave a coverage range about half again as wide
    // as the reference's — its wall is noticeably more even than chance while
    // still reading as unplanned. Each card owns one cell and is nudged inside
    // it, which keeps the evenness and hides the grid.
    const gCols = Math.max(1, Math.round(Math.sqrt(Math.max(1, count) * (fieldW / fieldH))));
    const gRows = Math.max(1, Math.ceil(Math.max(1, count) / gCols));
    const cellW = fieldW / gCols, cellH = fieldH / gRows;
    const col = index % gCols, row = Math.floor(index / gCols) % gRows;
    const jx = (hash2(index, seed * 17.3) - 0.5) * JITTER;
    const jy = (hash2(index, seed * 53.1) - 0.5) * JITTER;
    const x = (col + 0.5 + jx) * cellW - fieldW / 2 + v.offset.x * geo.k;
    const y = (row + 0.5 + jy) * cellH - fieldH / 2 + v.offset.y * geo.k;
    // Repeated field copies cover the camera path without clipping Travel.
    const panPerCell = (clamp(v.travel, 0, 1000) / 100) * PAN_PER_CELL * long;

    // Fade DARKENS the far cards; it does not make them see-through. At Fade 80
    // an alpha-based version left the farthest cards at 0.2 opacity, so every
    // card they overlapped ghosted through them and the wall read as broken
    // glass. Cards never change over time either way — see the header.
    const dim = (v.fade / 100) * (1 - d);

    const dir = v.direction === 'reverse' ? -1 : 1;
    const u = (((frame / ctx.totalFrames) * dir) % 1 + 1) % 1;

    const path = CAMERA_PATHS[v.camPath];
    let camX: number, camY: number, camZoom: number;
    if (path) {
      // The camera holds at each pin and lurches between them — that shape is
      // the scene's own easing curve, which is exactly how the reference does
      // it (its authored bezier is a near-flat-ended ease).
      const { nx, ny } = cameraPathAt(path, u, ctx.ease);
      camX = -nx * panPerCell;   // camera right -> field left
      camY = -ny * panPerCell;
      camZoom = 1;
    } else {
      // No authored path: a gentle one-cycle drift, so this family's own
      // presets still breathe.
      const angle = TAU * ctx.easedPhase(u);
      camZoom = 1 + 0.06 * (0.5 - 0.5 * Math.cos(angle));
      camX = Math.cos(angle) * panPerCell * GRID_REACH * 0.5;
      camY = Math.sin(angle) * panPerCell * GRID_REACH * 0.5;
    }

    return {
      x: repeated ? repeatCoordinate(x * camZoom + camX, fieldW * camZoom, copy % geo.copiesX, geo.copiesX) : x * camZoom + camX,
      y: repeated ? repeatCoordinate(y * camZoom + camY, fieldH * camZoom, Math.floor(copy / geo.copiesX), geo.copiesY) : y * camZoom + camY,
      scale: sizeFactor * camZoom,
      rotation: 0,
      alpha: 1,
      dim,
      depth: d,
    };
  },
};

// `variant` only patches control defaults; these presets also need their own
// curve, their own catalogue group and the NEW badge. They are a different
// LOOK from Drift 01-04 despite sharing the transform — a walked photo wall
// rather than a drifting one — so they get their own shelf.
function preset(id: string, name: string, patch: Record<string, any>, easing: EasingSpec): Template {
  const t = variant(parallax, id, name, patch);
  return { ...t, meta: { ...t.meta, defaultEasing: easing, group: 'Parallax', isNew: true } };
}

// The reference's own authored beziers, read from its store's bezPerModeBaseline.
const EASE_12: EasingSpec = { id: 'custom', bezier: [0.76, 0, 0.24, 1] };
const EASE_3: EasingSpec = { id: 'custom', bezier: [0.33, 0, 0, 1] };

export const parallaxVariants: Template[] = [
  parallax, // Drift 01
  variant(parallax, 'parallax-02', 'Drift 02', { count: 140, spread: 130, travel: 150, seed: 2 }),
  variant(parallax, 'parallax-03', 'Drift 03', { count: 40, spread: 60, travel: 80, seed: 3 }),
  variant(parallax, 'parallax-04', 'Drift 04', { count: 200, spread: 160, travel: 200, seed: 4 }),
  // Reference presets. `count`, `travel`, `depth`, `fade` and `seed` are the
  // reference's own numbers; `minSize`/`maxSize`/`cornerRadius` are its px,
  // canvas-scaled by 0.75 (its stage is 1080x1440, this project's long edge is
  // 1080); `spread` is 100% because that is what all three measure as; the
  // easing curves are its own authored beziers; `camPath` replays its pins.
  preset('parallax-r01', 'Parallax 01', {
    count: 133, minSize: 179, maxSize: 332, spread: 100, travel: 300, depth: 60, fade: 0, seed: 10, camPath: 'p1',
  }, EASE_12),
  preset('parallax-r02', 'Parallax 02', {
    count: 200, minSize: 179, maxSize: 332, spread: 100, travel: 150, depth: 100, fade: 78, seed: 10, camPath: 'p2',
  }, EASE_12),
  preset('parallax-r03', 'Parallax 03', {
    count: 140, minSize: 179, maxSize: 332, spread: 100, travel: 100, depth: 60, fade: 80, seed: 10, camPath: 'p3',
  }, EASE_3),
];
