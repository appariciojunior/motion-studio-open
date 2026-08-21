import type { CameraPose, LayerTransform, LayerTransform3D, Template, TransformCtx } from '@/lib/types';
import { TAU, clamp, smooth } from '@/lib/motion';
import { DEG, multiplyQuaternion, quaternionFromEuler, type Quaternion, type Vec3 } from '@/lib/tilt3d';
import { variant } from './variant';

const BASE = 340;

// ---------------------------------------------------------------------------
//  The reference tool's Spinner, TRANSCRIBED — not inferred from screenshots.
//
//  Every constant below was read out of the reference's own shipped module (its
//  `computeFrame`, `applySpinnerCamera`, `steppedSpinAngle`, `computeViewFades`)
//  and then checked against its LIVE scene graph: scripts/_scene_spinner.cjs
//  installs three's devtools hook before navigation, wraps the renderer's
//  render() to catch the camera, and reads every card's world matrix out of the
//  running page. On its Spinner 01 the camera comes back fov 32.6674, z
//  7045.361, near 70.454, far 9595.4 — the formulas here reproduce all four to
//  three decimals — and each card centre sits at hypot 335.0 = 300 + 35, at
//  exactly the ring angle its own rotation carries.
//
//  Reading it was the only way. A pixel bounding box could not settle the
//  camera: sweeping the reference's Perspective from 125 to 2000 moved the
//  measured box of Spinner 01 by under half a percent, because the cards that
//  balloon under a wide lens are the ones passing edge-on, and an edge-on card
//  rasterizes to nothing. Two probes disagreed and the scene graph was right.
//
//  The belt is NOT a ring of tangent cards. Each card is pinned by its inner
//  edge to the rotation axis and swings out from there like a paddle: the local
//  pivot is (0, planeSize/2, hinge) for a horizontal fold — half the card's own
//  size across the fold, so its inner edge lands on the axis — turned by the
//  ring angle, then pushed radially out by the orbit radius. `hinge` is an
//  offset along the card's OWN normal, and that is what turns the pinwheel into
//  the Hinge and Fan presets.
// ---------------------------------------------------------------------------

// The reference's card is `PLANE` tall and `PLANE * aspect` wide, ALWAYS: the
// card shape only moves the width, never the height. Its own units; converted
// to preview px by unitScale().
const PLANE = 600;
const HALF_PLANE = PLANE / 2;

// Its perspectiveToFov: tan(fov/2) walks linearly from tan(5deg) to tan(60deg)
// as `perspective` goes 0 -> 1000, clamped at 2000. So 125 is a 32.7deg lens
// and 1500 is a 137deg one — the control is a real lens, not a fudge factor.
const TAN_MIN = Math.tan(5 * DEG);
const TAN_MAX = Math.tan(60 * DEG);
// The reference's own default camera distance. Zoom here is that distance as a
// percentage of it, which is why its presets land on round numbers:
// 688.235 -> 85%, 780 -> 75%, 1170 -> 50%, 1500 -> 39%, 460.63 -> 127%.
const REF_DISTANCE = 585;

