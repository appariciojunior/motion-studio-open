import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { clamp, stepHold } from '@/lib/motion';
import { variant } from './variant';
import { latticeCount, solveLattice, latticeAxis, latticeMediaIndex } from './lattice';

// Reference size (px) shared with the renderer's sprite normalization, so that
// `cardSize` reads directly in on-screen pixels.
const BASE = 340;

// The motif closes in time; offscreen copies provide continuous spatial coverage.
const framesBase: Template = {
  meta: {
    id: 'wall-01',
    name: 'Frames 01',
    group: 'Frames',
    isNew: true,
    // The reference wall ships a firm in-out curve, steeper than Smooth.
    defaultEasing: { id: 'custom', bezier: [0.7, 0, 0.3, 1] },
    repeatAssets: true,
    // Hung pictures are portrait 3:4, not the 4:5 default.
    cardAspect: 3 / 4,
  },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'pills',  options: ['forward','reverse'], default: 'forward' },
    // No Count and no Columns: how many pictures the wall holds is a
    // consequence of how big they are and how big the frame is. See
    // templates/lattice.ts — the reference tool ships the same two controls.
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 60, max: 1000, step: 1, default: 762 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0, max: 300, step: 1,  default: 30 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 0 },
    { key: 'rowsSkipped',  label: 'Rows Skipped',  type: 'slider', min: 0, max: 2, step: 1,    default: 1, section: 'Layout', description: 'Masonry offset: 0 aligns columns, 1 shifts every other row, 2 steps in thirds.' },
    { key: 'weave',        label: 'Weave',         type: 'pills',  options: ['same','opposed','varied'], default: 'varied', section: 'Motion', description: 'Whether rows share a sideways drift, alternate direction, or each take their own rate.' },
    { key: 'sweep',        label: 'Sweep',         type: 'slider', min: 0, max: 1, step: 0.1,  default: 0.4, section: 'Motion', description: 'How far rows drift sideways. 0 is a straight vertical lift.' },
    { key: 'hold',         label: 'Hold',          type: 'slider', min: 0, max: 90, step: 1,   default: 30, section: 'Motion', unit: '%', description: 'Share of each cell step spent stopped.' },
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: -15, max: 15, step: 0.5, default: 0, section: 'Depth', unit: '°', description: 'Rotates the complete wall.' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.05, default: 0.5, description: 'Requested cells per second, rounded to complete image-motif repeats. 0 stops motion.' },
  ],

  // Enough hung pictures to cover the wall, derived from their size and the
  // frame. The old Count/Columns pair could not express this: a smaller print
  // needs MORE of them, and every preset had to be hand-tuned to stay covered.
  layerCount: (v, ctx) => latticeCount(v, ctx, 3 / 4),

  mediaCount: (v, ctx) => { const l = solveLattice(v, ctx); return l.motifCols * l.motifRows; },
  mediaIndex: latticeMediaIndex,

  transform: (frame, index, count, v, ctx) => {
    frame = ((frame % ctx.totalFrames) + ctx.totalFrames) % ctx.totalFrames;
    // Solved from the canvas; the sprite pool came from the same solver, so on
    // the stage the two agree exactly. `count` goes in only for the board and
    // web-export surfaces, whose card total is however many elements the user
    // placed — see solveLattice's fixed-count fallback.
    const { cols, rows, motifCols, motifRows, pitchX, pitchY, scale } = solveLattice(v, ctx, 3 / 4, count);
    const col = index % cols;
    const row = Math.floor(index / cols);
    const motifRow = row % motifRows;
    const sizeFactor = v.cardSize * scale / BASE;

    // Masonry: rowsSkipped 0 aligns columns, 1 shifts alternate rows half a
    // cell, 2 steps in thirds. The shift is fractional so it survives wrapping.
    const period = Math.round(clamp(v.rowsSkipped, 0, 2)) + 1;
    const rowShift = period > 1 ? (motifRow % period) / period : 0;

    // The wall is a torus: each axis wraps over its full lattice span, so cards
    // leaving one edge re-enter at the opposite one.
    const spanX = motifCols * pitchX;

    // Vertical: the stack scrolls as ONE block — measuring the reference wall,
    // the gap between rows never changes. Whole cells, snapped to a multiple of
    // `rows` so the lattice lands back on itself at the loop point.
    const stepsY = v.speed === 0 ? 0 : motifRows * Math.max(1, Math.round((v.speed * ctx.duration) / motifRows));

    const dir = v.direction === 'reverse' ? -1 : 1;
    const t = frame / ctx.totalFrames;

    // One phase unit = one cell, so a hold pauses on whole cells. `stepHold` is
    // loop-safe (f(n) = n at integers) and takes the scene curve, so stepping
    // and easing compose instead of fighting. Both axes read this one clock, so
    // a held wall stops completely instead of shearing.
    const hold = clamp(v.hold / 100, 0, 0.95);
    const advance = hold > 0
      ? stepHold(t * stepsY, hold, ctx.ease)
      : ctx.easedPhase(t * stepsY);
    const panY = advance * pitchY * dir;

    // Horizontal: each row rides its own ring. `laps` counts whole LATTICE
    // WIDTHS, not cells — shifting a row by k cells would leave a different
    // picture in every slot at the loop point, and the export would pop once per
    // cycle. Integer laps keep each row's own loop exact while letting the rows
    // disagree with each other, and that disagreement is the weave.
    const baseLaps = v.sweep > 0
      ? Math.max(1, Math.round((v.sweep * stepsY * pitchY) / spanX))
      : 0;
    const alternate = motifRow % 2 === 1 ? -1 : 1;
    const laps = baseLaps === 0 ? 0
      : v.weave === 'same' ? baseLaps
      : v.weave === 'opposed' ? baseLaps * alternate
      // `varied` — a distinct rate per row, so no two rows ever re-align.
      : (baseLaps + (motifRow % 3)) * alternate;
    const panX = (stepsY === 0 ? 0 : advance / stepsY) * laps * spanX * dir;

    const px = latticeAxis(col, motifCols, cols, pitchX, panX, rowShift);
    const py = latticeAxis(row, motifRows, rows, pitchY, panY);

    const roll = (Number(v.tilt ?? 0) * Math.PI) / 180;
    const x = px * Math.cos(roll) - py * Math.sin(roll) + v.offset.x * scale;
    const y = px * Math.sin(roll) + py * Math.cos(roll) + v.offset.y * scale;

    return {
      x,
      y,
      scale: sizeFactor,
      rotation: roll,
      alpha: 1,
      // Stable, lattice-derived order — a hung wall never restacks mid-pan.
      depth: motifRow + (col % motifCols) * 0.01,
    };
  },
};

