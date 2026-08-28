import type { Template, TransformCtx } from '@/lib/types';
import { variant } from './variant';

const BASE = 340;
const DEG = Math.PI / 180;
const CAMERA_HALF_Y = Math.tan(45 * DEG / 2) * 4;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const DIRECTIONS = [
  'right', 'top right', 'top', 'top left',
  'left', 'bottom left', 'bottom', 'bottom right', 'random',
] as const;

const DIRECTION_DEGREES: Record<string, number> = {
  right: 0,
  'top right': 50,
  top: 90,
  'top left': 130,
  left: 180,
  'bottom left': 230,
  bottom: 270,
  'bottom right': 310,
};

const STICKER_01_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [-0.2413, 0.1746], [-0.308, -0.5092], [0.495, -0.345], [0.1262, -0.5419],
  [0.3905, -0.3543], [0.4049, 0.2363], [0.2818, 0.4595], [-0.1692, 0.5318],
  [-0.2816, 0.0702], [-0.2619, 0.3877], [-0.3444, 0.4613], [-0.2188, -0.2364],
  [0.1403, 0.1105], [0.5533, -0.1593], [-0.5183, 0.0609], [0.4869, -0.1958],
  [-0.2404, 0.3034],
];

const STICKER_03_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [-0.719, 0.4198], [-0.3705, -0.427], [0.6705, -0.0365], [-0.6865, -0.164],
  [0.4191, -0.6696], [0.2718, -0.7959], [0.5502, 0.6491], [-0.1556, 0.4717],
  [0.121, 0.2959],
];

function randomToken(value: unknown) {
  const text = String(value ?? '');
  const token = text.startsWith('random:') ? text.slice(7) : text === 'random' ? 'random' : '';
  const counter = Number.parseInt(token, 36);
  if (token && Number.isFinite(counter)) return counter >>> 0;
  let hash = 0;
  for (let i = 0; i < token.length; i++) hash = (hash * 33 + token.charCodeAt(i)) >>> 0;
  return hash;
}