// Controls added over the years arrive as undefined on scenes saved before they
// existed; a bare `v.key` would turn into NaN on the first multiply and take the
// whole pose down, and a card at NaN is not drawn at all.
const num = (value: any, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const pick = (value: any, fallback: string) => (typeof value === 'string' ? value : fallback);

function cardAspectOf(ctx: TransformCtx) {
  return Math.max(0.05, num(ctx.cardAspect, 1));
}

function fovFor(v: Record<string, any>) {
  const t = TAN_MIN + (clamp(num(v.perspective, 125), 0, 2000) / 1000) * (TAN_MAX - TAN_MIN);
  return (2 * Math.atan(t)) / DEG;
}

// The reference's `distance`, recovered from our percentage Zoom.
function refDistance(v: Record<string, any>) {
  return (REF_DISTANCE * 100) / clamp(num(v.zoom, 85), 5, 800);
}

// Preview px per reference unit.
//
// The reference pulls its camera back to `SREF * distance` where SREF is
// PLANE / (200 * tan(refFov/2)), then divides by the tangent of the ACTUAL fov —
// so the half-height at z=0 comes out as PLANE * distance / 200 and its own
// normalizing lens cancels out entirely. That is why its Perspective control
// changes the keystone without changing how big a face-on card reads. One
// reference unit is therefore (height/2) / (PLANE/200 * distance) px here, and
// the camera then sits at this app's own 1:1 distance for its fov. Checked
// against the reference's 4:5 stage: its Spinner 01 card covers 0.1453 of the
// frame height by measurement and PLANE * unitScale predicts 0.1453.
const FRAME_PER_DISTANCE = PLANE / 200;
function unitScale(v: Record<string, any>, ctx: TransformCtx) {
  return ctx.height / 2 / (FRAME_PER_DISTANCE * refDistance(v));
}

// ---------------------------------------------------------------------------
//  Motion
// ---------------------------------------------------------------------------

// The reference couples its Rotation toggle to the belt's own rate: with the
// roll on, the belt turns TWICE per loop while the whole assembly rolls once.
function cyclesFor(v: Record<string, any>) {
  return pick(v.motionRotation, 'static') === 'rotation' ? 2 : 1;
}
function rollTurns(v: Record<string, any>) {
  return pick(v.motionRotation, 'static') === 'rotation' ? 1 : 0;
}

// The belt advances one SLOT per step, and `easedPhase` is the right tool here
// even though a continuous ring must never see it (see the Runway/Pulse notes):
// the reference genuinely steps. Its steppedSpinAngle counts whole steps and
// shapes the fraction with the curve, so on Linear it collapses to exactly
// dir * (t/L) * cycles * TAU — indistinguishable from a continuous spin — and on
// a curve (its Hinge 05 ships Glide) it deals one card at a time. Feeding the
// STEP COUNT through easedPhase reproduces both cases with one expression.
function spinAngle(frame: number, count: number, v: Record<string, any>, ctx: TransformCtx) {
  const dir = pick(v.direction, 'forward') === 'forward' ? 1 : -1;
  const slots = Math.max(1, count);
  const phase01 = frame / Math.max(1, ctx.totalFrames);
  const steps = phase01 * cyclesFor(v) * slots * Math.max(0.01, num(v.speed, 1));
  return dir * ctx.easedPhase(steps) * (TAU / slots);
}

// The reference ties the roll to the raw loop, not to the stepping, so it stays
// seamless whatever the curve and whatever Speed does to the belt.
function rollAngle(frame: number, v: Record<string, any>, ctx: TransformCtx) {
  return rollTurns(v) * TAU * (frame / Math.max(1, ctx.totalFrames));
}

// ---------------------------------------------------------------------------
//  Geometry — everything below is in the reference's units and its y-UP frame,
//  and is converted to this app's canvas convention (y down) only on the way
//  out. Keeping the whole derivation in one handedness is deliberate: the pose
//  is a position AND an orientation, and flipping only one of them leaves every
//  card's face on the wrong side of the plane its own centre sits on.
// ---------------------------------------------------------------------------

interface Slot {
  point: Vec3;          // card centre, reference units, y up
  quaternion: Quaternion;
  normal: Vec3;         // the front face's outward direction
  spanZ: number;        // upper bound on |z| over the whole belt, for sorting
}

// The camera, in the reference's own units — the geometry needs it too, since
// which side of a card is showing is a question about the line of sight and not
// about the z axis, and Offset moves the eye a long way off that axis.
function cameraRef(v: Record<string, any>) {
  const fov = fovFor(v);
  const half = FRAME_PER_DISTANCE * refDistance(v);
  return {
    fov,
    half,
    dist: half / Math.tan((fov * DEG) / 2),
    panX: (num(v.offset?.x) / 100) * half,
    panY: (num(v.offset?.y) / 100) * half,
  };
}

const rotateX = (p: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
};
const rotateY = (p: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
};
const rotateZ = (p: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
};

// The reference nests two groups above the cards: the inner one carries
// rotationX/Y/Z as a THREE Euler XYZ (Rx*Ry*Rz), the outer one carries the
// roll — so the roll goes on OUTSIDE the rig, and the rig moves centres and
// faces together. The previous port turned positions with Ry*Rx*Rz (via
// tiltPointCanvas) while turning faces with Rx*Ry*Rz, which cancels out
// whenever a single rig axis is used and pulls the cards off their own ring the
// moment two are (Spinner 03, Hinge 05, Fan 01 all use two or three).
function rigPoint(p: Vec3, v: Record<string, any>) {
  return rotateX(rotateY(rotateZ(p, num(v.rotateZ) * DEG), num(v.rotateY) * DEG), num(v.rotateX) * DEG);
}
function rigQuaternion(v: Record<string, any>) {
  return quaternionFromEuler(num(v.rotateX) * DEG, num(v.rotateY) * DEG, num(v.rotateZ) * DEG);
}

function rotateVectorByQuaternion(q: Quaternion, p: Vec3): Vec3 {
  // q * (p,0) * q^-1, expanded.
  const { x, y, z, w } = q;
  const tx = 2 * (y * p.z - z * p.y);
  const ty = 2 * (z * p.x - x * p.z);
  const tz = 2 * (x * p.y - y * p.x);
  return {
    x: p.x + w * tx + (y * tz - z * ty),
    y: p.y + w * ty + (z * tx - x * tz),
    z: p.z + w * tz + (x * ty - y * tx),
  };
}

// The belt's fixed numbers for one set of values: how far the card centres orbit
// and how far the whole thing can reach in z.
function beltMetrics(v: Record<string, any>, ctx: TransformCtx) {
  const aspect = cardAspectOf(ctx);
  const horizontal = pick(v.axis, 'horizontal') === 'horizontal';
  // Half the card's own size ACROSS the fold: its height when it folds about a
  // horizontal axis, its width when it folds about a vertical one. This is what
  // puts the card's inner edge on the axis at Diameter 0.
  const across = horizontal ? HALF_PLANE : HALF_PLANE * aspect;
  const hinge = num(v.hinge);
  // The panel's Diameter is twice the reference's orbitRadius (its own control
  // carries displayScale 2), and the radius is ADDED to the pivot vector's
  // length rather than replacing it — which is why the belt never collapses to
  // a point at Diameter 0, it closes onto the card's own inner edge.
  const radius = Math.max(0, num(v.diameter, 70)) / 2;
  // The pivot vector's length is the same at every angle (it is that vector
  // turned, nothing more), so the reference's per-card radial push is exactly a
  // scale on it — no normalizing inside the loop.
  const pivot = Math.hypot(across, hinge);
  const push = radius !== 0 && pivot > 0.001 ? (pivot + radius) / pivot : 1;
  return {
    horizontal, across: across * push, hinge: hinge * push,
    orbit: pivot * push,
    spanZ: pivot * push + Math.hypot(HALF_PLANE * aspect, HALF_PLANE),
  };
}

type Belt = ReturnType<typeof beltMetrics>;

// Just the centre — the fade needs every card's depth and nothing else, and
// building 40 quaternions per card to get 40 z values is the kind of cost that
// only shows up on the slowest machine somebody owns.
function slotPoint(index: number, count: number, spin: number, roll: number, belt: Belt, v: Record<string, any>) {
  const theta = (index / Math.max(1, count)) * TAU + spin;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const a = belt.across, b = belt.hinge;
  // Rx(theta) applied to (0, across, hinge) for a horizontal fold; Ry(theta)
  // applied to (across, 0, hinge) for a vertical one. The signs differ because a
  // turn about +y carries the x,z plane the other way round — this is the
  // reference's own pair of expressions, not a simplification of them.
  const local: Vec3 = belt.horizontal
    ? { x: 0, y: a * cos - b * sin, z: a * sin + b * cos }
    : { x: a * cos + b * sin, y: 0, z: -a * sin + b * cos };
  return { theta, point: rotateZ(rigPoint(local, v), roll) };
}

function slotAt(index: number, count: number, spin: number, roll: number, belt: Belt, v: Record<string, any>): Slot {
  const { theta, point } = slotPoint(index, count, spin, roll, belt, v);
  const card = belt.horizontal
    ? quaternionFromEuler(theta, 0, num(v.fanRotation) * DEG)
    : quaternionFromEuler(0, theta, num(v.fanRotation) * DEG);
  const quaternion = multiplyQuaternion(
    quaternionFromEuler(0, 0, roll),
    multiplyQuaternion(rigQuaternion(v), card),
  );
  const normal = rotateVectorByQuaternion(quaternion, { x: 0, y: 0, z: 1 });
  return { point, quaternion, normal, spanZ: belt.spanZ };
}

// The reference's fade is by VIEW DEPTH across the cards on screen right now,
// normalized so the nearest card stays at 1 and the farthest takes the full
// strength — not by ring angle, which is why it keeps working once the rig has
// tipped the belt over. Its computeViewFades needs the whole set's depth range,
// so the range is rebuilt here per frame; the belt is at most 40 cards, and the
// alternative — a closed-form envelope — would disagree with the reference at
// low counts, where the discrete slots never reach the envelope's extremes.
function viewFade(z: number, frame: number, count: number, spin: number, roll: number, belt: Belt, v: Record<string, any>) {
  const n = clamp(num(v.fade) / 100, 0, 1);
  if (n === 0) return 1;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < count; i++) {
    const depth = slotPoint(i, count, spin, roll, belt, v).point.z;
    if (depth < lo) lo = depth;
    if (depth > hi) hi = depth;
  }
  const span = hi - lo;
  if (span < 1e-6) return 1;
  // 0 = nearest card, 1 = farthest. The reference remaps it through
  // acos(1 - 2u)/PI, an S-curve that keeps the middle of the belt from washing
  // out, and scales by (1 + n^2*20)*n so the top of the slider bites hard.
  const u = clamp((hi - z) / span, 0, 1);
  const shaped = Math.acos(1 - 2 * u) / Math.PI;
  return clamp(1 - shaped * (1 + n * n * 20) * n, 0, 1);
}

