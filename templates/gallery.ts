import type { Template } from '@/lib/types';
import { TAU, clamp, frac, lerp, smooth, hash2 } from '@/lib/motion';
import { variant } from './variant';
import { canvasScale } from './lattice';

const BASE = 340;

const gallery: Template = {
  meta: {
    id: 'canvas-gallery-01', name: 'Canvas Gallery', group: 'Canvas',
    defaultEasing: { id: 'linear' }, repeatAssets: true, cardAspect: 1,
  },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 3, max: 30, step: 1, default: 6 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 500, step: 1, default: 260 },
    { key: 'blankArea',    label: 'Spread',        type: 'slider', min: 1, max: 100, step: 1, default: 90, unit: '%' },
    { key: 'path',         label: 'Path',          type: 'toggle', options: ['straight','spiral'], default: 'straight', section: 'Motion' },
    { key: 'spin',         label: 'Spin',          type: 'pills', options: ['clockwise','anticlockwise','both'], default: 'clockwise', section: 'Motion', visibleWhen: { key: 'path', equals: 'spiral' } },
    { key: 'appear',       label: 'Appear',        type: 'toggle', options: ['in-out','out-in'], default: 'out-in', section: 'Motion', advanced: true },
    { key: 'vanish',       label: 'Disappear',     type: 'toggle', options: ['in-out','out-in'], default: 'out-in', section: 'Motion', advanced: true },
    { key: 'appearT',      label: 'Appear Time',   type: 'slider', min: 0.2, max: 4, step: 0.1, default: 2, section: 'Motion', unit: 's' },
    { key: 'holdT',        label: 'Hold Time',     type: 'slider', min: 0, max: 4, step: 0.1, default: 3, section: 'Motion', unit: 's' },
    { key: 'exitT',        label: 'Exit Time',     type: 'slider', min: 0.2, max: 4, step: 0.1, default: 3, section: 'Motion', unit: 's' },
    { key: 'seed',         label: 'Seed',          type: 'slider', min: 1, max: 999, step: 1, default: 1, advanced: true },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1, default: 6 },
    { key: 'offset',       label: 'Offset',        type: 'xypad', default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, values, ctx) => {
    const appearTime = Math.max(0.2, values.appearT);
    const holdTime = Math.max(0, values.holdT);
    const exitTime = Math.max(0.2, values.exitT);
    const lifetime = appearTime + holdTime + exitTime;
    const laps = Math.max(1, Math.round(ctx.duration / lifetime));
    const phase = ctx.easedPhase(frame / ctx.totalFrames * laps) + index / count;
    const progress = frac(phase);
    const entryEnd = appearTime / lifetime;
    const holdEnd = (appearTime + holdTime) / lifetime;
    const entry = smooth(progress / entryEnd);
    const exit = smooth((progress - holdEnd) / (1 - holdEnd));
    const hold = holdTime > 0 ? smooth((progress - entryEnd) / (holdEnd - entryEnd)) : 0;
    const outwardEntry = values.appear === 'in-out';
    const outwardExit = values.vanish === 'in-out';
    const resolution = canvasScale(ctx);
    const aspect = ctx.cardAspect ?? 1;
    const cardLong = values.cardSize * resolution;
    const cardWidth = cardLong * Math.min(1, aspect);
    const cardHeight = cardLong * Math.min(1, 1 / aspect);
    const spread = clamp(values.blankArea / 100, 0.01, 1);
    const radiusX = Math.max(ctx.width * 0.12, (ctx.width - cardWidth) / 2) * spread;
    const radiusY = Math.max(ctx.height * 0.12, (ctx.height - cardHeight) / 2) * spread;
    const seedAngle = (hash2(values.seed, 2.3) - 0.5) * TAU / count;
    const anchorAngle = index * Math.PI * (3 - Math.sqrt(5)) - Math.PI / 2 + seedAngle;
    const spin = values.spin === 'anticlockwise' ? -1
      : values.spin === 'both' && index % 2 ? -1 : 1;
    const angle = values.path === 'spiral'
      ? seedAngle - Math.PI / 2 + spin * progress * TAU
      : anchorAngle;
    const restingScale = lerp(0.92, 1.04, hash2(index, values.seed));
    const holdRadius = 0.94;
    let radius: number;
    let size: number;

    if (progress < entryEnd) {
      radius = lerp(outwardEntry ? 0.25 : 1.6, 1, entry);
      size = lerp(outwardEntry ? 0.45 : 1.18, restingScale, entry);
    } else if (progress < holdEnd) {
      radius = lerp(1, holdRadius, hold);
      size = restingScale;
    } else {
      radius = lerp(holdTime > 0 ? holdRadius : 1, outwardExit ? 1.6 : 0.25, exit);
      size = lerp(restingScale, outwardExit ? 1.18 : 0.45, exit);
    }

    return {
      x: Math.cos(angle) * radiusX * radius + values.offset.x * resolution,
      y: Math.sin(angle) * radiusY * radius + values.offset.y * resolution,
      scale: cardLong / BASE * size,
      rotation: 0,
      alpha: entry * (1 - exit),
      depth: size,
    };
  },
};

export const galleryVariants: Template[] = [
  gallery,
  variant(gallery, 'canvas-gallery-02', 'Canvas Spiral', {
    path: 'spiral', appear: 'in-out', vanish: 'in-out', count: 6,
    appearT: 3, holdT: 2, exitT: 3, blankArea: 85, cardSize: 240,
  }),
  variant(gallery, 'canvas-gallery-03', 'Gallery 03', {
    appear: 'in-out', vanish: 'in-out', blankArea: 12, appearT: 0.5, holdT: 0.8,
    exitT: 0.9, count: 14, cardSize: 150,
  }, undefined, { catalogHidden: true }),
];
