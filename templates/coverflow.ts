import type { Template } from '@/lib/types';
import { clamp, loopCycles, smooth } from '@/lib/motion';
import { cardPath } from '@/lib/cardPath';
import { variant } from './variant';

const BASE = 340;

// ============================================================
//  COVERFLOW — a face-on centre card with the rest turned away
//
//  The look is a row of covers where the middle one faces the viewer and the
//  neighbours are rotated away on the vertical axis, receding into two tight
//  packs. There is no real 3D here: the turn is faked with the two fields
//  LayerTransform already provides for it — `scaleX` compresses the card as it
//  rotates away (cos of the turn angle) and `skewY` shears it into the matching
//  parallelogram. The type's own comments call these out for "fake-3D tilt" and
//  "flips/page turns".
//
//  The other half of the effect is the SPACING: side cards must bunch up rather
//  than stay evenly spread, or the row reads as a plain carousel. Past the first
//  neighbour the step shrinks to `sideStep`, which is what creates the packs.
// ============================================================

const coverflow: Template = {
  meta: { id: 'coverflow-01', name: 'Coverflow 01', group: 'Coverflow', defaultEasing: { id: 'glide' } },

  controls: [
    { key: 'axis',         label: 'Axis',          type: 'pills',  options: ['horizontal','vertical'], default: 'horizontal' },
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 3, max: 20, step: 1,     default: 8 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 60, max: 600, step: 1,   default: 300 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,    default: 10 },
    { key: 'centreGap',    label: 'Centre Gap',    type: 'slider', min: 60, max: 500, step: 1,   default: 230 }, // centre card → first neighbour
    { key: 'sideStep',     label: 'Side Step',     type: 'slider', min: 10, max: 220, step: 1,   default: 62 },  // step between packed side cards
    { key: 'turn',         label: 'Turn',          type: 'slider', min: 0, max: 85, step: 1,     default: 58 },
    { key: 'shear',        label: 'Shear',         type: 'slider', min: 0, max: 100, step: 1,    default: 55 },  // % of the turn expressed as skew
    { key: 'recede',       label: 'Recede',        type: 'slider', min: 0, max: 60, step: 1,     default: 22 },  // % size lost turning away
    { key: 'depthScale',   label: 'Depth Falloff', type: 'slider', min: 0, max: 60, step: 1,     default: 26 },  // % further size lost across the pack
    { key: 'vanish',       label: 'Vanish Drift',  type: 'slider', min: -120, max: 120, step: 1, default: 0 },   // px the pack drifts toward a vanishing point
    { key: 'curve',        label: 'Curve',         type: 'slider', min: -200, max: 200, step: 1, default: 0 },   // bows the row into an arc
    { key: 'fade',         label: 'Depth Fade',    type: 'slider', min: 0, max: 100, step: 1,    default: 45 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                default: { x: 0, y: 0 } },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.1,    default: 0.5 }, // covers/sec
  ],

  transform: (frame, index, count, v, ctx) => {
    const horiz = v.axis !== 'vertical';
    const dir = v.direction === 'reverse' ? -1 : 1;

    // period = count so every cover returns to its own slot at the loop point.
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir);
    const p = cardPath({ kind: 'line', index, count, phase, gap: 1, wrap: true });
    const offset = p.x;              // signed distance from centre, in card units
    const dist = Math.abs(offset);
    const side = Math.sign(offset);

    const sizeFactor = v.cardSize / BASE;

    // Turn: none at dead centre, full by the first neighbour and beyond. Smooth
    // so a cover eases into facing the viewer instead of snapping.
    const t = smooth(clamp(dist, 0, 1));
    const angle = (v.turn * Math.PI) / 180 * t;

    // Fake 3D: compress across the turn axis, shear along it.
    const compress = Math.cos(angle);
    const shear = -side * Math.sin(angle) * (v.shear / 100);

    // Packed spacing: the first neighbour sits at centreGap, everything past it
    // steps by the much smaller sideStep — that bunching is the whole look.
    const packed = dist <= 1
      ? dist * v.centreGap
      : v.centreGap + (dist - 1) * v.sideStep;
    const along = side * packed * sizeFactor;

    // How deep into the side pack this cover sits, 0..1. `turn` saturates at the
    // first neighbour, so without this every card in a pack would share one size
    // and the pack would read flat. This keeps size and opacity falling with
    // distance, which is what gives the pack depth.
    const far = smooth(clamp((dist - 1) / Math.max(1, count / 2 - 1), 0, 1));

    // Curve bows the row, which is what turns a flat strip into a ring. The
    // vanishing drift pulls the pack off-axis as it recedes, so the two packs
    // converge instead of running parallel.
    const across = (v.curve * sizeFactor) * (1 - Math.cos(clamp(dist, 0, 3) * 0.5))
      + v.vanish * sizeFactor * far;

    const x = (horiz ? along : across) + v.offset.x;
    const y = (horiz ? across : along) + v.offset.y;

    const scale = sizeFactor * (1 - (v.recede / 100) * t) * (1 - (v.depthScale / 100) * far);
    const alpha = clamp(1 - (v.fade / 100) * far, 0, 1);

    return {
      x,
      y,
      scale,
      rotation: 0,
      alpha,
      // Compression and shear swap axes with the row, so a vertical coverflow
      // turns about the horizontal axis instead.
      scaleX: horiz ? compress : 1,
      scaleY: horiz ? 1 : compress,
      skewX: horiz ? 0 : shear,
      skewY: horiz ? shear : 0,
      // Centre cover always on top; the packs stack inward behind it.
      depth: -dist,
    };
  },
};

export const coverflowVariants: Template[] = [
  coverflow,
  variant(coverflow, 'coverflow-02', 'Coverflow Vertical', {
    axis: 'vertical', centreGap: 200, sideStep: 48, turn: 52, cardSize: 260, count: 9,
  }),
  variant(coverflow, 'coverflow-03', 'Coverflow Ring', {
    curve: 150, turn: 70, sideStep: 78, centreGap: 250, recede: 34, fade: 60, count: 12,
  }),
];
