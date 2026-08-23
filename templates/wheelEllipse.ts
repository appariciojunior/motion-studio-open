import type { LayerTransform, Template, TransformCtx } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { TAU, clamp, loopCycles } from '@/lib/motion';
import { DEG } from '@/lib/tilt3d';
import { variant } from './variant';

// ---------------------------------------------------------------------------
//  The reference tool's Wheel, TRANSCRIBED — module 24248 (WHEEL_FOV,
//  WHEEL_BANK_DEG, applyCamera, cameraZ, computeFrame,
//  computeWheelContrastScales), its preset table in module 478, its stage
//  renderer in 44392, and the stepped spin it shares with the ring
//  (25001 steppedSpinAngle).
//
//  Checked against its LIVE scene graph (scripts/_scene_orbit.cjs at
//  MS_FAMILY=Wheel, capture in .shots/ref-scene-wheel.json). Every number
//  below lands on the capture:
//
//    Wheel 01  camera z 1701.085 = 170/(200·tan(17.5°)) × 631, to the digit;
//              the first card's frame group at x 387.5 = orbitRadius 350 plus
//              half a 75 card; its mesh turned -PI/2 and the next -PI/2 + a
//              slot; the ring group at -1.74899 = 45° + the spin
//    Wheel 05  the frame group at (-202.792, 250.243), which is exactly on the
//              ellipse rx 425 / ry 284.75 (the test comes back 1.0000); the
//              ring group at 0.64577 = 37° with NO spin in it, because its
//              coupling is `static`; and each mesh counter-turned by -37° so
//              the cards stay upright while they travel
//
//  Two things separate this family from the ring in templates/orbit3d.ts:
//
//    · it is FLAT. Every card sits at z = 0 and the only 3D in the whole family
//      is a 0.15 degree bank about the ellipse's own tangent — a hair of tilt
//      whose job is to stop coplanar cards from z-fighting, not to be seen. So
//      this is a 2D template and the pose is exact rather than approximated.
//    · there is NO artboard crop. Its renderer sets the camera aspect from the
//      stage box and then renders into a viewport of exactly that size
//      (gl.setViewport centred in the canvas), so the frame IS the artboard —
//      unlike the ring's stage, which draws a square frame and shows a window
//      onto it (see BOARD_CROP in templates/orbit3d.ts).
//
//  And one thing it does NOT have, which is worth stating because every other
//  ported family does: no fade. Its renderer passes uVis 1 for every card and
//  forces backface `show`, so there is no depth cue here beyond Contrast.
// ---------------------------------------------------------------------------

const BASE = 340;

// WHEEL_FOV, and the card size its framing is normalized against. The lens
// cancels: the frame's half-height at z=0 comes out as 170/200 × distance for
// any fov, which is why its Size control changes scale and nothing else.
const WHEEL_FOV = 35;
const WHEEL_REF_CARD = 170;
const FRAME_PER_DISTANCE = WHEEL_REF_CARD / 200;

// Its own default `distance`, and all five presets ship it — so Zoom 100% here
// is the authored framing.
const REF_DISTANCE = 631;

// WHEEL_BANK_DEG. Kept as a named constant rather than dropped so the next
// reader knows it was read and judged, not missed: at 0.15 degrees a card
// foreshortens by three parts in a million, and a sprite has no axis to bank
// about anyway.
const WHEEL_BANK_DEG = 0.15;

