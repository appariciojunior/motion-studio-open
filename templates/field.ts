import type { Template } from '@/lib/types';
import { loopCycles } from '@/lib/motion';
import { canvasScale } from './lattice';
import { variant } from './variant';

const BASE = 340;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// Deterministic hash for per-card variety (no Math.random — transform is pure).
const h = (k: number) => { const s = Math.sin(k * 127.1 + 1.7) * 43758.5453; return s - Math.floor(s); };

// Field — a starfield: cards scattered through 3D depth drifting toward the
// camera at constant velocity. Near ones grow large and diverge outward, then
// recycle from far to near.
const field: Template = {
  meta: { id: 'field-01', name: 'Warp 01', group: 'Warp', defaultEasing: { id: 'linear' }, repeatAssets: true },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 4, max: 40, step: 1,   default: 18 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 20, max: 400, step: 1, default: 140 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 12 },
    { key: 'spread',       label: 'Spread',        type: 'slider', min: 100, max: 900, step: 1, default: 500 },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.1,  default: 0.6 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const k=canvasScale(ctx);
    const sizeFactor = v.cardSize * k / BASE;

    // Depth position: 0 (far) → 1 (near), wrapping continuously. The drift
    // rate (speed·0.15 laps/sec) is loop-locked to whole depth cycles per clip.
    const laps = loopCycles(v.speed * 0.15, ctx.duration);
    const zRaw = index / count + (frame / ctx.totalFrames) * laps;
    const zf = zRaw - Math.floor(zRaw);

    const scale = sizeFactor * lerp(0.15, 1.5, zf * zf);

    // Scatter each card in a fixed direction; it diverges outward as it nears.
    const ang = h(index) * Math.PI * 2;
    const rad = 0.15 + h(index + 50) * 0.85;
    const x = Math.cos(ang) * rad * v.spread * (0.3 + zf) + v.offset.x;
    const y = Math.sin(ang) * rad * v.spread * (0.3 + zf) + v.offset.y;

    // Fade in when far, fade out as it passes the camera.
    const alpha = Math.max(0, Math.min(1, zf / 0.15) * Math.min(1, (1 - zf) / 0.1));

    return {
      x: x*k,
      y: y*k,
      scale,
      rotation: 0,
      alpha,
      depth: zf, // nearer cards draw on top
    };
  },
};

export const fieldVariants: Template[] = [
  field, // Field 01 — calm drift
  variant(field, 'field-02', 'Warp 02', {
    count: 30, spread: 700, speed: 1.0,
  }),
  variant(field, 'field-03', 'Warp 03', {
    count: 40, spread: 400, speed: 1.6, cardSize: 100,
  }),
  variant(field, 'field-04', 'Warp 04', {
    count: 12, spread: 850, speed: 0.4, cardSize: 220,
  }),
];
