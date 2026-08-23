import type { Template } from '@/lib/types';
import { clamp, loopCycles, wave } from '@/lib/motion';
import { variant } from './variant';

// Reference size (px) shared with the renderer's sprite normalization, so that
// `cardSize` reads directly in on-screen pixels.
const BASE = 340;

// ============================================================
//  ISOMETRIC — tiles on a 2:1 projected grid
//
//  The family's identity is the LAYOUT, not the motion: a grid mapped through an
//  isometric projection, where a step along a grid column moves the tile right
//  and down while a step along a row moves it left and down. `squash` is the
//  vertical ratio — 0.5 is the classic 2:1 game-art isometric, 1.0 collapses to
//  a plain 45° diamond.
//
//  On top of that sits a lift wave travelling along the grid diagonal, which is
//  what reads as depth on an isometric plane: tiles rise off the surface in
//  sequence. The wave is a function of frac(), so it repeats every unit and the
//  clip loops seamlessly.
// ============================================================

const isometric: Template = {
  meta: { id: 'iso-01', name: 'Isometric 01', group: 'Isometric', defaultEasing: { id: 'smooth' }, repeatAssets: true },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 60, step: 1,     default: 16 },
    { key: 'cols',         label: 'Columns',       type: 'slider', min: 1, max: 10, step: 1,     default: 4 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 40, max: 400, step: 1,   default: 150 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,    default: 8 },
    { key: 'tileGap',      label: 'Tile Gap',      type: 'slider', min: 40, max: 400, step: 1,   default: 130 },
    { key: 'squash',       label: 'Iso Squash',    type: 'slider', min: 0.2, max: 1, step: 0.05, default: 0.5 }, // 0.5 = classic 2:1
    { key: 'lift',         label: 'Lift',          type: 'slider', min: 0, max: 300, step: 1,    default: 90 },  // px a tile rises at the wave peak
    { key: 'spread',       label: 'Wave Spread',   type: 'slider', min: 0, max: 3, step: 0.05,   default: 1 },   // how far the wave stretches across the diagonal
    { key: 'growth',       label: 'Peak Growth',   type: 'slider', min: 0, max: 60, step: 1,     default: 14 },  // % scale gain at the peak
    { key: 'rock',         label: 'Rock',          type: 'slider', min: 0, max: 20, step: 1,     default: 0 },   // degrees, per-tile rotation at the peak
    { key: 'fade',         label: 'Trough Fade',   type: 'slider', min: 0, max: 100, step: 1,    default: 0 },   // dim tiles resting on the plane
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                default: { x: 0, y: 0 } },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.1,    default: 0.5 }, // wave cycles/sec
  ],

  transform: (frame, index, count, v, ctx) => {
    const cols = Math.max(1, Math.round(v.cols));
    const rows = Math.max(1, Math.ceil(count / cols));
    const col = index % cols;
    const row = Math.floor(index / cols);

    // Centre the grid on the canvas.
    const dc = col - (cols - 1) / 2;
    const dr = row - (rows - 1) / 2;

    const sizeFactor = v.cardSize / BASE;
    const stepX = v.tileGap * sizeFactor;
    const stepY = stepX * v.squash;

    // The isometric projection: columns go right-and-down, rows go left-and-down.
    const baseX = (dc - dr) * stepX;
    const baseY = (dc + dr) * stepY;

    // Period 1: the wave repeats every cycle, so a whole number of cycles per
    // clip puts frame totalFrames back on frame 0.
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, 1));

    // Position along the diagonal, normalized 0..1. The wave is delayed by it,
    // so the lift travels from the back corner to the front.
    const span = Math.max(1, (cols - 1) + (rows - 1));
    const u = (col + row) / span;
    const peak = wave(phase - u * v.spread); // 0 → 1 → 0, one pulse per cycle

    const lift = peak * v.lift;
    const scale = sizeFactor * (1 + (v.growth / 100) * peak);
    const alpha = 1 - (v.fade / 100) * (1 - peak);

    return {
      x: baseX + v.offset.x,
      // Lift moves the tile UP off the plane, so it subtracts from y.
      y: baseY - lift + v.offset.y,
      scale,
      rotation: (v.rock * Math.PI) / 180 * peak,
      alpha: clamp(alpha, 0, 1),
      // Front of the plane draws over the back. The lift is converted into
      // diagonal steps rather than added as a flat bonus: a tile raised higher
      // than one row's spacing is physically above the tiles in front of it, so
      // it must draw over them. A fixed bonus left a tile lifted 300px still
      // painted behind its neighbour, which read as broken.
      depth: (col + row) + lift / Math.max(1, stepY),
    };
  },
};

export const isometricVariants: Template[] = [
  isometric,
  variant(isometric, 'iso-02', 'Isometric 02', {
    cols: 6, count: 30, cardSize: 110, tileGap: 100, squash: 0.42, lift: 140, spread: 1.6, growth: 22, fade: 35, speed: 0.4,
  }),
  variant(isometric, 'iso-03', 'Isometric 03', {
    cols: 3, count: 9, cardSize: 210, tileGap: 190, squash: 0.6, lift: 60, spread: 0.5, growth: 8, rock: 6, speed: 0.7,
  }),
];
