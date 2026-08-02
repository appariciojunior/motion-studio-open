import type { Template } from '@/lib/types';
import { clamp, loopCycles, smooth } from '@/lib/motion';
import { backfaceFade, tiltNormalCanvas, tiltPointCanvas, wrapEnvelope } from '@/lib/tilt3d';
import { variant } from './variant';

const BASE = 340;

function geometry(frame: number, index: number, count: number, v: Record<string, any>, ctx: Parameters<Template['transform']>[4]) {
  const columns = Math.max(2, Math.round(v.columns));
  const rows = Math.max(1, Math.ceil(count / columns));
  const col = index % columns;
  const row = Math.floor(index / columns);
  const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, rows));
  const gap = 1 + v.gap / 100;
  const stepX = v.cardSize * gap;
  const stepY = v.cardSize * 0.72 * gap;
  const width = Math.max(stepX, (columns - 1) * stepX);
  const u = columns <= 1 ? 0 : col / (columns - 1);
  const centred = u * 2 - 1;
  const bend = clamp(v.curvature / 150, -1, 1) * 1.35;
  const angle = centred * Math.abs(bend);
  const radius = Math.abs(bend) < 0.001 ? 1e8 : width / (2 * Math.abs(bend));
  const sign = Math.sign(bend) || 1;
  const x = Math.abs(bend) < 0.001 ? centred * width / 2 : Math.sin(angle) * radius;
  const z = Math.abs(bend) < 0.001 ? 0 : (1 - Math.cos(angle)) * radius * sign;

  let row01 = rows <= 1 ? 0.5 : row / rows;
  let seam = 1;
  if (v.mode !== 'wall') {
    const alternate = v.flow === 'alternate' && col % 2 ? -1 : 1;
    const columnPhase = v.mode === 'cascade' ? col * v.phaseOffset / 100 : col * 0.11;
    row01 = ((row01 - phase / rows * alternate + columnPhase) % 1 + 1) % 1;
    seam = wrapEnvelope(row01, 0.09);
  }
  const y = (row01 - (v.mode === 'wall' ? (rows - 1) / Math.max(1, rows) / 2 : 0.5)) * rows * stepY;
  const edge = 1 - (v.edgeFade / 100) * smooth(clamp((Math.abs(centred) - 0.55) / 0.45, 0, 1));
  const normal = tiltNormalCanvas({ x: -Math.sin(angle) * sign, y: 0, z: Math.cos(angle) }, { pitch: v.tilt });
  const point = tiltPointCanvas({ x, y, z }, { pitch: v.tilt });
  return { point, normal, angle: angle * sign, alpha: seam * edge * backfaceFade(normal.z, v.backFade) };
}

const surface: Template = {
  meta: { id: 'surface-wall-01', name: 'Curved Wall', group: 'Surface', isNew: true, engine: 'webgl', catalog3d: true, repeatAssets: true, defaultEasing: { id: 'linear' } },
  controls: [
    { key: 'mode', label: 'Mode', type: 'pills', options: ['wall','cascade','totem'], default: 'wall', section: 'Layout', advanced: true },
    { key: 'count', label: 'Count', type: 'slider', min: 6, max: 60, step: 1, default: 25, section: 'Layout' },
    { key: 'columns', label: 'Columns', type: 'slider', min: 2, max: 5, step: 1, default: 5, section: 'Layout' },
    { key: 'cardSize', label: 'Card Size', type: 'slider', min: 70, max: 320, step: 1, default: 170, section: 'Layout', unit: 'px' },
    { key: 'gap', label: 'Gap', type: 'slider', min: 0.5, max: 20, step: 0.5, default: 5, section: 'Layout', unit: '%', precision: 1 },
    { key: 'curvature', label: 'Curvature', type: 'slider', min: -150, max: 150, step: 1, default: -100, section: 'Depth', unit: '%', description: 'Bends the shared surface while every card remains attached to it.' },
    { key: 'tilt', label: 'Tilt', type: 'slider', min: -45, max: 45, step: 1, default: 0, section: 'Depth', unit: '°', description: 'Rotates the complete curved surface, not the individual cards.' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 100, step: 1, default: 48, section: 'Depth', unit: '%' },
    { key: 'flow', label: 'Column Flow', type: 'pills', options: ['same','alternate'], default: 'same', section: 'Motion', visibleWhen: { key: 'mode', not: 'wall' } },
    { key: 'phaseOffset', label: 'Phase Offset', type: 'slider', min: 0, max: 100, step: 1, default: 15, section: 'Motion', unit: '%', visibleWhen: { key: 'mode', equals: 'cascade' } },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.1, default: 0, section: 'Motion', unit: '×', precision: 1 },
    { key: 'edgeFade', label: 'Edge Fade', type: 'slider', min: 0, max: 100, step: 1, default: 18, section: 'Finish', unit: '%' },
    { key: 'backFade', label: 'Back Fade', type: 'slider', min: 0, max: 100, step: 1, default: 55, section: 'Finish', unit: '%' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1, default: 10, section: 'Finish', unit: '%' },
    { key: 'offset', label: 'Offset', type: 'xypad', default: { x: 0, y: 0 }, section: 'Layout' },
  ],
  transform3d: (frame, index, count, v, ctx) => {
    const g = geometry(frame, index, count, v, ctx);
    return {
      x: g.point.x + v.offset.x,
      y: g.point.y + v.offset.y,
      z: g.point.z,
      rotationX: -v.tilt * Math.PI / 180,
      rotationY: g.angle,
      rotationZ: 0,
      scale: v.cardSize / BASE,
      alpha: g.alpha,
    };
  },
  transform: (frame, index, count, v, ctx) => {
    const g = geometry(frame, index, count, v, ctx);
    const depthScale = 1 + clamp(g.point.z / 1500, -0.35, 0.35);
    return {
      x: g.point.x + v.offset.x,
      y: g.point.y + v.offset.y,
      scale: (v.cardSize / BASE) * depthScale,
      rotation: 0,
      alpha: g.alpha,
      depth: g.point.z,
    };
  },
};

export const surfaceVariants: Template[] = [
  surface,
  variant(surface, 'surface-cascade-01', 'Curved Cascade', {
    mode: 'cascade', count: 30, columns: 5, speed: 0.55, phaseOffset: 15, curvature: -85, edgeFade: 25,
  }),
  variant(surface, 'surface-totem-01', 'Totem Wall', {
    mode: 'totem', count: 18, columns: 3, cardSize: 205, speed: 0.4, flow: 'alternate', curvature: -70, edgeFade: 30,
  }),
];