const num = (value: any, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const pick = (value: any, fallback: string) => (typeof value === 'string' ? value : fallback);

function cardAspectOf(ctx: TransformCtx) {
  return Math.max(0.05, num(ctx.cardAspect, 0.8));
}

function refDistance(v: Record<string, any>) {
  return (REF_DISTANCE * 100) / clamp(num(v.zoom, 100), 5, 1000);
}

// Preview px per reference unit. The canvas is the frame, so there is no window
// term here — see the header.
function unitScale(v: Record<string, any>, ctx: TransformCtx) {
  return ctx.height / 2 / (FRAME_PER_DISTANCE * refDistance(v));
}

interface Wheel {
  n: number;
  rx: number;
  ry: number;
  axis: number;      // ringRotation, radians
  spin: number;      // the stepped advance, radians
  spoke0: number;    // what the spin adds to each card's own angle
  group: number;     // what the ring group turns by
  radial: boolean;
}

// The ellipse. Its radius is the orbit radius plus HALF A CARD plus the gap —
// so Diameter 0 still leaves the cards clear of the hub, and Gap pushes the
// whole ring out rather than shrinking the cards the way the ring's Gap does.
// Ellipticity squashes the vertical radius only, to a floor of a tenth.
function wheelOf(v: Record<string, any>, count: number, frame: number, ctx: TransformCtx): Wheel {
  const n = Math.max(3, Math.round(count));
  const rx = Math.max(1, Math.max(0, num(v.diameter, 400)) / 2)
    + Math.max(1, num(v.cardSize, 170)) / 2
    + Math.max(0, num(v.gap, 0));
  const ry = rx * (1 - clamp(num(v.ellipticity), 0, 0.9));
  const spin = spinAt(frame, v, n, ctx);
  // Spin couples one of two ways, and this is the whole difference between a
  // fairground wheel and a turning plate:
  //   rotate  the ring GROUP turns, so the cards go round with it and their
  //           own angle in the ring never changes
  //   static  the group stands still and each card's angle advances instead,
  //           so with Card Align `normal` the cards stay upright as they travel
  const still = pick(v.spinCoupling, 'rotate') === 'static';
  return {
    n, rx, ry,
    axis: num(v.axis, 45) * DEG,
    spin,
    spoke0: still ? spin : 0,
    group: num(v.axis, 45) * DEG + (still ? 0 : spin),
    radial: pick(v.cardAlign, 'radial') === 'radial',
  };
}

// steppedSpinAngle, the same one the ring uses: the clip is `count` steps, each
// shaped by the scene curve and optionally held at its end, and on Linear with
// no hold it collapses to a constant turn. Its forward is negative — its own
// dirSign — so forward reads as clockwise.
function spinAt(frame: number, v: Record<string, any>, n: number, ctx: TransformCtx) {
  const dir = pick(v.direction, 'forward') === 'forward' ? -1 : 1;
  const slots = Math.abs(loopCycles(num(v.speed, 1), ctx.duration, n));
  const p = (frame / Math.max(1, ctx.totalFrames)) * slots;
  const move = Math.max(0.01, 1 - clamp(num(v.hold) / 100, 0, 0.9));
  const stepped = Math.floor(p) + ctx.ease(Math.min(1, (p - Math.floor(p)) / move));
  return dir * stepped * (TAU / n);
}

// Where a card sits, in the reference's units and its y-UP frame.
function cardAt(index: number, w: Wheel) {
  const spoke = (index / w.n) * TAU + w.spoke0;
  const local = { x: w.rx * Math.cos(spoke), y: w.ry * Math.sin(spoke) };
  const c = Math.cos(w.group), s = Math.sin(w.group);
  return {
    spoke,
    x: local.x * c - local.y * s,
    y: local.x * s + local.y * c,
  };
}

// Contrast is by SCREEN HEIGHT here, not by depth — there is no depth to read.
// Its own expression is the negated y of the card after the ring has turned,
// normalized across the set, so the card highest in frame keeps scale 1 and the
// lowest lands on 1/(1 + contrast/100). Reads as a wheel leaning away at the
// bottom.
function contrastScales(w: Wheel, v: Record<string, any>, count: number) {
  const c = Math.max(0, num(v.scaleContrast));
  const n = Math.max(1, Math.round(count));
  if (c <= 0) return null;
  let lo = Infinity, hi = -Infinity;
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    const value = -cardAt(i, w).y;
    values.push(value);
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  const span = Math.max(hi - lo, 1e-6);
  return values.map((value) => 1 + (1 / (1 + c / 100) - 1) * ((value - lo) / span));
}

const wheelEllipse: Template = {
  meta: {
    id: 'wheel-r01', name: 'Wheel 01', group: 'Ferris', repeatAssets: true,
    cardAspect: 4 / 5, defaultEasing: { id: 'custom', bezier: [0.8, 0, 0.2, 1] },
  },
  controls: [
    { key: 'count', label: 'Count', type: 'slider', min: 3, max: 24, step: 1, default: 20, section: 'Layout' },
    { key: 'cardSize', label: 'Card Size', type: 'slider', min: 60, max: 320, step: 5, default: 75, section: 'Layout' },
    // The panel states the orbit as a DIAMETER, twice the radius the maths uses
    // — the same displayScale 2 its other families use.
    { key: 'diameter', label: 'Diameter', type: 'slider', min: 80, max: 1000, step: 10, default: 700, section: 'Layout',
      description: 'How far the cards sit from the hub. Half a card and the Gap are added on top, so they never crowd the centre.' },
    { key: 'gap', label: 'Gap', type: 'slider', min: 0, max: 200, step: 2, default: 0, section: 'Layout',
      description: 'Pushes the whole ring outward. Unlike the Orbit ring, this grows the circle instead of shrinking the cards.' },
    { key: 'ellipticity', label: 'Ellipticity', type: 'slider', min: 0, max: 0.6, step: 0.01, default: 0, section: 'Layout', precision: 2,
      description: 'Squashes the ring vertically into an ellipse — the cards keep their spacing in angle, not in distance.' },
    { key: 'axis', label: 'Axis', type: 'slider', min: -180, max: 180, step: 1, default: 45, section: 'Layout', unit: '°',
      description: 'Turns the whole wheel in the frame. With an ellipse it decides which way the flat side faces.' },
    { key: 'cardAlign', label: 'Card Align', type: 'pills', options: ['radial', 'normal'], default: 'radial', section: 'Depth',
      description: 'Radial points each card along its spoke; Normal keeps every card upright whatever the wheel does.' },
    { key: 'spinCoupling', label: 'Spin', type: 'pills', options: ['rotate', 'static'], default: 'rotate', section: 'Motion',
      description: 'Rotate turns the whole wheel and the cards with it; Static walks the cards round a wheel that stands still.' },
    { key: 'zoom', label: 'Zoom', type: 'slider', min: 10, max: 300, step: 0.1, default: 100, section: 'Depth', unit: '%', precision: 1 },
    { key: 'scaleContrast', label: 'Contrast', type: 'slider', min: 0, max: 500, step: 1, default: 0, section: 'Depth', unit: '%',
      description: 'Shrinks the cards low in the frame, so the wheel reads as leaning away at the bottom.' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1, default: 10, section: 'Finish', unit: '%' },
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward', 'reverse'], default: 'forward', section: 'Motion' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 4, step: 0.05, default: 1, section: 'Motion', unit: '×', precision: 2,
      description: 'Cards per second. The clip always closes on a whole number of turns.' },
    { key: 'hold', label: 'Hold', type: 'slider', min: 0, max: 60, step: 0.5, default: 12.5, section: 'Motion', unit: '%', precision: 1,
      description: 'How much of each card-to-card step is spent stopped. Its own presets on a shaped curve hold an eighth of the step.' },
  ],

  transform: (frame, index, count, v, ctx): LayerTransform => {
    const w = wheelOf(v, count, frame, ctx);
    const k = unitScale(v, ctx);
    const aspect = cardAspectOf(ctx);
    const card = cardAt(index, w);
    const scales = contrastScales(w, v, count);
    const size = Math.max(1, num(v.cardSize, 170));
    // Its renderer turns the mesh by (spoke - PI/2) when the cards run radially,
    // and by -(axis + spin) when they do not — which cancels the ring group
    // exactly and leaves the card upright. Both are z-rotations in its y-up
    // frame, so both come back negated on a canvas where y runs down.
    const turn = w.radial ? w.group + card.spoke - Math.PI / 2 : 0;
    return {
      x: card.x * k,
      y: -card.y * k,
      rotation: -turn,
      scale: (size * Math.max(1, aspect) * k * (scales ? scales[index] ?? 1 : 1)) / BASE,
      alpha: 1,
      // Its cards are all at z=0 and it draws them in slot order, so the later
      // slot wins an overlap. Keeping that as a stable per-slot value rather
      // than a depth reproduces the same stacking.
      depth: (index + 1) / (Math.max(1, Math.round(count)) + 1),
    };
  },
};

