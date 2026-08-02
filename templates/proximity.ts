import type { Template } from '@/lib/types';
import { TAU, frac, wave, clamp, lerp, hash2, loopCycles, smooth } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// Proximity — a dense grid of small tiles; a focus point pans across and the
// tiles nearest it magnify (macOS-dock style), while distant ones stay small
// and fade slightly. The focal path is selectable; sizeMix/tilt add per-tile
// variety; atmosphere adds a distance haze; buildInOut ramps the whole field.
const proximity: Template = {
  meta: { id: 'proximity-01', name: 'Dock 01', group: 'Dock', defaultEasing: { id: 'flow' }, repeatAssets: true },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 6, max: 200, step: 1,  default: 30 },
    { key: 'cols',         label: 'Columns',       type: 'slider', min: 3, max: 16, step: 1,   default: 6 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 20, max: 200, step: 1, default: 90 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 12 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0, max: 80, step: 1,   default: 12 },
    { key: 'magnify',      label: 'Magnify',       type: 'slider', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'focusRadius',  label: 'Focus Radius',  type: 'slider', min: 80, max: 600, step: 1, default: 260 },
    { key: 'path',         label: 'Focal Path',    type: 'select', options: ['lissajous','sweep','diagonal','figure8'], default: 'lissajous' },
    { key: 'sizeMix',      label: 'Size Mix',      type: 'slider', min: 0, max: 100, step: 1,  default: 0 },
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: 0, max: 45, step: 1,   default: 0 },
    { key: 'atmosphere',   label: 'Atmosphere',    type: 'slider', min: 0, max: 100, step: 1,  default: 0 },
    { key: 'buildInOut',   label: 'Build In/Out',  type: 'toggle', options: ['on','off'],      default: 'off' },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.1,  default: 0.6 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const sizeFactor = v.cardSize / BASE;

    // Grid layout centred on the canvas.
    const cols = Math.max(1, Math.round(v.cols));
    const rows = Math.ceil(count / cols);
    const col = index % cols;
    const row = Math.floor(index / cols);

    const spacingX = (v.cardSize + v.gap) * sizeFactor;
    const spacingY = (v.cardSize + v.gap) * sizeFactor;
    const baseX = (col - (cols - 1) / 2) * spacingX;
    const baseY = (row - (rows - 1) / 2) * spacingY;

    // Focus point pans on a selectable, loop-locked path (whole revolutions
    // per clip; integer-ratio Lissajous frequencies so every path closes).
    const th = TAU * frac((frame / ctx.totalFrames) * loopCycles(v.speed * 0.15, ctx.duration));
    const ampX = cols * spacingX * 0.35;
    const ampY = rows * spacingY * 0.35;
    let fx = 0, fy = 0;
    switch (v.path) {
      case 'sweep':    fx = Math.sin(th) * ampX; fy = 0; break;
      case 'diagonal': fx = Math.sin(th) * ampX; fy = Math.sin(th) * ampY; break;
      case 'figure8':  fx = Math.sin(th) * ampX; fy = Math.sin(2 * th) * ampY * 0.5; break;
      default:         fx = Math.sin(2 * th) * ampX; fy = Math.cos(3 * th) * ampY; // lissajous 2:3
    }

    const dist = Math.hypot(baseX - fx, baseY - fy);
    const r = v.focusRadius;
    const influence = smooth(clamp(1 - dist / r, 0, 1));
    const mag = 1 + v.magnify * influence;

    // per-tile variety: deterministic size mix and rotation wobble
    const mix = 1 - (v.sizeMix / 100) * 0.6 * hash2(index, 13.7);
    const rotation = ((hash2(index, 71.3) - 0.5) * 2 * v.tilt * Math.PI) / 180 * influence;

    // whole-field build in/out envelope (0 at both ends → loop-safe)
    const env = v.buildInOut === 'on' ? Math.pow(wave(frame / ctx.totalFrames), 0.75) : 1;

    const scale = sizeFactor * mag * mix * env;
    let alpha = lerp(0.45, 1, Math.max(0, 1 - dist / (r * 1.6)));
    alpha *= 1 - (v.atmosphere / 100) * clamp(dist / (r * 2), 0, 1); // distance haze

    return {
      x: baseX + v.offset.x,
      y: baseY + v.offset.y,
      scale,
      rotation,
      alpha,
      depth: mag, // magnified tiles draw on top of their neighbours
    };
  },
};

export const proximityVariants: Template[] = [
  proximity, // Proximity 01 — 6-wide dock
  variant(proximity, 'proximity-02', 'Dock 02', {
    cols: 8, count: 40, magnify: 1.4,
  }),
  variant(proximity, 'proximity-03', 'Dock 03', {
    cols: 4, count: 20, magnify: 0.8, cardSize: 120,
  }),
  variant(proximity, 'proximity-04', 'Dock 04', {
    cols: 10, count: 60, magnify: 1.8, cardSize: 70, focusRadius: 340,
  }),
  variant(proximity, 'proximity-05', 'Dock 05', {
    path: 'figure8', cols: 12, count: 96, cardSize: 64, gap: 8, magnify: 1.6, sizeMix: 35, atmosphere: 30,
  }),
  variant(proximity, 'proximity-06', 'Dock 06', {
    path: 'sweep', buildInOut: 'on', cols: 14, count: 140, cardSize: 48, gap: 6, magnify: 1.2, tilt: 12, atmosphere: 45,
  }),
];
