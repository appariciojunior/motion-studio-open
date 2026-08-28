import type { Template } from '@/lib/types';
import { variant } from './variant';
import { exactStickerVariants } from './stickersExact';

const BASE = 340;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
};

const PEEL_FROM_OPTIONS = [
  'right', 'top right', 'top', 'top left',
  'left', 'bottom left', 'bottom', 'bottom right', 'random',
] as const;

const PEEL_FROM_DEGREES: Record<string, number> = {
  right: 0,
  'top right': 50,
  top: 90,
  'top left': 130,
  left: 180,
  'bottom left': 230,
  bottom: 270,
  'bottom right': 310,
};

function randomDirectionTurn(from: string) {
  const token = from.startsWith('random:') ? from.slice('random:'.length) : '';
  let turn = 0;
  for (let i = 0; i < token.length; i++) turn = (turn * 33 + token.charCodeAt(i)) % 8;
  return turn;
}

// Direction and peel strength are separate controls. Older Poster/Sticker 02
// scenes stored a numeric direction in `peel`, so keep that as a fallback only.
function peelDirection(
  v: Record<string, any>,
  seed = 0,
  fallback = 45,
  legacyPeelWasDirection = false,
) {
  const from = String(v.peelFrom ?? '');
  if (from === 'random' || from.startsWith('random:')) {
    const directions = Object.values(PEEL_FROM_DEGREES);
    const seedStep = Math.round(seed * 97);
    return directions[(seedStep * 5 + 3 + randomDirectionTurn(from)) % directions.length];
  }
  if (PEEL_FROM_DEGREES[from] !== undefined) return PEEL_FROM_DEGREES[from];
  const legacy = Number(v.peel);
  if (legacyPeelWasDirection && Number.isFinite(legacy)) {
    return v.angle === 'random' ? (legacy + seed * 360) % 360 : legacy;
  }
  return fallback;
}

// `peelFrom` describes a side of the canvas, not a side that should rotate
// with each scattered sticker. Convert that screen-space direction back into
// the sticker's local coordinates before deforming its geometry.
function localPeelDirection(
  v: Record<string, any>,
  rotation: number,
  seed = 0,
  fallback = 45,
  legacyPeelWasDirection = false,
) {
  const screenDirection = peelDirection(v, seed, fallback, legacyPeelWasDirection);
  return ((screenDirection - rotation * 180 / Math.PI) % 360 + 360) % 360;
}

