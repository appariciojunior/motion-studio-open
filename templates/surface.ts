import type { Template } from '@/lib/types';
import { clamp, frac, loopCycles, smooth } from '@/lib/motion';
import { backfaceFade, tiltNormalCanvas, tiltPointCanvas, wrapEnvelope } from '@/lib/tilt3d';

const BASE = 340;
const GROUP = '3D & Perspective';

type SurfaceMode = 'wall' | 'cascade' | 'totem';

function laneCardSize(mode: SurfaceMode, lanes: number, padding: number, ctx: { width: number; height: number }) {
  const stage = Math.min(ctx.width, ctx.height);
  const usable = stage * (1 - clamp(padding, 0, 20) / 50);
  if (mode === 'wall') return usable * (1.08 / Math.max(2, lanes));
  const density = 1.08 - Math.max(0, 5 - lanes) * 0.15;
  return usable * (density / Math.max(2, lanes));
}

function surfaceTemplate(id: string, name: string, mode: SurfaceMode, lanesDefault: number, countDefault: number): Template {
  const horizontal = mode === 'wall';
  const controls: Template['controls'] = [
    { key: 'mode', label: 'Mode', type: 'pills', options: ['wall','cascade','totem'], default: mode, section: 'Layout', advanced: true },
    { key: 'count', label: 'Card Count', type: 'slider', min: 8, max: 80, step: 1, default: countDefault, section: 'Layout', advanced: true },
    { key: 'lanes', label: horizontal ? 'Rows' : 'Columns', type: 'slider', min: 2, max: 5, step: 1, default: lanesDefault, section: 'Layout' },
    { key: 'tilt', label: 'Tilt', type: 'slider', min: -45, max: 45, step: 1, default: 0, section: 'Depth', unit: '°' },
    { key: 'padding', label: 'Padding', type: 'slider', min: 0, max: 20, step: 0.5, default: 13, section: 'Layout', unit: '%', precision: 1 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 12, step: 0.5, default: 0.5, section: 'Finish', unit: '%', precision: 1 },
    { key: 'curvature', label: 'Curvature', type: 'slider', min: -150, max: 150, step: 5, default: -100, section: 'Depth', unit: '%', description: 'Concave at negative values, convex at positive values.' },
    { key: 'gap', label: 'Gap', type: 'slider', min: 0.5, max: 20, step: 0.25, default: mode === 'totem' ? 4.5 : 5, section: 'Layout', unit: '%', precision: 2 },
    { key: 'edgeFade', label: 'Edge Fade', type: 'slider', min: 0, max: 100, step: 5, default: 0, section: 'Finish', unit: '%' },
  ];
  if (mode !== 'totem') {
    controls.push({ key: 'motion', label: 'Motion', type: 'pills', options: ['continuous','waypoints','waypoints-no-zoom'], default: 'continuous', section: 'Motion' });
  }
  controls.push(
    { key: 'direction', label: 'Direction', type: 'pills', options: horizontal ? ['left','right','alternate'] : ['up','down','alternate'], default: horizontal ? 'left' : 'up', section: 'Motion' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 100, step: 1, default: 48, section: 'Depth', unit: '%', advanced: true },
    { key: 'camDistance', label: 'Camera Distance', type: 'slider', min: 0.5, max: 2.5, step: 0.05, default: 1, section: 'Depth', unit: '×', precision: 2, advanced: true,
      description: 'Moves the camera itself closer or further, at the same Perspective.' },
    { key: 'backFade', label: 'Back Fade', type: 'slider', min: 0, max: 100, step: 5, default: 55, section: 'Finish', unit: '%', advanced: true },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.35, section: 'Motion', unit: '×', precision: 1, advanced: true },
    { key: 'offset', label: 'Offset', type: 'xypad', default: { x: 0, y: 0 }, section: 'Layout', advanced: true },
  );

  const geometry = (frame: number, index: number, count: number, v: Record<string, any>, ctx: Parameters<Template['transform']>[4]) => {
    const lanes = Math.max(2, Math.round(v.lanes));
    const cardAspect = Math.max(0.2, ctx.cardAspect ?? 16 / 9);
    const cardPx = laneCardSize(mode, lanes, v.padding, ctx);
    const cardW = cardPx * Math.min(1, cardAspect);
    const cardH = cardPx * Math.min(1, 1 / cardAspect);
    const gap = 1 + v.gap / 100;
    const stepX = cardW * gap;
    const stepY = cardH * gap;
    const phaseRaw = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, Math.max(1, Math.ceil(count / lanes)));
    const phase = v.motion === 'continuous' || mode === 'totem' ? phaseRaw : ctx.easedPhase(phaseRaw);
    const offset = v.offset ?? { x: 0, y: 0 };

    let x = 0;
    let y = 0;
    let centred = 0;
    let seam = 1;

    if (horizontal) {
      const row = index % lanes;
      const columns = Math.max(1, Math.ceil(count / lanes));
      const col = Math.floor(index / lanes);
      const rowDir = v.direction === 'alternate' && row % 2 ? -1 : 1;
      const dir = v.direction === 'right' ? -1 : 1;
      const u = frac(col / columns - (phase / columns) * dir * rowDir);
      centred = u * 2 - 1;
      y = (row - (lanes - 1) / 2) * stepY;
      seam = wrapEnvelope(u, 0.055);
    } else {
      const col = index % lanes;
      const rows = Math.max(1, Math.ceil(count / lanes));
      const row = Math.floor(index / lanes);
      centred = lanes <= 1 ? 0 : (col / (lanes - 1)) * 2 - 1;
      const colDir = v.direction === 'alternate' && col % 2 ? -1 : 1;
      const dir = v.direction === 'down' ? -1 : 1;
      const u = frac(row / rows - (phase / rows) * dir * colDir + (mode === 'cascade' ? col * 0.035 : 0));
      y = (u - 0.5) * Math.max(ctx.height * 1.18, rows * stepY);
      seam = wrapEnvelope(u, 0.07);
    }

    const wallWidth = horizontal
      ? Math.max(ctx.width * 1.42, Math.ceil(count / lanes) * stepX)
      // Cascade/Totem are sections of a large cylindrical wall. Basing the
      // cylinder on only the five column centres collapses the projection into
      // a thin strip. The reference keeps the curved surface frame-filling and
      // lets the outer columns continue beyond the crop.
      : Math.max(ctx.width * 1.15, (lanes - 1) * stepX);
    const bend = clamp(v.curvature / 150, -1, 1) * 1.35;
    const angle = centred * Math.abs(bend);
    const flat = Math.abs(bend) < 0.001;
    const radius = flat ? 1e8 : wallWidth / (2 * Math.abs(bend));
    const sign = Math.sign(bend) || 1;
    x = flat ? centred * wallWidth / 2 : Math.sin(angle) * radius;
    const z = flat ? 0 : (1 - Math.cos(angle)) * radius * sign;
    const normal = tiltNormalCanvas({ x: -Math.sin(angle) * sign, y: 0, z: Math.cos(angle) }, { pitch: v.tilt });
    const point = tiltPointCanvas({ x, y, z }, { pitch: v.tilt });
    const edge = 1 - (v.edgeFade / 100) * smooth(clamp((Math.abs(centred) - 0.55) / 0.45, 0, 1));
    return {
      point: { x: point.x + offset.x, y: point.y + offset.y, z: point.z },
      normal,
      angle: angle * sign,
      cardPx,
      alpha: seam * edge * backfaceFade(normal.z, v.backFade),
    };
  };

  return {
    meta: {
      id, name, group: GROUP, engine: 'webgl', catalog3d: true,
      repeatAssets: true, cardAspect: 16 / 9, defaultEasing: { id: 'linear' },
    },
    controls,
    camera: (v) => ({ fov: 24 + clamp(v.perspective / 100, 0, 1) * 38, distance: v.camDistance }),
    transform3d: (frame, index, count, v, ctx) => {
      const g = geometry(frame, index, count, v, ctx);
      return {
        x: g.point.x,
        y: g.point.y,
        z: g.point.z,
        rotationX: -v.tilt * Math.PI / 180,
        rotationY: g.angle,
        rotationZ: 0,
        scale: g.cardPx / BASE,
        alpha: g.alpha,
      };
    },
    transform: (frame, index, count, v, ctx) => {
      const g = geometry(frame, index, count, v, ctx);
      const depthScale = 1 + clamp(g.point.z / 1500, -0.35, 0.35);
      return {
        x: g.point.x,
        y: g.point.y,
        scale: (g.cardPx / BASE) * depthScale,
        rotation: 0,
        alpha: g.alpha,
        depth: g.point.z,
      };
    },
  };
}

export const sphereWall = surfaceTemplate('surface-wall-01', 'Sphere Wall', 'wall', 5, 40);
export const sphereCascade = surfaceTemplate('surface-cascade-01', 'Sphere Cascade', 'cascade', 5, 40);
export const totemWall = surfaceTemplate('surface-totem-01', 'Totem Wall', 'totem', 3, 24);

export const surfaceVariants: Template[] = [sphereWall, sphereCascade, totemWall];
