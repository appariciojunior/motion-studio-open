import type { Template } from '@/lib/types';
import { TAU, clamp, lerp, loopCycles } from '@/lib/motion';
import {
  DEG, backfaceFade, quaternionFromEuler, tiltNormalCanvas, tiltPointCanvas,
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

const showcase: Template = {
  meta: {
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
    { key: 'facing',       label: 'Card Facing',   type: 'pills',  options: ['surface','camera'], default: 'surface', section: 'Depth', advanced: true },
    { key: 'backFade',     label: 'Back Fade',     type: 'slider', min: 10, max: 95, step: 5,     default: 70, section: 'Finish', unit: '%' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 12, step: 0.5,    default: 3, section: 'Finish', unit: '%', precision: 1 },
    { key: 'thickness',    label: 'Thickness',     type: 'slider', min: 0, max: 24, step: 1,      default: 8, section: 'Finish', unit: 'px', advanced: true,
      description: 'Gives the cards a physical edge. Also what lets depth shading register at all.' },
    { key: 'shadow',       label: 'Shadow',        type: 'toggle', options: ['on','off'],         default: 'off', section: 'Finish' },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 2, step: 0.1,     default: 0.35, section: 'Motion', unit: '×', precision: 1, advanced: true },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                 default: { x: 0, y: 0 }, section: 'Layout', advanced: true },
  ],

  camera: (v) => ({ fov: showcaseFov(v.perspective) }),

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
    const radius = (stage * (v.ringSize / 100)) / 2 * 1.08;
    const k = openingFactor(v.ringOpening);

    // The ring in its own plane, before the plane is tipped. phi = 0 sits at the
    // front (canvas y is down, so +y is the near side once tilted).
    const rx = Math.sin(phi) * radius;
    const ry = Math.cos(phi) * radius * k;

    const rig = { pitch: v.ringTilt };
    const p = tiltPointCanvas({ x: rx, y: ry, z: 0 }, rig);

    // THIS card's own outward normal — not the ring plane's normal, which is
    // the same for every card and barely varies with ringTilt. That was the
    // bug: it made backfaceFade nearly inert (the plane stays broadly camera-
    // facing at any reasonable tilt), so far-side cards never dimmed enough
    // and showed their DoubleSide back — mirrored text — instead of fading out.
    //
    // The correct normal is perpendicular to the ellipse's own tangent, in the
    // ring's local (untilted) plane, then tilted the same way as the position.
    // For x = sin(phi)·r, y = cos(phi)·r·k, the tangent is
    // (cos(phi), -sin(phi)·k) — same derivation as the tangent-roll below — and
    // rotating that -90° and picking the sign with positive dot-product against
    // the position vector gives the OUTWARD normal (sin(phi)·k, cos(phi)).
    // tiltNormalCanvas normalizes it, so it does not need to be unit length here.
    const n = tiltNormalCanvas({ x: Math.sin(phi) * k, y: Math.cos(phi), z: 0 }, rig);

    // Lay the card along the ring: it takes the plane's tilt plus the roll that
    // points it around the curve. Quaternion rather than Euler because the
    // renderer prefers it and because composing tilt with roll in Euler order
    // introduces gimbal drift at steep tilts.
    //
    // The roll is the tangent of the ELLIPSE, not of a circle. `opening` squashes
    // the ring inside its own plane before the plane is tipped, so the curve the
    // cards sit on is already an ellipse — and an ellipse's tangent is not the
    // circle's. Using -phi looked right only at opening 100; at the default 55
    // (k ≈ 0.63) it left every card visibly off its own path. Reduces to -phi
    // exactly when k = 1.
    const surface = v.facing === 'surface';
    const roll = surface ? Math.atan2(-Math.sin(phi) * k, Math.cos(phi)) : 0;
    const quaternion = quaternionFromEuler(
      surface ? v.ringTilt * DEG : 0,
      0,
      roll,
    );

    const cardPx = stage * (v.cardSizePct / 100);
    // Depth shading needs thickness to register: without it renderer3d makes the
    // material emissive and ignores materialExposure entirely.
    const nearness = clamp((p.z / Math.max(1, radius) + 1) / 2, 0, 1);

    return {
      x: p.x + v.offset.x,
      y: p.y + v.offset.y,
      z: p.z,
      quaternion,
      scale: cardPx / BASE,
      // Keep the rear arc present but subdued. The reference reads as a closed
      // ring; cutting back-facing cards entirely turns it into a front-only fan.
      alpha: backfaceFade(n.z, v.backFade),
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
    const radius = (stage * (v.ringSize / 100)) / 2 * 1.08;
    const k = openingFactor(v.ringOpening);
    const rx = Math.sin(phi) * radius;
    const ry = Math.cos(phi) * radius * k;
    const p = tiltPointCanvas({ x: rx, y: ry, z: 0 }, { pitch: v.ringTilt });

    const nearness = clamp((p.z / Math.max(1, radius) + 1) / 2, 0, 1);
    const cardPx = stage * (v.cardSizePct / 100);

    return {
      x: p.x + v.offset.x,
      y: p.y + v.offset.y,
      scale: (cardPx / BASE) * lerp(0.72, 1.12, nearness),
      // Same ellipse tangent as the 3D path, so the thumbnail agrees with the stage.
      rotation: v.facing === 'surface' ? Math.atan2(-Math.sin(phi) * k, Math.cos(phi)) : 0,
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
