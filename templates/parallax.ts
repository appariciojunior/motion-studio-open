import type { Template } from '@/lib/types';
import { loopCycles } from '@/lib/motion';
import { variant } from './variant';

// Parallax — a multi-layer image wall with depth. The camera pans
// horizontally while near layers travel faster than far ones, and cards
// wrap seamlessly across the field.
const BASE = 340;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const h = (k: number) => { const s = Math.sin(k * 127.1 + 1.7) * 43758.5453; return s - Math.floor(s); };

const parallax: Template = {
  meta: { id: 'parallax-01', name: 'Drift 01', group: 'Drift', repeatAssets: true, defaultEasing: { id: 'smooth' } },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 3, max: 16, step: 1,    default: 9 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 500, step: 1,  default: 220 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,   default: 14 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 80, max: 500, step: 1,  default: 260 },
    { key: 'spreadY',      label: 'Spread Y',      type: 'slider', min: 0, max: 600, step: 1,   default: 260 },
    { key: 'scatter',      label: 'Scatter',       type: 'slider', min: 0, max: 300, step: 1,   default: 80 },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.1,   default: 0.5 },
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                               default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const sizeFactor = v.cardSize / BASE;

    // 0 = far, 1 = near
    const layer = count <= 1 ? 1 : index / (count - 1);
    const depthScale = lerp(0.5, 1.35, layer);
    const pSpeed = lerp(0.25, 1, layer); // near layers scroll faster

    const dir = v.direction === 'reverse' ? -1 : 1;

    // horizontal scatter + scroll, wrapped across the field span. Each layer
    // scrolls at its own depth-proportional rate, so each card's wrap count is
    // quantized separately — every card returns exactly at the loop point.
    const span = count * v.gap * sizeFactor;
    const wraps = Math.max(1, Math.round((v.speed * ctx.duration * ctx.width * pSpeed) / span));
    const t = ctx.easedPhase((frame / ctx.totalFrames) * wraps) * dir;
    const raw = index * v.gap * sizeFactor - t * span;
    const x = (((raw % span) + span) % span) - span / 2 + v.offset.x;

    // vertical placement by layer with a little deterministic scatter
    const y = (layer - 0.5) * v.spreadY + (h(index) - 0.5) * v.scatter + v.offset.y;

    return {
      x,
      y,
      scale: sizeFactor * depthScale,
      rotation: 0,
      alpha: lerp(0.55, 1, layer),
      depth: layer,
    };
  },
};

export const parallaxVariants: Template[] = [
  parallax,
  variant(parallax, 'parallax-02', 'Drift 02', { count: 12, spreadY: 380, speed: 0.8 }),
  variant(parallax, 'parallax-03', 'Drift 03', { count: 6, spreadY: 140, speed: 0.35 }),
  variant(parallax, 'parallax-04', 'Drift 04', { count: 16, spreadY: 460, speed: 1.1 }),
];
