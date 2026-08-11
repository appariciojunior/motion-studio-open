import { clamp } from './motion';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export interface Vec3 { x: number; y: number; z: number }
export interface TiltRig { pitch?: number; yaw?: number; roll?: number }
export interface Quaternion { x: number; y: number; z: number; w: number }

// Apply Ry(yaw) * Rx(pitch) * Rz(roll) in Three's world coordinates while
// accepting/returning the app's canvas convention (positive Y points down).
// Every planar template uses this one function so card centres and normals can
// never drift onto subtly different planes.
export function tiltPointCanvas(point: Vec3, rig: TiltRig): Vec3 {
  const ax = (rig.pitch ?? 0) * DEG;
  const ay = (rig.yaw ?? 0) * DEG;
  const az = (rig.roll ?? 0) * DEG;
  const sx = Math.sin(ax), cx = Math.cos(ax);
  const sy = Math.sin(ay), cy = Math.cos(ay);
  const sz = Math.sin(az), cz = Math.cos(az);

  // canvas -> world, then Rz, Rx, Ry
  const wx = point.x;
  const wy = -point.y;
  const wz = point.z;
  const xz = wx * cz - wy * sz;
  const yz = wx * sz + wy * cz;
  const zz = wz;
  const xx = xz;
  const yx = yz * cx - zz * sx;
  const zx = yz * sx + zz * cx;
  const xy = xx * cy + zx * sy;
  const yy = yx;
  const zy = -xx * sy + zx * cy;
  return { x: xy, y: -yy, z: zy };
}

export function tiltNormalCanvas(normal: Vec3, rig: TiltRig): Vec3 {
  const p = tiltPointCanvas(normal, rig);
  const length = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / length, y: p.y / length, z: p.z / length };
}

export function softLimit(value: number, limit: number, softness = 1): number {
  if (limit <= 0) return 0;
  return Math.tanh((value / limit) * softness) * limit;
}

export function smoother(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// Symmetric seam envelope. `edge` is the fraction at each end used to hide a
// wrapped ownership hand-off; 0 keeps the item fully visible.
export function wrapEnvelope(phase01: number, edge: number): number {
  const e = clamp(edge, 0, 0.49);
  if (e <= 0) return 1;
  const p = ((phase01 % 1) + 1) % 1;
  return smoother(Math.min(p / e, (1 - p) / e, 1));
}

// Dim a card as it turns away, WITHOUT ever hiding it. Use this when the value
// being passed is a position-derived "which side am I on" proxy rather than the
// card's true facing — a ring of cards lying flat ON a plane, for instance, all
// share the plane's normal and none of them is ever genuinely reversed, so the
// far arc must stay present or the ring reads as a front-only fan.
export function depthDim(sideZ: number, amount: number): number {
  const a = clamp(amount / 100, 0, 1);
  const facing = smoother((sideZ + 0.15) / 1.15);
  return 1 - a * (1 - facing);
}

// Dim AND hide. Use this when the argument is the card's real surface normal —
// a sphere tile, a ring card turned outward — where turning past edge-on would
// expose the DoubleSide back.
export function backfaceFade(normalZ: number, amount: number): number {
  const a = clamp(amount / 100, 0, 1);
  const facing = smoother((normalZ + 0.15) / 1.15);
  // How much a turning-away card DIMS — this is what `amount` controls, and it
  // deliberately never reaches zero on its own: at amount 55 a fully reversed
  // card still returns 0.45.
  const dim = 1 - a * (1 - facing);
  // Whether it is visible AT ALL, which `amount` must not control. The card
  // meshes are THREE.DoubleSide, so a plane turned past edge-on draws its back:
  // the same texture, mirrored. Dimming that to 45% does not make reversed
  // lettering read as anything but broken — it has to actually go to zero.
  //
  // The cut runs over normalZ 0→0.12, i.e. entirely within the last sliver
  // before edge-on. A card that close to edge-on projects to almost no area
  // anyway, so nothing visible is lost: by the angle at which the back would
  // start to show, alpha is already 0. This is what a solid object does.
  const front = smoother(clamp(normalZ / 0.12, 0, 1));
  return dim * front;
}

export function perspectiveFov(value: number, max = 100): number {
  return 15 + clamp(value / max, 0, 1) * 80;
}

export function shortestAngle(from: number, to: number): number {
  const d = ((to - from + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return from + d;
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

// Same intrinsic XYZ convention used by THREE.Euler. Kept dependency-free so
// template transforms remain pure and can run in Node verification scripts.
export function quaternionFromEuler(x: number, y: number, z: number): Quaternion {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return normalizeQuaternion({
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  });
}

export function slerpQuaternion(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let end = b;
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  if (dot < 0) {
    dot = -dot;
    end = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (dot > 0.9995) {
    return normalizeQuaternion({
      x: a.x + (end.x - a.x) * t,
      y: a.y + (end.y - a.y) * t,
      z: a.z + (end.z - a.z) * t,
      w: a.w + (end.w - a.w) * t,
    });
  }
  const theta = Math.acos(clamp(dot, -1, 1));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return normalizeQuaternion({
    x: a.x * wa + end.x * wb,
    y: a.y * wa + end.y * wb,
    z: a.z * wa + end.z * wb,
    w: a.w * wa + end.w * wb,
  });
}

export function multiplyQuaternion(a: Quaternion, b: Quaternion): Quaternion {
  return normalizeQuaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}

export function criticallyDamped(t: number, response = 7): number {
  const x = Math.max(0, t);
  return 1 - (1 + response * x) * Math.exp(-response * x);
}

export function springOvershoot(t: number, damping = 7, frequency = 10): number {
  const x = Math.max(0, t);
  return 1 - Math.exp(-damping * x) * (Math.cos(frequency * x) + (damping / frequency) * Math.sin(frequency * x));
}

export function velocityLean(speed: number, referenceSpeed: number, maxDegrees = 3): number {
  return softLimit(speed / Math.max(1e-6, referenceSpeed), 1, 1.15) * maxDegrees;
}
