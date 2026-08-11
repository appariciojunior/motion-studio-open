import type { Template } from '@/lib/types';
import { TAU, clamp, lerp, loopCycles } from '@/lib/motion';
import {
  DEG, backfaceFade, multiplyQuaternion, quaternionFromEuler,
} from '@/lib/tilt3d';
import { variant } from './variant';

const BASE = 340;

// ============================================================
//  SHOWCASE — a ring of cards lying on a plane tipped into depth
//
//  Ferris already puts cards on a ring, but that ring sits IN the screen plane:
//  seen face on, every card the same size, and it stays a circle. Here the ring
//  is laid down on a tipped plane, so it reads as an ellipse, the far side is
//  genuinely further from the camera, and each card is turned with the surface
//  it sits on.
//
//  This is a `webgl` template because that is the only way to get it honestly.
//  The 2D seam's LayerTransform is entirely affine, and affine maps send
//  parallel lines to parallel lines — a card turning away needs a keystone,
//  which is projective. Three.js supplies a real perspective camera, so the
//  keystone comes from the projection rather than from faking it with skew.
//
//  ONE CAMERA. `camera()` is not optional for this family. Without it the
//  renderer maps `values.perspective` over 0..200 (renderer3d's
//  updateTrackCamera), and this template's Perspective range is 0..40 — the
//  default mapping would read 18 as a very long lens and the tilt would barely
//  register. The fov mapping has to belong to the template.
// ============================================================

// ---- The one assumption in this file ----------------------------------------
// `Ring Opening` could not be measured directly: the reference editor's render
// loop is suspended whenever its tab is not compositing, so its canvas was
// frozen on an old frame and sweeping the slider changed nothing measurable.
//
// One real data point survived, from the default state (tilt -28, opening 55,
// size 80): the drawn ring's bounding box was 906x766, a ratio of 0.845. A plain
// circle tipped 28 degrees would give cos(28) = 0.883, and the cards' own extent
// inflates the box's height, pushing the measured ratio UP toward 1. So the ring
// underneath is flatter than 0.845 — flatter than the tilt alone explains.
//
// Hence: opening is a squash of the ellipse's minor axis that is ADDITIONAL to
// the tilt. 85 leaves the ring nearly as open as the tilt alone would; 15
// collapses it toward a line. Isolated here on purpose — if the reference can be
// measured later, only this function changes.
const openingFactor = (opening: number) => lerp(0.18, 1, clamp(opening, 0, 100) / 100);

// Long lens to moderately wide. The ceiling is deliberately low: the reference
// caps Perspective at 40 and ships 18, keeping the lens long enough that the
// ring reads as a ring rather than a funnel.
const showcaseFov = (perspective: number) => lerp(17, 46, clamp(perspective, 0, 40) / 40);

// ---- The drum ----------------------------------------------------------------
// This family used to lay every card FLAT on one tipped disc. Measured, all
// twelve cards then pointed the same way — 0.0° between any pair of facings —
// and a set of coplanar cards is a 2D arrangement that happens to be rotated:
// a perspective camera has nothing to reveal, so it read as fake however
// correct the maths was. It also contradicts the reference, where the far cards
// come out visibly trapezoidal; coplanar cards all take the SAME keystone, so
// per-card keystone is only possible if each card has its own orientation.
//
// The cards now stand UPRIGHT on the ring and face outward — the same drum
// Orbit 3D builds, which is the look this family is meant to share. Two
// rotations, and the order is the whole trick:
//
//   Rx(tilt) · Ry(phi)
//
//   Ry(phi)   turns the card to face out along its own radius. This is the step
//             that gives every card a different facing, and therefore its own
//             keystone — the thing the flat disc could never produce.
//   Rx(tilt)  tips the finished ring as one rigid body.
//
// Reversing them leans every card in a single world direction instead of
// radially, which collapses straight back to the flat-disc bug. An earlier
// pass here also added a third rotation, Rx(lean), to tip the card tops
// outward; that is a crown or a bowl, not this family — it is left out on
// purpose.
function drumRadius(stage: number, ringSize: number, opening: number) {
  // Same donut construction Orbit 3D uses, so the two families read as
  // siblings: Ring Opening sets the inner diameter as a fraction of the outer,
  // and the cards ride the midline between them.
  const outer = stage * clamp(ringSize, 50, 95) / 100;
  const inner = outer * clamp(opening, 15, 85) / 100;
  return (outer + inner) / 4;
}

