import type { Template } from '@/lib/types';
import { TAU, clamp, loopCycles, smooth } from '@/lib/motion';
import {
  depthDim,
  multiplyQuaternion,
  quaternionFromEuler,
  tiltNormalCanvas,
  tiltPointCanvas,
  velocityLean,
} from '@/lib/tilt3d';
import { variant } from './variant';

const BASE = 340;

function ringMetrics(v: Record<string, any>, count: number, ctx: { width: number; height: number }) {
  const minDim = Math.min(ctx.width, ctx.height);
  const padding = clamp(v.padding / 100, 0, 0.2);
  const usable = minDim * (1 - padding * 2);
  // Opening is relative to the ring's own outer diameter. Previously it was
  // measured against the canvas, so opening and ring size fought each other.
  const outer = usable * clamp(v.ringSizePct / 100, 0.4, 0.98);
  const inner = outer * clamp(v.opening / 100, 0.15, 0.85);
  const radius = (outer + inner) / 4;

  // A card must never consume more arc than its slot owns. This keeps every
  // count airy instead of collapsing the cards into a closed black drum.
  const requested = usable * clamp(v.cardSizePct / 100, 0.08, 0.36);
  const arcPerCard = (TAU * radius) / Math.max(4, count);
  return {
    radius,
    // Use the full long edge for the safety bound. Assets may be landscape or
    // square when Card shape is Auto; assuming 4:5 here made wide images touch.
    cardPx: Math.min(requested, arcPerCard * 0.72),
  };
}

// A continuously turning ring must NOT route its angle through ctx.easedPhase.
//
// easedPhase is floor(p) + ease(frac(p)): it shapes every UNIT STEP of the
// phase. That is exactly right for a conveyor that advances one slot at a time —
// a ticker, a deck — where each step should accelerate and settle. A ring is the
// opposite case: its period is `count`, so an ease-in-out curve makes it
// accelerate and decelerate once PER CARD, twelve times per revolution at the
// default count. Measured with the shipped `flow` curve, the instantaneous
// angular velocity swung 23.5x between its slowest and fastest frame; with a
// linear phase the same ring holds a flat rate. That lurch is what reads as
// stiff next to a smoothly spinning reference.
//
// It also made `velocity` lie. That vector is derived from cycles/duration —
// the AVERAGE rate — and is handed to the finish pass for motion blur, so under
// an eased phase the blur was being told a speed up to 23x off from the truth.
// On a linear phase the average IS the instantaneous rate, and it becomes exact.
//
// The seam is unaffected either way: loopCycles returns a whole multiple of
// `count`, so at frame totalFrames the angle has advanced by a multiple of TAU.
function ringPhase(frame: number, v: Record<string, any>, count: number, ctx: { duration: number; totalFrames: number }) {
  const dir = v.direction === 'reverse' ? -1 : 1;
  const cycles = loopCycles(v.speed, ctx.duration, count);
  return { dir, cycles, phase: (frame / ctx.totalFrames) * cycles * dir };
}

