import type { Template } from '@/lib/types';
import { loopCycles } from '@/lib/motion';
import { cardPath } from '@/lib/cardPath';
import { variant } from './variant';

const BASE = 340;
const DEG = Math.PI / 180;

// Wheel — cards on a rotating ring (or a fan arc). Featured card is the one
// nearest the top of the wheel; Spin Thumbs tilts cards along the tangent.
const wheel: Template = {
  meta: { id: 'wheel-01', name: 'Ferris 01', group: 'Ferris', repeatAssets: true, defaultEasing: { id: 'flow' } },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    { key: 'mode',         label: 'Path',          type: 'toggle', options: ['ring','fan'], default: 'fan' },
    { key: 'spinThumbs',   label: 'Spin Thumbs',   type: 'toggle', options: ['on','off'], default: 'on' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 3, max: 20, step: 1,   default: 5 },
    { key: 'radius',       label: 'Ring Radius',   type: 'slider', min: 100, max: 900, step: 1, default: 620 },
    { key: 'cardSize',     label: 'Thumb Size',    type: 'slider', min: 40, max: 600, step: 1, default: 190 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 10 },
    { key: 'bigScale',     label: 'Big Scale',     type: 'slider', min: 100, max: 200, step: 1, default: 115 },
    // The reference's Wheel exposes this (its every shipped preset measures
    // 180°, so the fixed 162° span this family used to hardcode was a small,
    // silent divergence on every preset, not just the ones added below).
    // Fan-mode only — Ring already sweeps the full circle regardless.
    { key: 'cycleDeg',     label: 'Arc Span',      type: 'slider', min: 30, max: 720, step: 1, default: 180, unit: '°', visibleWhen: { key: 'mode', equals: 'fan' } },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 4, step: 0.1,  default: 0.5 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: -160 } },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,  default: 0 },
  ],

  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'reverse' ? -1 : 1;
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir);
    const sizeFactor = v.cardSize / BASE;

    const kind = v.mode === 'fan' ? 'arc' : 'ring';
    const arcSpan = (v.cycleDeg ?? 180) * DEG;
    // Fan wraps too: cards recycle through the arc window so the sweep loops
    // seamlessly instead of drifting off the end of the arc.
    const p = cardPath({
      kind, index, count, phase,
      radius: v.radius,
      arcSpan,
      wrap: true,
    });

    // tangent angle at this position (ring: from centre; fan: arc param)
    let angle = 0;
    const off = ((index - phase) % count + count) % count;
    if (kind === 'ring') {
      angle = (off / count) * Math.PI * 2;
    } else {
      const offS = off > count / 2 ? off - count : off;
      angle = -arcSpan / 2 + (offS + count / 2) * (arcSpan / count);
    }

    const scale = sizeFactor * (1 + (v.bigScale / 100 - 1) * p.featuredness);
    const alpha = 1 - (v.fade / 100) * (1 - p.depthNorm);

    return {
      x: p.x + v.offset.x,
      y: p.y + v.offset.y,
      scale,
      rotation: v.spinThumbs === 'on' ? angle : 0,
      alpha,
      depth: p.depthNorm,
    };
  },
};

// Wheel 05/06 round the reference's 6-preset family out to 6 here too. Read
// straight from its own store (paramsPerModeBaseline; count/spinThumbs/
// bigImage/cornerRadius/direction are unit-for-unit the same controls we
// already have): count 10/11, spinThumbs off/on, bigImage off both (→
// bigScale 100, our value for "no featured card"), cornerRadius 0 both,
// cycles 2/1 at similar base rates. `radius`/`cardSize` aren't literal
// conversions of its ringRadius/thumbSize — same gap as Stack below, its
// values are percentages of an 1080-stage that don't map onto our literal-px
// controls, and Ferris 01-04 here were never a measured port of its Wheel
// 01-04 to convert against either (count 5/8/12/20 vs. its 10/10/10/8, no
// correspondence at all). Interpolated within Ferris 02→03's own established
// radius/cardSize curve at count 8→12 instead, so the two new rings sit in
// the family's existing visual range rather than jumping to a new scale.
export const wheelVariants: Template[] = [
  wheel, // Wheel 01 — top fan, tilted thumbs
  variant(wheel, 'wheel-02', 'Ferris 02', {
    mode: 'ring', count: 8, radius: 340, cardSize: 230, speed: 0.4,
    offset: { x: 0, y: 0 }, bigScale: 100,
  }),
  variant(wheel, 'wheel-03', 'Ferris 03', {
    mode: 'ring', count: 12, radius: 380, cardSize: 130, speed: 0.7,
    offset: { x: 0, y: 0 }, bigScale: 125,
  }),
  variant(wheel, 'wheel-04', 'Ferris 04', {
    mode: 'ring', count: 20, radius: 400, cardSize: 60, speed: 1,
    offset: { x: 0, y: 0 }, bigScale: 100, cornerRadius: 24,
  }),
  variant(wheel, 'wheel-05', 'Ferris 05', {
    mode: 'ring', count: 10, radius: 360, cardSize: 180, speed: 1.1,
    offset: { x: 0, y: 0 }, bigScale: 100, cornerRadius: 0, spinThumbs: 'off',
  }),
  variant(wheel, 'wheel-06', 'Ferris 06', {
    mode: 'ring', count: 11, radius: 372, cardSize: 148, speed: 0.65,
    offset: { x: 0, y: 0 }, bigScale: 100, cornerRadius: 0,
  }),
];