function drumPose(phi: number, radius: number, tiltDeg: number, surface: boolean) {
  const tilt = tiltDeg * DEG;
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const st = Math.sin(tilt), ct = Math.cos(tilt);

  // Ring point (R·sin phi, 0, R·cos phi) tipped about world X.
  const x = radius * sp;
  const wy = -radius * cp * st;
  const z = radius * cp * ct;

  // The card's own normal after the same rotations, for backfaceFade.
  // Ry(phi)·(0,0,1) = (sin phi, 0, cos phi), then Rx(tilt) — only z is used.
  const nz = surface ? cp * ct : 1;

  const quaternion = surface
    ? multiplyQuaternion(quaternionFromEuler(tilt, 0, 0), quaternionFromEuler(0, phi, 0))
    // 'camera' facing keeps every card square to the frame — the ring then
    // reads purely as position, which is the old flat look on purpose.
    : quaternionFromEuler(0, 0, 0);

  return { x, wy, z, nz, quaternion };
}

const showcase: Template = {
  meta: {
    // WITHHELD from the catalogue while the ring geometry is reworked.
    //
    // Photographing the reference (scripts/_shoot_ref.cjs) showed this family is
    // a closed drum whose FAR cards stay visible as dark card backs — a solid
    // object seen obliquely — while this implementation fades them out instead,
    // so it reads as a shallow front-only arc. Getting there is a geometry
    // change, not a parameter tweak, so the preset stays out of every picker
    // until it matches. Saved scenes that already reference it still load:
    // catalogHidden only affects catalogTemplateList (templates/index.ts).
    catalogHidden: true,
    id: 'showcase-01', name: 'Showcase Stream', group: '3D & Perspective',
    isNew: true, engine: 'webgl', catalog3d: true, repeatAssets: true, cardAspect: 1,
    defaultEasing: { id: 'linear' },
  },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward', section: 'Motion' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 6, max: 32, step: 1,      default: 12, section: 'Layout', advanced: true },
    { key: 'padding',      label: 'Padding',       type: 'slider', min: 0, max: 20, step: 0.5,    default: 6, section: 'Layout', unit: '%', precision: 1 },
    { key: 'ringSize',     label: 'Ring Size',     type: 'slider', min: 50, max: 95, step: 1,     default: 80, section: 'Layout', unit: '%' },
    { key: 'cardSizePct',  label: 'Card Size',     type: 'slider', min: 12, max: 32, step: 1,     default: 21, section: 'Layout', unit: '%' },
    { key: 'ringTilt',     label: 'Ring Tilt',     type: 'slider', min: -60, max: 60, step: 1,    default: -28, section: 'Depth', unit: '°',
      description: 'Tips the whole ring plane into depth. Every card turns with the surface it sits on.' },
    { key: 'ringOpening',  label: 'Ring Opening',  type: 'slider', min: 15, max: 85, step: 1,     default: 55, section: 'Depth', unit: '%',
      description: 'Squashes the ellipse further than the tilt alone does. Low collapses the ring toward a line.' },
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 0, max: 40, step: 2,      default: 18, section: 'Depth', unit: '%',
      description: 'Camera field of view. Kept deliberately long — past this the ring reads as a funnel.' },
    { key: 'camDistance',  label: 'Camera Distance', type: 'slider', min: 0.5, max: 2.5, step: 0.05, default: 1, section: 'Depth', unit: '×', precision: 2,
      description: 'Moves the camera itself closer or further, at the same Perspective.' },
    { key: 'facing',       label: 'Card Facing',   type: 'pills',  options: ['surface','camera'], default: 'surface', section: 'Depth', advanced: true },
    { key: 'backFade',     label: 'Back Fade',     type: 'slider', min: 10, max: 95, step: 5,     default: 70, section: 'Finish', unit: '%' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 12, step: 0.5,    default: 3, section: 'Finish', unit: '%', precision: 1 },
    { key: 'thickness',    label: 'Thickness',     type: 'slider', min: 0, max: 24, step: 1,      default: 8, section: 'Finish', unit: 'px', advanced: true,
      description: 'Gives the cards a physical edge. Also what lets depth shading register at all.' },
    { key: 'shadow',       label: 'Shadow',        type: 'toggle', options: ['on','off'],         default: 'off', section: 'Finish' },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 2, step: 0.1,     default: 0.35, section: 'Motion', unit: '×', precision: 1, advanced: true },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                 default: { x: 0, y: 0 }, section: 'Layout', advanced: true },
  ],

  camera: (v) => ({ fov: showcaseFov(v.perspective), distance: v.camDistance }),

  transform3d: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'reverse' ? -1 : 1;
    // Period is `count`: one full turn of the ring is count slots, so frame
    // totalFrames poses exactly like frame 0.
    //
    // RAW phase, not ctx.easedPhase. easedPhase is floor(p) + ease(frac(p)) — it
    // shapes every unit step, which is right for a conveyor advancing one slot at
    // a time and wrong for a ring turning continuously: with period `count` an
    // ease-in-out curve makes the ring accelerate and settle once PER CARD.
    // Measured on Orbit 3D, that swung the instantaneous angular rate 23.5x
    // between frames. The seam is unaffected — loopCycles returns a whole
    // multiple of `count`, so the angle advances by a multiple of TAU.
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir;
    const phi = (((index - phase) % count + count) % count) / count * TAU;

    const stage = Math.min(ctx.width, ctx.height) * (1 - clamp(v.padding, 0, 20) / 50);
    const radius = drumRadius(stage, v.ringSize, v.ringOpening);

    const g = drumPose(phi, radius, v.ringTilt, v.facing === 'surface');

    const cardPx = stage * (v.cardSizePct / 100);
    // Depth shading needs thickness to register: without it renderer3d makes the
    // material emissive and ignores materialExposure entirely.
    const nearness = clamp((g.z / Math.max(1, radius) + 1) / 2, 0, 1);

    return {
      // World y is up, canvas y is down, and the renderer negates on the way in.
      x: g.x + v.offset.x,
      y: -g.wy + v.offset.y,
      z: g.z,
      quaternion: g.quaternion,
      scale: cardPx / BASE,
      // backfaceFade, not depthDim: now that every card carries its own facing,
      // the far half genuinely IS reversed and would show its DoubleSide back.
      alpha: backfaceFade(g.nz, v.backFade),
      thickness: v.thickness,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: lerp(0.62, 1.06, nearness),
    };
  },

  // ---- 2D fallback, for thumbnails and the non-webgl path ----
  // Orthographic on purpose: it cannot express a keystone, so it does not
  // pretend to. Size falloff stands in for the perspective.
  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'reverse' ? -1 : 1;
    // Raw phase, matching the 3D path — see the note there.
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir;
    const phi = (((index - phase) % count + count) % count) / count * TAU;

    const stage = Math.min(ctx.width, ctx.height) * (1 - clamp(v.padding, 0, 20) / 50);
    const radius = drumRadius(stage, v.ringSize, v.ringOpening);

    // Same crown geometry as the 3D path, so the thumbnail agrees with the
    // stage. What it cannot carry across is the per-card orientation: a sprite
    // has no facing, so the size falloff below stands in for the whole of it.
    const g = drumPose(phi, radius, v.ringTilt, v.facing === 'surface');
    const nearness = clamp((g.z / Math.max(1, radius) + 1) / 2, 0, 1);
    const cardPx = stage * (v.cardSizePct / 100);

    return {
      x: g.x + v.offset.x,
      y: -g.wy + v.offset.y,
      scale: (cardPx / BASE) * lerp(0.72, 1.12, nearness),
      rotation: 0,
      alpha: lerp(1 - clamp(v.backFade, 0, 95) / 100, 1, nearness),
      depth: nearness,
    };
  },
};

export const showcaseVariants: Template[] = [
  showcase,
  // Steeper and flatter: looking down into the ring, the shot where the tipped
  // plane is most obvious.
  variant(showcase, 'showcase-02', 'Showcase Deep', {
    ringTilt: -46, ringOpening: 34, ringSize: 88, cardSizePct: 24,
    perspective: 26, backFade: 80, speed: 0.28,
  }),
  // Near-upright ring, long lens, cards square to the frame — a calm band
  // rather than a drum.
  variant(showcase, 'showcase-03', 'Showcase Flat', {
    ringTilt: -12, ringOpening: 78, ringSize: 72, cardSizePct: 18,
    perspective: 8, facing: 'camera', backFade: 45, thickness: 4, speed: 0.45, count: 16,
  }),
].map((template, index) => index === 0
  ? template
  : { ...template, meta: { ...template.meta, catalogHidden: true } });