// ---------------------------------------------------------------------------
//  Its five authored presets (module 478, saved to
//  .shots/ref-wheel-presets-authored.json). Every one ships distance 631, so
//  all five are Zoom 100%; Diameter is twice its orbitRadius; Speed is
//  count/loopDuration, i.e. cards per second, which is what its Duration pins.
//
//  Hold is its implicit pause: when a preset carries a curve and no pause of
//  its own it holds an eighth of each step, so the Natural ones sit at 12.5%
//  and the Linear ones at 0.
//
//  Not ported: its card shadow and silhouette shadow (a soft quad and an
//  alpha-shaped variant behind each card — this app's shadows come from a real
//  light and want a receiver, which a flat wheel has none of), `holderShape`,
//  and the 0.15 degree bank.
// ---------------------------------------------------------------------------
const NATURAL: EasingSpec = { id: 'custom', bezier: [0.8, 0, 0.2, 1] };
const LINEAR: EasingSpec = { id: 'linear' };
const SQUARE = { cardAspect: 1 };

export const wheelEllipseVariants: Template[] = [
  // Twenty small cards on a wide wheel, pointing along their spokes.
  wheelEllipse,
  variant(wheelEllipse, 'wheel-r02', 'Wheel 02', {
    count: 24, cardSize: 60, diameter: 400, gap: 200, ellipticity: 0, axis: 45,
    cardAlign: 'normal', spinCoupling: 'rotate', speed: 2, hold: 0,
  }, LINEAR),
  variant(wheelEllipse, 'wheel-r03', 'Wheel 03', {
    count: 12, cardSize: 170, diameter: 400, gap: 0, ellipticity: 0, axis: 45,
    cardAlign: 'normal', spinCoupling: 'rotate', speed: 1, hold: 12.5,
  }, NATURAL, SQUARE),
  variant(wheelEllipse, 'wheel-r04', 'Wheel 04', {
    count: 10, cardSize: 170, diameter: 340, gap: 38, ellipticity: 0, axis: 45,
    cardAlign: 'radial', spinCoupling: 'rotate', speed: 1, hold: 12.5,
  }, NATURAL),
  // The one that reads as a real fairground wheel: an ellipse, the hub standing
  // still, and every card upright as it travels round.
  variant(wheelEllipse, 'wheel-r05', 'Wheel 05', {
    count: 12, cardSize: 200, diameter: 650, gap: 0, ellipticity: 0.33, axis: 37,
    cardAlign: 'normal', spinCoupling: 'static', speed: 1, hold: 0,
  }, LINEAR, SQUARE),
];
