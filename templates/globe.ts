import type { Template } from '@/lib/types';
import { TAU, clamp, lerp, loopCycles } from '@/lib/motion';
import { backfaceFade, tiltNormalCanvas, tiltPointCanvas } from '@/lib/tilt3d';
import { variant } from './variant';

const BASE = 340;
const GROUP = '3D & Perspective';

function globePoint(frame: number, index: number, count: number, v: Record<string, any>, ctx: Parameters<Template['transform']>[4]) {
  const stage = Math.min(ctx.width, ctx.height);
  // Animos' Globe Size is measured against the sphere diameter plus its card
  // footprint, not as a literal diameter percentage. The literal mapping left
  // both globe presets visibly undersized in the stage.
  const radius = stage * clamp(v.globeSizePct, 40, 95) / 200 * 1.24;
  const layout = v.layout === 'orbit' ? 'orbit' : 'grid';
  let lat: number;
  let lon: number;

  if (layout === 'grid') {
    const rows = Math.max(3, Math.min(count, Math.round(v.rows ?? Math.sqrt(count * 0.9))));
    const columns = Math.max(3, Math.ceil(count / rows));
    const row = index % rows;
    const col = Math.floor(index / rows);
    const dir = v.direction === 'right' ? -1 : v.direction === 'alternate' && row % 2 ? -1 : 1;
    const raw = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, columns) * dir;
    const phase = v.motion === 'continuous' ? raw : ctx.easedPhase(raw);
    lat = ((row + 0.5) / rows - 0.5) * Math.PI * 0.92;
    lon = ((col - phase + (row % 2) * 0.5) / columns) * TAU;
  } else {
    const dir = v.direction === 'right' ? -1 : 1;
    const raw = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration) * dir;
    const turns = v.motion === 'continuous' ? raw : ctx.easedPhase(raw);
    const gold = Math.PI * (3 - Math.sqrt(5));
    lat = Math.asin(-1 + 2 * (index + 0.5) / Math.max(1, count));
    lon = index * gold + turns * TAU;
  }

  const normal = {
    x: Math.cos(lat) * Math.sin(lon),
    y: Math.sin(lat),
    z: Math.cos(lat) * Math.cos(lon),
  };
  const n = tiltNormalCanvas(normal, { pitch: v.tilt });
  const p = tiltPointCanvas({ x: normal.x * radius, y: normal.y * radius, z: normal.z * radius }, { pitch: v.tilt });
  const gapScale = 1 - clamp(v.gap, 0.5, 8) / 100;
  // The reference's percentage is a globe-relative design scale, not a raw
  // percentage of the canvas. Dense latitude/longitude tiles need the smaller
  // factor; Orbit Globe intentionally keeps its sparse cards large.
  const layoutScale = layout === 'grid' ? 0.6 : 1;
  const cardPx = stage * clamp(v.cardSizePct, 8, 30) / 100 * gapScale * layoutScale;
  return { p, n, radius, cardPx, depthN: (n.z + 1) / 2 };
}

