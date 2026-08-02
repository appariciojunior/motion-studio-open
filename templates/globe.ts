import type { Template } from '@/lib/types';
import { loopCycles } from '@/lib/motion';
import { backfaceFade, tiltNormalCanvas, tiltPointCanvas } from '@/lib/tilt3d';
import { variant } from './variant';

const BASE = 340;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function globeCardPx(radius: number, count: number, requested: number, gap: number) {
  // Approximate the Fibonacci cell's geodesic diameter from sphere area, then
  // reserve visible breathing room. Large cards previously converged into one
  // bright central slab while their dark edges flickered around it.
  const cell = radius * Math.sqrt((4 * Math.PI) / Math.max(6, count));
  const fill = 0.54 * (1 - Math.min(40, Math.max(0, gap)) / 100);
  return Math.min(requested, cell * fill);
}

// Globe — images tiled evenly over a slowly spinning sphere (Fibonacci
// distribution). Front tiles sit large and opaque; rear tiles shrink and fade.
const globe: Template = {
  meta: { id: 'globe-01', name: 'Globe Base', group: 'Globe', engine: 'webgl', catalog3d: true, repeatAssets: true, defaultEasing: { id: 'linear' } },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 6, max: 60, step: 1,   default: 24 },
    { key: 'radius',       label: 'Globe Size',    type: 'slider', min: 100, max: 700, step: 1, default: 280, section: 'Layout', unit: 'px' },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 20, max: 300, step: 1, default: 90 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 12 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0, max: 40, step: 1, default: 8, section: 'Layout', unit: '%' },
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: -45, max: 45, step: 1, default: 0, section: 'Depth', unit: '°', description: 'Rotates the sphere axis while preserving the Fibonacci distribution.' },
    { key: 'facing',       label: 'Facing',        type: 'pills', options: ['camera','surface'], default: 'surface', section: 'Depth' },
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 0, max: 100, step: 1, default: 35, section: 'Depth', unit: '%' },
    { key: 'backFade',     label: 'Back Fade',     type: 'slider', min: 0, max: 100, step: 1, default: 55, section: 'Finish', unit: '%' },
    { key: 'thickness',    label: 'Thickness',     type: 'slider', min: 0, max: 20, step: 1, default: 0, section: 'Finish', unit: 'px', advanced: true },
    { key: 'shadow',       label: 'Shadow',        type: 'toggle', options: ['on','off'], default: 'off', section: 'Finish' },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.1,  default: 0.4 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  camera: (v) => ({ fov: 18 + Math.min(100, Math.max(0, v.perspective)) * 0.2 }),

  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'reverse' ? -1 : 1;
    // Revolutions per clip, loop-locked to a whole number (lon has period t=1).
    const t = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration) * dir;
    const sizeFactor = globeCardPx(v.radius, count, v.cardSize, v.gap) / BASE;

    // Fibonacci sphere: even latitude bands, golden-angle longitude + spin.
    const gold = Math.PI * (3 - Math.sqrt(5));
    const lat = Math.asin(-1 + 2 * (index + 0.5) / count);
    const lon = index * gold + t * Math.PI * 2;

    const cx = Math.cos(lat) * Math.sin(lon);
    const cz = Math.cos(lat) * Math.cos(lon);
    const cy = Math.sin(lat);

    const x = cx * v.radius + v.offset.x;
    const y = cy * v.radius + v.offset.y;
    const depthN = (cz + 1) / 2; // 1 = front, 0 = back

    const scale = sizeFactor * lerp(0.3, 1.15, depthN);
    const alpha = lerp(0.12, 1, depthN);

    return {
      x,
      y,
      scale,
      rotation: 0,
      alpha,
      depth: depthN,
    };
  },
  transform3d: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'reverse' ? -1 : 1;
    const t = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration) * dir;
    const gold = Math.PI * (3 - Math.sqrt(5));
    const lat = Math.asin(-1 + 2 * (index + 0.5) / count);
    const lon = index * gold + t * Math.PI * 2;
    const normal = {
      x: Math.cos(lat) * Math.sin(lon),
      y: Math.sin(lat),
      z: Math.cos(lat) * Math.cos(lon),
    };
    const n = tiltNormalCanvas(normal, { pitch: v.tilt });
    const p = tiltPointCanvas({ x: normal.x * v.radius, y: normal.y * v.radius, z: normal.z * v.radius }, { pitch: v.tilt });
    return {
      x: p.x + v.offset.x,
      y: p.y + v.offset.y,
      z: p.z,
      rotationX: v.facing === 'surface' ? -Math.asin(Math.max(-1, Math.min(1, n.y))) : 0,
      rotationY: v.facing === 'surface' ? Math.atan2(n.x, n.z) : 0,
      rotationZ: 0,
      scale: globeCardPx(v.radius, count, v.cardSize, v.gap) / BASE,
      alpha: backfaceFade(n.z, v.backFade),
      thickness: v.thickness,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: 0.68 + Math.max(0, n.z) * 0.4,
    };
  },
};

export const globeVariants: Template[] = [
  globe, // Globe 01 — full sphere
  variant(globe, 'globe-02', 'Globe Focus', {
    count: 18, radius: 230, cardSize: 135, tilt: 27, backFade: 82,
  }),
  variant(globe, 'globe-03', 'Globe 03', {
    count: 42, radius: 330, cardSize: 78,
  }),
  variant(globe, 'globe-04', 'Globe 04', {
    count: 36, radius: 360, cardSize: 88, speed: 0.7,
  }),
];
