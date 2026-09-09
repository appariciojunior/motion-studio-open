import type { Template } from '@/lib/types';
import { loopCycles, smooth } from '@/lib/motion';
import { canvasScale } from './lattice';
import { variant } from './variant';

const BASE = 340;

// Field — a starfield: cards scattered through 3D depth drifting toward the
// camera at constant velocity. Near ones grow large and diverge outward, then
// recycle from far to near.
const field: Template = {
  meta: { id: 'field-01', name: 'Canvas Depth', group: 'Canvas', defaultEasing: { id: 'linear' }, repeatAssets: true },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 4, max: 40, step: 1,   default: 12 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 20, max: 400, step: 1, default: 280 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 6 },
    { key: 'spread',       label: 'Spread',        type: 'slider', min: 100, max: 900, step: 1, default: 620 },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.1,  default: 0.6 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const resolution = canvasScale(ctx);
    const sizeFactor = v.cardSize * resolution / BASE;

    // Depth position: 0 (far) → 1 (near), wrapping continuously. The drift
    // rate (speed·0.15 laps/sec) is loop-locked to whole depth cycles per clip.
    const laps = loopCycles(v.speed * 0.15, ctx.duration);
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * laps) + index / count;
    const progress = phase - Math.floor(phase);
    const perspective = 0.35 / (1 - progress * 0.76);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = (v.spread / 620) * (0.16 + perspective * 0.64);
    const x = Math.cos(angle) * ctx.width * radius / 2;
    const y = Math.sin(angle) * ctx.height * radius / 2;
    const scale = sizeFactor * perspective;

    // Fade in when far, fade out as it passes the camera.
    const alpha = smooth(progress / 0.12) * smooth((1 - progress) / 0.18);

    return {
      x: x + v.offset.x * resolution,
      y: y + v.offset.y * resolution,
      scale,
      rotation: 0,
      alpha,
      depth: progress,
    };
  },
};

export const fieldVariants: Template[] = [
  field, // Field 01 — calm drift
  variant(field, 'field-02', 'Warp 02', {
    count: 30, spread: 700, speed: 1.0,
  }, undefined, { catalogHidden: true }),
  variant(field, 'field-03', 'Warp 03', {
    count: 40, spread: 400, speed: 1.6, cardSize: 100,
  }, undefined, { catalogHidden: true }),
  variant(field, 'field-04', 'Warp 04', {
    count: 12, spread: 850, speed: 0.4, cardSize: 220,
  }, undefined, { catalogHidden: true }),
];
