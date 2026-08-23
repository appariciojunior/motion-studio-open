import type { Template } from '@/lib/types';
import { clamp } from '@/lib/motion';
import { variant } from './variant';
import { flatFallback, refCamera, refDepthDim, refFocal, refScale, mulQuat, eulerQuat, type Quat } from './refScene3d';

const BASE = 340;
const DEG = Math.PI / 180;

// ============================================================
//  DECK 04-15 — the reference's own twelve, on its own arithmetic
//
//  Our Deck 01-03 is the same mechanic reconstructed by eye: a stack of cards
//  travelling through the centre, each turning over as it goes. These are its
//  twelve presets on its numbers, and they need three things ours does not
//  express, so they ship as their own file rather than as extra defaults on it.
//
//  What the reference actually does, read out of `applyCardflipFrame`:
//
//  · The turn is a LOOKUP, not a curve: a card `d` slots from the middle has
//    turned 0, 110, 187, 280 then 360 degrees at d = 0, 1, 2, 3, 4, linearly
//    interpolated between. So it whips through its first half-turn and then
//    creeps — nothing about a cosine or an ease produces that shape.
//  · Only the middle band scales up and rolls. `maxScale` and `tilt` are
//    windowed to |d| < 1 and fall off linearly, so the card at the front is the
//    only one that grows.
//  · A card is dropped past 3.2 slots out, and the slot count is bumped up to
//    at least seven — a six-card deck runs twelve slots, two laps of its six
//    images — so the band is always full.
//  · Slot pitch is a share of the FRAME, not of the card: `gap` 0.29 means a
//    card lands 29% of the frame from its neighbour whatever size it is.
//  · Two-sided is two different images, not one mirrored. A pose carries one
//    texture, so each slot is two layers here — front and back at the same
//    place, each drawn only while it faces the camera. That is also why the
//    layer count is twice the slot count.
// ============================================================

/** The reference's turn table: degrees turned at 0, 1, 2, 3 and 4 slots out. */
const TURN_LUT = [0, 110, 187, 280, 360];
/** How far out a card survives, in slots. */
const BAND = 3.2;

function turnDegrees(d: number): number {
  const t = Math.min(d, TURN_LUT.length - 1);
  const i = Math.floor(t);
  const a = TURN_LUT[i];
  const b = TURN_LUT[Math.min(i + 1, TURN_LUT.length - 1)];
  return a + (b - a) * (t - i);
}

/** Its slot count: at least seven, reached by repeating the image pool. */
function slotCount(count: number): number {
  const c = clamp(Math.round(count), 2, 30);
  return c >= 7 ? c : Math.min(100, c * Math.ceil(7 / c));
}

