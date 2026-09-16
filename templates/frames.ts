import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { clamp, stepHold } from '@/lib/motion';
import { variant } from './variant';
import { latticeCount, solveLattice, latticeAxis, latticeMediaIndex } from './lattice';

// Reference size (px) shared with the renderer's sprite normalization, so that
// `cardSize` reads directly in on-screen pixels.
const BASE = 340;

// A number in [0,1) that belongs to a cell of the motif and never changes.
// Integer mixing rather than a sin-based hash so the wall is identical on
// every machine -- the same scene has to export the same frames anywhere.
function cellNoise(col: number, row: number): number {
  let n = (col * 374761393 + row * 668265263) | 0;
  n = Math.imul(n ^ (n >> 13), 1274126177) | 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

// Which cells of a motif row hang a landscape spread across two cells.
//
// Read off the reference wall rather than invented: its prints are not all the
// same shape. Rows keep one height and the widths inside them vary, everything
// flush against everything else with one thin gutter. That is the difference
// between a wall of documents and a tiled texture, and a first attempt at it --
// shrinking prints inside their own cell -- produced the opposite of what the
// clip does: holes around every small print instead of a flush row.
//
// Greedy left to right so two spreads can never claim the same cell, and never
// starting on the last column, because a spread that crossed the motif boundary
// would be cut in half when the wall wraps.
function wideCells(motifRow: number, motifCols: number, chance: number): Uint8Array {
  // 0 = a normal print, 1 = the left half of a spread, 2 = swallowed by one.
  const out = new Uint8Array(motifCols);
  if (chance <= 0) return out;
  for (let c = 0; c < motifCols - 1; c++) {
    if (out[c] !== 0) continue;
    if (cellNoise(c, motifRow) < chance) { out[c] = 1; out[c + 1] = 2; }
  }
  return out;
}

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
    { key: 'mixSizes',     label: 'Mixed Sizes',   type: 'slider', min: 0, max: 100, step: 1,   default: 0, section: 'Layout', unit: '%', description: 'How often a print hangs as a landscape spread across two cells instead of a single portrait one. The wall stays flush either way — this changes the shape of the prints, not the spacing between them.' },
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
    const motifCol = col % motifCols;
    // Not every print on a wall is the same size. The variation belongs to the
    // MOTIF cell and not to the card index, because the wall is a torus: a card
    // leaving one edge re-enters at the other, and if its size came from its
    // copy it would change size as it wrapped.
    //
    // It only ever SHRINKS. Growing a print past its cell would overlap its
    // neighbours, and the lattice, the loop and the media identity are all built
    // on one card per cell. Shrinking keeps every one of those and produces what
    // the uneven wall actually looks like: an irregular edge with the background
    // showing through where the smaller prints are.
    const sizeFactor = v.cardSize * scale / BASE;
    // A spread covers two cells and the gutter between them. It gets there by
    // being drawn BIGGER and then clipped back to one cell of height, so the
    // picture is cropped to a landscape the way a cover-crop would do it.
    // Stretching it with scaleX instead would distort every face on the wall.
    const mistura = clamp(Number(v.mixSizes) || 0, 0, 100) / 100;
    const largos = mistura > 0 ? wideCells(motifRow, motifCols, mistura * 0.5) : null;
    const papel = largos ? largos[motifCol] : 0;
    const razao = Math.max(0.05, ctx.cardAspect ?? 3 / 4);
    const larguraCard = v.cardSize * Math.min(1, razao);
    const fatorLargo = larguraCard > 0 ? 2 + v.gap / larguraCard : 2;

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

    // The swallowed cell is not drawn: its neighbour is standing in its place.
    if (papel === 2) {
      return { x, y, scale: sizeFactor, rotation: roll, alpha: 0,
        depth: motifRow + (col % motifCols) * 0.01 };
    }
    if (papel === 1) {
      const meia = 0.5 / fatorLargo;
      return {
        x: x + (pitchX / 2) * Math.cos(roll),
        y: y + (pitchX / 2) * Math.sin(roll),
        scale: sizeFactor * fatorLargo,
        rotation: roll,
        alpha: 1,
        clip: { x0: 0, y0: 0.5 - meia, x1: 1, y1: 0.5 + meia },
        depth: motifRow + (col % motifCols) * 0.01,
      };
    }
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
