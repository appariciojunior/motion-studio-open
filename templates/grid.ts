import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { TAU, clamp, stepHold } from '@/lib/motion';
import { variant } from './variant';
import { latticeCount, solveLattice } from './lattice';

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
//  · The wall has NO count control. Shrinking the cards ADDS cells and leaves
//    the gap exactly where it was — see templates/lattice.ts for the four states
//    that fix the rule and the fit. So the cell total is derived here too, from
//    `layerCount`, and Count and Columns are gone from the panel.
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
    // Plane Size and Gap are the whole layout. The wall's cell total follows
    // from them and the canvas — same two controls the reference ships.
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

  // The wall covers the canvas by holding enough cells, so the count is a
  // consequence of Plane Size, Gap and the frame — never a control.
  layerCount: (v, ctx) => latticeCount(v, ctx, 3 / 4),

  transform: (frame, index, count, v, ctx) => {
    // Solved from the canvas, not factored back out of `count`. The pool was
    // sized by the same solver, so on the stage the two agree exactly; `count`
    // goes in only so the board and web-export surfaces, whose card total comes
    // from the user's own markup, still tile a complete rectangle.
    const { cols, rows, pitchX, pitchY } = solveLattice(v, ctx, 3 / 4, count);
    const col = index % cols;
    const row = Math.floor(index / cols);
    const sizeFactor = v.cardSize / BASE;

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
  // Smaller tiles, so the wall solves to a denser lattice on its own.
  preset('grid-02', 'Grid 02', { cardSize: 537, gap: 59 }, { id: 'glide' }),
  preset('grid-03', 'Grid 03', { gap: 89 }, SMOOTH),
  // Wide gutters and a real zoom — the tiles read as separate prints on a wall.
  preset('grid-04', 'Grid 04', { cardSize: 637, gap: 375, zoom: 'on', zoomAmount: 30 }, SMOOTH),
  preset('grid-05', 'Grid 05', { gap: 89, zoom: 'on' }, SMOOTH),
];
