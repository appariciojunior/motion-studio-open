import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { TAU, clamp, stepHold } from '@/lib/motion';
import { variant } from './variant';
import { latticeCount, solveLattice, latticeAxis, latticeMediaIndex } from './lattice';

const BASE = 340;

// The motif closes in time; offscreen copies provide continuous spatial coverage.
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
    { key: 'cycles',       label: 'Steps',         type: 'slider', min: 0, max: 24, step: 1,   default: 6, section: 'Motion', description: 'Requested cell steps, rounded to complete repeats of the image motif. 0 stops the wall.' },
    { key: 'hold',         label: 'Hold',          type: 'slider', min: 0, max: 90, step: 1,   default: 12, section: 'Motion', unit: '%', description: 'Share of each cell step spent stopped before it moves.' },
    { key: 'zoom',         label: 'Zoom Pulse',          type: 'pills',  options: ['off','on'],      default: 'off', section: 'Motion', description: 'Moves closer and returns once per loop.' },
    { key: 'zoomAmount',   label: 'Zoom Amount',   type: 'slider', min: 0, max: 60, step: 1,   default: 20, unit: '%', visibleWhen: { key: 'zoom', equals: 'on' } },
    { key: 'breath',       label: 'Breath',        type: 'pills',  options: ['off','on'],      default: 'off', section: 'Motion', description: 'A cyclic swell on top of the zoom.' },
    { key: 'pulseAmt',     label: 'Breath Amount', type: 'slider', min: 0, max: 60, step: 1,   default: 20, unit: '%', visibleWhen: { key: 'breath', equals: 'on' } },
    { key: 'pulseCycles',  label: 'Breath Cycles', type: 'slider', min: 1, max: 12, step: 1,   default: 6, visibleWhen: { key: 'breath', equals: 'on' } },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  // The wall covers the canvas by holding enough cells, so the count is a
  // consequence of Plane Size, Gap and the frame — never a control.
  layerCount: (v, ctx) => latticeCount(v, ctx, 3 / 4),

  mediaCount: (v, ctx) => { const l = solveLattice(v, ctx); return l.motifCols * l.motifRows; },
  mediaIndex: latticeMediaIndex,

  transform: (frame, index, count, v, ctx) => {
    frame = ((frame % ctx.totalFrames) + ctx.totalFrames) % ctx.totalFrames;
    // Solved from the canvas, not factored back out of `count`. The pool was
    // sized by the same solver, so on the stage the two agree exactly; `count`
    // goes in only so the board and web-export surfaces, whose card total comes
    // from the user's own markup, still tile a complete rectangle.
    const { cols, rows, motifCols, motifRows, pitchX, pitchY, scale } = solveLattice(v, ctx, 3 / 4, count);
    const col = index % cols;
    const row = Math.floor(index / cols);
    const motifRow = row % motifRows;
    const sizeFactor = v.cardSize * scale / BASE;

    // The wall steps a whole cell per cycle on BOTH axes, so travel is snapped
    // to a multiple of the lattice period on each — a wall that stops a third of
    // the way across would put different pictures in the same cells at the loop
    // point. With the measured 6 steps on a 3x3 that snap is already exact.
    const want = Math.max(0, Math.round(v.cycles));
    const stepsX = want === 0 ? 0 : motifCols * Math.max(1, Math.round(want / motifCols));
    const stepsY = want === 0 ? 0 : motifRows * Math.max(1, Math.round(want / motifRows));

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

    const baseX = latticeAxis(col, motifCols, cols, pitchX, panX);
    const baseY = latticeAxis(row, motifRows, rows, pitchY, panY);

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
      x: baseX * swell + v.offset.x * scale,
      y: baseY * swell + v.offset.y * scale,
      scale: sizeFactor * swell,
      rotation: 0,
      alpha: 1,
      depth: motifRow + (col % motifCols) * 0.01,
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
