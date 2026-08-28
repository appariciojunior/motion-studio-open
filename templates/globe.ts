import type { Template, TransformCtx } from '@/lib/types';
import { TAU, clamp, lerp, loopCycles, smooth } from '@/lib/motion';
import { DEG, quaternionFromEuler } from '@/lib/tilt3d';
import { variant } from './variant';

// ---------------------------------------------------------------------------
//  GLOBE — an original spherical card engine.
//
//  The family deliberately joins two useful ideas without cloning either UI:
//    - MOVO Sphere's clear Billboard / Brace / Generative visual vocabulary;
//    - Arqe Globe's axis, camera-facing, depth-scale and scene-rotation model.
//
//  Its camera and motion follow the same lessons as this repo's Orbit 3D port:
//  perspective is a real lens, continuous turns close on whole revolutions,
//  stepped turns shape each step without breaking the loop, and one rigid rig
//  rotates centres and faces together. The geometry is different: equal-area
//  points cover a sphere instead of cards occupying slots around a ring.
// ---------------------------------------------------------------------------

const BASE = 340;
const GROUP = 'Globe';
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TAN_MIN = Math.tan(5 * DEG);
const TAN_MAX = Math.tan(60 * DEG);

type Vec3 = { x: number; y: number; z: number };
type GlobeLayout = 'fibonacci' | 'latitude';

