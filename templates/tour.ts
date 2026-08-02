import type { Template } from '@/lib/types';
import { loopCycles } from '@/lib/motion';
import { variant } from './variant';

// Tour — a slow cinematic camera pan-and-zoom across a scattered collage,
// drifting focus between images. Cards live at fixed positions in a large
// field; the camera glides through, emphasising whatever it passes over.
const BASE = 340;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const h = (k: number) => { const s = Math.sin(k * 127.1 + 1.7) * 43758.5453; return s - Math.floor(s); };

const tour: Template = {
  meta: { id: 'tour-01', name: 'Voyage 01', group: 'Voyage', repeatAssets: true, defaultEasing: { id: 'smooth' } },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 4, max: 24, step: 1,    default: 14 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 400, step: 1,  default: 200 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,   default: 14 },
    { key: 'spread',       label: 'Spread',        type: 'slider', min: 400, max: 1600, step: 1, default: 1000 },
    { key: 'zoom',         label: 'Zoom',          type: 'slider', min: 0, max: 60, step: 1,    default: 25 },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 2, step: 0.1,   default: 0.5 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                               default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const sizeFactor = v.cardSize / BASE;

    // fixed scatter in a large field, each card its own size
    const px = (h(index) - 0.5) * v.spread;
    const py = (h(index + 37.2) - 0.5) * v.spread;
    const cardBaseSize = sizeFactor * (0.7 + h(index + 5) * 0.6);

    // slow smooth camera drift + gentle zoom breathing. Each oscillator gets
    // its own whole number of revolutions per clip (loop-locked); the original
    // 0.7/0.9/0.6 rad/s frequencies become the per-axis rev/sec ratios.
    const u = frame / ctx.totalFrames;
    const TAU = Math.PI * 2;
    const n1 = loopCycles((v.speed * 0.7) / TAU, ctx.duration);
    const n2 = loopCycles((v.speed * 0.9) / TAU, ctx.duration);
    const n3 = loopCycles((v.speed * 0.6) / TAU, ctx.duration);
    const camX = Math.sin(TAU * u * n1) * v.spread * 0.4;
    const camY = Math.cos(TAU * u * n2) * v.spread * 0.3;
    const camZoom = 1 + v.zoom / 100 * (0.5 + 0.5 * Math.sin(TAU * u * n3));

    // world → screen
    const x = (px - camX) * camZoom + v.offset.x;
    const y = (py - camY) * camZoom + v.offset.y;
    let scale = cardBaseSize * camZoom;

    // emphasise whatever the camera centres on
    const dist = Math.hypot(px - camX, py - camY);
    const focus = Math.max(0, 1 - dist / (v.spread * 0.35));
    scale *= 1 + focus * 0.15;

    return {
      x,
      y,
      scale,
      rotation: 0,
      alpha: lerp(0.5, 1, focus),
      depth: focus + h(index) * 0.01,
    };
  },
};

export const tourVariants: Template[] = [
  tour,
  variant(tour, 'tour-02', 'Voyage 02', { spread: 700, zoom: 40, count: 18 }),
  variant(tour, 'tour-03', 'Voyage 03', { spread: 1400, zoom: 15, count: 10 }),
  variant(tour, 'tour-04', 'Voyage 04', { spread: 1000, zoom: 55, count: 24 }),
];
