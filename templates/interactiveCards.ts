import type { Template } from '@/lib/types';
import { TAU, clamp, frac, lerp, loopCycles } from '@/lib/motion';
import {
  DEG,
  backfaceFade,
  quaternionFromEuler,
  wrapEnvelope,
} from '@/lib/tilt3d';
import { variant } from './variant';

const BASE = 340;

// Faithful Motion Studio adaptation of vogelino/three-interactive-cards:
// - 13 curved image segments form every ring;
// - rings are stacked vertically;
// - each ring starts 20 degrees after the previous one;
// - neighbouring rings counter-rotate;
// - the camera sits inside the cylinder and travels through the stack.
//
// The reference drives these values from pointer momentum. A video template has
// no live pointer during export, so the same offsets are advanced by a seamless
// timeline. All geometry and proportions otherwise follow the original model.
function ringPose(
  frame: number,
  index: number,
  count: number,
  v: Record<string, any>,
  ctx: { width: number; height: number; duration: number; totalFrames: number; cardAspect?: number },
) {
  const cardsPerRing = Math.max(4, Math.min(count, Math.round(v.cardsPerRing ?? 13)));
  const ringCount = Math.max(1, Math.ceil(count / cardsPerRing));
  const ring = Math.floor(index / cardsPerRing);
  const card = index % cardsPerRing;
  const cardsHere = Math.min(cardsPerRing, count - ring * cardsPerRing);
  const direction = v.direction === 'reverse' ? -1 : 1;

  const stage = Math.min(ctx.width, ctx.height);
  const cardPx = stage * clamp(v.cardSize / 100, 0.08, 0.55);
  const aspect = Math.max(0.05, ctx.cardAspect ?? 1);
  const cardWidth = cardPx * Math.min(1, aspect);
  const cardHeight = cardPx * Math.min(1, 1 / aspect);

  // Card Size owns the layout. Arc Coverage is the share of one angular slot
  // the card may occupy; when a larger card would collide with its neighbours,
  // the cylinder expands instead of silently clamping the card back down.
  const coverage = clamp(v.arcCoverage / 100, 0.15, 0.95);
  const requestedRadius = stage * clamp(v.radius / 100, 0.28, 1.4);
  const collisionSafeRadius = (cardWidth * Math.max(4, cardsHere)) / (TAU * coverage);
  const radius = Math.max(requestedRadius, collisionSafeRadius);

  // Ring Gap is an edge gap measured as a percentage of the real card height.
  // This keeps the vertical rhythm identical across square, portrait and
  // landscape cards while Card Size changes.
  const rowPitch = cardHeight * (1 + clamp((v.ringGap ?? 12) / 100, 0, 2));

  // In the source, vertical drag both moves the camera through the stack and
  // turns every other ring in the opposite direction. `loopCycles` makes the
  // exported clip return to the exact first pose.
  const travelUnits = loopCycles(v.travelSpeed, ctx.duration, ringCount) * direction;
  const travel = (frame / ctx.totalFrames) * travelUnits;
  const ring01 = ringCount > 1 ? frac(ring / ringCount - travel / ringCount) : 0.5;
  const verticalSpan = Math.max(1, ringCount * rowPitch);
  const y = (ring01 - 0.5) * verticalSpan;
  const verticalAlpha = ringCount > 1
    ? wrapEnvelope(ring01, Math.min(0.12, 0.7 / ringCount))
    : 1;

  const oddSign = v.alternate === 'on' && ring % 2 === 1 ? -1 : 1;
  const ringOffset = ring * Number(v.angleOffset) * DEG;
  const dragRotation = travel * Number(v.dragRotation) * DEG * oddSign;

  // The source rotates the camera boom horizontally. Rotating every ring by the
  // inverse angle is the same relative motion while keeping one shared camera.
  const lookUnits = loopCycles(v.lookSpeed, ctx.duration, cardsPerRing) * direction;
  const look = (frame / ctx.totalFrames) * lookUnits * TAU / cardsPerRing;
  const angle = TAU * card / Math.max(1, cardsHere) + ringOffset + dragRotation - look;

  const x = Math.sin(angle) * radius;
  const z = Math.cos(angle) * radius;

  // Match the card surface to the cylinder instead of applying an arbitrary
  // bend. The sagitta of a chord gives the exact normalized curve; Curve Match
  // lets the user fade that physical match out or exaggerate it.
  const halfChord = Math.min(cardWidth / 2, radius * 0.999);
  const sagitta = radius - Math.sqrt(Math.max(0, radius * radius - halfChord * halfChord));
  const bend = clamp((sagitta / Math.max(1, cardWidth)) * (v.cardBend / 100), 0, 0.45);

  // Cards face inward toward the camera at the cylinder centre. A PlaneGeometry
  // starts facing +Z, hence radial angle + PI.
  const inwardAngle = angle + Math.PI;
  const inwardNormalZ = -Math.cos(angle);
  const nearness = clamp((-z / Math.max(1, radius) + 1) / 2, 0, 1);

  return {
    x,
    y,
    z,
    angle,
    quaternion: quaternionFromEuler(0, inwardAngle, 0),
    cardPx,
    bend,
    alpha: verticalAlpha * backfaceFade(inwardNormalZ, v.backFade),
    nearness,
  };
}

