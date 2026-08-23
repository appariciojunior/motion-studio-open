import { multiplyQuaternion, normalizeQuaternion, quaternionFromEuler, slerpQuaternion } from '@/lib/tilt3d';
import { clamp } from '@/lib/motion';

// ============================================================
//  Shared arithmetic for the reference tool's one 3D scene
//
//  Its Globe, Spiral, ring and Carousel families are not four engines — they
//  are four `projectionModel` branches of a single scene class, sharing one
//  camera rule, one time model and one depth fade. Porting them separately
//  would mean writing that shared half four times and getting it four
//  different kinds of nearly-right, so it lives here once.
//
//  Everything below is in the reference's own world units: a stage 1080 wide
//  and 1440 tall, with the camera on +z looking back at the origin. `refScale`
//  converts to ours.
// ============================================================

export type Quat = { x: number; y: number; z: number; w: number };
export type Vec3 = { x: number; y: number; z: number };

/** Its authoring stage. Every distance, radius and plane size below is in these px. */
export const REF_H = 1440;

/** Reference px → our px, so a preset frames the same on any canvas height. */
export const refScale = (height: number) => height / REF_H;

/**
 * Its focal length, which is where the `perspective` slider actually lands: the
 * scene keeps the camera where it is and changes the LENS, so 100 is the
 * authored view and lower numbers widen it. `ring3d`, `sphere` and `spiral`
 * share the 1000/s form; `carousel3d` is the odd one out and grows with s.
 */
export function refFocal(model: 'ring3d' | 'sphere' | 'spiral' | 'carousel3d', perspective: number, height: number): number {
  const s = Math.max(0.001, perspective / 100);
  if (model === 'carousel3d') return 600 * s * (height / 1350);
  return 1000 / s;
}

/**
 * The camera pose a preset's `perspective` and `distance` add up to. Our
 * `distance` is a multiplier on the fov-derived fit distance, and the fit
 * distance IS the reference's focal length once the fov is set from it — so
 * the multiplier is just distance/focal.
 */
export function refCamera(
  model: 'ring3d' | 'sphere' | 'spiral' | 'carousel3d',
  perspective: number, distance: number, height: number,
) {
  const focal = refFocal(model, perspective, height);
  return {
    fov: (2 * Math.atan((REF_H / 2) / focal) * 180) / Math.PI,
    distance: Math.max(0.01, Math.abs(distance) / focal),
  };
}

/**
 * The reference's two time models.
 *
 * `continuous` turns by `cycleDeg` every cycle and eases WITHIN each one, so a
 * preset at 6 cycles of 60 degrees is a stepped-feeling full turn. That is
 * exactly `ctx.easedPhase`, and the clip is `duration * cycles` long.
 *
 * `step` advances one card-slot per step and there are `cycles * count` of
 * them in a clip, which comes to the same `cycles` full turns — but the beat is
 * the SLOT, not the cycle, so a 10-card ring lands ten times where a 4-card one
 * lands four.
 */
export function refSpinRadians(
  model: 'continuous' | 'step',
  frame: number, totalFrames: number, easedPhase: (p: number) => number,
  count: number, cycles: number, cycleDeg: number,
): number {
  const u = frame / Math.max(1, totalFrames);
  if (model === 'continuous') {
    const turns = easedPhase(u * Math.max(0.01, cycles));
    return (turns * cycleDeg * Math.PI) / 180;
  }
  const steps = Math.max(1, Math.round(cycles * count));
  return easedPhase(u * steps) * ((Math.PI * 2) / Math.max(1, count));
}

