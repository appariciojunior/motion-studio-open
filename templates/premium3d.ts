import type { Template } from '@/lib/types';
import { TAU, clamp, frac, hash2, lerp, loopCycles, smooth } from '@/lib/motion';
import { quaternionFromEuler, springOvershoot, wrapEnvelope } from '@/lib/tilt3d';

const BASE = 340;

const sharedFinish = [
  { key: 'cornerRadius', label: 'Corner Radius', type: 'slider' as const, min: 0, max: 20, step: 0.5, default: 3, section: 'Finish' as const, unit: '%' as const, precision: 1 },
  { key: 'thickness', label: 'Thickness', type: 'slider' as const, min: 0, max: 24, step: 1, default: 10, section: 'Finish' as const, unit: 'px' as const },
  { key: 'shadow', label: 'Shadow', type: 'toggle' as const, options: ['on','off'], default: 'on', section: 'Finish' as const },
];

export const cardTunnel: Template = {
  meta: { id: 'tunnel-01', name: 'Card Tunnel', group: 'Depth', isNew: true, engine: 'webgl', catalog3d: true, catalogHidden: true, repeatAssets: true, defaultEasing: { id: 'linear' } },
  controls: [
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward','backward'], default: 'forward', section: 'Motion' },
    { key: 'count', label: 'Card Count', type: 'slider', min: 8, max: 48, step: 4, default: 24, section: 'Layout' },
    { key: 'tunnelSize', label: 'Tunnel Size', type: 'slider', min: 45, max: 110, step: 1, default: 90, section: 'Layout', unit: '%' },
    { key: 'cardLength', label: 'Card Length', type: 'slider', min: 25, max: 75, step: 1, default: 55, section: 'Layout', unit: '%' },
    { key: 'gap', label: 'Gap', type: 'slider', min: 0, max: 30, step: 1, default: 10, section: 'Layout', unit: '%' },
    { key: 'depth', label: 'Tunnel Depth', type: 'slider', min: 500, max: 2400, step: 25, default: 1500, section: 'Depth', unit: 'px' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 100, step: 1, default: 58, section: 'Depth', unit: '%' },
    { key: 'depthFade', label: 'Depth Fade', type: 'slider', min: 0, max: 100, step: 1, default: 45, section: 'Finish', unit: '%' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.35, section: 'Motion', unit: '×', precision: 1 },
    ...sharedFinish,
  ],
  camera: (v) => ({ fov: 34 + clamp(v.perspective / 100, 0, 1) * 38, near: 1, far: 6000 }),
  transform3d: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'backward' ? -1 : 1;
    const laneCount = Math.max(1, Math.ceil(count / 4));
    const lane = Math.floor(index / 4);
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, laneCount) * dir;
    const u = frac(lane / laneCount - phase / laneCount);
    const side = index % 4;
    const half = Math.min(ctx.width, ctx.height) * (v.tunnelSize / 100) * 0.42;
    const z = lerp(-v.depth * 0.62, v.depth * 0.42, u);
    const edge = wrapEnvelope(u, 0.08);
    const farFade = 1 - (v.depthFade / 100) * smooth(clamp((0.28 - u) / 0.28, 0, 1));
    const cardPx = Math.min(ctx.width, ctx.height) * (v.cardLength / 100) * (1 - v.gap / 120);
    let x = 0, y = 0, rx = 0, ry = 0;
    if (side === 0) { x = -half; ry = Math.PI / 2; }
    if (side === 1) { x = half; ry = -Math.PI / 2; }
    if (side === 2) { y = -half; rx = Math.PI / 2; }
    if (side === 3) { y = half; rx = -Math.PI / 2; }
    const speedZ = -(loopCycles(v.speed, ctx.duration, laneCount) / laneCount) * v.depth / Math.max(0.001, ctx.duration) * dir;
    return {
      x, y, z,
      quaternion: quaternionFromEuler(rx, ry, 0),
      scale: cardPx / BASE,
      alpha: edge * farFade,
      thickness: v.thickness,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: 0.62 + u * 0.48,
      velocity: { x: 0, y: 0, z: speedZ },
    };
  },
  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'backward' ? -1 : 1;
    const laneCount = Math.max(1, Math.ceil(count / 4));
    const lane = Math.floor(index / 4);
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, laneCount) * dir;
    const u = frac(lane / laneCount - phase / laneCount);
    const side = index % 4;
    const half = Math.min(ctx.width, ctx.height) * (v.tunnelSize / 100) * 0.32;
    const zN = smooth(u);
    return {
      x: side === 0 ? -half : side === 1 ? half : 0,
      y: side === 2 ? -half : side === 3 ? half : 0,
      scale: (Math.min(ctx.width, ctx.height) * v.cardLength / 100 / BASE) * lerp(0.2, 1, zN),
      rotation: side < 2 ? Math.PI / 2 : 0,
      alpha: wrapEnvelope(u, 0.08),
      depth: u,
    };
  },
};