const num = (value: any, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const pick = (value: any, fallback: string) =>
  typeof value === 'string' ? value : fallback;

function perspectiveToFov(value: number) {
  const t = TAN_MIN + (clamp(value, 0, 2000) / 1000) * (TAN_MAX - TAN_MIN);
  return (2 * Math.atan(t)) / DEG;
}

function rotateX(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}

function rotateY(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}

function rotateZ(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
}

function rotateOnAxis(p: Vec3, axis: string, angle: number) {
  if (axis === 'x') return rotateX(p, angle);
  if (axis === 'z') return rotateZ(p, angle);
  return rotateY(p, angle);
}

// Three's intrinsic XYZ convention, matching Orbit 3D: the authored rig sits
// outside the animated spin, so a compound rotation never prises the globe
// apart or leaves the card normals behind their centres.
function rigPoint(p: Vec3, v: Record<string, any>) {
  return rotateX(
    rotateY(
      rotateZ(p, num(v.rotationZ) * DEG),
      num(v.rotationY) * DEG,
    ),
    num(v.rotationX) * DEG,
  );
}

function basePoint(index: number, count: number, layoutValue: any): Vec3 {
  const layout = pick(layoutValue, 'fibonacci') as GlobeLayout | 'grid' | 'orbit';
  if (layout === 'latitude' || layout === 'grid') {
    // An equal-area latitude grid: row centres are uniform in sin(latitude),
    // while each row receives roughly circumference-proportional columns.
    // That keeps the poles from bunching into the spiky pinecone silhouette a
    // naive uniform-latitude grid produces.
    const rows = Math.max(3, Math.round(Math.sqrt(count / 2)));
    const row = index % rows;
    const y = 1 - 2 * ((row + 0.5) / rows);
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const columns = Math.max(3, Math.ceil(count / rows));
    const col = Math.floor(index / rows);
    const lon = ((col + (row % 2) * 0.5) / columns) * TAU;
    return { x: ring * Math.sin(lon), y, z: ring * Math.cos(lon) };
  }

  // Fibonacci points give every card the same patch of surface area. The
  // half-step avoids placing a card exactly on either pole.
  const y = 1 - 2 * ((index + 0.5) / Math.max(1, count));
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const lon = index * GOLDEN_ANGLE;
  return { x: ring * Math.sin(lon), y, z: ring * Math.cos(lon) };
}

function spinAngle(frame: number, count: number, v: Record<string, any>, ctx: TransformCtx) {
  const direction = pick(v.direction, 'forward') === 'reverse' ? -1 : 1;
  const turns = Math.abs(loopCycles(num(v.speed, 0.35), ctx.duration));
  const progress = frame / Math.max(1, ctx.totalFrames);

  if (pick(v.motion, 'continuous') !== 'stepped') {
    return direction * progress * turns * TAU;
  }

  // A step count derived from the population keeps a dense globe calm and a
  // sparse one deliberate. At frame N `p` is an integer, so the final angle is
  // still whole turns and therefore exactly the same picture as frame 0.
  const stepsPerTurn = Math.max(6, Math.round(Math.sqrt(Math.max(6, count)) * 2));
  const p = progress * turns * stepsPerTurn;
  const move = Math.max(0.02, 1 - clamp(num(v.hold, 18) / 100, 0, 0.9));
  const stepped = Math.floor(p) + ctx.ease(Math.min(1, (p - Math.floor(p)) / move));
  return direction * (stepped / stepsPerTurn) * TAU;
}

interface GlobePose {
  point: Vec3;
  normal: Vec3;
  radius: number;
  cardPx: number;
  nearness: number;
  alpha: number;
  dim: number;
}

function globePose(
  frame: number,
  index: number,
  count: number,
  v: Record<string, any>,
  ctx: TransformCtx,
): GlobePose {
  const stage = Math.min(ctx.width, ctx.height);
  const radius = stage * clamp(num(v.globeSizePct, 70), 35, 100) / 200;
  const angle = spinAngle(frame, count, v, ctx);
  const spun = rotateOnAxis(basePoint(index, count, v.layout), pick(v.axis, 'y'), angle);
  const normal = rigPoint(spun, v);
  const point = {
    x: normal.x * radius + num(v.offset?.x),
    y: normal.y * radius - num(v.offset?.y),
    z: normal.z * radius,
  };

  // The equal-area cell has area 4*pi*r^2/count; its square-root is the
  // physical card footprint. Card Size fills/overfills that patch, while Gap
  // uniformly opens it. This is resolution independent and survives changes
  // to Count without turning into a sparse cloud or a solid brick.
  const cell = radius * Math.sqrt((4 * Math.PI) / Math.max(6, count));
  const fill = clamp(num(v.cardSizePct, 82), 25, 180) / 100;
  const gap = 1 - clamp(num(v.gap, 6), 0, 35) / 100;

  const linearDepth = clamp((normal.z + 1) / 2, 0, 1);
  const contrast = clamp(num(v.contrast, 65), 0, 200) / 100;
  const nearness = smooth(lerp(linearDepth, Math.pow(linearDepth, 1 + contrast * 1.4), contrast * 0.72));
  const minScale = clamp(num(v.minScale, 62), 10, 160) / 100;
  const maxScale = clamp(num(v.maxScale, 118), 20, 240) / 100;
  const depthScale = lerp(minScale, maxScale, nearness);
  const style = pick(v.style, 'orbit');
  const styleScale = style === 'generative' ? 1.08 : style === 'brace' ? 0.9 : 1;
  const cardPx = cell * fill * gap * depthScale * styleScale;

  const fade = clamp(num(v.fade, 18), 0, 100) / 100;
  let alpha = 1 - fade * (1 - nearness);
  const surfaceFacing = pick(v.facing, 'camera') === 'surface';
  if (surfaceFacing && pick(v.backface, 'hide') === 'hide') {
    // Hide only the true reverse of a surface-facing card. Billboard cards are
    // parallel to the camera by definition, so depth fade — not backface cull
    // — is the honest way to thin their far hemisphere.
    alpha *= smooth(clamp(normal.z / 0.12, 0, 1));
  }

  return {
    point,
    normal,
    radius,
    cardPx,
    nearness,
    alpha,
    dim: clamp(contrast * (1 - nearness) * 0.52, 0, 0.82),
  };
}

function cameraZ(v: Record<string, any>, ctx: TransformCtx) {
  const fov = perspectiveToFov(num(v.perspective, 430));
  const fit = (ctx.height / 2) / Math.tan((fov * DEG) / 2);
  return fit * (100 / clamp(num(v.zoom, 100), 25, 200));
}

const globe: Template = {
  meta: {
    id: 'globe-01',
    name: 'Orbit Globe',
    group: GROUP,
    isNew: true,
    engine: 'webgl',
    // The group is already explicitly named Globe, so it needs no generated
    // "3D" suffix in the catalogue. `engine` remains the renderer truth.
    repeatAssets: true,
    cardAspect: 4 / 3,
    defaultEasing: { id: 'flow' },
  },
  controls: [
    { key: 'style', label: 'Globe Style', type: 'pills', options: ['orbit', 'editorial', 'billboard', 'brace', 'generative'], default: 'orbit', section: 'Layout' },
    { key: 'layout', label: 'Distribution', type: 'pills', options: ['fibonacci', 'latitude'], default: 'fibonacci', section: 'Layout', advanced: true },
    { key: 'count', label: 'Card Count', type: 'slider', min: 8, max: 200, step: 1, default: 54, section: 'Layout' },
    { key: 'globeSizePct', label: 'Globe Size', type: 'slider', min: 35, max: 100, step: 1, default: 72, section: 'Layout', unit: '%' },
    { key: 'cardSizePct', label: 'Card Size', type: 'slider', min: 25, max: 180, step: 1, default: 88, section: 'Layout', unit: '%' },
    { key: 'gap', label: 'Gap', type: 'slider', min: 0, max: 35, step: 1, default: 7, section: 'Layout', unit: '%' },
    { key: 'facing', label: 'Card Facing', type: 'pills', options: ['camera', 'surface'], default: 'camera', section: 'Depth' },
    { key: 'surface', label: 'Surface', type: 'pills', options: ['flat', 'wrap'], default: 'flat', section: 'Depth', visibleWhen: { key: 'facing', equals: 'surface' } },
    { key: 'minScale', label: 'Far Scale', type: 'slider', min: 10, max: 160, step: 1, default: 62, section: 'Depth', unit: '%' },
    { key: 'maxScale', label: 'Near Scale', type: 'slider', min: 20, max: 240, step: 1, default: 118, section: 'Depth', unit: '%' },
    { key: 'contrast', label: 'Depth Contrast', type: 'slider', min: 0, max: 200, step: 1, default: 65, section: 'Depth', unit: '%' },
    { key: 'fade', label: 'Depth Fade', type: 'slider', min: 0, max: 100, step: 1, default: 18, section: 'Finish', unit: '%' },
    { key: 'backface', label: 'Backface', type: 'toggle', options: ['hide', 'show'], default: 'hide', section: 'Finish', advanced: true },
    { key: 'motion', label: 'Motion', type: 'pills', options: ['continuous', 'stepped'], default: 'continuous', section: 'Motion' },
    { key: 'axis', label: 'Spin Axis', type: 'pills', options: ['y', 'x', 'z'], default: 'y', section: 'Motion' },
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward', 'reverse'], default: 'forward', section: 'Motion' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.05, default: 0.35, section: 'Motion', unit: '×', precision: 2 },
    { key: 'hold', label: 'Step Hold', type: 'slider', min: 0, max: 80, step: 1, default: 18, section: 'Motion', unit: '%', visibleWhen: { key: 'motion', equals: 'stepped' } },
    { key: 'rotationX', label: 'Rotation X', type: 'slider', min: -180, max: 180, step: 1, default: -12, section: 'Depth', unit: '°', advanced: true },
    { key: 'rotationY', label: 'Rotation Y', type: 'slider', min: -180, max: 180, step: 1, default: 0, section: 'Depth', unit: '°', advanced: true },
    { key: 'rotationZ', label: 'Rotation Z', type: 'slider', min: -180, max: 180, step: 1, default: 8, section: 'Depth', unit: '°', advanced: true },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 2000, step: 10, default: 430, section: 'Depth', advanced: true },
    { key: 'zoom', label: 'Zoom', type: 'slider', min: 25, max: 200, step: 1, default: 100, section: 'Depth', unit: '%' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 24, step: 1, default: 4, section: 'Finish', unit: '%' },
    { key: 'thickness', label: 'Thickness', type: 'slider', min: 0, max: 24, step: 1, default: 3, section: 'Finish', unit: 'px', advanced: true },
    { key: 'shadow', label: 'Shadow', type: 'toggle', options: ['off', 'on'], default: 'off', section: 'Finish', advanced: true },
    { key: 'offset', label: 'Offset', type: 'xypad', default: { x: 0, y: 0 }, section: 'Layout', advanced: true },
  ],
  camera: (v) => ({
    fov: perspectiveToFov(num(v.perspective, 430)),
    distance: 100 / clamp(num(v.zoom, 100), 25, 200),
    near: 0.1,
    far: 20000,
  }),
  transform3d: (frame, index, count, v, ctx) => {
    const g = globePose(frame, index, count, v, ctx);
    const surfaceFacing = pick(v.facing, 'camera') === 'surface';
    const roll = num(v.cardRoll) * DEG;
    const quaternion = surfaceFacing
      ? quaternionFromEuler(-Math.asin(clamp(g.normal.y, -1, 1)), Math.atan2(g.normal.x, g.normal.z), roll)
      : quaternionFromEuler(0, 0, roll);
    const wrapped = surfaceFacing && pick(v.surface, 'flat') === 'wrap';
    return {
      x: g.point.x,
      // globePose is kept in y-up world coordinates; the renderer accepts
      // canvas-y and negates it once, so convert only at this boundary.
      y: -g.point.y,
      z: g.point.z,
      quaternion,
      scale: g.cardPx / BASE,
      alpha: g.alpha,
      dim: g.dim,
      bend: wrapped ? -clamp((g.cardPx / Math.max(1, g.radius)) * 0.34, 0.025, 0.24) : 0,
      thickness: num(v.thickness, 3),
      shadowStrength: pick(v.shadow, 'off') === 'on' ? 1 : 0,
      materialExposure: lerp(0.72, 1.08, g.nearness),
    };
  },
  transform: (frame, index, count, v, ctx) => {
    const g = globePose(frame, index, count, v, ctx);
    const camZ = cameraZ(v, ctx);
    const perspectiveScale = clamp(camZ / Math.max(1, camZ - g.point.z), 0.2, 4);
    return {
      x: g.point.x * perspectiveScale,
      y: -g.point.y * perspectiveScale,
      scale: (g.cardPx / BASE) * perspectiveScale,
      rotation: num(v.cardRoll) * DEG,
      alpha: g.alpha,
      dim: g.dim,
      depth: g.point.z,
    };
  },
};

