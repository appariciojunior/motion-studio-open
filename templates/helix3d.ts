import type { Template } from '@/lib/types';
import { TAU, clamp, lerp, loopCycles } from '@/lib/motion';
import {
  DEG, backfaceFade, quaternionFromEuler, tiltNormalCanvas, tiltPointCanvas, wrapEnvelope,
} from '@/lib/tilt3d';
import { variant } from './variant';

const BASE = 340;

// ============================================================
//  HELIX 3D — a corkscrew of cards climbing a tilted axis
//
//  A separate family from the existing pixi Helix, not a replacement: that one
//  stays exactly as it is. The old one fakes depth — x = sin(a)·radius with no z
//  at all, and cos(a) reused as a sort key — so the cards slide past each other
//  on a flat plane. Here the helix is an actual curve in space, seen through the
//  perspective camera, with the axis itself tiltable.
//
//  Axis runs VERTICALLY. A helix around the z axis would corkscrew toward the
//  camera, which is territory Card Tunnel already occupies; keeping the axis
//  upright is what makes this a staircase rather than a second tunnel, and it is
//  what `Card Gap` reads against — the rise per card, i.e. the helix pitch.
//
//  Cards face OUTWARD from the axis, like the risers on a spiral stair. The
//  normal is aimed with the same construction globe.ts uses (rotationY =
//  atan2(n.x, n.z), rotationX = -asin(n.y)) rather than by assuming the angle,
//  because once the axis is tilted the radial direction is no longer the flat
//  circle's radial direction.
//
//  ONE CAMERA. `camera()` is mandatory: without it renderer3d maps
//  `values.perspective` over 0..200, and this family's Perspective range is
//  0..40 — the default mapping would read every value as a long lens.
// ============================================================

// ---- The one assumption in this file ----------------------------------------
// `Taper` could not be measured: the reference editor suspends its render loop
// whenever its tab is not compositing, so its canvas stayed frozen and sweeping
// the slider produced no observable change. Read from the name and its symmetric
// -90..90 range: the radius varies along the spiral, negative closing it toward
// the far end and positive opening it out, 0 leaving a plain cylinder.
//
// Kept as one function so that if the reference becomes measurable, only this
// changes. The 0.45 ceiling keeps the radius strictly positive at both extremes.
const taperFactor = (taper: number, u: number) => {
  const t = clamp(taper, -90, 90) / 200; // ±0.45
  return lerp(1 - t, 1 + t, clamp(u, 0, 1));
};

// Long lens to moderately wide, matching the reference's deliberately low
// ceiling. A helix blows out into a funnel long before a 95-degree fov.
const helixFov = (perspective: number) => lerp(19, 48, clamp(perspective, 0, 40) / 40);

// Shared geometry + a size clamp, so the 3D pose and the 2D fallback can never
// disagree and so the card can never render bigger than the spiral lets it.
//
// A flat ring (Orbit 3D) only ever needs to protect against ITS OWN neighbour —
// one step around the circle. A multi-turn spiral has a second, easy-to-miss
// collision: card i and card i+k, where k ≈ count/turns is "one lap later",
// land at nearly the SAME angle, separated mostly by one turn's rise. When that
// rise is small relative to the card, laps stack on top of each other and read
// as flickering vertical stripes — measured on the shipped defaults, the
// closest pair (6 apart, not 1) sat at 0.78x the card's own size, i.e. already
// overlapping, and the reference-inspired "funnel" variant reached 1.46x.
//
// Both distances are estimated analytically (not by scanning all pairs from
// inside a per-card pure function) and the smaller one bounds the card.
function helixMetrics(v: Record<string, any>, count: number, ctx: { width: number; height: number }) {
  const stage = Math.min(ctx.width, ctx.height) * (1 - clamp(v.padding ?? 6, 0, 20) / 50);
  const radius = (stage * (v.spiralSize / 100)) / 2;
  const risePerTurn = stage * (v.cardGap / 100) * 0.9;
  const totalRise = v.turns * risePerTurn;
  const requested = stage * (v.cardSizePct / 100);

  // Worst-case radius for the spacing estimate: Taper can shrink the spiral
  // down to (1 - |taper|/200) of its nominal radius at one end (see
  // taperFactor below), and that end is where laps sit closest together.
  const radiusSafe = radius * (1 - Math.min(1, Math.abs(clamp(v.taper, -90, 90)) / 200));

  // 1. Same-lap neighbour — one index step along the coil.
  const angleStep1 = (v.turns * TAU) / count;
  const yStep1 = totalRise / count;
  const spacing1 = Math.hypot(radiusSafe * angleStep1, yStep1);

  // 2. Adjacent-lap neighbour, k ≈ count/turns steps away. Skipped when the
  // spiral never completes a second lap across its own card count (turns too
  // small relative to count), and when the rise is negligible — Card Gap = 0
  // is a deliberate flat multi-layer ring (see its own control description),
  // not a defect to clamp away.
  let spacing2 = Infinity;
  if (totalRise > 1) {
    const k = Math.round(count / Math.max(0.001, v.turns));
    if (k >= 1 && k < count) {
      const raw = ((v.turns * TAU * k) / count) % TAU;
      const angleStep2 = Math.min(raw, TAU - raw);
      const yStep2 = (totalRise * k) / count;
      spacing2 = Math.hypot(radiusSafe * angleStep2, yStep2);
    }
  }

  // The card is portrait (default crop 4:5), so its own diagonal is ~0.8x its
  // width — bigger than the width alone. A factor tuned only against width, as
  // a ring's would be, still let portrait corners graze: two near-opaque cards
  // that overlap even slightly can z-fight, because depthWrite turns on above
  // alpha 0.995 (renderer3d) and two nearly-coincident depth writes resolve
  // per-pixel, which is what reads as interleaved stripes rather than a soft
  // double-exposure. 0.52 leaves real clearance for that diagonal.
  const bound = Math.min(spacing1, spacing2);
  // The original intentionally overlaps neighbouring turns. The previous
  // safety factor treated that overlap as an error and reduced the cards to
  // thumbnail-sized fragments. Keep a modest collision guard, but preserve the
  // large ribbon-like cards that define Spiral Stream.
  const cardPx = Number.isFinite(bound) ? Math.min(requested, bound * 1.3) : requested;
  return { radius, risePerTurn, totalRise, cardPx };
}

