import type { Template } from '@/lib/types';
import { loopCycles } from '@/lib/motion';
import { cardPath } from '@/lib/cardPath';
import { variant } from './variant';

const BASE = 340;

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
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 4, step: 0.1,  default: 0.5 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: -160 } },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,  default: 0 },
  ],

  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'reverse' ? -1 : 1;
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir);
    const sizeFactor = v.cardSize / BASE;

    const kind = v.mode === 'fan' ? 'arc' : 'ring';
    // Fan wraps too: cards recycle through the arc window so the sweep loops
    // seamlessly instead of drifting off the end of the arc.
    const p = cardPath({
      kind, index, count, phase,
      radius: v.radius,
      arcSpan: Math.PI * 0.9,
      wrap: true,
    });

    // tangent angle at this position (ring: from centre; fan: arc param)
    let angle = 0;
    const off = ((index - phase) % count + count) % count;
    if (kind === 'ring') {
      angle = (off / count) * Math.PI * 2;
    } else {
      const span = Math.PI * 0.9;
      const offS = off > count / 2 ? off - count : off;
      angle = -span / 2 + (offS + count / 2) * (span / count);
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
];
