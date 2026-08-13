import type { Template } from '@/lib/types';
import { variant } from './variant';

const BASE = 340;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
};

// Poster 01 is a finite stack, not a carousel. Nine 4:5 sheets share the same
// centre and are peeled away from the top-right corner one by one; after the
// last sheet the composition stays empty until the 21-second clip ends.
const poster: Template = {
  meta: {
    id: 'poster-01', name: 'Poster 01', group: 'Stickers', repeatAssets: true,
    engine: 'webgl', cardAspect: 4 / 5, isNew: true, defaultEasing: { id: 'smooth' },
  },
  controls: [
    { key: 'count', label: 'Count', type: 'slider', min: 1, max: 12, step: 1, default: 9 },
    { key: 'cardSize', label: 'Size', type: 'slider', min: 50, max: 300, step: 1, default: 150 },
    { key: 'cornerRadius', label: 'Corner', type: 'slider', min: 0, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'roll', label: 'Roll', type: 'slider', min: -180, max: 180, step: 1, default: 0 },
    { key: 'peel', label: 'Peel', type: 'slider', min: 0, max: 360, step: 1, default: 50 },
    { key: 'angle', label: 'Angle', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
    { key: 'curl', label: 'Curl', type: 'slider', min: 0, max: 100, step: 1, default: 30, unit: '%' },
    { key: 'amount', label: 'Amount', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
    { key: 'backface', label: 'Backface', type: 'toggle', options: ['image', 'sticker'], default: 'image' },
    { key: 'spread', label: 'Spread', type: 'slider', min: 0, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0.1, max: 3, step: 0.05, default: 1, unit: '×', section: 'Motion' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 200, step: 1, default: 125, advanced: true },
  ],
  transform: (frame, index, count, v, ctx) => {
    const seconds = (frame / Math.max(1, ctx.totalFrames)) * ctx.duration * Number(v.speed ?? 1);
    const interval = (ctx.duration * 0.82) / Math.max(1, count);
    const start = (count - 1 - index) * interval;
    const peelDuration = Math.max(0.2, interval * 0.48);
    const progress = smooth((seconds - start) / peelDuration);
    const seed = ((index * 73 + 19) % 97) / 97;
    const scatter = (v.spread / 100) * ctx.width * 0.62;
    const rotation = ((seed - 0.5) * 2 * Number(v.roll ?? 0)) * Math.PI / 180;
    return {
      x: Math.cos(seed * Math.PI * 11) * scatter,
      y: Math.sin(seed * Math.PI * 11) * scatter,
      scale: (v.cardSize / 150) * 650 / BASE,
      scaleY: 1,
      rotation,
      alpha: seconds < start + peelDuration ? 1 : 0,
      depth: index + progress,
    };
  },
  transform3d: (frame, index, count, v, ctx) => {
    const seconds = (frame / Math.max(1, ctx.totalFrames)) * ctx.duration * Number(v.speed ?? 1);
    const interval = (ctx.duration * 0.82) / Math.max(1, count);
    const start = (count - 1 - index) * interval;
    const peelDuration = Math.max(0.2, interval * 0.48);
    const progress = smooth((seconds - start) / peelDuration);
    const active = seconds >= start && seconds < start + peelDuration;
    const seed = ((index * 73 + 19) % 97) / 97;
    const scatter = (v.spread / 100) * ctx.width * 0.62;
    const rotation = ((seed - 0.5) * 2 * Number(v.roll ?? 0)) * Math.PI / 180;
    const peelDirection = v.angle === 'random'
      ? (Number(v.peel ?? 50) + seed * 360) % 360
      : Number(v.peel ?? 50);
    const amount = v.amount === 'random' ? 0.72 + seed * 0.56 : 1;
    return {
      x: Math.cos(seed * Math.PI * 11) * scatter,
      y: Math.sin(seed * Math.PI * 11) * scatter,
      z: index * 0.9 + (active ? Math.sin(progress * Math.PI) * 45 : 0),
      rotationX: 0,
      rotationY: 0,
      rotationZ: rotation,
      cornerPeel: active ? progress : 0,
      peelAngle: Math.PI * 1.03 * progress * amount,
      peelDirection,
      curl: active ? (v.curl / 100) * 1.45 * Math.sin(progress * Math.PI) : 0,
      scale: (v.cardSize / 150) * 650 / BASE,
      alpha: seconds < start + peelDuration ? 1 : 0,
    };
  },
};

// Frame-matched reconstruction of the separate rolling sticker scatter.
const STICKER_LAYOUT: ReadonlyArray<readonly [number, number, number]> = [
  [-0.46, -0.30, -28], [-0.58, 0.77, 0], [0.88, 0.34, -18], [0.26, 0.77, 45],
  [0.26, -0.16, -8], [-0.68, -0.77, -32], [-0.36, -0.46, 12], [-0.28, -0.84, -35],
  [0.50, -0.76, 0], [0.82, -0.38, 26], [0.86, 0.64, -24], [-0.88, -0.12, 10],
  [-0.57, -0.08, -16], [0.90, 0.18, 24], [-0.16, 0.12, 8], [0.04, -0.68, -42],
  [0.52, 0.28, 14],
];

function stickerPose(frame: number, index: number, count: number, v: Record<string, any>, ctx: Parameters<Template['transform']>[4]) {
  const seconds = (frame / Math.max(1, ctx.totalFrames)) * ctx.duration;
  const durationScale = ctx.duration / 36;
  const denominator = Math.max(1, count - 1);
  const enterStart = ctx.duration * 0.006 + index * ((ctx.duration * 0.59) / denominator);
  const enterDuration = Math.max(0.18, 0.9 * durationScale);
  const exitStart = ctx.duration * 0.69 + (count - 1 - index) * ((ctx.duration * 0.245) / denominator);
  const exitDuration = Math.max(0.18, 0.9 * durationScale);
  const entering = smooth((seconds - enterStart) / enterDuration);
  const exiting = smooth((seconds - exitStart) / exitDuration);
  const visible = seconds >= enterStart && seconds < exitStart + exitDuration;
  const travel = entering * (1 - exiting);
  const layout = STICKER_LAYOUT[index % STICKER_LAYOUT.length];
  const ring = Math.floor(index / STICKER_LAYOUT.length);
  const spread = (Number(v.spread ?? 42) / 42) * (1 + ring * 0.08);
  const targetX = layout[0] * (ctx.width / 2) * spread;
  const targetY = layout[1] * (ctx.height / 2) * spread;
  const seed = ((index * 73 + 19) % 97) / 97;
  const randomAmount = v.amount === 'random' ? 0.65 + seed * 0.7 : 1;
  const randomAngle = v.angle === 'random' ? (seed - 0.5) * ctx.width * 0.8 : 0;
  const offscreenY = -ctx.height * 0.72 - Number(v.cardSize ?? 50) * 3.2;
  const x = targetX * travel + randomAngle * (1 - travel);
  const y = offscreenY * (1 - travel) + targetY * travel;
  const roll = (Number(v.roll ?? 90) * Math.PI / 180) * randomAmount * (1 - travel);
  const peel = (Number(v.peel ?? 0) * Math.PI / 180) * randomAmount * (1 - travel);
  return {
    x, y, roll, peel,
    rotation: layout[2] * Math.PI / 180,
    curl: ((Number(v.curl ?? 15) / 100) * 0.38) * (index % 2 === 0 ? 1 : -1),
    scale: (Number(v.cardSize ?? 50) / 50) * (225 / BASE),
    alpha: visible ? 1 : 0,
    depth: index + travel * 0.25,
  };
}

const stickerScatter: Template = {
  meta: {
    id: 'stickers-01', name: 'Stickers 01', group: 'Stickers', repeatAssets: true,
    engine: 'webgl', cardAspect: 1, isNew: true, defaultEasing: { id: 'smooth' },
  },
  controls: [
    { key: 'count', label: 'Count', type: 'slider', min: 1, max: 30, step: 1, default: 17 },
    { key: 'cardSize', label: 'Size', type: 'slider', min: 20, max: 120, step: 1, default: 50 },
    { key: 'cornerRadius', label: 'Corner', type: 'slider', min: 0, max: 50, step: 1, default: 20, unit: '%' },
    { key: 'roll', label: 'Roll', type: 'slider', min: 0, max: 180, step: 1, default: 90 },
    { key: 'peel', label: 'Peel', type: 'slider', min: 0, max: 90, step: 1, default: 0 },
    { key: 'angle', label: 'Angle', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
    { key: 'curl', label: 'Curl', type: 'slider', min: 0, max: 100, step: 1, default: 15, unit: '%' },
    { key: 'amount', label: 'Amount', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
    { key: 'backface', label: 'Backface', type: 'toggle', options: ['image', 'sticker'], default: 'sticker' },
    { key: 'stickerColor', label: 'Color', type: 'color', default: '#FFFFFF' },
    { key: 'stroke', label: 'Stroke', type: 'slider', min: 0, max: 30, step: 1, default: 0 },
    { key: 'spread', label: 'Spread', type: 'slider', min: 0, max: 100, step: 1, default: 42, unit: '%' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 200, step: 1, default: 125, advanced: true },
  ],
  transform: (frame, index, count, v, ctx) => {
    const p = stickerPose(frame, index, count, v, ctx);
    return {
      x: p.x, y: p.y, scale: p.scale,
      scaleY: Math.max(0.03, Math.abs(Math.cos(p.roll))),
      rotation: p.rotation, alpha: p.alpha, depth: p.depth,
    };
  },
  transform3d: (frame, index, count, v, ctx) => {
    const p = stickerPose(frame, index, count, v, ctx);
    return {
      x: p.x, y: p.y, z: p.depth * 1.5,
      rotationX: p.roll, rotationY: p.peel, rotationZ: p.rotation,
      curl: p.curl, scale: p.scale, alpha: p.alpha,
      backfaceColor: v.backface === 'sticker' ? String(v.stickerColor || '#FFFFFF') : undefined,
    };
  },
};

// Stickers 02/03 are a second motion family: nine large square stickers stay
// on-screen while a single 13-second peel pulse opens and closes their corners.
const STICKER_PEEL_LAYOUT: ReadonlyArray<readonly [number, number, number]> = [
  [-1.08, -0.48, 18], [-0.60, 0.78, 0], [1.05, -0.38, 2],
  [-1.08, 0.24, -11], [0.74, 0.96, 14], [0.45, 1.10, -8],
  [-0.28, -0.82, -12], [0.92, -0.82, 4], [0.23, -0.45, 14],
];
const STICKER_PEEL_DIRECTIONS = [120, 310, 140, 40, 230, 130, 310, 230, 230] as const;

function stickerPeelPose(frame: number, index: number, count: number, v: Record<string, any>, ctx: Parameters<Template['transform']>[4]) {
  const seconds = (frame / Math.max(1, ctx.totalFrames)) * ctx.duration;
  // The nine stickers never leave. Across the whole composition they make one
  // slow peel-and-return pulse (flat at both ends, deepest at the midpoint).
  const phase = clamp01(seconds / Math.max(0.001, ctx.duration));
  const progress = Math.sin(phase * Math.PI);
  const active = progress > 0.001;
  const layout = STICKER_PEEL_LAYOUT[index % STICKER_PEEL_LAYOUT.length];
  const spread = Number(v.spread ?? 0) / 37;
  const seed = ((index * 73 + 19) % 97) / 97;
  const amount = v.amount === 'random' ? 0.72 + seed * 0.56 : 1;
  const roll = Number(v.roll ?? 0);
  const rotation = (layout[2] / 21) * roll * Math.PI / 180;
  const peelDirection = v.angle === 'random'
    ? STICKER_PEEL_DIRECTIONS[index % STICKER_PEEL_DIRECTIONS.length]
    : Number(v.peel ?? 50);

  return {
    x: layout[0] * (ctx.width / 2) * spread,
    y: layout[1] * (ctx.height / 2) * spread,
    rotation,
    progress,
    active,
    amount,
    peelDirection,
    scale: (Number(v.cardSize ?? 100) / 100) * (450 / BASE),
    depth: index + progress * 0.35,
  };
}

const stickerPeel: Template = {
  meta: {
    id: 'stickers-02', name: 'Stickers 02', group: 'Stickers', repeatAssets: true,
    engine: 'webgl', cardAspect: 1, isNew: true, defaultEasing: { id: 'smooth' },
  },
  controls: [
    { key: 'count', label: 'Count', type: 'slider', min: 1, max: 30, step: 1, default: 9 },
    { key: 'cardSize', label: 'Size', type: 'slider', min: 20, max: 120, step: 1, default: 100 },
    { key: 'cornerRadius', label: 'Corner', type: 'slider', min: 0, max: 50, step: 1, default: 20, unit: '%' },
    { key: 'roll', label: 'Roll', type: 'slider', min: 0, max: 180, step: 1, default: 0 },
    { key: 'peel', label: 'Peel', type: 'slider', min: 0, max: 360, step: 1, default: 50 },
    { key: 'angle', label: 'Angle', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
    { key: 'curl', label: 'Curl', type: 'slider', min: 0, max: 100, step: 1, default: 15, unit: '%' },
    { key: 'amount', label: 'Amount', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
    { key: 'backface', label: 'Backface', type: 'toggle', options: ['image', 'sticker'], default: 'sticker' },
    { key: 'stickerColor', label: 'Color', type: 'color', default: '#FFFFFF' },
    { key: 'stroke', label: 'Stroke', type: 'slider', min: 0, max: 30, step: 1, default: 0 },
    { key: 'spread', label: 'Spread', type: 'slider', min: 0, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 200, step: 1, default: 125, advanced: true },
  ],
  transform: (frame, index, count, v, ctx) => {
    const p = stickerPeelPose(frame, index, count, v, ctx);
    return {
      x: p.x, y: p.y, scale: p.scale,
      scaleY: 1, rotation: p.rotation,
      alpha: 1, depth: p.depth,
    };
  },
  transform3d: (frame, index, count, v, ctx) => {
    const p = stickerPeelPose(frame, index, count, v, ctx);
    return {
      x: p.x, y: p.y,
      z: index * 0.9 + p.progress * 2,
      rotationX: Math.cos(p.peelDirection * Math.PI / 180) * Number(v.roll ?? 0) * Math.PI / 180 * p.progress * 0.35,
      rotationY: Math.sin(p.peelDirection * Math.PI / 180) * Number(v.roll ?? 0) * Math.PI / 180 * p.progress * 0.35,
      rotationZ: p.rotation,
      cornerPeel: p.active ? p.progress * 0.32 * p.amount : 0,
      peelAngle: (90 + Number(v.peel ?? 50)) * Math.PI / 180,
      peelDirection: p.peelDirection,
      curl: p.active ? (Number(v.curl ?? 15) / 100) * 1.45 : 0,
      scale: p.scale,
      alpha: 1,
      backfaceColor: v.backface === 'sticker' ? String(v.stickerColor || '#FFFFFF') : undefined,
    };
  },
};

export const stickerVariants: Template[] = [
  poster,
  variant(poster, 'poster-02', 'Poster 02', { peel: 310, curl: 30 }),
  variant(poster, 'poster-03', 'Poster 03', { peel: 310, curl: 15, angle: 'random' }),
  variant(poster, 'poster-04', 'Poster 04', { peel: 270, curl: 15 }),
  variant(poster, 'poster-05', 'Poster 05', { peel: 0, curl: 15 }),
  variant(poster, 'poster-06', 'Poster 06', { roll: 20, peel: 310, curl: 15, angle: 'random', spread: 31 }),
  stickerScatter,
  stickerPeel,
  variant(stickerPeel, 'stickers-03', 'Stickers 03', { roll: 21, angle: 'random', spread: 37 }),
];
