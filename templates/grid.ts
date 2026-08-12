import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { TAU, clamp, stepHold } from '@/lib/motion';
import { variant } from './variant';
import { divisorNear } from './frames';

const BASE = 340;

// ============================================================
//  GRID — a tiled wall that steps diagonally, cell by cell
//
//  This is Frames' squared-off sibling, and the difference is the weave. Frames
//  offsets its rows like brickwork and lets each one drift at its own rate; Grid
//  keeps its columns ALIGNED and moves as one piece, advancing in discrete cell
//  steps with a beat of stillness between them. Frames wanders, Grid marches.
//  (Dock is a third thing again: a grid that magnifies near a moving focus.)
//
//  Measured on the reference tool, with the playhead paused — which matters,
//  because reading its card list while it plays returns half-written frames and
//  produced two rounds of nonsense before this:
//
//  · The lattice is rigid. Every visible card shares one position residue
//    (spread 0 across 9 cards), so the whole wall moves as one piece.
//  · Columns are aligned — all three rows sat on the same set of x values, with
//    no masonry offset anywhere in the clip.
//  · Cards are 3:4 at a constant size while `zoom` is off, 700x933 on its
//    1080x1440 stage, with `planeSize` reading directly as the card's WIDTH in
//    px. Halving that for this project's canvas and dividing back out by the 3:4
//    ratio cancels exactly, so `cardSize` here equals the reference planeSize.
//  · Pitch is card + gap on both axes (700+80, 933+80).
//  · The clip loops exactly, and the wall returns to its home cell six times
//    across it — a 2.93s cycle on a 17.6s clip.
//
//  The motion, tracked by following one identified cell across a cycle rather
//  than by reading residues (which wrap and mislead):
//
//      t=0.00  (540, -293)      t=1.47  (-74,  505)
//      t=0.24  (540, -293)      t=2.20  (-202, 671)
//      t=0.73  (430, -151)      t=3.18  (-241, 719)
//
//  That is a displacement of (-781, +1012), which is exactly (-1 pitchX,
//  +1 pitchY). So the wall advances ONE CELL DIAGONALLY per cycle — left one
//  column, down one row — six times over the clip. Its progress within a step
//  runs 0, 0, 0.015, 0.14, 0.46, 0.79, 0.95, 0.99: a distinct hold at the start
//  and then a long deceleration, which is a stepped advance, not a glide.
//
//  So Grid is a stepped diagonal conveyor with aligned columns, and Frames is a
//  woven one with offset rows. An earlier version of this file had it drifting a
//  few percent of a cell in place, which was wrong by an order of magnitude —
//  that reading came from residues sampled while the playhead was running.
// ============================================================

