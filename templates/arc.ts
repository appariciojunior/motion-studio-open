import type { LayerTransform, Template, TransformCtx } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { TAU, clamp } from '@/lib/motion';
import { DEG } from '@/lib/tilt3d';
import { variant } from './variant';

// ---------------------------------------------------------------------------
//  The reference tool's Arc, TRANSCRIBED — module 41034 (ARC_FOV, ARC_REF_CARD,
//  applyCamera, computeFrame, slotCount) plus the shared motion helpers in
//  70418 (motionFromParams, effectivePauseSec, roundsPerLoop) and 88461
//  (computeProgress, staggerOrder, mediaIndexOf).
//
//  It is a separate engine from the ring in templates/orbit3d.ts, and it lives
//  in the reference's WHEEL category rather than its Orbit one — "Wheel — Arc",
//  three presets. Worth saying because its explorer lists them next to each
//  other and a DOM sweep of preset names cannot tell the two apart.
//
//  The mechanic: the cards are glued to the rim of a very large wheel — radius
//  1250 to 2400 units against a card 500 tall — and the frame looks at the
//  CREST of it. So they ride over a shallow hill, leaning as they go, and the
//  one at the top is square to the viewer. Nothing here has depth: every card
//  sits at z = 0 and its perspective camera only sets the scale, which is why
//  this is a flat template while the ring is a 3D one.
//
//  Its Gap is an ANGLE, not a distance. The whole sweep the cards occupy walks
//  from 55 to 105 degrees as Gap goes 4 to 80, divided by the count — so at the
//  authored Gap 20 with 8 cards the pitch is 16.38 degrees, which on a radius
//  of 1250 is 357 units of arc, and the card is 500 x 0.714 = 357 wide. They
//  touch exactly. That coincidence is the check that the reading is right.
// ---------------------------------------------------------------------------

const BASE = 340;

// ARC_FOV / ARC_REF_CARD, and its normalizing constant. The lens cancels out of
// the framing exactly as it does in the ring and the belt: the frame's
// half-height at z=0 comes out as ARC_REF_CARD/200 * distance = 1.75 * distance
// for any fov, which is why its Size control changes scale and nothing else.
const ARC_FOV = 35;
const ARC_REF_CARD = 350;
const FRAME_PER_DISTANCE = ARC_REF_CARD / 200;

// Its own default `distance`, and every one of the three presets ships it, so
// Zoom 100% here IS the authored framing. Their own panel reads 75% for the
// same value — its displayInvert base for this family is 306, not the family
// default — so do not "fix" this to agree with their label: the number that
// matters is the distance, and the live camera confirms 408 (z 2264.519 =
// 350/(200·tan(17.5°)) × 408, to three decimals).
const REF_DISTANCE = 408;

// NOTE — and this is where the arc differs from the ring: there is NO artboard
// crop here. The ring's stage draws into a square canvas sized to the browser
// window with the artboard as a CSS window onto it (see BOARD_CROP in
// templates/orbit3d.ts). The arc's own renderer sizes its canvas to the
// artboard: the live camera comes back with aspect 0.7995 against its 4:5
// board, where every ring capture came back square. Measured, not assumed —
// and the photograph agrees: its card is 500 units on a frame half-height of
// 1.75 × 408 = 714, which is 0.35 of the frame, and that is what its stage
// shows (.shots/ref-stage-arc-01.png). With the ring's crop applied it would
// be 0.75 and fill the board.

// Its sweep bounds: Gap 4..80 walks the total angle the cards occupy from 55 to
// 105 degrees. Values below 4 clamp, which is why Gap 0 and Gap 4 look alike.
const SWEEP_MIN = 55;
const SWEEP_MAX = 105;
// Past this angle from the crest a card is not drawn at all.
const VISIBLE_LIMIT = 170 * DEG;
// The wheel's own radius, clamped as its w() does.
const RADIUS_MIN = 600;
const RADIUS_MAX = 2400;