// The first preset is the requested synthesis: an Orbit-like camera rig and
// loop wrapped around a Globe population. The remaining looks expose the three
// useful Sphere dialects plus calmer editorial alternatives. They are authored
// for this app rather than mirroring either reference's preset table.
export const orbitGlobe = globe;

export const globeVariants: Template[] = [
  globe,
  variant(globe, 'globe-02', 'Editorial Globe', {
    style: 'editorial', layout: 'latitude', count: 96, globeSizePct: 76,
    cardSizePct: 92, gap: 5, facing: 'surface', surface: 'flat',
    minScale: 72, maxScale: 112, contrast: 38, fade: 12,
    rotationX: -18, rotationZ: -8, perspective: 310, speed: 0.25,
  }, { id: 'linear' }, { cardAspect: 4 / 3 }),
  variant(globe, 'globe-03', 'Billboard Globe', {
    style: 'billboard', layout: 'fibonacci', count: 42, globeSizePct: 70,
    cardSizePct: 72, gap: 12, facing: 'camera', minScale: 28, maxScale: 128,
    contrast: 92, fade: 42, rotationX: 0, rotationZ: 0, perspective: 520,
  }, { id: 'smooth' }, { cardAspect: 1 }),
  variant(globe, 'globe-04', 'Brace Globe', {
    style: 'brace', layout: 'fibonacci', count: 56, globeSizePct: 78,
    cardSizePct: 112, gap: 3, facing: 'surface', surface: 'wrap',
    minScale: 84, maxScale: 108, contrast: 24, fade: 0,
    rotationX: 12, rotationY: -14, rotationZ: 6, perspective: 480,
    thickness: 1,
  }, { id: 'linear' }, { cardAspect: 1 }),
  variant(globe, 'globe-05', 'Generative Globe', {
    style: 'generative', layout: 'fibonacci', count: 110, globeSizePct: 70,
    cardSizePct: 82, gap: 2, facing: 'camera', minScale: 48, maxScale: 124,
    contrast: 125, fade: 22, rotationX: -8, rotationZ: 12,
    perspective: 500, zoom: 86, speed: 0.2,
  }, { id: 'flow' }, { cardAspect: 1 }),
  variant(globe, 'globe-06', 'Halo Globe', {
    style: 'editorial', layout: 'latitude', count: 72, globeSizePct: 84,
    cardSizePct: 78, gap: 15, facing: 'camera', minScale: 30, maxScale: 106,
    contrast: 110, fade: 58, axis: 'z', rotationX: 64, rotationZ: 24,
    perspective: 250, speed: 0.3,
  }, { id: 'glide' }, { cardAspect: 16 / 9 }),
  variant(globe, 'globe-07', 'Step Globe', {
    style: 'orbit', layout: 'fibonacci', count: 64, globeSizePct: 74,
    cardSizePct: 84, facing: 'camera', motion: 'stepped', hold: 48,
    minScale: 45, maxScale: 132, contrast: 86, fade: 30,
    axis: 'x', rotationY: 24, rotationZ: -14, perspective: 560,
  }, { id: 'settle' }, { cardAspect: 4 / 5 }),
  variant(globe, 'globe-08', 'Wide Lens Globe', {
    style: 'generative', layout: 'fibonacci', count: 88, globeSizePct: 74,
    cardSizePct: 72, gap: 5, facing: 'surface', surface: 'flat',
    backface: 'show', minScale: 42, maxScale: 112, contrast: 105, fade: 42,
    rotationX: 18, rotationY: -22, rotationZ: 33,
    perspective: 650, zoom: 72, speed: 0.18, thickness: 4, shadow: 'on',
  }, { id: 'linear' }, { cardAspect: 1 }),
];