// Frontface/Backface are a real cull in the reference (FrontSide / BackSide /
// DoubleSide on the material), so a hidden side goes away completely rather
// than dimming. Which side shows is decided against the LINE OF SIGHT, not
// against the z axis: the GPU culls by the triangle's winding once projected,
// and with Offset panning the eye by a third of the frame (Fan 03) those two
// answers part company near edge-on. Ramped over the last sliver rather than
// switched — a card that close to edge-on covers almost no pixels, so nothing
// visible is lost and it stops popping as it crosses.
function facingAlpha(slot: Slot, cam: ReturnType<typeof cameraRef>, v: Record<string, any>) {
  const front = pick(v.frontface, 'show') !== 'hide';
  const back = pick(v.backface, 'show') !== 'hide';
  if (front && back) return 1;
  if (!front && !back) return 0;
  const view = { x: cam.panX - slot.point.x, y: cam.panY - slot.point.y, z: cam.dist - slot.point.z };
  const len = Math.hypot(view.x, view.y, view.z) || 1;
  const towards = (slot.normal.x * view.x + slot.normal.y * view.y + slot.normal.z * view.z) / len;
  return smooth(clamp((front ? towards : -towards) / 0.06, 0, 1));
}

// A card that is merely FAR must not go see-through, or the belt reads as glass
// — so `solid`, the reference's own default, darkens (the reference mixes toward
// its background colour) and only `alpha` actually thins the card out.
function shading(fade: number, v: Record<string, any>) {
  const useAlpha = pick(v.fadeMode, 'solid') === 'alpha';
  return { alpha: useAlpha ? fade : 1, dim: useAlpha ? 0 : 1 - fade };
}