/** Rotate a vector by a quaternion. */
export function rotateVec(v: Vec3, q: Quat): Vec3 {
  // t = 2 * (q.xyz x v); v' = v + q.w * t + q.xyz x t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/**
 * The orientation that lays a card flat against a sphere at direction `d` —
 * its own +z along the outward normal. Built the same way the reference builds
 * it, including the degenerate fallback at the poles where `up x d` vanishes.
 */
export function radialQuat(d: Vec3): Quat {
  let ax = { x: 0 * d.z - 1 * d.y, y: 1 * d.x - 0 * d.z, z: 0 * d.y - 0 * d.x }; // up=(0,1,0) x d
  let len = Math.hypot(ax.x, ax.y, ax.z);
  if (len < 1e-4) {
    ax = { x: 0 * d.z - 0 * d.y, y: 0 * d.x - 1 * d.z, z: 1 * d.y - 0 * d.x };   // fallback (1,0,0) x d
    len = Math.max(1e-6, Math.hypot(ax.x, ax.y, ax.z));
  }
  ax = { x: ax.x / len, y: ax.y / len, z: ax.z / len };
  const ay = {
    x: d.y * ax.z - d.z * ax.y,
    y: d.z * ax.x - d.x * ax.z,
    z: d.x * ax.y - d.y * ax.x,
  };
  return quatFromBasis(ax, ay, d);
}

/** Quaternion from three orthonormal axes taken as the columns of a rotation. */
export function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const m00 = x.x, m01 = y.x, m02 = z.x;
  const m10 = x.y, m11 = y.y, m12 = z.y;
  const m20 = x.z, m21 = y.z, m22 = z.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return normalizeQuaternion({ x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s, w: 0.25 / s });
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return normalizeQuaternion({ x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s, w: (m21 - m12) / s });
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return normalizeQuaternion({ x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s, w: (m02 - m20) / s });
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return normalizeQuaternion({ x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s, w: (m10 - m01) / s });
}

export const conjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export const eulerQuat = (x: number, y: number, z: number): Quat => quaternionFromEuler(x, y, z);
export const mulQuat = (a: Quat, b: Quat): Quat => multiplyQuaternion(a, b);
export const slerp = (a: Quat, b: Quat, t: number): Quat => slerpQuaternion(a, b, t);

/**
 * Its `fade`, which darkens toward the background rather than going
 * see-through — the shader blends the card to `bgColor`, so `dim` is the
 * faithful pose field, not `alpha`. The 1 + p^2 * 20 gain is its own: at low
 * fade only the very back dims, and it bites the whole depth range fast.
 */
export function refDepthDim(fade: number, depth01: number): number {
  const p = clamp(fade / 100, 0, 1);
  if (p <= 0) return 0;
  const gain = 1 + p * p * 20;
  return clamp(Math.min(clamp(depth01, 0, 1) * gain, 1) * p, 0, 1);
}

/**
 * Which card a stepped Globe brings to the front on step `n`. The reference
 * walks the sphere by the largest stride coprime with the card count nearest
 * to count/phi, so successive stops land far apart instead of crawling round
 * one band.
 */
export function refStopIndex(step: number, count: number): number {
  if (count <= 2) return 0;
  const target = Math.max(1, Math.round(count * 0.618033988749895));
  let stride = 1;
  outer: for (let n = 0; n < count; n++) {
    for (const cand of [target - n, target + n]) {
      if (cand >= 1 && cand < count && gcd(cand, count) === 1) { stride = cand; break outer; }
    }
  }
  return (((step * stride) % count) + count) % count;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a), y = Math.abs(b);
  while (y) { const t = y; y = x % y; x = t; }
  return x;
}

/**
 * The flat pose that stands in for the 3D one — thumbnails and the pixi path
 * both go through it. Two things it has to do that the 3D renderer does for
 * free: divide by depth, and cap what comes out. Several of the reference's
 * presets fly the camera THROUGH their own ring or coil, and a card a few units
 * off the lens projects to thousands of times the frame; three.js clips that at
 * the near plane, a sprite cannot, so past the point where a card has stopped
 * being a card and become a full-frame wash it is dropped instead.
 */
export function flatFallback(
  p: { x: number; y: number; scale: number; project: number; alpha: number; dim: number; depth: number },
  ctx: { width: number; height: number },
  base = 340,
) {
  const projected = p.scale * p.project;
  const cap = (Math.max(ctx.width, ctx.height) * 8) / base;
  const wash = projected > cap;
  return {
    x: p.x * p.project,
    y: p.y * p.project,
    scale: Math.min(projected, cap),
    rotation: 0,
    alpha: wash ? 0 : p.alpha,
    dim: p.dim,
    depth: p.depth,
  };
}