const interactiveCards: Template = {
  meta: {
    id: 'interactive-cards-01',
    name: 'Interactive Cards',
    group: 'Interactive Cards',
    engine: 'webgl',
    repeatAssets: true,
    cardAspect: 1,
    defaultEasing: { id: 'linear' },
  },
  controls: [
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward', 'reverse'], default: 'forward', section: 'Motion' },
    { key: 'alternate', label: 'Alternate Rings', type: 'toggle', options: ['on', 'off'], default: 'on', section: 'Motion' },
    { key: 'count', label: 'Card Count', type: 'slider', min: 26, max: 260, step: 13, default: 130, section: 'Layout', description: 'The reference uses 13 cards per ring. 130 cards create 10 stacked rings.' },
    { key: 'cardsPerRing', label: 'Cards / Ring', type: 'slider', min: 4, max: 20, step: 1, default: 13, section: 'Layout', advanced: true },
    { key: 'radius', label: 'Cylinder Radius', type: 'slider', min: 28, max: 140, step: 1, default: 68, section: 'Layout', unit: '%' },
    { key: 'cardSize', label: 'Card Size', type: 'slider', min: 8, max: 55, step: 1, default: 27, section: 'Layout', unit: '%', description: 'Sets the real long edge. The cylinder and row spacing adapt automatically to prevent collisions.' },
    { key: 'arcCoverage', label: 'Arc Coverage', type: 'slider', min: 15, max: 95, step: 1, default: 70, section: 'Layout', unit: '%', description: 'How much of each angular slot a card may fill. Larger cards expand the cylinder when needed.' },
    { key: 'ringGap', label: 'Ring Gap', type: 'slider', min: 0, max: 200, step: 2, default: 12, section: 'Layout', unit: '%', description: 'Edge gap relative to the resolved card height, so it stays proportional at every Card Size.' },
    { key: 'angleOffset', label: 'Ring Angle Offset', type: 'slider', min: -45, max: 45, step: 1, default: 20, section: 'Depth', unit: '°', description: 'The original repository offsets every ring by 20 degrees.' },
    { key: 'dragRotation', label: 'Drag Rotation', type: 'slider', min: 0, max: 30, step: 1, default: 10, section: 'Motion', unit: '°' },
    { key: 'travelSpeed', label: 'Vertical Travel', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.28, section: 'Motion', unit: '×', precision: 1 },
    { key: 'lookSpeed', label: 'Horizontal Look', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.18, section: 'Motion', unit: '×', precision: 1 },
    { key: 'perspective', label: 'Camera FOV', type: 'slider', min: 35, max: 110, step: 1, default: 75, section: 'Depth', unit: '°' },
    { key: 'cardBend', label: 'Curve Match', type: 'slider', min: 0, max: 200, step: 5, default: 100, section: 'Depth', unit: '%', description: '100% matches the card surface to the current cylinder radius.' },
    { key: 'backFade', label: 'Rear Fade', type: 'slider', min: 0, max: 95, step: 5, default: 25, section: 'Finish', unit: '%' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 18, step: 0.5, default: 0, section: 'Finish', unit: '%', precision: 1 },
    { key: 'brightness', label: 'Brightness', type: 'slider', min: 60, max: 140, step: 1, default: 100, section: 'Finish', unit: '%' },
    { key: 'offset', label: 'Offset', type: 'xypad', default: { x: 0, y: 0 }, section: 'Layout', advanced: true },
  ],
  camera: (v) => ({
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: -1 },
    fov: clamp(v.perspective, 35, 110),
    near: 1,
    far: 6000,
  }),
  transform3d: (frame, index, count, v, ctx) => {
    const g = ringPose(frame, index, count, v, ctx);
    return {
      x: g.x + v.offset.x,
      y: g.y + v.offset.y,
      z: g.z,
      quaternion: g.quaternion,
      scale: g.cardPx / BASE,
      alpha: g.alpha,
      bend: g.bend,
      thickness: 0,
      shadowStrength: 0,
      materialExposure: (v.brightness / 100) * lerp(0.86, 1.08, g.nearness),
    };
  },
  // Orthographic thumbnail of the same inside-cylinder composition.
  transform: (frame, index, count, v, ctx) => {
    const g = ringPose(frame, index, count, v, ctx);
    const projection = lerp(0.45, 1.15, g.nearness);
    return {
      x: g.x + v.offset.x,
      y: g.y + v.offset.y,
      scale: (g.cardPx / BASE) * projection,
      rotation: 0,
      alpha: g.alpha,
      depth: -g.z,
    };
  },
};

// Variations stay within the reference effect instead of inventing unrelated
// layouts: they only change density, momentum and the original alternating mode.
export const interactiveCardsVariants: Template[] = [
  interactiveCards,
  variant(interactiveCards, 'interactive-cards-02', 'Interactive Cards Dense', {
    count: 182,
    radius: 76,
    cardSize: 24,
    arcCoverage: 82,
    ringGap: 4,
    travelSpeed: 0.42,
    lookSpeed: 0.22,
    dragRotation: 12,
  }),
  variant(interactiveCards, 'interactive-cards-03', 'Interactive Cards Sync', {
    count: 104,
    alternate: 'off',
    radius: 62,
    cardSize: 30,
    arcCoverage: 58,
    ringGap: 32,
    angleOffset: 20,
    travelSpeed: 0.2,
    lookSpeed: 0.3,
    dragRotation: 8,
  }),
];