const cardGlobe: Template = {
  meta: {
    id: 'globe-01', name: 'Card Globe', group: GROUP, isNew: true,
    engine: 'webgl', catalog3d: true, repeatAssets: true, cardAspect: 16 / 9,
    defaultEasing: { id: 'linear' },
  },
  controls: [
    { key: 'layout', label: 'Layout', type: 'pills', options: ['grid','orbit'], default: 'grid', section: 'Layout', advanced: true },
    { key: 'count', label: 'Card Count', type: 'slider', min: 8, max: 96, step: 1, default: 72, section: 'Layout', advanced: true },
    { key: 'rows', label: 'Latitude Rows', type: 'slider', min: 3, max: 12, step: 1, default: 8, section: 'Layout', advanced: true },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 12, step: 0.5, default: 1, section: 'Finish', unit: '%', precision: 1 },
    { key: 'globeSizePct', label: 'Globe Size', type: 'slider', min: 40, max: 95, step: 1, default: 70, section: 'Layout', unit: '%' },
    { key: 'cardSizePct', label: 'Card Size', type: 'slider', min: 8, max: 30, step: 1, default: 20, section: 'Layout', unit: '%' },
    { key: 'gap', label: 'Gap', type: 'slider', min: 0.5, max: 8, step: 0.25, default: 2.5, section: 'Layout', unit: '%', precision: 2 },
    { key: 'backFade', label: 'Back Fade', type: 'slider', min: 0, max: 90, step: 5, default: 55, section: 'Finish', unit: '%' },
    { key: 'tilt', label: 'Tilt', type: 'slider', min: -45, max: 45, step: 1, default: 0, section: 'Depth', unit: '°' },
    { key: 'motion', label: 'Motion', type: 'pills', options: ['continuous','waypoints','waypoints-no-zoom'], default: 'continuous', section: 'Motion' },
    { key: 'direction', label: 'Direction', type: 'pills', options: ['left','right','alternate'], default: 'left', section: 'Motion' },
    { key: 'facing', label: 'Facing', type: 'pills', options: ['surface','camera'], default: 'surface', section: 'Depth', advanced: true },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 100, step: 1, default: 35, section: 'Depth', unit: '%', advanced: true },
    { key: 'thickness', label: 'Thickness', type: 'slider', min: 0, max: 20, step: 1, default: 2, section: 'Finish', unit: 'px', advanced: true },
    { key: 'shadow', label: 'Shadow', type: 'toggle', options: ['on','off'], default: 'off', section: 'Finish', advanced: true },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 3, step: 0.1, default: 0.4, section: 'Motion', unit: '×', precision: 1, advanced: true },
    { key: 'offset', label: 'Offset', type: 'xypad', default: { x: 0, y: 0 }, section: 'Layout', advanced: true },
  ],
  camera: (v) => ({ fov: 18 + clamp(v.perspective, 0, 100) * 0.2 }),
  transform3d: (frame, index, count, v, ctx) => {
    const g = globePoint(frame, index, count, v, ctx);
    const offset = v.offset ?? { x: 0, y: 0 };
    return {
      x: g.p.x + offset.x,
      y: g.p.y + offset.y,
      z: g.p.z,
      rotationX: v.facing === 'surface' ? -Math.asin(clamp(g.n.y, -1, 1)) : 0,
      rotationY: v.facing === 'surface' ? Math.atan2(g.n.x, g.n.z) : 0,
      rotationZ: 0,
      scale: g.cardPx / BASE,
      alpha: backfaceFade(g.n.z, v.backFade),
      thickness: v.thickness,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: 0.68 + Math.max(0, g.n.z) * 0.4,
    };
  },
  transform: (frame, index, count, v, ctx) => {
    const g = globePoint(frame, index, count, v, ctx);
    const offset = v.offset ?? { x: 0, y: 0 };
    return {
      x: g.p.x + offset.x,
      y: g.p.y + offset.y,
      scale: (g.cardPx / BASE) * lerp(0.62, 1.12, g.depthN),
      rotation: 0,
      alpha: backfaceFade(g.n.z, v.backFade),
      depth: g.p.z,
    };
  },
};

const orbitVariant = variant(cardGlobe, 'globe-02', 'Orbit Globe', {
  layout: 'orbit', count: 14, globeSizePct: 50, cardSizePct: 28, tilt: 27, rows: 4,
});

export const orbitGlobe: Template = {
  ...orbitVariant,
  meta: { ...orbitVariant.meta, cardAspect: 1 },
};

const legacyGlobe03 = variant(cardGlobe, 'globe-03', 'Globe 03', { count: 42, globeSizePct: 62, cardSizePct: 15 });
const legacyGlobe04 = variant(cardGlobe, 'globe-04', 'Globe 04', { count: 36, globeSizePct: 68, cardSizePct: 17, speed: 0.7 });

export const globeVariants: Template[] = [
  cardGlobe,
  orbitGlobe,
  { ...legacyGlobe03, meta: { ...legacyGlobe03.meta, catalogHidden: true } },
  { ...legacyGlobe04, meta: { ...legacyGlobe04.meta, catalogHidden: true } },
];