const grid: Template = {
  meta: {
    id: 'grid-01',
    name: 'Grid 01',
    group: 'Grid',
    isNew: true,
    defaultEasing: { id: 'glide' },
    cardAspect: 3 / 4,
    repeatAssets: true,
  },

  controls: [
    // The lattice has to hold at least as many distinct cells along each axis as
    // the wall takes steps, or the whole composition repeats inside one clip:
    // a 3x3 returns to itself every 3 steps, so six steps played the same three
    // frames twice. Six columns and six rows give six distinct steps. Most of
    // those cells sit off-canvas at any moment — that is the overscan doing its
    // job, and it is what the reference gets for free by virtualizing.
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 60, step: 1,   default: 36 },
    { key: 'columns',      label: 'Columns',       type: 'slider', min: 1, max: 10, step: 1,   default: 6, section: 'Layout', description: 'Snaps to a divisor of Count so the wall has no half-filled row.' },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 60, max: 1000, step: 1, default: 700 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0, max: 400, step: 1,  default: 60 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 0 },
    { key: 'direction',    label: 'Direction',     type: 'pills',  options: ['forward','reverse'], default: 'forward', section: 'Motion' },
    { key: 'cycles',       label: 'Steps',         type: 'slider', min: 0, max: 24, step: 1,   default: 6, section: 'Motion', description: 'Cells advanced diagonally over the clip. 0 pins the wall still.' },
    { key: 'hold',         label: 'Hold',          type: 'slider', min: 0, max: 90, step: 1,   default: 12, section: 'Motion', unit: '%', description: 'Share of each cell step spent stopped before it moves.' },
    { key: 'zoom',         label: 'Zoom',          type: 'pills',  options: ['off','on'],      default: 'off', section: 'Motion' },
    { key: 'zoomAmount',   label: 'Zoom Amount',   type: 'slider', min: 0, max: 60, step: 1,   default: 20, unit: '%', visibleWhen: { key: 'zoom', equals: 'on' } },
    { key: 'breath',       label: 'Breath',        type: 'pills',  options: ['off','on'],      default: 'off', section: 'Motion', description: 'A cyclic swell on top of the zoom.' },
    { key: 'pulseAmt',     label: 'Breath Amount', type: 'slider', min: 0, max: 60, step: 1,   default: 20, unit: '%', visibleWhen: { key: 'breath', equals: 'on' } },
    { key: 'pulseCycles',  label: 'Breath Cycles', type: 'slider', min: 1, max: 12, step: 1,   default: 6, visibleWhen: { key: 'breath', equals: 'on' } },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    // Same no-half-row rule as Frames: an incomplete last row would read as a
    // hole punched in the wall, and here it never scrolls away.
    const cols = divisorNear(count, clamp(Math.round(v.columns), 1, 10));
    const rows = Math.max(1, Math.round(count / cols));
    const col = index % cols;
    const row = Math.floor(index / cols);

    // The renderer normalizes a sprite's LONG edge, so cardSize is that edge and
    // the short one follows the card's RESOLVED aspect — which the scene's card
    // shape can override away from this family's declared 3:4. Spacing off the
    // declared value instead leaves one gutter right and the other wrong: at the
    // 4:5 shape a nominal 60px gap comes out 60 vertically and 25 across.
    // `gap` is a true edge gap in canvas px, so pitch reads as "card plus gutter".
    const aspect = ctx.cardAspect ?? 3 / 4;
    const sizeFactor = v.cardSize / BASE;
    const cardW = aspect < 1 ? v.cardSize * aspect : v.cardSize;
    const cardH = aspect < 1 ? v.cardSize : v.cardSize / aspect;
    // The wall wraps as a torus over one lattice period, which only covers the
    // frame while that period is at least as big as the frame. Nothing stopped a
    // small Plane Size from breaking that: at Plane Size 60 / Gap 60 on a 6x6,
    // the lattice spans 630x720 inside an 810x1080 canvas and leaves a 360px
    // band of dead background down the frame.
    //
    // Covering it with more CELLS is not available — that size needs 8x9 = 72 of
    // them and `count` is the sprite budget. So the GUTTER takes up the slack.
    // Widening the gutter rather than scaling the pitch matters: a single factor
    // on both pitches adds a different amount to each axis, which pulls the
    // horizontal and vertical gutters apart — the exact asymmetry this family
    // was fixed for once already. One gutter, solved on whichever axis needs it
    // most, keeps them equal and covers the frame.
    const gutter = Math.max(v.gap, ctx.width / cols - cardW, ctx.height / rows - cardH);
    const pitchX = cardW + gutter;
    const pitchY = cardH + gutter;

    const spanX = cols * pitchX;
    const spanY = rows * pitchY;

    // The wall steps a whole cell per cycle on BOTH axes, so travel is snapped
    // to a multiple of the lattice period on each — a wall that stops a third of
    // the way across would put different pictures in the same cells at the loop
    // point. With the measured 6 steps on a 3x3 that snap is already exact.
    const want = Math.max(0, Math.round(v.cycles));
    const stepsX = want === 0 ? 0 : cols * Math.max(1, Math.round(want / cols));
    const stepsY = want === 0 ? 0 : rows * Math.max(1, Math.round(want / rows));

    const dir = v.direction === 'reverse' ? -1 : 1;
    const u = frame / ctx.totalFrames;

    // One phase unit = one cell, so the hold parks the wall on whole cells.
    // `stepHold` is loop-safe (f(n) = n) and takes the scene curve, which is
    // what produces the measured shape: a beat of stillness, then a long settle.
    const hold = clamp(v.hold / 100, 0, 0.95);
    const step = (total: number) => total === 0 ? 0
      : hold > 0 ? stepHold(u * total, hold, ctx.ease) : ctx.easedPhase(u * total);

    // Measured: left one column and down one row per cycle.
    const panX = -step(stepsX) * pitchX * dir;
    const panY = step(stepsY) * pitchY * dir;

    const wrapCentred = (q: number, span: number) => (((q % span) + span) % span) - span / 2;
    const baseX = wrapCentred(col * pitchX - panX, spanX);
    const baseY = wrapCentred(row * pitchY - panY, spanY);

    const turn = TAU * u;

    // Zoom swells once and returns; breath rides a whole number of cycles on top,
    // which is why Breath Cycles is an integer slider.
    const z = v.zoom === 'on'
      ? 1 + (v.zoomAmount / 100) * (0.5 - 0.5 * Math.cos(turn))
      : 1;
    const b = v.breath === 'on'
      ? 1 + (v.pulseAmt / 100) * 0.5 * Math.sin(turn * Math.round(v.pulseCycles))
      : 1;
    const swell = z * b;

    // Scaling the lattice with the cards keeps the zoom centred on the frame
    // instead of sliding the wall off one corner.
    return {
      x: baseX * swell + v.offset.x,
      y: baseY * swell + v.offset.y,
      scale: sizeFactor * swell,
      rotation: 0,
      alpha: 1,
      depth: row + col * 0.01,
    };
  },
};

// `variant` only patches control defaults; a preset with its own curve needs
// `meta` patched too.
function preset(id: string, name: string, patch: Record<string, any>, easing: EasingSpec): Template {
  const t = variant(grid, id, name, patch);
  return { ...t, meta: { ...t.meta, defaultEasing: easing } };
}

const SMOOTH: EasingSpec = { id: 'smooth' };

export const gridVariants: Template[] = [
  grid,
  // A dense 7x7 of smaller tiles.
  preset('grid-02', 'Grid 02', { count: 49, columns: 7, cardSize: 537, gap: 59 }, { id: 'glide' }),
  preset('grid-03', 'Grid 03', { gap: 89 }, SMOOTH),
  // Wide gutters and a real zoom — the tiles read as separate prints on a wall.
  preset('grid-04', 'Grid 04', { cardSize: 637, gap: 375, zoom: 'on', zoomAmount: 30 }, SMOOTH),
  preset('grid-05', 'Grid 05', { gap: 89, zoom: 'on' }, SMOOTH),
];
