// Projecting a webgl template's REAL 3D pose into a DOM thumbnail.
//
// Why this exists: 119 of the 271 catalogue presets are `engine: 'webgl'` and
// pose their cards through `transform3d`, but the thumbnail only ever called
// `transform` — the 2D fallback. So for 44% of the catalogue the thumbnail drew
// a geometry the stage never draws. That is not a fidelity nicety; it is the
// thumbnail advertising the wrong preset.
//
// The thumbnail cannot open a WebGL context per card (a catalogue page would
// need over a hundred), but it does not have to: the stage's camera is frontal
// and centred — `position = {0,0,D}`, `target = {0,0,0}` — and its on-screen
// magnification for a point at depth z is D / (D - z). CSS `perspective: D`
// produces P / (P - z). Same function. So the browser's own perspective does
// the projection exactly, for free, and the card stays a plain element.
//
// The one trap is handedness. The stage lives in three's y-up space and negates
// y on the way in (`position.set(t.x, -t.y, t.z)`), while the pose contract and
// CSS are both y-down. Rather than reason about which rotation signs flip (Rx
// and Rz do, Ry does not — and a quaternion flips in a way that is easy to get
// wrong by hand), this builds the matrix in the stage's own space and CONJUGATES
// it by the flip: M_css = F · M_stage · F, with F = diag(1,-1,1,1). Mechanical,
// and correct for Euler and quaternion alike.
import type { CameraPose, LayerTransform3D, Template, TransformCtx } from '@/lib/types';

/** A 4x4 in column-major order, the layout CSS matrix3d() takes. */
export type Mat4 = number[];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

const identity = (): Mat4 => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function translation(x: number, y: number, z: number): Mat4 {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];
}

// three's default Euler order is XYZ, and its matrix for that order is
// Rx · Ry · Rz — the same composition order CSS writes as
// `rotateX() rotateY() rotateZ()`.
function rotationFromEuler(x: number, y: number, z: number): Mat4 {
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  const Rx: Mat4 = [1,0,0,0, 0,cx,sx,0, 0,-sx,cx,0, 0,0,0,1];
  const Ry: Mat4 = [cy,0,-sy,0, 0,1,0,0, sy,0,cy,0, 0,0,0,1];
  const Rz: Mat4 = [cz,sz,0,0, -sz,cz,0,0, 0,0,1,0, 0,0,0,1];
  return multiply(multiply(Rx, Ry), Rz);
}

function rotationFromQuaternion(q: { x: number; y: number; z: number; w: number }): Mat4 {
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  const x = q.x / len, y = q.y / len, z = q.z / len, w = q.w / len;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1,
  ];
}

// diag(1,-1,1,1) — three's y-up against the canvas/CSS y-down. Involutive, so
// the same matrix serves on both sides of the conjugation.
const FLIP: Mat4 = [1,0,0,0, 0,-1,0,0, 0,0,1,0, 0,0,0,1];

/**
 * The card's pose as a CSS-space matrix, in the THUMBNAIL's pixels.
 *
 * `k` is thumbnailWidth / previewWidth. Every length has to go through it —
 * x, y, z and the container's perspective alike — because a CSS 3D transform is
 * measured in the element's own pixels while the template poses in preview
 * pixels. Scaling only some of them tilts the projection instead of resizing it.
 *
 * The translation deliberately stays IN the matrix rather than going out to
 * left/top like the 2D path does. Under perspective those are not the same
 * thing: a card at x=100, z=-500 projects to x·P/(P+500) — pulled toward the
 * centre as it recedes — and positioning it with left/top would place it at a
 * flat x=100 with no such foreshortening.
 *
 * Scale is absent on purpose: the thumbnail sizes the element itself, as the 2D
 * path does with width/aspect-ratio, so applying it here too would square it.
 */
export function pose3dMatrix(t: LayerTransform3D, k = 1, gain = 1): Mat4 {
  const rotation = t.quaternion
    ? rotationFromQuaternion(t.quaternion)
    : rotationFromEuler(t.rotationX ?? 0, t.rotationY ?? 0, t.rotationZ ?? 0);
  // Built in the stage's space, y already negated, exactly as renderer3d does.
  // `gain` lands on x and y but never on z: z is what the perspective divide
  // consumes, and scaling it would move the card in depth instead of resizing
  // its projection. See thumbPerspective for where the ratio comes from.
  const stage = multiply(translation(t.x * k * gain, -t.y * k * gain, t.z * k), rotation);
  return multiply(multiply(FLIP, stage), FLIP);
}

export function matrix3dString(m: Mat4): string {
  return `matrix3d(${m.map((n) => (Math.abs(n) < 1e-6 ? 0 : Number(n.toFixed(6)))).join(', ')})`;
}

/**
 * The eye distance CSS needs, derived the same way the stage derives its camera.
 *
 * Mirrors renderer3d.updateTrackCamera: fov comes from the template's own
 * camera() when it has one, else from the `perspective` control mapped over
 * 15..95 degrees; D = (height/2) / tan(fov/2); and `distance` multiplies D.
 *
 * A template that sets an explicit camera `position` bypasses the fit distance
 * on the stage, so it does here too — and a camera that is not on the axis
 * cannot be expressed as a CSS perspective at all, which the caller has to know.
 */
export function thumbPerspective(
  template: Template,
  values: Record<string, any>,
  ctx: TransformCtx,
): { perspective: number; gain: number; exact: boolean } {
  let pose: CameraPose | undefined;
  try { pose = template.camera?.(values, ctx); } catch { pose = undefined; }

  const control = Math.max(0, Math.min(200, Number(values.perspective ?? 100)));
  const fov = pose?.fov ?? (15 + (95 - 15) * (control / 200));
  const D = (ctx.height / 2) / Math.tan((fov * Math.PI) / 360);

  // The eye distance, and whether the camera sits on the axis at all.
  let P: number;
  let exact = true;
  if (pose?.position) {
    P = Math.max(1, Math.abs(pose.position.z));
    // Off the axis there is no CSS perspective that reproduces the view: CSS
    // always looks straight down -z from the element's perspective-origin.
    exact = Math.abs(pose.position.x) <= 0.5 && Math.abs(pose.position.y) <= 0.5;
  } else {
    P = Math.max(1, D * (pose?.distance ?? 1));
  }

  // The gain is the whole reason this function returns three numbers.
  //
  // The stage magnifies a point at depth z by D / (P - z): moving the camera
  // closer at a FIXED fov makes the subject fill more of the frame. CSS
  // `perspective: P` magnifies by P / (P - z) — it keeps the z=0 plane at 1:1
  // no matter how near the eye is, and only the distortion changes.
  //
  // The two agree exactly when P == D (a template that leaves `distance` alone,
  // which is most of them) and diverge by D/P when it does not. Applying that
  // ratio uniformly to x, y and the card's drawn size — but NOT to z, which
  // belongs to the perspective divide — makes the composition match term for
  // term. scripts/verify-thumb3d.cjs proves it against the stage's own maths.
  return { perspective: P, gain: D / P, exact };
}

/**
 * Where a point at depth z lands, relative to the eye at `perspective`.
 * The stage's magnification is D/(D−z); this is the same quantity, and the
 * verify script uses it to compare the two projections numerically.
 */
export function magnification(perspective: number, z: number): number {
  const denom = perspective - z;
  // Behind the eye or on it: the stage clips these against near/far, and CSS
  // collapses them. Reported as 0 so callers can drop the card.
  if (denom <= 1e-6) return 0;
  return perspective / denom;
}