const helix3d: Template = {
  meta: {
    id: 'helix3d-01', name: 'Spiral Stream', group: '3D & Perspective',
    catalog3d: true, engine: 'webgl', repeatAssets: true, cardAspect: 1,
    defaultEasing: { id: 'linear' },
  },

  controls: [
    { key: 'padding',      label: 'Padding',       type: 'slider', min: 0, max: 20, step: 0.5,    default: 6, section: 'Layout', unit: '%', precision: 1 },
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['downward','upward'], default: 'downward', section: 'Motion' },
    { key: 'motion',       label: 'Motion',        type: 'pills', options: ['continuous','fast-slow-fast','step-per-card'], default: 'continuous', section: 'Motion' },
    { key: 'count',        label: 'Card Count',    type: 'slider', min: 8, max: 48, step: 1,      default: 24, section: 'Layout' },
    { key: 'turns',        label: 'Spiral Turns',  type: 'slider', min: 1, max: 6, step: 0.25,    default: 3.75, section: 'Layout', precision: 2 },
    { key: 'spiralSize',   label: 'Spiral Size',   type: 'slider', min: 35, max: 90, step: 1,     default: 62, section: 'Layout', unit: '%' },
    { key: 'cardSizePct',  label: 'Card Size',     type: 'slider', min: 12, max: 36, step: 1,     default: 33, section: 'Layout', unit: '%' },
    { key: 'cardGap',      label: 'Card Gap',      type: 'slider', min: 0, max: 50, step: 2,      default: 28, section: 'Layout', unit: '%',
      description: 'Rise per turn — the helix pitch. 0 collapses the spiral into a flat ring.' },
    { key: 'taper',        label: 'Taper',         type: 'slider', min: -90, max: 90, step: 5,    default: 0, section: 'Depth', unit: '%',
      description: 'Varies the radius along the spiral. Negative closes it toward the far end, positive opens it out.' },
    { key: 'ringTilt',     label: 'Ring Tilt',     type: 'slider', min: -45, max: 45, step: 1,    default: 0, section: 'Depth', unit: '°',
      description: 'Tips the whole helix axis. The cards stay attached to the curve.' },
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 0, max: 40, step: 2,      default: 20, section: 'Depth', unit: '%' },
    { key: 'camDistance',  label: 'Camera Distance', type: 'slider', min: 0.5, max: 2.5, step: 0.05, default: 1, section: 'Depth', unit: '×', precision: 2,
      description: 'Moves the camera itself closer or further, at the same Perspective.' },
    { key: 'facing',       label: 'Card Style',    type: 'pills',  options: ['curved','upright'], default: 'curved', section: 'Depth' },
    { key: 'scalePulse',   label: 'Scale Pulse',   type: 'slider', min: 0, max: 60, step: 5,      default: 0, section: 'Motion', unit: '%',
      description: 'Breathes the card size once per lap. Period is exactly one lap, so the loop stays seamless.' },
    { key: 'backFade',     label: 'Back Fade',     type: 'slider', min: 10, max: 95, step: 5,     default: 55, section: 'Finish', unit: '%' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 12, step: 0.5,    default: 3, section: 'Finish', unit: '%', precision: 1 },
    { key: 'thickness',    label: 'Thickness',     type: 'slider', min: 0, max: 24, step: 1,      default: 8, section: 'Finish', unit: 'px', advanced: true,
      description: 'Gives the cards a physical edge. Also what lets depth shading register at all.' },
    { key: 'shadow',       label: 'Shadow',        type: 'toggle', options: ['on','off'],         default: 'off', section: 'Finish' },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 2, step: 0.1,     default: 0.35, section: 'Motion', unit: '×', precision: 1, advanced: true },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                 default: { x: 0, y: 0 }, section: 'Layout', advanced: true },
  ],

  camera: (v) => ({ fov: helixFov(v.perspective), distance: v.camDistance }),

  transform3d: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'upward' ? -1 : 1;
    // Period is `count`: each card advances exactly one slot per cycle, so frame
    // totalFrames poses like frame 0.
    // Raw phase: a helix advances continuously, so easedPhase would make it
    // accelerate and settle once per card. Seam holds — loopCycles returns a
    // whole multiple of `count`.
    const rawPhase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir;
    const phase = v.motion === 'continuous' ? rawPhase : ctx.easedPhase(rawPhase);
    // u wraps in [0,1) along the whole spiral. Every term below is a function of
    // u with integer period, which is what keeps the seam closed.
    const u = (((index - phase) % count + count) % count) / count;

    const m = helixMetrics(v, count, ctx);
    const radius = m.radius * taperFactor(v.taper, u);
    const a = v.turns * TAU * u;

    const rig = { pitch: v.ringTilt };
    const p = tiltPointCanvas({
      x: Math.sin(a) * radius,
      y: (0.5 - u) * m.totalRise,
      z: Math.cos(a) * radius,
    }, rig);

    // Radial normal — a riser on a spiral stair faces away from the axis. Tilted
    // by the same rig so the facing cannot drift off the curve.
    const n = tiltNormalCanvas({ x: Math.sin(a), y: 0, z: Math.cos(a) }, rig);

    const surface = v.facing === 'curved';
    const quaternion = surface
      // Aim +Z (a plane's own normal) along n. Same construction as globe.ts:
      // solving for the angles rather than reusing `a` is what stays correct
      // once the axis is tilted.
      ? quaternionFromEuler(-Math.asin(clamp(n.y, -1, 1)), Math.atan2(n.x, n.z), 0)
      // 'camera' facing keeps every card square to the frame: identity, so the
      // helix reads purely as position and the images stay flat to the viewer.
      : quaternionFromEuler(0, 0, 0);

    // One breath per lap. sin(TAU·u) has period exactly 1 in u, so it returns to
    // its starting value at the seam by construction.
    const pulse = 1 + (v.scalePulse / 100) * 0.5 * Math.sin(TAU * u);
    const cardPx = m.cardPx * pulse;

    const nearness = clamp((p.z / Math.max(1, radius) + 1) / 2, 0, 1);

    return {
      x: p.x + v.offset.x,
      y: p.y + v.offset.y,
      z: p.z,
      quaternion,
      scale: cardPx / BASE,
      // Two separate things: the card turning away from the camera, and the
      // hand-off at the ends of the spiral.
      alpha: backfaceFade(n.z, v.backFade) * wrapEnvelope(u, 0.06),
      thickness: v.thickness,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: lerp(0.6, 1.08, nearness),
    };
  },

  // ---- 2D fallback, for thumbnails and the non-webgl path ----
  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'upward' ? -1 : 1;
    // Raw phase: a helix advances continuously, so easedPhase would make it
    // accelerate and settle once per card. Seam holds — loopCycles returns a
    // whole multiple of `count`.
    const rawPhase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir;
    const phase = v.motion === 'continuous' ? rawPhase : ctx.easedPhase(rawPhase);
    const u = (((index - phase) % count + count) % count) / count;

    const m = helixMetrics(v, count, ctx);
    const radius = m.radius * taperFactor(v.taper, u);
    const a = v.turns * TAU * u;

    const p = tiltPointCanvas({
      x: Math.sin(a) * radius,
      y: (0.5 - u) * m.totalRise,
      z: Math.cos(a) * radius,
    }, { pitch: v.ringTilt });

    const nearness = clamp((p.z / Math.max(1, radius) + 1) / 2, 0, 1);
    const pulse = 1 + (v.scalePulse / 100) * 0.5 * Math.sin(TAU * u);
    const cardPx = m.cardPx * pulse;

    return {
      x: p.x + v.offset.x,
      y: p.y + v.offset.y,
      scale: (cardPx / BASE) * lerp(0.62, 1.14, nearness),
      rotation: 0,
      alpha: lerp(1 - clamp(v.backFade, 0, 95) / 100, 1, nearness) * wrapEnvelope(u, 0.06),
      depth: nearness,
    };
  },
};

export const helix3dVariants: Template[] = [
  helix3d,
  // Tight and tall: many laps, small cards, a DNA column.
  variant(helix3d, 'helix3d-02', 'Spiral Column', {
    turns: 5.5, count: 40, spiralSize: 44, cardSizePct: 17, cardGap: 34,
    perspective: 26, backFade: 65, thickness: 5, speed: 0.5,
  }),
  // A closing funnel seen from a tilted axis — the shot that shows Taper.
  variant(helix3d, 'helix3d-03', 'Spiral Funnel', {
    turns: 2.5, count: 18, spiralSize: 86, cardSizePct: 28, cardGap: 16,
    taper: -70, ringTilt: 24, perspective: 30, backFade: 70, speed: 0.3,
  }),
].map((template, index) => index === 0
  ? template
  : { ...template, meta: { ...template.meta, catalogHidden: true } });