function deckPose(
  frame: number, index: number, v: Record<string, any>,
  ctx: { width: number; height: number; duration: number; totalFrames: number; cardAspect?: number; ease: (t: number) => number },
) {
  const slots = slotCount(v.count);
  const twoSided = v.twoSided !== 'off';
  const slot = twoSided ? Math.floor(index / 2) : index;
  const isBack = twoSided && index % 2 === 1;

  const gone = { x: 0, y: 0, z: 0, quat: { x: 0, y: 0, z: 0, w: 1 } as Quat, scale: 0, project: 1, alpha: 0, dim: 0, depth: -1 };
  if (slot >= slots) return gone;

  const k = refScale(ctx.height);
  const horizontal = v.direction === 'left' || v.direction === 'right';
  const dir = (v.direction === 'down' || v.direction === 'right') ? -1 : 1;
  const flipHorizontal = v.flipAxis === 'horizontal';

  // One step per slot, `cycles * groups` of them in a clip, each with the
  // scene curve inside it and `delay` of rest after it.
  const groups = Math.max(1, Math.min(slots, Math.round(v.count)));
  const steps = Math.max(1, Math.max(0.25, v.cycles) * groups);
  const stepTime = Math.max(0.5, ctx.duration) / steps;
  const span = stepTime + Math.max(0, v.delay);
  const t = (frame / Math.max(1, ctx.totalFrames)) % 1 * Math.max(0.5, ctx.duration);
  const whole = Math.floor(t / span);
  const advance = whole + ctx.ease(clamp((t - whole * span) / stepTime, 0, 1));

  // This slot's signed distance from the middle, unwrapped to the near side.
  const head = ((advance * dir) % slots + slots) % slots;
  let s = slot;
  while (s - head > slots / 2) s -= slots;
  while (s - head < -slots / 2) s += slots;
  const d = s - head;
  if (Math.abs(d) > BAND) return gone;
  if (v.solo === 'on' && slot !== ((Math.round(head) % slots) + slots) % slots) return gone;

  const turn = Math.sign(d) * turnDegrees(Math.abs(d)) * DEG;
  // Only the middle band grows and rolls, and it falls off straight.
  const inBand = d > -1 && d <= 1;
  const peak = d <= 0 ? 1 + d : 1 - d;
  const roll = inBand ? v.tilt * peak * DEG : 0;
  const bump = inBand ? 1 + (v.maxScale - 1) * peak : 1;

  // Each face exists only while it points at the camera.
  if (twoSided && (Math.cos(turn) >= 0) === isBack) return gone;

  const pitch = v.gap * (horizontal ? ctx.width : ctx.height);
  const worldZ = -Math.abs(d) * 3 * k;

  // Its rotation order here is ZXY, so the roll is applied outside the turn.
  const quat = mulQuat(
    eulerQuat(0, 0, roll),
    flipHorizontal ? eulerQuat(0, turn, 0) : eulerQuat(turn, 0, 0),
  );

  const aspect = Math.max(0.05, ctx.cardAspect ?? 3 / 4);
  const scale = (v.planeSize * bump * k) / (BASE * aspect);
  const camZ = Math.abs(v.distance);
  const depth = Math.max(1, camZ - worldZ / k);

  return {
    x: horizontal ? d * pitch : 0,
    y: horizontal ? 0 : -d * pitch,
    z: worldZ,
    quat,
    scale,
    project: refFocal('ring3d', v.perspective, ctx.height) / depth,
    alpha: 1,
    dim: refDepthDim(v.fade, Math.min(1, Math.abs(d) / BAND)),
    depth: -Math.abs(d),
  };
}

const deckRef: Template = {
  meta: {
    id: 'deck-r01', name: 'Deck 04', group: 'Deck', engine: 'webgl', isNew: true,
    defaultEasing: { id: 'custom', bezier: [0.86, 0.14, 0.14, 0.86] },
    cardAspect: 3 / 4, repeatAssets: true,
  },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'pills',  options: ['up','down','left','right'],  default: 'up', section: 'Motion' },
    { key: 'flipAxis',     label: 'Flip Axis',     type: 'pills',  options: ['vertical','horizontal'],     default: 'vertical', section: 'Motion' },
    { key: 'twoSided',     label: 'Two Sided',     type: 'toggle', options: ['on','off'],                  default: 'on', section: 'Layout', description: 'A card’s reverse is the next image, not a mirror of its front.' },
    { key: 'solo',         label: 'Solo',          type: 'toggle', options: ['off','on'],                  default: 'off', section: 'Layout', description: 'Show only the card in the middle.' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 30, step: 1,               default: 6 },
    { key: 'planeSize',    label: 'Plane Size',    type: 'slider', min: 50, max: 2000, step: 5,            default: 320, section: 'Layout' },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0.1, max: 0.5, step: 0.01,         default: 0.29, precision: 2, section: 'Layout', description: 'Slot pitch as a share of the frame.' },
    { key: 'maxScale',     label: 'Max Scale',     type: 'slider', min: 1, max: 2, step: 0.01,             default: 1.15, unit: '×', precision: 2, section: 'Layout', description: 'How much the card in the middle grows.' },
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: -30, max: 30, step: 0.5,           default: 4.5, unit: '°', precision: 1, section: 'Layout' },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,              default: 0, unit: '%', section: 'Depth' },
    { key: 'distance',     label: 'Distance',      type: 'slider', min: 200, max: 5000, step: 10,          default: 1000, section: 'Depth' },
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 10, max: 300, step: 5,             default: 100, section: 'Depth' },
    { key: 'cycles',       label: 'Cycles',        type: 'slider', min: 0.25, max: 4, step: 0.25,          default: 1, section: 'Motion' },
    { key: 'delay',        label: 'Hold',          type: 'slider', min: 0, max: 2, step: 0.05,             default: 0, unit: 's', precision: 2, section: 'Motion' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 200, step: 1,              default: 16 },
  ],

  layerCount: (v) => (v.twoSided !== 'off' ? 2 : 1) * slotCount(v.count),

  transform: (frame, index, count, v, ctx) => flatFallback(deckPose(frame, index, v, ctx), ctx, BASE),

  transform3d: (frame, index, count, v, ctx) => {
    const p = deckPose(frame, index, v, ctx);
    return { x: p.x, y: p.y, z: p.z, quaternion: p.quat, scale: p.scale, alpha: p.alpha, dim: p.dim };
  },

  camera: (v, ctx) => refCamera('ring3d', v.perspective, v.distance, ctx.height),
};

