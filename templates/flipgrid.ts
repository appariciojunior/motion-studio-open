import type { Template } from '@/lib/types';
import { TAU, clamp, loopCycles, staggered } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// ============================================================
//  RIPPLE — a grid of tiles turning on their own axis
//
//  Was this codebase's "Flip" until 2026-08-19: measured against the
//  reference's real Flip (a split-flap board, see templates/flip.ts) and found
//  to be a different mechanic entirely — a tile here never changes image, it
//  turns in place. Renamed rather than deleted: it is a complete, working
//  effect in its own right, just not a port of anything called Flip.
//
//  Each tile turns about its centre line, staggered so the grid ripples rather
//  than flipping as a block. The turn is a cosine on `scaleX` (or `scaleY`),
//  which squashes the tile to nothing edge-on and expands it mirrored on the
//  far side. That mirror is deliberate: a sprite has no back face to show, so a
//  real 180° flip would reveal nothing — the squash-through-zero is what reads
//  as a flip in 2D, and it is exactly what `scaleX`/`scaleY` exist for
//  ("flips/page turns", per LayerTransform).
//
//  `edgeFade` dims the tile as it passes edge-on. Without it the mirrored face
//  arrives at full opacity and the eye notices the image is reversed; a short
//  dip at the crossing hides the handoff.
// ============================================================

const flipgrid: Template = {
  meta: { id: 'ripple-01', name: 'Ripple 01', group: 'Ripple', defaultEasing: { id: 'smooth' }, repeatAssets: true },

  controls: [
    { key: 'axis',         label: 'Flip Axis',     type: 'pills',  options: ['y','x'],          default: 'y' }, // y = turns left/right
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 60, step: 1,    default: 12 },
    { key: 'cols',         label: 'Columns',       type: 'slider', min: 1, max: 10, step: 1,    default: 4 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 40, max: 400, step: 1,  default: 170 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,   default: 8 },
    { key: 'gapX',         label: 'Gap X',         type: 'slider', min: 0, max: 400, step: 1,   default: 190 },
    { key: 'gapY',         label: 'Gap Y',         type: 'slider', min: 0, max: 400, step: 1,   default: 210 },
    { key: 'stagger',      label: 'Stagger',       type: 'slider', min: 0, max: 2, step: 0.05,  default: 0.5 },
    { key: 'order',        label: 'Order',         type: 'pills',  options: ['index','row','col','diagonal'], default: 'diagonal' },
    { key: 'edgeFade',     label: 'Edge Fade',     type: 'slider', min: 0, max: 100, step: 1,   default: 70 },  // dip as the tile passes edge-on
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 0, max: 100, step: 1,   default: 45 },  // shear that makes the near edge lead
    { key: 'lift',         label: 'Lift',          type: 'slider', min: 0, max: 40, step: 1,    default: 10 },  // % scale gain mid-flip
    { key: 'offset',       label: 'Offset',        type: 'xypad',                               default: { x: 0, y: 0 } },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.1,   default: 0.4 }, // flips/sec
  ],

  transform: (frame, index, count, v, ctx) => {
    const cols = Math.max(1, Math.round(v.cols));
    const rows = Math.max(1, Math.ceil(count / cols));
    const col = index % cols;
    const row = Math.floor(index / cols);

    const sizeFactor = v.cardSize / BASE;
    const x = (col - (cols - 1) / 2) * v.gapX * sizeFactor + v.offset.x;
    const y = (row - (rows - 1) / 2) * v.gapY * sizeFactor + v.offset.y;

    // Period 1: a full turn per cycle, so a whole number of cycles per clip
    // lands frame totalFrames back on frame 0.
    const t = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, 1));

    // Which tile leads the ripple. `staggered` offsets each tile's own clock by
    // its normalized position and wraps with frac(), so it stays loop-safe.
    const span =
      v.order === 'row'      ? row / Math.max(1, rows - 1) :
      v.order === 'col'      ? col / Math.max(1, cols - 1) :
      v.order === 'diagonal' ? (col + row) / Math.max(1, (cols - 1) + (rows - 1)) :
                               index / Math.max(1, count - 1);
    // staggered() wants a normalized index; feed it the chosen ordering directly.
    const local = staggered(t, span * Math.max(1, count - 1), Math.max(2, count), v.stagger);

    // The turn. cos goes 1 → 0 → −1 → 0 → 1 over one cycle: face, edge-on,
    // mirrored face, edge-on, back to face.
    const turn = Math.cos(local * TAU);

    // Edge-on is where |turn| is small — dip the opacity through the crossing.
    const edge = 1 - Math.abs(turn);           // 0 face-on, 1 edge-on
    const alpha = clamp(1 - (v.edgeFade / 100) * edge, 0, 1);
    // A little size gain mid-turn sells the tile leaving the plane.
    const scale = sizeFactor * (1 + (v.lift / 100) * edge);

    const flipY = v.axis === 'y';

    // A cosine on scaleX alone is a squash, not a turn: both halves of the tile
    // narrow equally, so nothing reads as coming toward the viewer. Shearing by
    // sin of the same angle skews the tile the other way through the crossing,
    // which is what makes the leading edge look nearer. sin is zero whenever
    // cos is ±1, so the tile is unsheared whenever it faces the viewer — and
    // the loop seam is untouched.
    const shear = Math.sin(local * TAU) * (v.perspective / 100) * 0.45;

    return {
      x,
      y,
      scale,
      rotation: 0,
      alpha,
      scaleX: flipY ? turn : 1,
      scaleY: flipY ? 1 : turn,
      skewY: flipY ? shear : 0,
      skewX: flipY ? 0 : shear,
      // Tiles crossing edge-on lift over their neighbours, so the ripple reads
      // as passing in front rather than clipping through.
      depth: edge,
    };
  },
};

export const rippleVariants: Template[] = [
  flipgrid,
  variant(flipgrid, 'ripple-02', 'Ripple 02', {
    axis: 'x', cols: 6, count: 24, cardSize: 120, gapX: 135, gapY: 150, order: 'row', stagger: 0.9, edgeFade: 85, speed: 0.3,
  }),
  variant(flipgrid, 'ripple-03', 'Ripple 03', {
    cols: 2, count: 4, cardSize: 300, gapX: 330, gapY: 360, order: 'index', stagger: 0.25, lift: 22, speed: 0.6,
  }),
];