function cameraFor(v: Record<string, any>, ctx: TransformCtx): CameraPose {
  const cam = cameraRef(v);
  const k = unitScale(v, ctx);
  const aspect = cardAspectOf(ctx);
  // The reference's own far plane: the belt's total reach, four times over.
  const spread = Math.max(PLANE * aspect, PLANE) + Math.abs(num(v.hinge)) + Math.max(0, num(v.diameter, 70)) / 2;
  // Offset pans the CAMERA — position and lookAt together, as a share of the
  // frame's half-HEIGHT on BOTH axes — so the belt keeps the lens axis it had
  // and simply sits off centre, keystone and all. `y` is negated because camera
  // poses are handed over in canvas coordinates and the renderer flips them.
  return {
    fov: cam.fov,
    position: { x: cam.panX * k, y: -cam.panY * k, z: cam.dist * k },
    target: { x: cam.panX * k, y: -cam.panY * k, z: 0 },
    near: Math.max(0.1, 0.01 * cam.dist * k),
    far: (cam.dist + spread * 4 + 10) * k,
  };
}

const spinner: Template = {
  meta: {
    id: 'spinner-01', name: 'Spinner 01', group: 'Spinner', repeatAssets: true,
    engine: 'webgl', cardAspect: 1, isNew: true, defaultEasing: { id: 'linear' },
  },
  controls: [
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward', 'reverse'], default: 'forward' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0.1, max: 3, step: 0.05, default: 1, unit: '×', section: 'Motion' },
    { key: 'motionRotation', label: 'Motion Rotation', type: 'toggle', options: ['static', 'rotation'], default: 'static', section: 'Motion' },
    // 3 is the reference's own floor: two cards share one axis and draw a plane,
    // not a belt.
    { key: 'count', label: 'Count', type: 'slider', min: 3, max: 40, step: 1, default: 6 },
    { key: 'cornerRadius', label: 'Corner', type: 'slider', min: 0, max: 100, step: 1, default: 10, unit: '%' },
    { key: 'shape', label: 'Shape', type: 'toggle', options: ['normal', 'squircle'], default: 'squircle' },
    { key: 'axis', label: 'Axis', type: 'toggle', options: ['vertical', 'horizontal'], default: 'horizontal' },
    { key: 'fanRotation', label: 'Rotation', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' },
    { key: 'diameter', label: 'Diameter', type: 'slider', min: 0, max: 1000, step: 1, default: 70 },
    { key: 'hinge', label: 'Hinge', type: 'slider', min: -1000, max: 1000, step: 1, default: 0 },
    { key: 'fade', label: 'Fade', type: 'slider', min: 0, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'fadeMode', label: 'Fade Mode', type: 'toggle', options: ['alpha', 'solid'], default: 'solid', visibleWhen: { key: 'fade', not: 0 } },
    { key: 'frontface', label: 'Frontface', type: 'toggle', options: ['show', 'hide'], default: 'show' },
    { key: 'backface', label: 'Backface', type: 'toggle', options: ['show', 'hide'], default: 'show' },
    { key: 'rotateX', label: 'X', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' },
    { key: 'rotateY', label: 'Y', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' },
    { key: 'rotateZ', label: 'Z', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' },
    { key: 'zoom', label: 'Zoom', type: 'slider', min: 25, max: 200, step: 1, default: 85, unit: '%' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 2000, step: 1, default: 125 },
    { key: 'offset', label: 'Offset', type: 'xypad', max: 100, default: { x: 0, y: 0 },
      description: 'Pans the camera as a share of the half-frame, so the belt sits off centre without its own axis moving.' },
  ],
  // The 2D pose. This is what the catalogue thumbnails draw, and they have no
  // camera of their own — so the projection the renderer would do in 3D is done
  // here: the card's own two axes are projected and the resulting 2x2 is
  // decomposed into the rotation/scale/skew a sprite can carry. An affine
  // approximation (one depth per card rather than per pixel) is all a sprite
  // can express anyway; a card that genuinely needs the keystone is on the 3D
  // path, which is the one the stage uses.
  transform: (frame, index, count, v, ctx): LayerTransform => {
    const k = unitScale(v, ctx);
    const spin = spinAngle(frame, count, v, ctx);
    const roll = rollAngle(frame, v, ctx);
    const belt = beltMetrics(v, ctx);
    const slot = slotAt(index, count, spin, roll, belt, v);
    const aspect = cardAspectOf(ctx);
    const cam = cameraRef(v);

    // Perspective magnification at this card's depth, floored so a card that
    // has crossed the lens never inverts or explodes off to infinity.
    const f = cam.dist / Math.max(cam.dist * 0.08, cam.dist - slot.point.z);
    const x = (slot.point.x - cam.panX) * f * k;
    const y = -(slot.point.y - cam.panY) * f * k;

    // The card's own axes in screen directions. Its local +y points UP in the
    // reference's frame and DOWN on this canvas, hence the second negation.
    const u = rotateVectorByQuaternion(slot.quaternion, { x: 1, y: 0, z: 0 });
    const w = rotateVectorByQuaternion(slot.quaternion, { x: 0, y: 1, z: 0 });
    const ax = u.x, ay = -u.y;
    const bx = w.x, by = -w.y;
    // pixi builds its matrix (Container._updateSkew) as
    //   (a, b) = ( cos(rotation + skewY), sin(rotation + skewY)) * scaleX
    //   (c, d) = (-sin(rotation - skewX), cos(rotation - skewX)) * scaleY
    // so with skewY at 0 each column is read straight off its OWN projected
    // axis: the first column fixes `rotation`, and the angle that satisfies the
    // second is atan2(-bx, by) — the components enter swapped and negated
    // because that column is built from -sin and cos rather than cos and sin.
    //
    // Taking the second angle off the FIRST axis and then patching the
    // orientation with a negative scaleY, which is what stood here, leaves the
    // card's short axis up to 90 degrees off its real direction (measured 1.91
    // on a unit axis, Spinner 02 at frame 199) and hands every card that shows
    // its back a negative height. A mirrored card is not a negative scale in
    // this parameterization: it is a skew past 90 degrees, and cos(skewX)
    // carries the flip — which is why scaleY here is a plain length.
    const rotation = Math.atan2(ay, ax);
    const skewX = rotation - Math.atan2(-bx, by);

    const fade = viewFade(slot.point.z, frame, count, spin, roll, belt, v);
    const shade = shading(fade, v);
    return {
      x, y,
      scale: (PLANE * k * Math.max(1, aspect) * f) / BASE,
      scaleX: Math.hypot(ax, ay),
      scaleY: Math.hypot(bx, by),
      rotation,
      skewX,
      alpha: shade.alpha * facingAlpha(slot, cam, v),
      dim: shade.dim,
      // Painter's order for the paths without a depth buffer. The reference
      // sorts by how face-on a card is rather than by depth, which is a choice
      // its depth test then mostly overrides; true depth is the closer stand-in
      // for what its stage actually shows.
      depth: clamp(0.5 + slot.point.z / (2 * Math.max(1, slot.spanZ)), 0, 1),
    };
  },
  transform3d: (frame, index, count, v, ctx): LayerTransform3D => {
    const k = unitScale(v, ctx);
    const spin = spinAngle(frame, count, v, ctx);
    const roll = rollAngle(frame, v, ctx);
    const belt = beltMetrics(v, ctx);
    const slot = slotAt(index, count, spin, roll, belt, v);
    const aspect = cardAspectOf(ctx);
    const cam = cameraRef(v);
    const fade = viewFade(slot.point.z, frame, count, spin, roll, belt, v);
    const shade = shading(fade, v);
    return {
      x: slot.point.x * k,
      // The reference builds the belt y-up; this app hands the renderer canvas
      // coordinates and it negates y on the way into the scene. The quaternion
      // is passed through untouched, so negating y here is the whole conversion.
      y: -slot.point.y * k,
      z: slot.point.z * k,
      quaternion: slot.quaternion,
      scale: (PLANE * k * Math.max(1, aspect)) / BASE,
      alpha: shade.alpha * facingAlpha(slot, cam, v),
      dim: shade.dim,
    };
  },
  camera: cameraFor,
};

// The reference's curve names, mapped to this app's presets:
//   its Linear                    -> linear
//   its Glide  [.85,.15,.15,.85]  -> flow   [.86,.14,.14,.86]
//   its Natural [.8, 0, .2, 1]    -> smooth [.76,0,.24,1]
// Its own "Glide" const is a different curve from its "Glide" preset; the
// presets are what its spinner variants carry, so those are the ones matched.
export const spinnerVariants: Template[] = [
  spinner,
  variant(spinner, 'spinner-02', 'Spinner 02', { motionRotation: 'rotation' }),
  variant(spinner, 'spinner-03', 'Spinner 03', {
    count: 32, axis: 'vertical', diameter: 500, rotateX: -60, rotateY: 60, rotateZ: 90, zoom: 50, perspective: 1500,
  }),
  variant(spinner, 'spinner-04', 'Spinner 04', {
    count: 18, axis: 'vertical', rotateX: -18, rotateY: -4, offset: { x: 0, y: 7 }, perspective: 840,
  }),
  variant(spinner, 'spinner-05', 'Spinner 05', { count: 32, perspective: 1000 }),
  variant(spinner, 'spinner-06', 'Spinner 06', {
    count: 40, axis: 'vertical', diameter: 1000, rotateX: 20, zoom: 39,
  }, undefined, { cardAspect: 4 / 3 }),
  variant(spinner, 'hinge-01', 'Hinge 01', { count: 9, hinge: 282, rotateX: -45, rotateY: -45, zoom: 75 }),
  variant(spinner, 'hinge-02', 'Hinge 02', { count: 9, hinge: 282, rotateX: -45, zoom: 75 }),
  variant(spinner, 'hinge-03', 'Hinge 03', { count: 9, hinge: 282, rotateY: -30, zoom: 75 }),
  variant(spinner, 'hinge-04', 'Hinge 04', {
    count: 12, hinge: 282, rotateY: -15, zoom: 75, perspective: 1345, offset: { x: -5, y: 0 },
  }),
  variant(spinner, 'hinge-05', 'Hinge 05', {
    count: 12, hinge: 280, rotateX: -115, rotateY: -35, rotateZ: -15, zoom: 75, perspective: 1000,
  }, { id: 'flow' }),
  variant(spinner, 'fan-01', 'Fan 01', {
    count: 12, direction: 'reverse', axis: 'vertical', fanRotation: 180, hinge: 75,
    rotateY: -60, rotateZ: -180, zoom: 125, perspective: 250, offset: { x: -16, y: 0 }, backface: 'hide',
  }, { id: 'smooth' }, { cardAspect: 4 / 5 }),
  variant(spinner, 'fan-02', 'Fan 02', {
    count: 6, diameter: 50, zoom: 180, perspective: 150, offset: { x: 0, y: 34 },
  }, undefined, { cardAspect: 4 / 5 }),
  variant(spinner, 'fan-03', 'Fan 03', {
    count: 9, axis: 'vertical', diameter: 440, fade: 13, rotateX: -26, rotateY: 120,
    zoom: 127, perspective: 1000, offset: { x: 34, y: 5 }, backface: 'hide',
  }, undefined, { cardAspect: 4 / 5 }),
];