export const depthStackScroll: Template = {
  meta: { id: 'depth-stack-01', name: 'Depth Stack Scroll', group: 'Depth', isNew: true, engine: 'webgl', catalog3d: true, catalogHidden: true, repeatAssets: true, defaultEasing: { id: 'smooth' } },
  controls: [
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward','backward'], default: 'forward', section: 'Motion' },
    { key: 'count', label: 'Count', type: 'slider', min: 3, max: 16, step: 1, default: 7, section: 'Layout' },
    { key: 'cardSizePct', label: 'Card Size', type: 'slider', min: 25, max: 80, step: 1, default: 48, section: 'Layout', unit: '%' },
    { key: 'depth', label: 'Stack Depth', type: 'slider', min: 200, max: 1400, step: 20, default: 720, section: 'Depth', unit: 'px' },
    { key: 'spread', label: 'Stack Spread', type: 'slider', min: 0, max: 40, step: 1, default: 14, section: 'Layout', unit: '%' },
    { key: 'tilt', label: 'Resting Tilt', type: 'slider', min: -20, max: 20, step: 0.5, default: -4, section: 'Depth', unit: '°', precision: 1 },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 100, step: 1, default: 42, section: 'Depth', unit: '%' },
    { key: 'fade', label: 'Depth Fade', type: 'slider', min: 0, max: 100, step: 1, default: 58, section: 'Finish', unit: '%' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.3, section: 'Motion', unit: '×', precision: 1 },
    ...sharedFinish,
  ],
  camera: (v) => ({ fov: 20 + clamp(v.perspective / 100, 0, 1) * 42 }),
  transform3d: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'backward' ? -1 : 1;
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir;
    const u = frac(index / count - phase / count);
    const arrival = smooth(clamp((u - 0.66) / 0.34, 0, 1));
    const settle = springOvershoot(arrival, 8.5, 12);
    const edge = wrapEnvelope(u, 0.075);
    const spreadPx = Math.min(ctx.width, ctx.height) * v.spread / 100;
    const cardPx = Math.min(ctx.width, ctx.height) * v.cardSizePct / 100;
    const z = lerp(-v.depth * 0.62, v.depth * 0.38, u) + settle * 42;
    const drift = (hash2(index, 4.1) - 0.5) * spreadPx;
    const lean = (v.tilt + dir * settle * 2.4) * Math.PI / 180;
    return {
      x: drift * 0.24 * (1 - settle * 0.65),
      y: lerp(-spreadPx, spreadPx * 0.72, smooth(u)) - drift * 0.12,
      z,
      quaternion: quaternionFromEuler(lean, -lean * 0.35, lean * 0.3),
      scale: (cardPx / BASE) * (0.9 + settle * 0.1),
      alpha: edge * (1 - (v.fade / 100) * (1 - smooth(u))),
      thickness: v.thickness,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: 0.68 + smooth(u) * 0.4,
      velocity: { x: 0, y: 0, z: -v.depth * v.speed * dir },
    };
  },
  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'backward' ? -1 : 1;
    const u = frac(index / count - ((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir) / count);
    const cardPx = Math.min(ctx.width, ctx.height) * v.cardSizePct / 100;
    const spreadPx = Math.min(ctx.width, ctx.height) * v.spread / 100;
    return { x: 0, y: lerp(-spreadPx, spreadPx * 0.72, smooth(u)), scale: cardPx / BASE * lerp(0.72, 1, u), rotation: v.tilt * Math.PI / 180, alpha: wrapEnvelope(u, 0.075), depth: u };
  },
};