// `variant` intentionally only patches control defaults. A preset that also
// ships its own curve needs the meta patched too, which is what this adds.
function preset(
  base: Template,
  id: string,
  name: string,
  patch: Record<string, any>,
  easing?: EasingSpec
): Template {
  const t = variant(base, id, name, patch);
  return easing ? { ...t, meta: { ...t.meta, defaultEasing: easing } } : t;
}

export const framesVariants: Template[] = [
  framesBase,
  preset(framesBase, 'wall-02', 'Frames 02', {
    cardSize: 670, rowsSkipped: 0, hold: 0,
  }),
  preset(framesBase, 'wall-03', 'Frames 03', {
    cardSize: 610, rowsSkipped: 2, hold: 50, direction: 'reverse',
  }),
  preset(framesBase, 'wall-04', 'Frames 04', {
    cardSize: 610, hold: 0,
  }, { id: 'linear' }),
  preset(framesBase, 'wall-05', 'Frames 05', {
    tilt: -15, hold: 0,
  }, { id: 'flow' }),
  // A dense wall of small prints with wide mounts between them. The lattice
  // grows to match on its own now — this used to need count and columns
  // hand-tuned alongside cardSize, and they went stale the moment the canvas
  // changed shape.
  preset(framesBase, 'wall-06', 'Frames 06', {
    cardSize: 152, gap: 80, hold: 0, direction: 'reverse',
  }, { id: 'linear' }),
  // Gapless — the wall reads as one continuous tiled surface.
  preset(framesBase, 'wall-07', 'Frames 07', {
    cardSize: 465, gap: 0, hold: 0,
  }, { id: 'linear' }),
];