const num = (value: any, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const pick = (value: any, fallback: string) => (typeof value === 'string' ? value : fallback);

function cardAspectOf(ctx: TransformCtx) {
  return Math.max(0.05, num(ctx.cardAspect, 5 / 7));
}

function refDistance(v: Record<string, any>) {
  return (REF_DISTANCE * 100) / clamp(num(v.zoom, 100), 5, 1000);
}

// Preview px per reference unit. Its frame's half-height at z=0 is
// ARC_REF_CARD/200 × distance for any lens, and the canvas IS that frame.
function unitScale(v: Record<string, any>, ctx: TransformCtx) {
  return ctx.height / 2 / (FRAME_PER_DISTANCE * refDistance(v));
}

// The angle from one card to the next.
function pitchOf(v: Record<string, any>, count: number) {
  const gap = clamp(num(v.gap, 20), 4, 80);
  const sweep = SWEEP_MIN + ((gap - 4) / 76) * (SWEEP_MAX - SWEEP_MIN);
  return (2 * sweep * DEG) / Math.max(1, count);
}

// The panel states this as a DIAMETER, twice the wheel's radius — the same
// displayScale 2 its Orbit panel uses for the ring. Its slider runs 2500..5000
// there; the maths clamps the radius to 600..2400, so the top of the slider is
// where it stops moving.
function radiusOf(v: Record<string, any>) {
  return clamp(num(v.diameter, 2500) / 2, RADIUS_MIN, RADIUS_MAX);
}

// ---------------------------------------------------------------------------
//  Motion
//
//  Both modes deal ONE PITCH per step and shape that step with the scene curve.
//  What differs is how many steps a clip holds and what happens at the end of
//  each:
//
//    normal      `count` steps, each advancing the belt by a pitch, so a card
//                that leaves one end re-enters at the other and the clip closes
//                on every card back at its own start
//    boomerang   TWO steps: the belt swings one pitch forward and then all the
//                way back, which is what makes its Arc 01 read as a card
//                arriving, settling and leaving the way it came
//
//  Stagger delays each card by where it sits along the arc rather than by which
//  card it is, so the advance ripples across the row. Its own staggerOrder
//  counts from one end (Push) or the other (Pull), and flips with Direction.
//
//  Pause and Stagger stay in SECONDS here, as the reference states them, and
//  the step length follows the clip: (duration / steps) - pause - stagger is
//  the time a card actually spends moving.
// ---------------------------------------------------------------------------

function stepsPerLoop(v: Record<string, any>, count: number) {
  return pick(v.movement, 'boomerang') === 'boomerang' ? 2 : Math.max(1, count);
}

function motionOf(v: Record<string, any>, count: number, ctx: TransformCtx) {
  const step = Math.max(0.001, ctx.duration) / stepsPerLoop(v, count);
  const pause = Math.min(step, Math.max(0, num(v.pause, 0.25)));
  const stagger = Math.max(0, num(v.stagger, 0.05));
  return {
    step,
    stagger,
    action: Math.max(0.01, step - pause - (Math.max(1, count) - 1) * stagger),
  };
}

// staggerOrder, verbatim: the ramp runs from one end of the row to the other,
// and Pull reverses it. `slot` is the card's place along the arc, 0 at the end
// the belt is coming from.
function staggerOrder(slot: number, count: number, dir: number, mode: string) {
  const last = Math.max(1, count - 1);
  let order = dir > 0 ? count - 1 - slot : slot;
  if (mode === 'pull') order = last - order;
  return order;
}

interface Arc {
  count: number;
  pitch: number;
  radius: number;
  dir: number;
  centre: number;
}

function arcOf(v: Record<string, any>, count: number): Arc {
  const n = Math.max(1, Math.round(count));
  return {
    count: n,
    pitch: pitchOf(v, n),
    radius: radiusOf(v),
    dir: pick(v.direction, 'forward') === 'forward' ? -1 : 1,
    // Its slots are numbered symmetrically about the crest.
    centre: (n - 1) / 2,
  };
}

// Where card `index` sits, as an angle from the crest.
function angleAt(index: number, frame: number, arc: Arc, v: Record<string, any>, ctx: TransformCtx) {
  const m = motionOf(v, arc.count, ctx);
  const t = (frame / Math.max(1, ctx.totalFrames)) * Math.max(0.001, ctx.duration);
  const slot = index;
  const delay = staggerOrder(slot, arc.count, arc.dir, pick(v.staggerMode, 'pull')) * m.stagger;
  const shaped = (u: number) => ctx.ease(clamp(u, 0, 1));

  if (pick(v.movement, 'boomerang') === 'boomerang') {
    const loop = Math.max(0.1, ctx.duration);
    const u = ((t / loop) % 1 + 1) % 1;
    const out = u < 0.5;
    const local = (out ? u : u - 0.5) * loop;
    const swing = shaped((local - delay) / m.action);
    // Out on the first half, back on the second — and the second half is stated
    // as (1 - shaped) rather than as a reversed curve, so the return eases the
    // same way round.
    const offset = out ? -arc.dir * arc.pitch * swing : -arc.dir * arc.pitch * (1 - swing);
    return (slot - arc.centre) * arc.pitch + offset;
  }

  // Normal: whole steps plus the shaped fraction of the one in progress.
  const p = Math.floor(t / m.step);
  const within = t - p * m.step;
  const advance = arc.dir * (p + shaped((within - delay) / Math.min(m.action, m.step)));
  // The reference keeps its slots still and rotates which image each one shows;
  // this app binds an image to a card for the whole clip, so the CARD travels
  // and wraps instead. Same set of (angle, image) pairs at every instant — the
  // window is `count` pitches wide and only about seven of them are ever in
  // shot — and it closes the loop for free, because a whole number of steps
  // brings every card back to its own start.
  const span = arc.count * arc.pitch;
  const raw = (slot - arc.centre - advance) * arc.pitch;
  return raw - span * Math.round(raw / span);
}

const arc: Template = {
  meta: {
    id: 'arc-01', name: 'Arc 01', group: 'Ferris', repeatAssets: true,
    cardAspect: 5 / 7, defaultEasing: { id: 'custom', bezier: [0.8, 0, 0.2, 1] },
  },
  controls: [
    { key: 'count', label: 'Count', type: 'slider', min: 1, max: 24, step: 1, default: 8, section: 'Layout' },
    // An ANGLE, not a distance: it sets the whole sweep the cards occupy, and
    // the pitch is that divided by the count. Below 4 it clamps, so 0 and 4
    // look the same — the reference's own floor.
    { key: 'gap', label: 'Gap', type: 'slider', min: 0, max: 200, step: 1, default: 20, section: 'Layout',
      description: 'How much of the arc the row spans — 4 is a 55° sweep and 80 a 105° one, shared out between the cards.' },
    { key: 'cardSize', label: 'Card Size', type: 'slider', min: 50, max: 500, step: 10, default: 500, section: 'Layout' },
    { key: 'diameter', label: 'Diameter', type: 'slider', min: 1200, max: 5000, step: 20, default: 2500, section: 'Layout',
      description: 'The wheel the cards are glued to. Large values flatten the hill they ride over; small ones curl it.' },
    { key: 'zoom', label: 'Zoom', type: 'slider', min: 10, max: 300, step: 0.1, default: 100, section: 'Depth', unit: '%', precision: 1 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1, default: 10, section: 'Finish', unit: '%' },
    { key: 'movement', label: 'Movement', type: 'pills', options: ['normal', 'boomerang'], default: 'boomerang', section: 'Motion',
      description: 'Normal deals the cards past in one direction; Boomerang swings the row out by one card and back.' },
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward', 'reverse'], default: 'forward', section: 'Motion' },
    { key: 'pause', label: 'Pause', type: 'slider', min: 0, max: 3, step: 0.01, default: 0.25, section: 'Motion', unit: 's', precision: 2,
      description: 'Held at the end of each step, in seconds — what makes the row settle rather than drift.' },
    { key: 'stagger', label: 'Stagger', type: 'slider', min: 0, max: 0.15, step: 0.01, default: 0.05, section: 'Motion', unit: 's', precision: 2,
      description: 'Delay from one end of the row to the other, so the advance ripples across it.' },
    { key: 'staggerMode', label: 'Mode', type: 'pills', options: ['pull', 'push'], default: 'pull', section: 'Motion' },
  ],

  transform: (frame, index, count, v, ctx): LayerTransform => {
    const a = arcOf(v, count);
    const k = unitScale(v, ctx);
    const aspect = cardAspectOf(ctx);
    const angle = angleAt(index, frame, a, v, ctx);
    // Glued to the rim of a wheel whose centre sits a radius BELOW the crest,
    // so the row bows downward at its ends and each card leans with the
    // tangent. The reference states the turn as -angle about z in a y-up frame,
    // which is +angle on a canvas where y runs down.
    const x = a.radius * Math.sin(angle);
    const drop = a.radius * (1 - Math.cos(angle));
    const size = Math.max(1, num(v.cardSize, 500));
    return {
      x: x * k,
      y: drop * k,
      rotation: angle,
      scale: (size * Math.max(1, aspect) * k) / BASE,
      alpha: Math.abs(angle) <= VISIBLE_LIMIT ? 1 : 0,
      // Nearer the crest reads as nearer the viewer, which is the order the
      // reference sorts by too (its renderOrder follows the angle).
      depth: clamp(0.5 + Math.cos(angle) * 0.5, 0, 1),
    };
  },
};

// ---------------------------------------------------------------------------
//  Its three authored presets (.shots/ref-arc-presets-authored.json). All
//  three share one geometry — 8 cards on a 1250 wheel at Gap 20, a 500 card at
//  Zoom 100% — and differ only in how they move:
//
//    Arc 01  boomerang, 4.2s: out one card and back, on a Natural curve
//    Arc 02  normal, 13.5s: the same row dealt past, still settling per card
//    Arc 03  normal, 13.5s, no pause and no stagger, Linear — a steady drift
//
//  Zoom = 408/distance x 100, its own default distance read back as a
//  percentage; all three ship 408, so all three are 100%.
//
//  Not ported: its card shadow (a soft quad behind each card — this app's
//  shadows are cast by a real light and want a receiver, which a flat row has
//  no use for) and `holderShape`, its squircle corner.
// ---------------------------------------------------------------------------
const NATURAL: EasingSpec = { id: 'custom', bezier: [0.8, 0, 0.2, 1] };
const LINEAR: EasingSpec = { id: 'linear' };

export const arcVariants: Template[] = [
  arc,
  variant(arc, 'arc-02', 'Arc 02', { movement: 'normal' }, NATURAL),
  variant(arc, 'arc-03', 'Arc 03', { movement: 'normal', pause: 0, stagger: 0 }, LINEAR),
];