export const parallaxTotem: Template = {
  meta: { id: 'parallax-totem-01', name: 'Parallax Totem', group: 'Depth', isNew: true, engine: 'webgl', catalog3d: true, catalogHidden: true, repeatAssets: true, defaultEasing: { id: 'flow' } },
  controls: [
    { key: 'count', label: 'Count', type: 'slider', min: 6, max: 24, step: 1, default: 12, section: 'Layout' },
    { key: 'planes', label: 'Depth Planes', type: 'slider', min: 2, max: 5, step: 1, default: 3, section: 'Depth' },
    { key: 'cardSizePct', label: 'Card Size', type: 'slider', min: 12, max: 42, step: 1, default: 22, section: 'Layout', unit: '%' },
    { key: 'spreadX', label: 'Horizontal Spread', type: 'slider', min: 30, max: 110, step: 1, default: 52, section: 'Layout', unit: '%' },
    { key: 'spreadY', label: 'Vertical Spread', type: 'slider', min: 30, max: 110, step: 1, default: 58, section: 'Layout', unit: '%' },
    { key: 'depth', label: 'Depth', type: 'slider', min: 120, max: 900, step: 10, default: 520, section: 'Depth', unit: 'px' },
    { key: 'parallax', label: 'Parallax', type: 'slider', min: 0, max: 100, step: 1, default: 58, section: 'Motion', unit: '%' },
    { key: 'tilt', label: 'Card Tilt', type: 'slider', min: 0, max: 20, step: 0.5, default: 5, section: 'Depth', unit: '°', precision: 1 },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 100, step: 1, default: 50, section: 'Depth', unit: '%' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.22, section: 'Motion', unit: '×', precision: 1 },
    ...sharedFinish,
  ],
  camera: (v) => ({ fov: 24 + clamp(v.perspective / 100, 0, 1) * 38 }),
  transform3d: (frame, index, count, v, ctx) => {
    const planes = Math.max(2, Math.round(v.planes));
    const plane = index % planes;
    const row = Math.floor(index / planes);
    const rows = Math.max(1, Math.ceil(count / planes));
    const depthN = planes <= 1 ? 1 : plane / (planes - 1);
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration);
    const a = TAU * phase + (plane / planes) * TAU;
    const amp = v.parallax / 100 * (0.35 + depthN * 0.65);
    const baseX = (plane - (planes - 1) / 2) * (ctx.width * v.spreadX / 100) / Math.max(1, planes - 1);
    const baseY = (row - (rows - 1) / 2) * (ctx.height * v.spreadY / 100) / Math.max(1, rows - 1);
    const x = baseX + Math.sin(a) * ctx.width * 0.035 * amp;
    const y = baseY + Math.cos(a * 2) * ctx.height * 0.025 * amp;
    const z = lerp(-v.depth * 0.62, v.depth * 0.38, depthN);
    const tilt = (hash2(index, 12.4) - 0.5) * 2 * v.tilt * Math.PI / 180;
    const cardPx = Math.min(ctx.width, ctx.height) * v.cardSizePct / 100;
    return {
      x, y, z,
      quaternion: quaternionFromEuler(tilt * 0.55, -tilt, tilt * 0.8),
      scale: (cardPx / BASE) * lerp(0.78, 1.08, depthN),
      alpha: lerp(0.52, 1, depthN),
      thickness: v.thickness,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: lerp(0.68, 1.08, depthN),
      velocity: { x: Math.cos(a) * ctx.width * 0.035 * amp, y: -Math.sin(a * 2) * ctx.height * 0.05 * amp, z: 0 },
    };
  },
  transform: (frame, index, count, v, ctx) => {
    const planes = Math.max(2, Math.round(v.planes));
    const plane = index % planes;
    const row = Math.floor(index / planes);
    const rows = Math.max(1, Math.ceil(count / planes));
    const depthN = plane / (planes - 1);
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration);
    const a = TAU * phase + (plane / planes) * TAU;
    const x = (plane - (planes - 1) / 2) * (ctx.width * v.spreadX / 100) / Math.max(1, planes - 1) + Math.sin(a) * ctx.width * 0.025;
    const y = (row - (rows - 1) / 2) * (ctx.height * v.spreadY / 100) / Math.max(1, rows - 1) + Math.cos(a * 2) * ctx.height * 0.018;
    return { x, y, scale: Math.min(ctx.width, ctx.height) * v.cardSizePct / 100 / BASE * lerp(0.78, 1.08, depthN), rotation: 0, alpha: lerp(0.52, 1, depthN), depth: depthN };
  },
};

export const premium3dTemplates = [cardTunnel, depthStackScroll, parallaxTotem];