// Same seeded generator and field order as the sticker engine. Keeping the
// order is important: roll, angle, pace and action are independent authored
// random values, not repeated uses of one ad-hoc index hash.
function rng(seed: number, index: number) {
  let state = (Math.imul(seed >>> 0, 2654435761) ^ Math.imul(index + 1, 40503)) >>> 0;
  const next = () => {
    state |= 0;
    let value = Math.imul((state = state + 1831565813 | 0) ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  return {
    roll: next(), angle: next(), pace: next(), action: next(),
    x: next(), y: next(), amount: next(), phase: next(), curl: next(),
  };
}

function ease(name: string, value: number) {
  const t = clamp01(value);
  const normalized = name.toLowerCase();
  if (normalized === 'linear') return t;
  if (normalized === 'smooth') {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  return 1 - Math.pow(1 - t, 3);
}

function triangle(phase: number, easing: string) {
  const p = phase - Math.floor(phase);
  return ease(easing, p < 0.5 ? 2 * p : 2 - 2 * p);
}

function direction(v: Record<string, any>, index: number, seed: number, fallback: number) {
  const from = String(v.peelFrom ?? '');
  const token = randomToken(from);
  const shiftedSeed = (seed ^ Math.imul(token, 2246822519)) >>> 0;
  const random = rng(shiftedSeed, index).angle;
  if (v.angle === 'random') return (random * 360 + (token % 360)) % 360;
  if (from === 'random' || from.startsWith('random:')) {
    const values = Object.values(DIRECTION_DEGREES);
    // The token is an incrementing reshuffle counter, so every click advances
    // to a different side. The card index fans a multi-sticker preset out.
    return values[(index + token) % values.length];
  }
  return DIRECTION_DEGREES[from] ?? fallback;
}

function reverseColor(v: Record<string, any>) {
  return String(v.backSide ?? 'color') === 'color'
    ? String(v.backColor ?? '#FFFFFF')
    : undefined;
}

function screenPosition(
  authored: readonly [number, number] | undefined,
  spread: number,
  authoredSpread: number,
  ctx: TransformCtx,
) {
  if (!authored || spread <= 0) return { x: 0, y: 0 };
  const unit = ctx.height / (2 * CAMERA_HALF_Y);
  const scale = spread / Math.max(0.001, authoredSpread);
  // Source coordinates are y-up; templates use canvas y-down.
  return { x: authored[0] * unit * scale, y: -authored[1] * unit * scale };
}

function cardScale(cardSize: number, ctx: TransformCtx) {
  const worldSize = Math.max(0.01, cardSize / 100);
  return (worldSize * ctx.height / (2 * CAMERA_HALF_Y)) / BASE;
}

type Schedule = {
  order: Record<number, number>;
  starts: number[];
  actions: number[];
  duration: number;
};

function schedule(count: number, travel: 'in' | 'out', seed: number, loopDuration: number): Schedule {
  const cards = Array.from({ length: Math.max(1, count) }, (_, index) => index)
    .filter((index) => index !== 0);
  cards.sort((a, b) => travel === 'out' ? b - a : a - b);
  const order: Record<number, number> = {};
  cards.forEach((card, index) => { order[card] = index; });

  // Sticker 01 is a two-position boomerang. With 17 cards, 36 seconds and a
  // one-second stagger, the shared motion model resolves a two-second action.
  const baseAction = Math.max(0.01, loopDuration / 2 - (Math.max(1, count) - 1));
  const starts: number[] = [];
  const actions: number[] = [];
  let duration = 0.001;
  for (let slot = 0; slot < cards.length; slot++) {
    const random = rng(seed, cards[slot]);
    actions[slot] = Math.max(0.001, baseAction * (0.5 + random.action));
    starts[slot] = slot === 0 ? 0 : starts[slot - 1] + (0.35 + 1.3 * random.pace);
    duration = Math.max(duration, starts[slot] + actions[slot]);
  }
  return { order, starts, actions, duration };
}

function transitionPose(frame: number, index: number, count: number, v: Record<string, any>, ctx: TransformCtx) {
  const firstSeed = 1;
  const secondSeed = (firstSeed ^ 2654435769) >>> 0;
  const incoming = schedule(count, 'in', firstSeed, ctx.duration);
  const outgoing = schedule(count, 'out', secondSeed, ctx.duration);
  const sceneDuration = incoming.duration + outgoing.duration;
  const clock = (frame / Math.max(1, ctx.totalFrames)) * sceneDuration;
  const second = clock >= incoming.duration;
  const current = second ? outgoing : incoming;
  const localClock = second ? clock - incoming.duration : clock;
  const travel = second ? 'out' : 'in';
  const activeSeed = second ? secondSeed : firstSeed;
  const authored = STICKER_01_POSITIONS[index % STICKER_01_POSITIONS.length];
  const pos = screenPosition(authored, Number(v.spread ?? 42), 42, ctx);
  const random = rng(firstSeed, index);
  const worldSize = Math.max(0.01, Number(v.cardSize ?? 50) / 100);
  const peelDirection = direction(v, index, activeSeed, 0);
  const radians = peelDirection * DEG;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const maxProjection = worldSize * (Math.abs(dx) + Math.abs(dy)) / 2;
  const curlWorld = Math.max(0.0001, Number(v.curl ?? 15) / 100);
  let motion = 0;

  // Base Card keeps index 0 stuck while the other sixteen roll in and back out.
  if (index !== 0) {
    const slot = current.order[index];
    const progress = clamp01((localClock - current.starts[slot]) / current.actions[slot]);
    motion = travel === 'out' ? ease('Natural', progress) : ease('Natural', 1 - progress);
  }

  const aspect = Math.max(0.0001, ctx.width / ctx.height);
  const halfX = CAMERA_HALF_Y * aspect;
  const offscreen = -(Math.abs(halfX * dx) + Math.abs(CAMERA_HALF_Y * dy) + 2 * curlWorld + 0.15)
    - (authored[0] * dx + authored[1] * dy);
  const frontWorld = maxProjection + (offscreen - maxProjection) * motion;

  return {
    x: pos.x,
    y: pos.y,
    z: index * 0.0025,
    rotation: (2 * random.roll - 1) * Number(v.roll ?? 90) * DEG,
    direction: peelDirection,
    front: frontWorld / worldSize,
    radius: curlWorld / worldSize,
    scale: cardScale(Number(v.cardSize ?? 50), ctx),
  };
}

function idlePose(frame: number, index: number, v: Record<string, any>, ctx: TransformCtx) {
  const random = rng(1, index);
  const phase = frame / Math.max(1, ctx.totalFrames);
  const pulse = triangle(phase, 'smooth');
  const cardSize = Number(v.cardSize ?? 100);
  const worldSize = Math.max(0.01, cardSize / 100);
  const peelDirection = direction(v, index, 1, 50);
  const radians = peelDirection * DEG;
  const maxProjection = worldSize
    * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians))) / 2;
  const curlWorld = Math.max(0.0001, Number(v.curl ?? 15) / 100);
  const fixedAmount = Math.max(0, Number(v.peelAmount ?? 30) / 100);
  const amount = v.amount === 'random'
    ? 0.15 + (Math.max(0.15, fixedAmount) - 0.15) * Math.pow(random.amount, 0.35)
    : fixedAmount;
  const frontWorld = maxProjection
    + (-maxProjection - Math.PI * curlWorld - maxProjection) * amount * pulse;
  const spread = Number(v.spread ?? 0);
  const authored = STICKER_03_POSITIONS[index % STICKER_03_POSITIONS.length];
  const pos = screenPosition(authored, spread, 37, ctx);

  return {
    x: pos.x,
    y: pos.y,
    z: index * 0.0025,
    rotation: (2 * random.roll - 1) * Number(v.roll ?? 0) * DEG,
    direction: peelDirection,
    front: frontWorld / worldSize,
    radius: curlWorld / worldSize,
    scale: cardScale(cardSize, ctx),
  };
}

