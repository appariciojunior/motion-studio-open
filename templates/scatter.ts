import type { Template } from '@/lib/types';
import { frac, lerp, hash2 } from '@/lib/motion';
import { canvasScale } from './lattice';
import { variant } from './variant';

const BASE = 340;

// Parallax Scatter — a seeded field of tiles scattered across the canvas at
// random depths, drifting vertically at depth-proportional speeds (nearer =
// faster and larger). The seed makes the scatter fully reproducible; each
// card's wrap count is quantized separately so the whole clip loops exactly.
const scatter: Template = {
  meta: {
    id: 'parallax-05', name: 'Drift Scatter', group: 'Drift',
    defaultEasing: { id: 'linear' }, repeatAssets: true,
  },

  controls: [
    { key: 'count',        label: 'Count',      type: 'slider', min: 6, max: 120, step: 1,   default: 24 },
    { key: 'cardSize',     label: 'Plane Size', type: 'slider', min: 40, max: 300, step: 1,  default: 130 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1, default: 14 },
    { key: 'spread',       label: 'Spread',     type: 'slider', min: 200, max: 1400, step: 10, default: 800 },
    { key: 'seed',         label: 'Seed',       type: 'slider', min: 1, max: 999, step: 1,   default: 1 },
    { key: 'speed',        label: 'Speed',      type: 'slider', min: 0.1, max: 2, step: 0.1, default: 0.5 },
    { key: 'depthFade',    label: 'Depth Fade', type: 'toggle', options: ['on','off'],       default: 'on' },
    { key: 'direction',    label: 'Direction',  type: 'toggle', options: ['up','down'],      default: 'up' },
    { key: 'offset',       label: 'Offset',     type: 'xypad',                               default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const k=canvasScale(ctx);
    // reproducible per-card randoms — same seed, same field
    const d = hash2(index, v.seed * 1.31);            // depth 0 (far) .. 1 (near)
    const x0 = (hash2(index, v.seed) - 0.5) * v.spread;
    const y0 = hash2(index, v.seed * 2.17);           // start position along the travel span

    // travel window incl. offscreen margin so wraps happen out of sight
    const span = ctx.height + (v.cardSize * 1.6 + 2 * Math.abs(v.offset.y)) * k;

    // per-card whole laps per clip (deeper = slower) → exact loop for every card
    const laps = v.speed === 0 ? 0 : Math.max(1, Math.round(v.speed * ctx.duration * (0.3 + d)));
    const t = ctx.easedPhase((frame / ctx.totalFrames) * laps);
    // travel parameter wraps in [0,1); up = drift toward negative y
    const u = frac(y0 + (v.direction === 'down' ? t : -t));
    const y = (u - 0.5) * span;

    const scale = (v.cardSize * k / BASE) * lerp(0.55, 1.3, d);
    const alpha = v.depthFade === 'on' ? lerp(0.35, 1, d) : 1;

    return {
      x: (x0 + v.offset.x) * k,
      y: y + v.offset.y * k,
      scale,
      rotation: 0,
      alpha,
      depth: d, // nearer tiles draw on top
    };
  },
};

export const scatterVariants: Template[] = [
  scatter,
  variant(scatter, 'parallax-06', 'Drift Scatter 02', {
    count: 60, spread: 1200, seed: 7, cardSize: 90, speed: 0.8,
  }),
];