const ringStream: Template = {
  meta: {
    id: 'orbit-3d-01', name: 'Ring Stream', group: 'Orbit', isNew: true,
    // Linear on purpose — see ringPhase above. The curve picker still works for
    // anyone who wants the stepped feel back.
    defaultEasing: { id: 'linear' }, engine: 'webgl', catalog3d: true, repeatAssets: true,
  },
  controls: [
    { key: 'style', label: 'Style', type: 'pills', options: ['stream','showcase','bloom'], default: 'stream', section: 'Layout', advanced: true },
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward','reverse'], default: 'forward', section: 'Motion' },
    { key: 'count', label: 'Count', type: 'slider', min: 4, max: 24, step: 1, default: 12, section: 'Layout' },
    { key: 'padding', label: 'Padding', type: 'slider', min: 0, max: 20, step: 1, default: 6, section: 'Layout', unit: '%' },
    { key: 'ringSizePct', label: 'Ring Size', type: 'slider', min: 45, max: 95, step: 1, default: 94, section: 'Layout', unit: '%' },
    { key: 'opening', label: 'Ring Opening', type: 'slider', min: 15, max: 85, step: 1, default: 70, section: 'Layout', unit: '%', description: 'Controls the inner diameter while keeping the ring complete.' },
    { key: 'cardSizePct', label: 'Card Size', type: 'slider', min: 8, max: 36, step: 1, default: 18, section: 'Layout', unit: '%' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 20, step: 0.5, default: 3, section: 'Finish', unit: '%', precision: 1 },
    // Signed, so the slider sits at centre and reads as one axis: negative
    // cups each image inward toward the ring's centre, positive bows it
    // outward, 0 is flat. The 3D renderer already flips the arc's centre by
    // the sign (lib/renderer3d makeBentPlaneGeometry) and clamps to +/-0.45,
    // so only this range was holding the outward half back.
    { key: 'cardBend', label: 'Card Bend', type: 'slider', min: -12, max: 12, step: 0.5, default: 4, section: 'Depth', unit: '%', precision: 1, description: 'Curves each image surface around the ring — negative cups inward, positive bows outward.' },
    { key: 'tiltX', label: 'Ring Tilt', type: 'slider', min: -60, max: 60, step: 1, default: -8, section: 'Depth', unit: '°', description: 'Rotates the complete physical ring without changing its radius.' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 40, step: 1, default: 18, section: 'Depth', unit: '%' },
    { key: 'camDistance', label: 'Camera Distance', type: 'slider', min: 0.5, max: 2.5, step: 0.05, default: 1, section: 'Depth', unit: '×', precision: 2,
      description: 'Moves the camera itself closer or further, at the same Perspective — a different move than widening the lens.' },
    { key: 'facing', label: 'Facing', type: 'pills', options: ['camera','ring'], default: 'ring', section: 'Depth' },
    { key: 'fade', label: 'Back Fade', type: 'slider', min: 0, max: 100, step: 1, default: 15, section: 'Finish', unit: '%' },
    { key: 'shadow', label: 'Shadow', type: 'toggle', options: ['on','off'], default: 'on', section: 'Finish' },
    { key: 'spread', label: 'Ring Width', type: 'slider', min: 55, max: 135, step: 1, default: 100, section: 'Layout', unit: '%', visibleWhen: { key: 'style', equals: 'showcase' } },
    { key: 'pulse', label: 'Bloom', type: 'slider', min: 0, max: 35, step: 1, default: 15, section: 'Motion', unit: '%', visibleWhen: { key: 'style', equals: 'bloom' } },
    { key: 'curve', label: 'Curve', type: 'slider', min: -100, max: 100, step: 1, default: 0, section: 'Depth', unit: '%', visibleWhen: { key: 'style', equals: 'bloom' } },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.3, section: 'Motion', unit: '×', precision: 1 },
    { key: 'offset', label: 'Offset', type: 'xypad', default: { x: 0, y: 0 }, section: 'Layout' },
  ],

  camera: (v) => ({ fov: 15 + clamp(v.perspective / 40, 0, 1) * 14, distance: v.camDistance }),

  transform3d: (frame, index, count, v, ctx) => {
    const { dir, cycles, phase } = ringPhase(frame, v, count, ctx);
    const a = TAU * ((index - phase) / count);
    const metrics = ringMetrics(v, count, ctx);
    const pulse = v.style === 'bloom' ? 1 + (v.pulse / 100) * Math.sin((phase / count) * TAU) : 1;
    const width = metrics.radius * (v.style === 'showcase' ? v.spread / 100 : 1) * pulse;
    const depth = metrics.radius * pulse;
    const curveY = v.style === 'bloom' ? (1 - Math.cos(a)) * metrics.radius * (v.curve / 100) * 0.28 : 0;
    const base = { x: Math.sin(a) * width, y: curveY, z: Math.cos(a) * depth };
    const point = tiltPointCanvas(base, { pitch: v.tiltX });
    const normal = tiltNormalCanvas({ x: Math.sin(a), y: 0, z: Math.cos(a) }, { pitch: v.tiltX });
    const depthN = clamp((normal.z + 1) / 2, 0, 1);
    const lean = velocityLean(dir * v.speed, 1, 3) * Math.PI / 180;
    const qTilt = quaternionFromEuler(v.tiltX * Math.PI / 180, 0, 0);
    const qRadial = quaternionFromEuler(0, v.facing === 'ring' ? a : 0, 0);
    const qLean = quaternionFromEuler(0, 0, lean);
    const quaternion = multiplyQuaternion(multiplyQuaternion(qTilt, qRadial), qLean);
    const angularRate = (cycles / Math.max(0.001, ctx.duration)) * TAU / count * dir;
    return {
      x: point.x + v.offset.x,
      y: point.y + v.offset.y,
      z: point.z,
      quaternion,
      scale: (metrics.cardPx / BASE) * (1 + smooth(depthN) * 0.035),
      // Back Fade DARKENS the far arc; it does not make it see-through. On
      // alpha, the cards behind the ring showed straight through the ones in
      // front and the whole thing read as glass. It rides materialExposure
      // instead, which is a plain brightness multiply on the card's colour, so
      // a far card is dim AND solid.
      //
      // depthDim, not backfaceFade: this is a RING, and lib/tilt3d says it in
      // as many words — a ring's far arc has to stay present or the whole thing
      // reads as a front-only fan. backfaceFade multiplies in a hard cut to
      // zero near edge-on (added so sphere tiles never expose their DoubleSide
      // back), and applying it here deleted every card on the far side.
      alpha: 1,
      bend: v.cardBend / 100,
      thickness: 0,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: 0.78 + depthN * 0.28,
      dim: 1 - depthDim(normal.z, v.fade),
      velocity: {
        x: Math.cos(a) * width * angularRate,
        y: Math.sin(a) * depth * angularRate * Math.sin(v.tiltX * Math.PI / 180),
        z: -Math.sin(a) * depth * angularRate,
      },
    };
  },

  transform: (frame, index, count, v, ctx) => {
    // Same linear phase as the 3D path, so the thumbnail matches the stage.
    const { phase } = ringPhase(frame, v, count, ctx);
    const a = TAU * ((index - phase) / count);
    const metrics = ringMetrics(v, count, ctx);
    const base = { x: Math.sin(a) * metrics.radius, y: 0, z: Math.cos(a) * metrics.radius };
    const p = tiltPointCanvas(base, { pitch: v.tiltX });
    const normal = tiltNormalCanvas({ x: Math.sin(a), y: 0, z: Math.cos(a) }, { pitch: v.tiltX });
    const depthN = clamp((normal.z + 1) / 2, 0, 1);
    return {
      x: p.x + v.offset.x,
      y: p.y + v.offset.y,
      scale: (metrics.cardPx / BASE) * (0.84 + depthN * 0.19),
      rotation: 0,
      // Same reasoning as transform3d above, and it matters more here: the 2D
      // fallback has no depth at all, so losing the far arc leaves a bare row.
      // Darkens rather than going see-through, matching the 3D path.
      alpha: 1,
      dim: 1 - depthDim(normal.z, v.fade),
      depth: p.z,
    };
  },
};

export const orbit3dVariants: Template[] = [
  ringStream,
  variant(ringStream, 'orbit-3d-02', 'Orbit Showcase', {
    style: 'showcase', count: 10, ringSizePct: 86, opening: 48, tiltX: 0, perspective: 28, spread: 92, speed: 0.25,
  }),
  variant(ringStream, 'orbit-3d-03', 'Orbit Bloom', {
    style: 'bloom', count: 8, ringSizePct: 72, opening: 42, tiltX: -29, perspective: 26, cardSizePct: 25, fade: 45, pulse: 16,
  }),
];