const sharedControls: Template['controls'] = [
  { key: 'count', label: 'Count', type: 'slider', min: 1, max: 30, step: 1, default: 1 },
  { key: 'cardSize', label: 'Size', type: 'slider', min: 20, max: 120, step: 1, default: 100 },
  { key: 'cornerRadius', label: 'Corner', type: 'slider', min: 0, max: 50, step: 1, default: 20, unit: '%' },
  { key: 'roll', label: 'Roll', type: 'slider', min: 0, max: 180, step: 1, default: 0, unit: '°' },
  { key: 'peelFrom', label: 'Peel From', type: 'direction', options: [...DIRECTIONS], default: 'top right', description: 'Choose the edge or corner where the sticker starts to detach.' },
  { key: 'angle', label: 'Angle', type: 'toggle', options: ['normal', 'random'], default: 'normal', description: 'Normal uses the selected side; Random gives each sticker its own direction.' },
  { key: 'peelAmount', label: 'Peel', type: 'slider', min: 0, max: 100, step: 1, default: 30, unit: '%' },
  { key: 'curl', label: 'Curl', type: 'slider', min: 1, max: 100, step: 1, default: 15, unit: '%' },
  { key: 'amount', label: 'Amount', type: 'toggle', options: ['normal', 'random'], default: 'normal' },
  { key: 'backSide', label: 'Back Side', type: 'toggle', options: ['image', 'color'], default: 'color', description: 'The color is rendered on the reverse, behind the image.' },
  { key: 'backColor', label: 'Back Color', type: 'color', default: '#FFFFFF', visibleWhen: { key: 'backSide', equals: 'color' } },
  { key: 'stroke', label: 'Stroke', type: 'slider', min: 0, max: 30, step: 1, default: 0 },
  { key: 'spread', label: 'Spread', type: 'slider', min: 0, max: 100, step: 1, default: 0, unit: '%' },
  { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 200, step: 1, default: 125, advanced: true },
];

const sticker01: Template = {
  meta: {
    id: 'stickers-01', name: 'Stickers 01', group: 'Stickers', repeatAssets: true,
    engine: 'webgl', cardAspect: 1, isNew: true,
    defaultEasing: { id: 'custom', bezier: [0.8, 0, 0.2, 1] },
  },
  controls: sharedControls.map((control) => {
    const defaults: Record<string, any> = {
      count: 17, cardSize: 50, roll: 90, peelFrom: 'right', angle: 'normal',
      curl: 15, backSide: 'color', backColor: '#FFFFFF', spread: 42,
    };
    return defaults[control.key] !== undefined ? { ...control, default: defaults[control.key] } : control;
  }),
  transform: (frame, index, count, v, ctx) => {
    const pose = transitionPose(frame, index, count, v, ctx);
    return { x: pose.x, y: pose.y, rotation: pose.rotation, scale: pose.scale, alpha: 1, depth: pose.z };
  },
  transform3d: (frame, index, count, v, ctx) => {
    const pose = transitionPose(frame, index, count, v, ctx);
    return {
      x: pose.x, y: pose.y, z: pose.z,
      rotationX: 0, rotationY: 0, rotationZ: pose.rotation,
      stickerPeelFront: pose.front,
      stickerCurlRadius: pose.radius,
      peelDirection: pose.direction,
      scale: pose.scale, alpha: 1,
      backfaceColor: reverseColor(v),
    };
  },
};

const sticker02: Template = {
  meta: {
    id: 'stickers-02', name: 'Stickers 02', group: 'Stickers', repeatAssets: true,
    engine: 'webgl', cardAspect: 1, isNew: true, defaultEasing: { id: 'smooth' },
  },
  controls: sharedControls,
  transform: (frame, index, _count, v, ctx) => {
    const pose = idlePose(frame, index, v, ctx);
    return { x: pose.x, y: pose.y, rotation: pose.rotation, scale: pose.scale, alpha: 1, depth: pose.z };
  },
  transform3d: (frame, index, _count, v, ctx) => {
    const pose = idlePose(frame, index, v, ctx);
    return {
      x: pose.x, y: pose.y, z: pose.z,
      rotationX: 0, rotationY: 0, rotationZ: pose.rotation,
      stickerPeelFront: pose.front,
      stickerCurlRadius: pose.radius,
      peelDirection: pose.direction,
      scale: pose.scale, alpha: 1,
      backfaceColor: reverseColor(v),
    };
  },
};

export const exactStickerVariants: Template[] = [
  sticker01,
  sticker02,
  variant(sticker02, 'stickers-03', 'Stickers 03', {
    count: 9, roll: 21, peelFrom: 'top right', angle: 'random', spread: 37,
  }),
];