function stickerBackColor(v: Record<string, any>) {
  const mode = String(v.backSide ?? v.backface ?? 'image');
  if (mode !== 'color' && mode !== 'sticker') return undefined;
  return String(v.backColor ?? v.stickerColor ?? '#000000');
}

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
    { key: 'peelFrom', label: 'Peel From', type: 'direction', options: [...PEEL_FROM_OPTIONS], default: 'top right', description: 'Edge or corner where the sticker starts peeling.' },
    { key: 'curl', label: 'Curl', type: 'slider', min: 0, max: 100, step: 1, default: 30, unit: '%' },
    { key: 'amount', label: 'Amount', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
    { key: 'backSide', label: 'Back Side', type: 'toggle', options: ['image', 'color'], default: 'color', description: 'Repeat the image or use a solid color on the reverse.' },
    { key: 'backColor', label: 'Back Color', type: 'color', default: '#000000', visibleWhen: { key: 'backSide', equals: 'color' } },
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
    const direction = localPeelDirection(v, rotation, seed, 45, true);
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
      peelDirection: direction,
      curl: active ? (v.curl / 100) * 1.45 * Math.sin(progress * Math.PI) : 0,
      scale: (v.cardSize / 150) * 650 / BASE,
      alpha: seconds < start + peelDuration ? 1 : 0,
      backfaceColor: stickerBackColor(v),
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
  // The return trip starts as soon as the last arrivals have settled. Movo
  // removes the stickers in reverse order over roughly the final 43% of the
  // clip; delaying this until 69% left far too many cards on-screen from 24s
  // onward and made the preset read as a static pile instead of a cycle.
  const exitStart = ctx.duration * 0.57 + (count - 1 - index) * ((ctx.duration * 0.40) / denominator);
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
    x, y, roll, peel, travel, seed,
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
    { key: 'peel', label: 'Peel', type: 'slider', min: 0, max: 90, step: 1, default: 0, unit: '°' },
    { key: 'peelFrom', label: 'Peel From', type: 'direction', options: [...PEEL_FROM_OPTIONS], default: 'top', description: 'Side where each sticker rolls into place.' },
    { key: 'angle', label: 'Angle', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
    { key: 'curl', label: 'Curl', type: 'slider', min: 0, max: 100, step: 1, default: 15, unit: '%' },
    { key: 'amount', label: 'Amount', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
    { key: 'backSide', label: 'Back Side', type: 'toggle', options: ['image', 'color'], default: 'image', description: 'Repeat the image or use a solid color on the reverse.' },
    { key: 'backColor', label: 'Back Color', type: 'color', default: '#000000', visibleWhen: { key: 'backSide', equals: 'color' } },
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
    // This direction belongs to the sticker itself. Keeping it in local card
    // space makes the default Top pose exactly the original X-axis roll and
    // lets a rotated sticker peel from its own selected edge.
    const direction = peelDirection(v, p.seed, 90);
    const radians = direction * Math.PI / 180;
    return {
      x: p.x, y: p.y, z: p.depth * 1.5,
      // The selected side defines the loose edge, so the rotation axis is
      // perpendicular to its direction. `top` reproduces Movo's original
      // X-axis roll; other choices rotate that same motion around the card.
      rotationX: Math.sin(radians) * p.roll,
      rotationY: -Math.cos(radians) * p.roll + p.peel,
      rotationZ: p.rotation,
      curl: p.curl, scale: p.scale, alpha: p.alpha,
      backfaceColor: stickerBackColor(v),
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
  // Movo holds the stack flat for the first/last quarter of the clip. The peel
  // itself occupies the middle half, with its deepest point at 6.5 seconds.
  const phase = clamp01(seconds / Math.max(0.001, ctx.duration));
  const rise = smooth((phase - 0.25) / 0.25);
  const fall = 1 - smooth((phase - 0.5) / 0.25);
  const progress = Math.min(rise, fall);
  const active = progress > 0.001;
  const layout = STICKER_PEEL_LAYOUT[index % STICKER_PEEL_LAYOUT.length];
  const spread = Number(v.spread ?? 0) / 37;
  const seed = ((index * 73 + 19) % 97) / 97;
  const amount = v.amount === 'random' ? 0.72 + seed * 0.56 : 1;
  const roll = Number(v.roll ?? 0);
  const rotation = (layout[2] / 21) * roll * Math.PI / 180;
  // Angle and Peel From are deliberately separate. Normal uses one chosen
  // edge for the whole composition (Sticker 02); Random applies the authored
  // per-card offsets (Sticker 03). The chosen edge rotates that pattern, so
  // the direction picker remains meaningful in both modes.
  const baseDirection = peelDirection(v, 0, 45);
  const direction = v.angle === 'random'
    ? (STICKER_PEEL_DIRECTIONS[index % STICKER_PEEL_DIRECTIONS.length]
      + baseDirection - 45 + 360) % 360
    : baseDirection;

  return {
    x: layout[0] * (ctx.width / 2) * spread,
    y: layout[1] * (ctx.height / 2) * spread,
    rotation,
    progress,
    active,
    amount,
    peelDirection: direction,
    scale: (Number(v.cardSize ?? 100) / 100) * (405 / BASE),
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
    { key: 'peel', label: 'Peel', type: 'slider', min: 0, max: 180, step: 1, default: 50, unit: '°' },
    { key: 'peelFrom', label: 'Peel From', type: 'direction', options: [...PEEL_FROM_OPTIONS], default: 'top right', description: 'Edge or corner where the sticker starts peeling.' },
    { key: 'angle', label: 'Angle', type: 'toggle', options: ['normal', 'random'], default: 'normal', description: 'Use the selected edge on every sticker or vary the edge per sticker.' },
    { key: 'curl', label: 'Curl', type: 'slider', min: 0, max: 100, step: 1, default: 15, unit: '%' },
    { key: 'amount', label: 'Amount', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
    { key: 'backSide', label: 'Back Side', type: 'toggle', options: ['image', 'color'], default: 'image', description: 'Repeat the image or use a solid color on the reverse.' },
    { key: 'backColor', label: 'Back Color', type: 'color', default: '#000000', visibleWhen: { key: 'backSide', equals: 'color' } },
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
      rotationX: Math.sin(p.peelDirection * Math.PI / 180) * Number(v.roll ?? 0) * Math.PI / 180 * p.progress * 0.35,
      rotationY: -Math.cos(p.peelDirection * Math.PI / 180) * Number(v.roll ?? 0) * Math.PI / 180 * p.progress * 0.35,
      rotationZ: p.rotation,
      cornerPeel: p.active ? p.progress * 0.32 * p.amount : 0,
      peelAngle: (90 + Number(v.peel ?? 50)) * Math.PI / 180,
      peelDirection: p.peelDirection,
      peelSoftness: 0.94,
      curl: p.active ? (Number(v.curl ?? 15) / 100) * 1.9 : 0,
      shadowStrength: p.active ? p.progress * 0.28 : 0,
      scale: p.scale,
      alpha: 1,
      backfaceColor: stickerBackColor(v),
    };
  },
};

export const stickerVariants: Template[] = [
  poster,
  variant(poster, 'poster-02', 'Poster 02', { peelFrom: 'bottom right', curl: 30 }),
  variant(poster, 'poster-03', 'Poster 03', { peelFrom: 'random', curl: 15 }),
  variant(poster, 'poster-04', 'Poster 04', { peelFrom: 'bottom', curl: 15 }),
  variant(poster, 'poster-05', 'Poster 05', { peelFrom: 'right', curl: 15 }),
  variant(poster, 'poster-06', 'Poster 06', { roll: 20, peelFrom: 'random', curl: 15, spread: 31 }),
  ...exactStickerVariants,
];
