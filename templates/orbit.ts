import type { Template } from '@/lib/types';
import { loopCycles } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// Orbit — cards circle an ellipse; the front-most card grows and passes in
// front, then recedes behind. Flat ellipses read as a side-pass conveyor.
const orbit: Template = {
  meta: { id: 'orbit-01', name: 'Orbit 01', group: 'Orbit', defaultEasing: { id: 'flow' } },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 12, step: 1,   default: 4 },
    { key: 'radiusX',      label: 'Radius X',      type: 'slider', min: 0, max: 700, step: 1,  default: 330 },
    { key: 'radiusY',      label: 'Radius Y',      type: 'slider', min: 0, max: 700, step: 1,  default: 40 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 800, step: 1, default: 330 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 8 },
    { key: 'bigScale',     label: 'Big Scale',     type: 'slider', min: 100, max: 220, step: 1, default: 140 },
    { key: 'depthShrink',  label: 'Depth Shrink',  type: 'slider', min: 0, max: 90, step: 1,   default: 45 },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 4, step: 0.1,  default: 0.3 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,  default: 25 },
  ],

  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'reverse' ? -1 : 1;
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir);
    const ang = ((index - phase) / count) * Math.PI * 2;

    const x = Math.sin(ang) * v.radiusX;
    const y = Math.cos(ang) * v.radiusY;            // front card sits slightly low
    const depthNorm = (Math.cos(ang) + 1) / 2;      // 1 = front, 0 = back

    // front-most pop: only the nearest-to-front card grows toward Big Scale
    const featured = Math.max(0, depthNorm * 2 - 1);
    const shrink = 1 - (v.depthShrink / 100) * (1 - depthNorm);
    const scale = (v.cardSize / BASE) * shrink * (1 + (v.bigScale / 100 - 1) * featured);

    const alpha = 1 - (v.fade / 100) * (1 - depthNorm);

    return {
      x: x + v.offset.x,
      y: y + v.offset.y,
      scale,
      rotation: 0,
      alpha,
      depth: depthNorm,
    };
  },
};

export const orbitVariants: Template[] = [
  orbit, // Orbit 01 — flat side pass
  variant(orbit, 'orbit-02', 'Orbit 02', {
    radiusX: 40, radiusY: 300, count: 3, bigScale: 150, speed: 0.25,
  }),
  variant(orbit, 'orbit-03', 'Orbit 03', {
    radiusX: 300, radiusY: 300, count: 8, cardSize: 150, bigScale: 110,
    depthShrink: 25, fade: 10, speed: 0.5,
  }),
].map((template) => ({
  ...template,
  // Keep the stronger depth treatment in Ring Carousel 05 (side pass) and
  // Ring Bloom 02 (upright-card wheel). Old scenes still resolve these IDs.
  meta: { ...template.meta, catalogHidden: ['orbit-01', 'orbit-03'].includes(template.meta.id) },
}));