const E86 = { id: 'custom' as const, bezier: [0.86, 0.14, 0.14, 0.86] as [number, number, number, number] };
const E33 = { id: 'custom' as const, bezier: [0.33, 0, 0, 1] as [number, number, number, number] };
const LIN = { id: 'linear' as const };

// Its twelve, off its own `paramsPerModeBaseline` on 2026-08-23, renumbered so
// they sit after our Deck 01-03 instead of colliding with them. Every one of
// them runs count 6, cornerRadius 16 and no hold. Clip lengths are pinned in
// store/useSceneStore, since the step is duration/(cycles * count).
export const deckRefVariants: Template[] = [
  deckRef, // its Deck 01 — up, vertical flip, gap 0.29, tilt 4.5, 7s
  variant(deckRef, 'deck-r02', 'Deck 05', {
    direction: 'down', gap: 0.44, tilt: 0, planeSize: 375,
  }, E33),
  variant(deckRef, 'deck-r03', 'Deck 06', {
    gap: 0.44, tilt: 0, fade: 30, distance: 4130, maxScale: 1, planeSize: 445, perspective: 40,
  }, E33),
  variant(deckRef, 'deck-r04', 'Deck 07', {
    flipAxis: 'horizontal', gap: 0.37, planeSize: 320, perspective: 85,
  }, E86),
  variant(deckRef, 'deck-r05', 'Deck 08', {
    direction: 'down', flipAxis: 'horizontal', gap: 0.32, tilt: 0, perspective: 85,
  }, LIN),
  variant(deckRef, 'deck-r06', 'Deck 09', {
    direction: 'left', gap: 0.43, tilt: 0, distance: 860,
  }, E86),
  variant(deckRef, 'deck-r07', 'Deck 10', {
    direction: 'left', flipAxis: 'horizontal', gap: 0.38, tilt: 0, distance: 860, planeSize: 330,
  }, E86),
  variant(deckRef, 'deck-r08', 'Deck 11', {
    direction: 'left', flipAxis: 'horizontal', gap: 0.4, tilt: -8, fade: 30,
    distance: 1450, maxScale: 1.21, planeSize: 330,
  }, E33),
  variant(deckRef, 'deck-r09', 'Deck 12', {
    flipAxis: 'horizontal', gap: 0.5, tilt: 0, solo: 'on', twoSided: 'off',
    distance: 1090, planeSize: 500,
  }, E86),
  variant(deckRef, 'deck-r10', 'Deck 13', {
    direction: 'left', gap: 0.5, tilt: 0, solo: 'on', twoSided: 'off',
    distance: 1090, planeSize: 500,
  }, E86),
  variant(deckRef, 'deck-r11', 'Deck 14', {
    direction: 'down', gap: 0.5, tilt: 0, solo: 'on', twoSided: 'off',
    distance: 1090, planeSize: 500,
  }, E86),
  variant(deckRef, 'deck-r12', 'Deck 15', {
    direction: 'right', flipAxis: 'horizontal', gap: 0.5, tilt: 0, solo: 'on',
    twoSided: 'off', distance: 1090, planeSize: 500,
  }, E86),
];
