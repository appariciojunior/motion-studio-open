import type { Template } from '@/lib/types';
import { loopCycles } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// Spinner is a deliberately graphic family: cards circulate as a compact
// object instead of travelling around the edge of the canvas.  This makes the
// presets useful for logos, product cut-outs, and short social loops alike.
const spinner: Template = {
  meta: {
    id: 'spinner-01', name: 'Spinner 01', group: 'Spinner', repeatAssets: true,
    engine: 'webgl', cardAspect: 4 / 3, isNew: true, defaultEasing: { id: 'linear' },
  },
  controls: [
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward', 'reverse'], default: 'forward' },
    { key: 'count', label: 'Count', type: 'slider', min: 2, max: 24, step: 1, default: 9 },
    { key: 'cardSize', label: 'Card Size', type: 'slider', min: 50, max: 700, step: 1, default: 520 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1, default: 8 },
    { key: 'axis', label: 'Axis', type: 'toggle', options: ['horizontal', 'vertical'], default: 'horizontal' },
    { key: 'diameter', label: 'Diameter', type: 'slider', min: 0, max: 200, step: 1, default: 70 },
    { key: 'hinge', label: 'Hinge', type: 'slider', min: -100, max: 100, step: 1, default: 0 },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 200, step: 1, default: 125 },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.06 },
    { key: 'offset', label: 'Offset', type: 'xypad', default: { x: 0, y: 0 } },
    { key: 'fade', label: 'Fade', type: 'slider', min: 0, max: 100, step: 1, default: 12 },
  ],
  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'reverse' ? -1 : 1;
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, 1) * dir);
    const angle = phase * Math.PI * 2 + (index / count) * Math.PI * 2;
    // The reference family is a 3D card belt: the active axis is the axis
    // around which cards flip, yielding a compressed stack at the side view.
    // This is the equivalent 2D projection, including the thin edge-on pass.
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    const diameter = (v.diameter / 100) * ctx.height / 2;
    const hinge = (v.hinge / 100) * diameter;
    const depth = (cosine + 1) / 2;
    const edge = Math.max(0.12, Math.abs(cosine));
    const horizontal = v.axis === 'horizontal';
    return {
      x: (horizontal ? 0 : sine * diameter) + (horizontal ? 0 : hinge * (1 - cosine)) + v.offset.x,
      y: (horizontal ? sine * diameter : 0) + (horizontal ? hinge * (1 - cosine) : 0) + v.offset.y,
      scale: v.cardSize / BASE,
      scaleX: horizontal ? 1 : edge,
      scaleY: horizontal ? edge : 1,
      rotation: 0,
      alpha: 1 - (v.fade / 100) * (1 - depth),
      depth,
    };
  },
  transform3d: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'reverse' ? -1 : 1;
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, 1) * dir);
    const a = phase * Math.PI * 2 + (index / count) * Math.PI * 2;
    const radius = (v.diameter / 100) * ctx.height / 2;
    const hinge = (v.hinge / 100) * radius;
    const horizontal = v.axis === 'horizontal';
    const sin = Math.sin(a), cos = Math.cos(a);
    const depth = (cos + 1) / 2;
    return {
      x: (horizontal ? 0 : sin * radius) + (horizontal ? 0 : hinge * (1 - cos)) + v.offset.x,
      y: (horizontal ? sin * radius : 0) + (horizontal ? hinge * (1 - cos) : 0) + v.offset.y,
      z: (cos * radius + hinge * sin) * 0.22,
      rotationX: horizontal ? -a : 0,
      rotationY: horizontal ? 0 : a,
      rotationZ: 0,
      scale: v.cardSize / BASE,
      alpha: 1 - (v.fade / 100) * (1 - depth),
    };
  },
};

export const spinnerVariants: Template[] = [
  spinner,
  variant(spinner, 'spinner-02', 'Spinner 02', { count: 7, diameter: 52, cardSize: 300, speed: 0.55 }),
  variant(spinner, 'spinner-03', 'Spinner 03', { count: 12, diameter: 100, cardSize: 160, cornerRadius: 24, speed: 1.1 }),
  variant(spinner, 'spinner-04', 'Spinner 04', { count: 4, diameter: 42, cardSize: 380, speed: 0.7 }),
  variant(spinner, 'spinner-05', 'Spinner 05', { count: 14, diameter: 115, cardSize: 110, cornerRadius: 50, speed: 1.25 }),
  variant(spinner, 'spinner-06', 'Spinner 06', { count: 18, diameter: 130, cardSize: 80, cornerRadius: 50, speed: 1.7 }),
  // Hinge presets pull the centre of rotation below the cards, creating a
  // hinged flip-book silhouette rather than a symmetric wheel.
  variant(spinner, 'hinge-01', 'Hinge 01', { count: 5, diameter: 72, hinge: 44, cardSize: 260, speed: 0.55 }),
  variant(spinner, 'hinge-02', 'Hinge 02', { count: 7, diameter: 85, hinge: -38, cardSize: 200, speed: 0.75 }),
  variant(spinner, 'hinge-03', 'Hinge 03', { count: 9, diameter: 94, hinge: 55, cardSize: 155, speed: 0.9 }),
  variant(spinner, 'hinge-04', 'Hinge 04', { count: 4, diameter: 62, hinge: -52, cardSize: 350, speed: 0.45 }),
  variant(spinner, 'hinge-05', 'Hinge 05', { count: 12, diameter: 110, hinge: 68, cardSize: 120, speed: 1.15 }),
  // Fan is a shallower, fast-moving radial arrangement.
  variant(spinner, 'fan-01', 'Fan 01', { count: 5, axis: 'vertical', diameter: 70, hinge: 36, cardSize: 200, speed: 1.15 }),
  variant(spinner, 'fan-02', 'Fan 02', { count: 8, axis: 'vertical', diameter: 88, hinge: 48, cardSize: 135, speed: 1.35 }),
  variant(spinner, 'fan-03', 'Fan 03', { count: 3, axis: 'vertical', diameter: 56, hinge: -30, cardSize: 290, speed: 0.85 }),
];
