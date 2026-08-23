import type { CameraPose, LayerTransform, LayerTransform3D, Template, TransformCtx } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { TAU, clamp, loopCycles, smooth } from '@/lib/motion';
import { DEG, multiplyQuaternion, quaternionFromEuler, type Quaternion, type Vec3 } from '@/lib/tilt3d';
import { variant } from './variant';

// ---------------------------------------------------------------------------
//  The reference tool's Orbit family, TRANSCRIBED — not inferred from pixels.
//
//  Everything below was read out of the reference's own shipped modules:
//    · module 25001  ringRadius, ringSlots, ringCardScale, ringWrapSign,
//                    buildCardGeometry, steppedSpinAngle, cardFade,
//                    applyRingCamera, ringFacing
//    · module 42981  computeRingFrame — the ring group turns by -spin
//    · module 34379  the stage renderer: which group carries the card scale,
//                    where the Bloom pivot sits, how Fade/Contrast/Isolation
//                    are actually applied
//    · module 51437  computeViewFades — the fade is by VIEW DEPTH, not angle
//    · module 87645  perspectiveToFov
//  and then checked against the reference's LIVE scene graph
//  (scripts/_scene_orbit.cjs, capture in .shots/ref-orbit-scene-live.json):
//  Pure 01/05/06, Carousel 04, Lightroom 01/04 and Bloom 03 reproduce camera
//  fov/z/near/far, every card centre, the per-card scale and the rig to the
//  decimals the capture carries. Lightroom 01 is the row that matters most:
//  its camera sits at z 154.06 with a ring of radius 159.15 — the lens is
//  INSIDE the drum, at 139.6 degrees, which the previous port's 50-degree
//  ceiling could not express at all.
//
//  Reading it was the only way. A pixel bounding box cannot settle a ring
//  camera: the cards that balloon under a wide lens are the ones passing
//  edge-on, and an edge-on card rasterizes to nothing.
//
//  The ring is NOT our old "ring size / opening / card size" ring. There the
//  radius came from the canvas and the card filled a share of its slot. Here it
//  is the other way round, and it is the reference's actual model: the CARD is
//  a fixed 100 units tall, the radius is whatever makes the slots exactly one
//  card wide, and Gap then scales the card inside its slot. Which is why the
//  law measured earlier off its own panel — "Gap does not move the radius, and
//  cardSize = 100/(1 + gap/100)" — falls straight out of ringCardScale.
// ---------------------------------------------------------------------------

const BASE = 340;

// The reference's `cardSize`. Every one of the 24 authored presets ships 100,
// and applyRingCamera hard-codes 100 in its own copy of the radius formula, so
// the camera and the geometry only agree while the card is this size.
const CARD = 100;
const HALF_CARD = CARD / 2;

// perspectiveToFov: tan(fov/2) walks linearly from tan(5deg) to tan(60deg) as
// `perspective` goes 0 -> 1000, clamped at 2000. So 300 is a 60deg lens, 1600
// is 140deg and 2000 is 147deg — a real lens, not a fudge factor. Shared with
// templates/spinner.ts, which reads the same function out of the same module.
const TAN_MIN = Math.tan(5 * DEG);
const TAN_MAX = Math.tan(60 * DEG);

// The reference's own default `distance`, so Zoom is that distance read back as
// a percentage. Its panel shows exactly this (the control carries
// displayInvert), and it lands on round numbers for 22 of the 24 presets:
// 329.33 -> 75%, 494 -> 50%, 988 -> 25%, 197.6 -> 125%, 602.44 -> 41%.
const REF_DISTANCE = 247;
// applyRingCamera's zoom curve: distance*3/1000 walks the frame's half-height
// from 1.05 to 3.2 ring radii over [0.02, 1], and extrapolates past it.
const ZOOM_BASE = 1.05;
const ZOOM_SPAN = 2.15;

// How much of that frame the reference actually SHOWS — and this is the one
// number in this file that had to be measured rather than read.
//
// Its camera is exact: fov, z, near and far all reproduce the live scene to
// four decimals, and its cards sit at exactly the radius the formula says. Yet
// its stage photographs the drum at about 80% of the artboard height where the
// arithmetic says 38%. Neither reading was wrong. Its stage canvas is a SQUARE
// sized to the browser window (1600x1600 at a 1600x1000 viewport, 1900x1900 at
// 1900x1200 — measured, scripts/_canvas_orbit.cjs) and the artboard is a much
// smaller CSS window onto the middle of it. The composition is that window, not
// the canvas: its MP4 export clones the camera and calls
//
//     camera.setViewOffset(canvasCssW, canvasCssH, board.x, board.y, board.w, board.h)
//
// which renders exactly the artboard rectangle of the bigger frame. So the
// frame the viewer gets has half-height  W * zoomFactor * (boardH / canvasH),
// and that ratio measured 0.4675 at a 1600x1000 window and 0.4832 at 1900x1200.
//
// It is not a constant on their side — their own framing drifts a few percent
// with the browser window, because the canvas follows the viewport WIDTH while
// the artboard follows its HEIGHT. Ours has to be a constant, so it is the
// value at the 1600x1000 desktop window every probe in this repo drives them
// at. Getting this wrong is not subtle: at 1.0 the ring renders at 47% of the
// size the reference shows, which is the single biggest visual difference
// between this port and the previous one.
const BOARD_CROP = 0.4675;

// Controls added over the years arrive as undefined on scenes saved before they
// existed — and this family's rewrite retires several keys outright. A bare
// `v.key` would turn into NaN on the first multiply and take the whole pose
// down, and a card at NaN is not drawn at all, so an old project would simply
// open empty.
const num = (value: any, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const pick = (value: any, fallback: string) => (typeof value === 'string' ? value : fallback);

function cardAspectOf(ctx: TransformCtx) {
  return Math.max(0.05, num(ctx.cardAspect, 1));
}

function fovFor(v: Record<string, any>) {
  const t = TAN_MIN + (clamp(num(v.perspective, 312), 0, 2000) / 1000) * (TAN_MAX - TAN_MIN);
  return (2 * Math.atan(t)) / DEG;
}

// The lens our canvas actually gets. The artboard is a WINDOW onto the
// reference's frame, and a window is not a camera move — three states it as
// setViewOffset, which keeps every ray and simply renders a sub-rectangle. The
// equivalent for a full-frame camera is a NARROWER fov at the same distance:
// tan(fov/2) scales by the crop.
//
// Getting this wrong is easy and silent, and it cost a round trip here: pulling
// the camera back by 1/crop instead of narrowing the lens looks like the same
// correction and cancels itself out exactly — the render came back
// pixel-identical to the uncropped one, and only projecting the pose by hand
// (scripts/_frame_orbit.cjs) showed why.
function viewFovFor(v: Record<string, any>) {
  return (2 * Math.atan(BOARD_CROP * Math.tan((fovFor(v) * DEG) / 2))) / DEG;
}

// The reference's `distance`, recovered from our percentage Zoom.
function refDistance(v: Record<string, any>) {
  return (REF_DISTANCE * 100) / clamp(num(v.zoom, 100), 5, 1000);
}

// How many ring radii of half-height the camera frames. The reference's own
// curve, verbatim — including the flat 0.35 below distance 6.7, which is the
// branch that keeps an extreme Zoom from turning the camera inside out.
function zoomFactor(v: Record<string, any>) {
  const c = (refDistance(v) / 1000) * 3;
  return c <= 0.02 ? 0.35 : ZOOM_BASE + ((c - 0.02) / 0.98) * ZOOM_SPAN;
}

// ---------------------------------------------------------------------------
//  Geometry — in the reference's units and its y-UP frame. The conversion to
//  this app's canvas convention (y down) happens only on the way out, because
//  the pose is a position AND an orientation: flip one without the other and
//  every card's face ends up on the wrong side of the plane its centre sits on.
// ---------------------------------------------------------------------------

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

// The reference hangs the cards under two nested groups: the outer one carries
// Rotation X/Y/Z as a THREE Euler XYZ (Rx*Ry*Rz), the inner one carries the
// ring's own spin on y. So the rig sits OUTSIDE the spin, and it moves centres
// and faces together — which is why the point and the quaternion below are
// built in the same order. Getting that order wrong cancels out whenever a
// single rig axis is live and prises the ring open the moment two are, which is
// most of the Bloom subfamily (85/90, 75/24/90, 97/-40).
function rigPoint(p: Vec3, v: Record<string, any>) {
  return rotateX(rotateY(rotateZ(p, num(v.ringRoll) * DEG), num(v.ringYaw) * DEG), num(v.tiltX) * DEG);
}
function rigQuaternion(v: Record<string, any>) {
  return quaternionFromEuler(num(v.tiltX) * DEG, num(v.ringYaw) * DEG, num(v.ringRoll) * DEG);
}

// The skew below is a DIFFERENCE of two atan2 results, so it lands anywhere in
// (-2pi, 2pi) — and the branch it lands on can change between two frames that
// draw the same picture. A 2pi shift is exactly equivalent in pixi's
// parameterization (the angle only ever enters through sin and cos), but the
// loop-closure check compares the numbers, and verify-tilt caught Orbit Bloom
// card 7 handing it a 6.283 delta across the seam. Wrapping it is free and
// makes the seam numerically identical, not merely visually.
function wrapAngle(a: number) {
  const t = (a + Math.PI) % TAU;
  return (t < 0 ? t + TAU : t) - Math.PI;
}

function rotateVectorByQuaternion(q: Quaternion, p: Vec3): Vec3 {
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

interface Ring {
  n: number;
  aspect: number;
  // The card's width ACROSS the ring's tangent, after its own in-plane
  // rotation: |w*cos| + |h*sin|. This one quantity decides the radius, the card
  // scale AND the wrap, which is why the reference computes it in three places
  // and why they have to agree.
  extent: number;
  wrap: boolean;
  // Slot width per unit of radius: the arc for a wrapped card, the chord for a
  // flat one. A flat card spans its chord, so it needs a slightly bigger radius
  // than a wrapped one to leave the same gap — hence tan, not the arc.
  perUnit: number;
  W: number;          // the radius Gap does NOT move: extent / perUnit
  R: number;          // W + Diameter/2, the radius the cards actually sit on
  cardScale: number;  // ringCardScale — the card inside its slot
  frame: number;      // the FULL frame's half-height at z=0, reference units
  half: number;       // the part of it the artboard shows — see BOARD_CROP
  dist: number;       // camera z
  panX: number;
  panY: number;
}

function ringOf(v: Record<string, any>, count: number, ctx: TransformCtx): Ring {
  const n = Math.max(3, Math.round(count));
  const aspect = cardAspectOf(ctx);
  const rot = num(v.cardRotation) * DEG;
  const extent = Math.abs(CARD * aspect * Math.cos(rot)) + Math.abs(CARD * Math.sin(rot));
  const wrap = pick(v.surface, 'cylinder') === 'cylinder';
  const perUnit = wrap ? TAU / n : 2 * Math.tan(Math.PI / n);
  const W = extent / perUnit;
  // The panel's Diameter is twice the reference's orbitRadius (its own control
  // carries displayScale 2), and it is ADDED to the radius the cards would
  // otherwise sit on — so Diameter 0 is a closed ring of touching cards, not a
  // collapse to a point.
  const R = W + Math.max(0, num(v.diameter, 0)) / 2;
  // Gap is a share of the CARD, not of the slot: the slot is fixed by the
  // radius and the count, and the card shrinks inside it. At Gap -50 the cards
  // overlap by half, which is the reference's densest Carousel.
  const spacing = Math.max(0.05, 1 + num(v.gap, 6) / 100);
  const cardScale = clamp((perUnit * R) / (extent * spacing), 0.05, 8);
  // The camera frames a fixed number of the GAP-FREE radii — applyRingCamera
  // recomputes the radius with its own hard-coded 100 and no gap term, so
  // widening the gap spreads the ring inside a still frame instead of pushing
  // it out of shot.
  const frame = W * zoomFactor(v);
  const fov = fovFor(v);
  const dist = frame / Math.tan((fov * DEG) / 2);
  // Offset pans the CAMERA (position and lookAt together), as a share of the
  // FULL frame's half-height on both axes — its own aspect factor for x is the
  // canvas aspect, and its canvas is square, so there is no factor. Measured
  // against the live camera: Bloom 03 at Offset 5/7 sits at (47.31, 66.24) and
  // the formula gives (47.31, 66.24).
  return {
    n, aspect, extent, wrap, perUnit, W, R, cardScale, dist,
    frame,
    half: frame * BOARD_CROP,
    panX: (num(v.offsetX) / 100) * frame,
    panY: (num(v.offsetY) / 100) * frame,
  };
}

// Preview px per reference unit. The reference's half-height at z=0 comes out
// as W * zoomFactor for ANY lens — its camera distance divides by tan(fov/2)
// and the half-height multiplies it back — which is why its Perspective changes
// the keystone without changing how big a face-on card reads. What our canvas
// shows is the artboard's share of that (BOARD_CROP), so the camera below ends
// up framing more than the canvas holds, exactly as its own setViewOffset does.
function unitScale(ring: Ring, ctx: TransformCtx) {
  return ctx.height / 2 / Math.max(1e-6, ring.half);
}

// ---------------------------------------------------------------------------
//  Motion — the ring advances ONE SLOT PER STEP
// ---------------------------------------------------------------------------

// steppedSpinAngle, in our loop-safe units. The reference divides the clip into
// `count` steps, spends a `pause` at the end of each and shapes the rest with
// the preset's curve; on Linear with no pause that collapses to a constant spin
// exactly, because floor(p) + frac(p) is p.
//
// Hold is that pause as a SHARE of the step rather than as seconds, so it
// survives a change of clip length — and the two agree by construction, since
// the reference's own implicit pause (the one it applies when a preset carries
// a curve but no pause) is 0.125 of a step to the digit.
//
// The seam survives all of it: loopCycles returns a whole multiple of `count`,
// and the shaping preserves floor(p), so at frame totalFrames the ring has
// advanced a whole number of turns.
function spinAt(frame: number, v: Record<string, any>, n: number, ctx: TransformCtx) {
  // The reference's forward is -1 on its spin and its group then turns by
  // -spin, so forward advances the world angle and reverse retards it.
  const dir = pick(v.direction, 'reverse') === 'forward' ? 1 : -1;
  const slots = Math.abs(loopCycles(num(v.speed, 1), ctx.duration, n));
  const p = (frame / Math.max(1, ctx.totalFrames)) * slots;
  const move = Math.max(0.01, 1 - clamp(num(v.hold) / 100, 0, 0.9));
  const stepped = Math.floor(p) + ctx.ease(Math.min(1, (p - Math.floor(p)) / move));
  return dir * stepped * (TAU / n);
}

// ---------------------------------------------------------------------------
//  The pose
// ---------------------------------------------------------------------------

// Our own three presets predate this port and are not the reference's: Showcase
// squashes the ring into an ellipse and Bloom pulses its radius and bows it in
// y. They ride on top of the reference ring rather than inside it — every one
// of the 24 ported presets leaves `style` at 'stream', where all three terms
// are exactly 1, 1 and 0.
function styleOf(v: Record<string, any>, ring: Ring, spin: number) {
  const style = pick(v.style, 'stream');
  const pulse = style === 'bloom' ? 1 + (num(v.pulse, 15) / 100) * Math.sin(spin) : 1;
  return {
    width: ring.R * (style === 'showcase' ? num(v.spread, 100) / 100 : 1) * pulse,
    depth: ring.R * pulse,
    curve: style === 'bloom' ? (num(v.curve) / 100) * ring.R * 0.28 : 0,
  };
}

interface Slot {
  point: Vec3;
  quaternion: Quaternion;
  // The direction the PICTURE faces — the card's own +z. This is what
  // Front/Backface culls against, and it is a question about the line of sight
  // rather than about the z axis.
  //
  // Deliberately NOT turned back round by Flip, and this is the one place the
  // port departs from the reference's code. Its ringFacing picks the material
  // side as `frontface_shown !== (flip === 'yes') ? FrontSide : BackSide`, and
  // that XOR culls the wrong face once both are in play: its own Lightroom 05
  // and 06 (Flip yes, Backface hide, camera INSIDE the ring) render completely
  // EMPTY in its shipped build — confirmed not by a canvas read, which lies on
  // its stage, but by a composited screenshot (scripts/_shot_orbit.cjs,
  // .shots/ref-orbit-stage-lightroom-05.png: the 4:5 artboard is blank with
  // the panel showing Lightroom 05 loaded). Lightroom 07 and 08 photograph the
  // same way. Reproducing four blank presets faithfully is worth nothing, so
  // Backface here means what it says — do not draw the reverse of a card — and
  // Flip's job is only to decide which way the picture points, which is what
  // makes a ring filmed from the inside readable at all.
  outward: Vec3;
}

function slotAt(index: number, ring: Ring, v: Record<string, any>, spin: number): Slot {
  const theta = (index / ring.n) * TAU + spin;
  // Flip turns every card a further half turn AND inverts the wrap, so the drum
  // keeps its shape and only its faces change side. It is not a per-card fix
  // for the far arc: the reference applies it to all of them, and its Lightroom
  // presets need it because their camera sits INSIDE the ring, where every card
  // is seen from behind.
  const flipped = pick(v.flip, 'no') === 'yes';
  const face = theta + (flipped ? Math.PI : 0);
  const tiltDeg = num(v.cardTilt);
  const tilt = tiltDeg * DEG;
  const sinT = Math.sin(tilt), cosT = Math.cos(tilt);
  // Bloom swings the card about its LOWER edge for a positive angle and its
  // upper edge for a negative one — the reference hangs the mesh off a pivot
  // group offset by half a card and rotates that. The offset lives inside the
  // per-card scale, so it moves with Gap.
  const pivot = (tiltDeg >= 0 ? -HALF_CARD : HALF_CARD) * ring.cardScale;
  const shape = styleOf(v, ring, spin);
  const cardQ = quaternionFromEuler(tilt, 0, num(v.cardRotation) * DEG);

  if (pick(v.facing, 'ring') === 'camera') {
    // The reference's CameraBillboard sets the card's WORLD quaternion to the
    // camera's own, so the card stays parallel to the image plane rather than
    // aiming at the lens. Our camera never rotates (it pans by moving position
    // and target together), so that world quaternion is the identity — and the
    // card's Bloom pivot then swings in world axes, OUTSIDE the rig, because
    // the billboard group is what the pivot hangs from.
    const point = rigPoint({
      x: Math.sin(theta) * shape.width,
      y: shape.curve,
      z: Math.cos(theta) * shape.depth,
    }, v);
    return {
      point: { x: point.x, y: point.y + pivot * (1 - cosT), z: point.z - pivot * sinT },
      quaternion: cardQ,
      outward: rotateVectorByQuaternion(cardQ, { x: 0, y: 0, z: 1 }),
    };
  }

  const quaternion = multiplyQuaternion(
    rigQuaternion(v),
    multiplyQuaternion(quaternionFromEuler(0, face, 0), cardQ),
  );
  const local = {
    x: Math.sin(theta) * shape.width - pivot * sinT * Math.sin(face),
    y: shape.curve + pivot * (1 - cosT),
    z: Math.cos(theta) * shape.depth - pivot * sinT * Math.cos(face),
  };
  return {
    point: rigPoint(local, v),
    quaternion,
    outward: rotateVectorByQuaternion(quaternion, { x: 0, y: 0, z: 1 }),
  };
}

// Just the depth. Fade, Contrast, Isolation and the billboard's Front/Backface
// all need every card's z at this instant, and building n quaternions to read n
// z values is the kind of cost that only shows up on the slowest machine
// somebody owns.
function slotZ(index: number, ring: Ring, v: Record<string, any>, spin: number) {
  const theta = (index / ring.n) * TAU + spin;
  const tiltDeg = num(v.cardTilt);
  const tilt = tiltDeg * DEG;
  const sinT = Math.sin(tilt), cosT = Math.cos(tilt);
  const pivot = (tiltDeg >= 0 ? -HALF_CARD : HALF_CARD) * ring.cardScale;
  const shape = styleOf(v, ring, spin);
  const face = theta + (pick(v.flip, 'no') === 'yes' ? Math.PI : 0);
  if (pick(v.facing, 'ring') === 'camera') {
    return rigPoint({
      x: Math.sin(theta) * shape.width, y: shape.curve, z: Math.cos(theta) * shape.depth,
    }, v).z - pivot * sinT;
  }
  return rigPoint({
    x: Math.sin(theta) * shape.width - pivot * sinT * Math.sin(face),
    y: shape.curve + pivot * (1 - cosT),
    z: Math.cos(theta) * shape.depth - pivot * sinT * Math.cos(face),
  }, v).z;
}

interface Depths { lo: number; hi: number; near: number; mid: number }

function depthsOf(ring: Ring, v: Record<string, any>, spin: number, count: number): Depths {
  let lo = Infinity, hi = -Infinity, near = 0;
  const n = Math.max(1, Math.round(count));
  for (let i = 0; i < n; i++) {
    const z = slotZ(i, ring, v, spin);
    if (z < lo) lo = z;
    if (z > hi) { hi = z; near = i; }
  }
  return { lo, hi, near, mid: (lo + hi) / 2 };
}

// 0 at the card nearest the camera, 1 at the farthest. computeViewFades
// normalizes by the set's own depth range rather than by the ring's geometry,
// which is what keeps it working once the rig has tipped the ring over.
function depthFraction(z: number, d: Depths) {
  const span = d.hi - d.lo;
  return span < 1e-6 ? 0 : clamp((d.hi - z) / span, 0, 1);
}

// The reference remaps that fraction through acos(1 - 2u)/PI — an S-curve that
// keeps the middle of the ring from washing out — and scales it by
// (1 + n^2*20)*n so the top of the slider bites hard.
function viewFade(t: number, v: Record<string, any>) {
  const n = clamp(num(v.fade, 35) / 100, 0, 1);
  if (n === 0) return 1;
  return clamp(1 - (Math.acos(1 - 2 * t) / Math.PI) * (1 + n * n * 20) * n, 0, 1);
}

// Contrast SHRINKS the far cards rather than growing the near ones: the near
// card keeps scale 1 and the far one lands on 1/(1 + contrast/100), so at the
// reference's 200 the back of the ring is a third of the front.
function contrastScale(t: number, v: Record<string, any>) {
  const c = Math.max(0, num(v.scaleContrast));
  return c <= 0 ? 1 : 1 + (1 / (1 + c / 100) - 1) * t;
}

// Frontface/Backface is a real cull in the reference — FrontSide, BackSide or
// DoubleSide on the material — so a hidden side goes away completely rather
// than dimming. Two different rules, because a billboard has no far side:
//
//   Cover      decided against the LINE OF SIGHT and the card's own outward
//              direction. Ramped over the last sliver rather than switched: a
//              card that close to edge-on covers almost no pixels, so nothing
//              visible is lost and it stops popping as it crosses.
//   Billboard  decided by DEPTH against the midpoint of the set, which is what
//              the reference's own renderer does once the card is square to the
//              camera and "which side" has stopped meaning anything.
function facingAlpha(slot: Slot, ring: Ring, v: Record<string, any>, z: number, d: Depths) {
  const front = pick(v.frontface, 'show') !== 'hide';
  const back = pick(v.backface, 'show') !== 'hide';
  if (front && back) return 1;
  if (!front && !back) return 0;
  if (pick(v.facing, 'ring') === 'camera') {
    const nearer = z > d.mid;
    return (front ? nearer : !nearer) ? 1 : 0;
  }
  const view = { x: ring.panX - slot.point.x, y: ring.panY - slot.point.y, z: ring.dist - slot.point.z };
  const len = Math.hypot(view.x, view.y, view.z) || 1;
  const towards = (slot.outward.x * view.x + slot.outward.y * view.y + slot.outward.z * view.z) / len;
  return smooth(clamp((front ? towards : -towards) / 0.06, 0, 1));
}

// Wrap is not a free amount of bend: the card curves to follow the ring's OWN
// circle, so the sag is decided by the radius and the card's width.
// buildCardGeometry walks each vertex to (R*sin(x/R), R*cos(x/R) - R), which
// leaves the edges R*(1 - cos(halfExtent/R)) behind the centre.
//
// Our renderer states the same arc the other way up — `bend` is the CENTRE's
// displacement with the edges left at zero, and a positive bend pushes the
// centre AWAY from the card's front (verify-tilt pins that: centre vertex at
// -bend). A card hugging the drum has its centre standing proud of its edges,
// so the faithful value is NEGATIVE. Flip inverts it, exactly as the
// reference's ringWrapSign does, so a flipped card still hugs the drum instead
// of arching away from it.
//
// One approximation, stated: our bend axis is always the card's WIDTH, while
// the reference bends along the geometry's x AFTER the in-plane Rotation. They
// part company only at Rotation +/-90 with Wrap on, which is one preset
// (Pure 06) — and its card is square, so the sag DEPTH is right and only the
// direction of the curl differs.
// Card Bend rides ON TOP of that, and it is ours rather than the reference's.
// Wrap answers "follow the ring exactly", which is the faithful thing and also
// the only thing the reference can say; Card Bend answers "now curl them a bit
// more, or the other way", which people were using before this rewrite and
// which no combination of the reference's own controls can express. Kept as a
// separate term so Wrap stays exact at Card Bend 0: the two add, and the sum is
// clamped to the geometry's own ceiling.
//
// Signed the same way the renderer states it: POSITIVE pushes the card's centre
// away from its own front face, so for a card looking outward along the ring it
// cups INWARD toward the ring's centre, and negative bulges it outward at the
// viewer. Flip turns the card round, so it flips this too — otherwise the same
// slider would mean opposite things on the presets that use it.
function bendOf(ring: Ring, v: Record<string, any>) {
  // Flip turns the card round, so its local +z points the other way and every
  // term below has to turn with it.
  const sign = pick(v.flip, 'no') === 'yes' ? -1 : 1;
  const hug = ring.wrap
    ? (ring.R * (1 - Math.cos(ring.extent / (2 * ring.R)))) / (CARD * ring.aspect)
    : 0;
  // The renderer clamps the sag to +/-0.45 of the card's width and this control
  // feeds it /100, so +/-45 is exactly as far as the geometry goes.
  const extra = clamp(num(v.cardBend) / 100, -0.45, 0.45);
  return clamp(sign * (extra - hug), -0.45, 0.45);
}

function cameraFor(v: Record<string, any>, ctx: TransformCtx): CameraPose {
  const ring = ringOf(v, num(v.count, 20), ctx);
  const k = unitScale(ring, ctx);
  return {
    fov: viewFovFor(v),
    // `y` is negated because camera poses are handed over in canvas
    // coordinates and the renderer flips them on the way in.
    position: { x: ring.panX * k, y: -ring.panY * k, z: ring.dist * k },
    target: { x: ring.panX * k, y: -ring.panY * k, z: 0 },
    near: Math.max(0.1, 0.01 * ring.dist * k),
    // The reference's own far plane: the camera distance plus six ring radii.
    far: (ring.dist + 6 * ring.W) * k,
  };
}

const ring3d: Template = {
  meta: {
    id: 'orbit-3d-01', name: 'Ring Stream', group: 'Orbit', // Linear is the reference's family default, and for a ring that turns
    // continuously it is the only curve that does not lurch. The presets that
    // step (its Natural and Glide ones) carry their own curve on meta.
    defaultEasing: { id: 'linear' }, engine: 'webgl', catalog3d: true, repeatAssets: true,
  },
  controls: [
    { key: 'count', label: 'Count', type: 'slider', min: 3, max: 40, step: 1, default: 20, section: 'Layout' },
    // A share of the CARD, and it goes negative on purpose: the reference's
    // densest preset sits at -50, half a card of overlap, which a floor at 0
    // could not express at all.
    { key: 'gap', label: 'Gap', type: 'slider', min: -50, max: 200, step: 1, default: 6, section: 'Layout', unit: '%',
      description: 'Space between neighbours, as a share of the card. The ring keeps its size and the cards shrink inside their slots; below 0 they overlap.' },
    { key: 'diameter', label: 'Diameter', type: 'slider', min: 0, max: 1000, step: 1, default: 0, section: 'Layout',
      description: 'Pushes the ring outward. The slots grow with it, so the cards grow to match and the gaps stay honest.' },
    { key: 'cardRotation', label: 'Rotation', type: 'slider', min: -180, max: 180, step: 1, default: 0, section: 'Layout', unit: '°',
      description: 'Spins each card in its own plane. At ±90 a ring of portraits becomes a ring of landscapes.' },
    { key: 'surface', label: 'Surface', type: 'pills', options: ['flat', 'cylinder'], default: 'cylinder', section: 'Depth',
      description: 'Wrap curves each card around the ring it sits on, by exactly the arc its own slot spans.' },
    { key: 'facing', label: 'Face', type: 'pills', options: ['ring', 'camera'], default: 'ring', section: 'Depth',
      description: 'Cover turns each card outward along the ring; Billboard keeps it square to the viewer.' },
    { key: 'cardTilt', label: 'Bloom', type: 'slider', min: -90, max: 90, step: 1, default: 0, section: 'Depth', unit: '°',
      description: 'Leans every card out of the ring plane about its own edge — positive fans them outward like a crown.' },
    { key: 'cardBend', label: 'Card Bend', type: 'slider', min: -45, max: 45, step: 0.5, default: 0, section: 'Depth', unit: '%', precision: 1,
      description: 'Curls each image on top of Surface — positive cups it inward toward the ring, negative bows it outward at you. At 0 the card follows the ring exactly.' },
    { key: 'flip', label: 'Flip', type: 'toggle', options: ['no', 'yes'], default: 'no', section: 'Depth',
      description: 'Turns every card to show its reverse and inverts the wrap with it. What a ring filmed from the inside needs.' },
    { key: 'zoom', label: 'Zoom', type: 'slider', min: 10, max: 300, step: 0.1, default: 100, section: 'Depth', unit: '%', precision: 1,
      description: 'Moves the camera itself, at the same Perspective — a different move than widening the lens.' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 2000, step: 1, default: 312, section: 'Depth',
      description: 'The lens: 0 is a 10° telephoto, 1000 a 120° wide angle. Changes the keystone without changing how big a face-on card reads.' },
    { key: 'offsetX', label: 'Offset X', type: 'slider', min: -100, max: 100, step: 1, default: 0, section: 'Depth', unit: '%',
      description: 'Pans the camera rather than the ring, as a share of the frame — the ring keeps its own lens axis and simply sits off centre.' },
    { key: 'offsetY', label: 'Offset Y', type: 'slider', min: -100, max: 100, step: 1, default: 0, section: 'Depth', unit: '%' },
    { key: 'tiltX', label: 'Rotation X', type: 'slider', min: -180, max: 180, step: 1, default: -12, section: 'Depth', unit: '°' },
    { key: 'ringYaw', label: 'Rotation Y', type: 'slider', min: -180, max: 180, step: 1, default: -13, section: 'Depth', unit: '°' },
    { key: 'ringRoll', label: 'Rotation Z', type: 'slider', min: -180, max: 180, step: 1, default: 55, section: 'Depth', unit: '°' },
    { key: 'scaleContrast', label: 'Contrast', type: 'slider', min: 0, max: 500, step: 1, default: 0, section: 'Depth', unit: '%',
      description: 'Shrinks the far cards, so a near one reads much bigger than its twin across the ring.' },
    { key: 'fade', label: 'Fade', type: 'slider', min: 0, max: 100, step: 1, default: 35, section: 'Finish', unit: '%' },
    { key: 'fadeMode', label: 'Fade Mode', type: 'pills', options: ['solid', 'alpha'], default: 'alpha', section: 'Finish',
      description: 'Solid darkens the far arc and keeps it opaque; alpha makes it see-through.' },
    { key: 'frontface', label: 'Frontface', type: 'toggle', options: ['show', 'hide'], default: 'show', section: 'Finish' },
    { key: 'backface', label: 'Backface', type: 'toggle', options: ['show', 'hide'], default: 'show', section: 'Finish',
      description: 'Hiding it drops the arc that is facing away, leaving only the cards you can read.' },
    { key: 'isolated', label: 'Isolation', type: 'toggle', options: ['off', 'on'], default: 'off', section: 'Finish',
      description: 'Draws only the card nearest the camera.' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1, default: 10, section: 'Finish', unit: '%' },
    { key: 'shadow', label: 'Shadow', type: 'toggle', options: ['on', 'off'], default: 'off', section: 'Finish' },
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward', 'reverse'], default: 'reverse', section: 'Motion' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.05, default: 1, section: 'Motion', unit: '×', precision: 2,
      description: 'Cards per second. The clip always closes on a whole number of turns.' },
    { key: 'hold', label: 'Hold', type: 'slider', min: 0, max: 60, step: 0.5, default: 0, section: 'Motion', unit: '%', precision: 1,
      description: 'How much of each card-to-card step is spent stopped. Pairs with a shaped curve to make the ring index rather than spin.' },
    // Ours, not the reference's — see styleOf.
    { key: 'style', label: 'Style', type: 'pills', options: ['stream', 'showcase', 'bloom'], default: 'stream', section: 'Layout', advanced: true },
    { key: 'spread', label: 'Ring Width', type: 'slider', min: 55, max: 135, step: 1, default: 100, section: 'Layout', unit: '%', visibleWhen: { key: 'style', equals: 'showcase' } },
    { key: 'pulse', label: 'Pulse', type: 'slider', min: 0, max: 35, step: 1, default: 15, section: 'Motion', unit: '%', visibleWhen: { key: 'style', equals: 'bloom' } },
    { key: 'curve', label: 'Curve', type: 'slider', min: -100, max: 100, step: 1, default: 0, section: 'Depth', unit: '%', visibleWhen: { key: 'style', equals: 'bloom' } },
  ],

  camera: cameraFor,

  transform3d: (frame, index, count, v, ctx): LayerTransform3D => {
    const ring = ringOf(v, count, ctx);
    const k = unitScale(ring, ctx);
    const spin = spinAt(frame, v, ring.n, ctx);
    const slot = slotAt(index, ring, v, spin);
    const depths = depthsOf(ring, v, spin, count);
    const t = depthFraction(slot.point.z, depths);
    const fade = viewFade(t, v);
    const alphaFade = pick(v.fadeMode, 'alpha') === 'alpha';
    const shown = pick(v.isolated, 'off') === 'on' && index !== depths.near
      ? 0
      : facingAlpha(slot, ring, v, slot.point.z, depths);
    // Motion blur wants the card's real velocity, and with a curve or a hold
    // shaping the step the average rate is not it — a held card would be
    // blurred as if it were still travelling. One extra pose evaluation buys an
    // exact answer in every mode.
    const next = slotAt(index, ring, v, spinAt(frame + 1, v, ring.n, ctx));
    return {
      x: slot.point.x * k,
      // The reference builds the ring y-up; this app hands the renderer canvas
      // coordinates and it negates y on the way into the scene. The quaternion
      // is passed through untouched, so negating y here is the whole conversion.
      y: -slot.point.y * k,
      z: slot.point.z * k,
      quaternion: slot.quaternion,
      scale: (CARD * ring.cardScale * contrastScale(t, v) * k * Math.max(1, ring.aspect)) / BASE,
      // A card that is merely FAR must not go see-through, or the ring reads as
      // glass — so `solid` darkens (the reference mixes toward its background
      // colour) and only `alpha` actually thins the card out.
      alpha: shown * (alphaFade ? fade : 1),
      dim: alphaFade ? 0 : 1 - fade,
      bend: bendOf(ring, v),
      thickness: 0,
      shadowStrength: pick(v.shadow, 'off') === 'on' ? 1 : 0,
      velocity: {
        x: (next.point.x - slot.point.x) * k * ctx.fps,
        y: -(next.point.y - slot.point.y) * k * ctx.fps,
        z: (next.point.z - slot.point.z) * k * ctx.fps,
      },
    };
  },

  // The 2D pose. This is what the catalogue thumbnails, the Board and the web
  // export draw, and they have no camera of their own — so the projection the
  // renderer would do in 3D is done here: the card's own two axes are projected
  // and the resulting 2x2 is decomposed into the rotation/scale/skew a sprite
  // can carry. An affine approximation (one depth per card rather than per
  // pixel) is all a sprite can express anyway.
  transform: (frame, index, count, v, ctx): LayerTransform => {
    const ring = ringOf(v, count, ctx);
    const k = unitScale(ring, ctx);
    const spin = spinAt(frame, v, ring.n, ctx);
    const slot = slotAt(index, ring, v, spin);
    const depths = depthsOf(ring, v, spin, count);
    const t = depthFraction(slot.point.z, depths);
    const fade = viewFade(t, v);
    const alphaFade = pick(v.fadeMode, 'alpha') === 'alpha';
    const shown = pick(v.isolated, 'off') === 'on' && index !== depths.near
      ? 0
      : facingAlpha(slot, ring, v, slot.point.z, depths);

    // Perspective magnification at this card's depth, floored so a card that
    // has crossed the lens never inverts or explodes off to infinity. The
    // Lightroom presets put the camera INSIDE the ring — Lightroom 05 has a
    // radius of 129 with the lens at 47 — so that floor is load bearing here
    // rather than defensive, and a card past it is behind the lens.
    //
    // The floor sits at a QUARTER of the camera distance rather than at the
    // renderer's own near plane, which caps the magnification at 4x. That is a
    // deliberate limit of the sprite paths and not of the scene: the 3D stage
    // draws such a card correctly at whatever size its frustum says, while a
    // sprite has one depth for the whole card and cannot keystone it at all. At
    // the true near plane the approximation reaches 12.5x, which on Lightroom
    // 05's already frame-filling card is 14000px of sprite on a 1080px canvas —
    // what verify-catalogue reports as "card is more than 8x the canvas".
    const NEAR_FLOOR = 0.25;
    const behind = slot.point.z >= ring.dist * (1 - NEAR_FLOOR);
    const f = ring.dist / Math.max(ring.dist * NEAR_FLOOR, ring.dist - slot.point.z);
    const u = rotateVectorByQuaternion(slot.quaternion, { x: 1, y: 0, z: 0 });
    const w = rotateVectorByQuaternion(slot.quaternion, { x: 0, y: 1, z: 0 });
    // The card's own axes in screen directions. Its local +y points UP in the
    // reference's frame and DOWN on this canvas, hence the negation.
    const ax = u.x, ay = -u.y;
    const bx = w.x, by = -w.y;
    // pixi builds its matrix (Container._updateSkew) as
    //   (a, b) = ( cos(rotation + skewY), sin(rotation + skewY)) * scaleX
    //   (c, d) = (-sin(rotation - skewX), cos(rotation - skewX)) * scaleY
    // so with skewY at 0 each column is read straight off its OWN projected
    // axis, and the angle that satisfies the second is atan2(-bx, by). A
    // mirrored card is not a negative scale in this parameterization — it is a
    // skew past 90 degrees, and cos(skewX) carries the flip.
    const rotation = Math.atan2(ay, ax);
    const skewX = wrapAngle(rotation - Math.atan2(-bx, by));
    const scale = (CARD * ring.cardScale * contrastScale(t, v) * k * Math.max(1, ring.aspect)) / BASE;
    return {
      x: (slot.point.x - ring.panX) * f * k,
      y: -(slot.point.y - ring.panY) * f * k,
      // A card behind the lens has no size on screen. Handing the sprite paths
      // the floored magnification instead draws it at 12.5x — 11660px of card
      // on a 1080px canvas at the 9:16 card shape, which is what
      // verify-catalogue's "more than 8x the canvas" was reporting.
      scale: behind ? 0 : scale * f,
      scaleX: Math.hypot(ax, ay),
      scaleY: Math.hypot(bx, by),
      rotation,
      skewX,
      alpha: behind ? 0 : shown * (alphaFade ? fade : 1),
      dim: alphaFade ? 0 : 1 - fade,
      depth: clamp(0.5 + slot.point.z / (4 * Math.max(1, ring.R)), 0, 1),
    };
  },
};

// ---------------------------------------------------------------------------
//  The catalogue.
//
//  Three of our own, then the reference's 24 — Pure 6, Carousel 5, Lightroom 8,
//  Bloom 5 — straight off its authored preset table
//  (.shots/ref-orbit-presets-authored.json, pulled out of its own JS chunk and
//  executed, not scraped). The conversions are the only judgement in the port,
//  and there are just four of them:
//
//    Zoom      = 247/distance x 100, its own default distance read back as a
//                percentage. Exact on 22 of the 24; Bloom 01 (290) and Bloom 05
//                (207) are the two that were dragged rather than typed.
//    Diameter  = 2 x orbitRadius, the way its own panel shows it.
//    Speed     = count/loopDuration, i.e. cards per second, which is what its
//                Duration really pins: its ring advances one slot per step, so
//                the cadence is duration/count and the same clip is a third
//                slower on a 6-card ring than on a 9-card one. The clip length
//                itself is pinned per preset in the store.
//    Hold      = pause / step, the pause as a share of a step. Its implicit
//                pause — the one it applies when a preset carries a curve but
//                no pause of its own — is 0.125 of a step, hence the 12.5s.
//
//  Its easing names map to: Linear -> linear, Natural -> [.8,0,.2,1],
//  Glide -> [.85,.15,.15,.85]. Careful: its GLIDE_BEZIER constant ([.5,0,0,1])
//  is a different curve from the preset called "Glide"; the presets are what
//  its variants carry, so those are the ones matched.
//
//  Not ported: `holderShape` (its squircle corner — this app rounds corners
//  with a plain roundRect) and its material/DOF/refraction effects, none of
//  which any Orbit preset switches on.
// ---------------------------------------------------------------------------
const LINEAR: EasingSpec = { id: 'linear' };
const NATURAL: EasingSpec = { id: 'custom', bezier: [0.8, 0, 0.2, 1] };
const GLIDE: EasingSpec = { id: 'custom', bezier: [0.85, 0.15, 0.15, 0.85] };
const SQUARE = { cardAspect: 1 };
const PORTRAIT = { cardAspect: 0.8 };

export const orbit3dVariants: Template[] = [
  // ----- ours, not the reference's -----
  variant(ring3d, 'orbit-3d-01', 'Ring Stream', {
    count: 12, gap: 39, surface: 'cylinder', facing: 'ring', fade: 15, fadeMode: 'solid',
    tiltX: -8, ringYaw: 0, ringRoll: 0, perspective: 61, zoom: 182.7,
    cornerRadius: 3, shadow: 'on', speed: 0.3, direction: 'forward',
  }, LINEAR),
  variant(ring3d, 'orbit-3d-02', 'Orbit Showcase', {
    style: 'showcase', spread: 92, count: 10, gap: 39, surface: 'flat', facing: 'ring',
    fade: 15, fadeMode: 'solid', tiltX: 0, ringYaw: 0, ringRoll: 0, perspective: 81, zoom: 118.2,
    cornerRadius: 3, shadow: 'on', speed: 0.25, direction: 'forward',
  }, LINEAR),
  variant(ring3d, 'orbit-3d-03', 'Orbit Bloom', {
    style: 'bloom', pulse: 16, count: 8, gap: 39, surface: 'flat', facing: 'ring',
    fade: 45, fadeMode: 'solid', tiltX: -29, ringYaw: 0, ringRoll: 0, perspective: 76, zoom: 83,
    cornerRadius: 3, shadow: 'on', speed: 0.3, direction: 'forward',
  }, LINEAR),

  // ----- Pure: cards wrapped around a drum, facing outward along the ring ----
  variant(ring3d, 'orbit-3d-04', 'Ring Pure 01', {
    count: 18, gap: 35, surface: 'cylinder', facing: 'ring', fade: 30, fadeMode: 'solid',
    tiltX: -10, ringYaw: -10, ringRoll: 50, zoom: 100, perspective: 300, speed: 0.9,
  }, LINEAR, SQUARE),
  variant(ring3d, 'orbit-3d-05', 'Ring Pure 02', {
    count: 6, gap: 15, surface: 'cylinder', facing: 'ring', fade: 15, fadeMode: 'solid',
    tiltX: -10, ringYaw: -10, ringRoll: 50, zoom: 75, perspective: 500, speed: 0.3,
  }, LINEAR, SQUARE),
  variant(ring3d, 'orbit-3d-06', 'Ring Pure 03', {
    count: 9, gap: 15, surface: 'cylinder', facing: 'ring', fade: 15, fadeMode: 'solid',
    tiltX: -7, ringYaw: 0, ringRoll: 0, offsetY: 4, zoom: 75, perspective: 500, speed: 0.5,
  }, GLIDE, SQUARE),
  variant(ring3d, 'orbit-3d-07', 'Ring Pure 04', {
    count: 18, gap: 15, surface: 'cylinder', facing: 'ring', fade: 15, fadeMode: 'solid',
    tiltX: 0, ringYaw: 0, ringRoll: 0, zoom: 100, perspective: 500, speed: 0.5,
  }, NATURAL, SQUARE),
  variant(ring3d, 'orbit-3d-08', 'Ring Pure 05', {
    count: 12, gap: 15, diameter: 120, surface: 'cylinder', facing: 'ring', fade: 15, fadeMode: 'solid',
    tiltX: 0, ringYaw: 0, ringRoll: 0, zoom: 100, perspective: 500, speed: 0.35,
  }, NATURAL, SQUARE),
  // A drum stood on end: Rotation Z -90 turns the ring upright and Rotation 90
  // turns each card to match, which is the reference's vertical conveyor.
  variant(ring3d, 'orbit-3d-09', 'Ring Pure 06', {
    count: 18, gap: 0, diameter: 120, cardRotation: 90, surface: 'cylinder', facing: 'ring',
    fade: 15, fadeMode: 'solid', tiltX: 0, ringYaw: 0, ringRoll: -90,
    zoom: 65, perspective: 300, speed: 0.5, direction: 'forward', cornerRadius: 0,
  }, LINEAR, SQUARE),

  // ----- Carousel: the same ring with the cards kept square to the camera ----
  variant(ring3d, 'orbit-3d-10', 'Ring Carousel 01', {
    count: 18, gap: 35, surface: 'flat', facing: 'camera', fade: 30, fadeMode: 'solid',
    tiltX: -10, ringYaw: -10, ringRoll: 50, zoom: 100, perspective: 300, speed: 0.9,
  }, LINEAR, SQUARE),
  variant(ring3d, 'orbit-3d-11', 'Ring Carousel 02', {
    count: 9, gap: 15, surface: 'flat', facing: 'camera', fade: 15, fadeMode: 'solid',
    tiltX: -10, ringYaw: -10, ringRoll: 50, zoom: 75, perspective: 500, speed: 0.45,
  }, LINEAR, SQUARE),
  variant(ring3d, 'orbit-3d-12', 'Ring Carousel 03', {
    count: 6, gap: 15, surface: 'flat', facing: 'camera', fade: 15, fadeMode: 'solid',
    scaleContrast: 50, tiltX: 0, ringYaw: 0, ringRoll: 56, zoom: 50, perspective: 500,
    speed: 0.55, hold: 13.5,
  }, NATURAL, SQUARE),
  // Overlapping by half a card, stood upright, and pushed hard on depth — the
  // reference's densest Orbit preset, and the one our old model could not have
  // expressed at all.
  variant(ring3d, 'orbit-3d-13', 'Ring Carousel 04', {
    count: 20, gap: -50, surface: 'flat', facing: 'camera', fade: 15, fadeMode: 'solid',
    scaleContrast: 200, tiltX: 0, ringYaw: 0, ringRoll: 90, zoom: 41, perspective: 740,
    speed: 0.8, hold: 20,
  }, NATURAL, SQUARE),
  variant(ring3d, 'orbit-3d-14', 'Ring Carousel 05', {
    count: 6, gap: -15, surface: 'flat', facing: 'camera', fade: 15, fadeMode: 'solid',
    scaleContrast: 200, tiltX: 0, ringYaw: 0, ringRoll: 0, zoom: 25, perspective: 0,
    speed: 0.8, hold: 20,
  }, NATURAL, SQUARE),

  // ----- Lightroom: the camera INSIDE the ring -----
  // Its lens runs from 140 to 147 degrees and its camera z lands short of the
  // ring's own radius, so what fills the frame is the inside of the drum. Flip
  // is what makes that readable: every card is being seen from behind.
  variant(ring3d, 'orbit-3d-15', 'Ring Lightroom 01', {
    count: 10, gap: 6, surface: 'cylinder', facing: 'ring', flip: 'yes',
    fade: 0, fadeMode: 'alpha', tiltX: 0, ringYaw: 0, ringRoll: 0,
    zoom: 100, perspective: 1600, speed: 0.5,
  }, LINEAR, SQUARE),
  variant(ring3d, 'orbit-3d-16', 'Ring Lightroom 02', {
    count: 10, gap: 6, cardRotation: -90, surface: 'flat', facing: 'ring', flip: 'yes',
    fade: 0, fadeMode: 'alpha', tiltX: 0, ringYaw: 0, ringRoll: 90,
    zoom: 110, perspective: 1500, speed: 0.5,
  }, LINEAR, SQUARE),
  variant(ring3d, 'orbit-3d-17', 'Ring Lightroom 03', {
    count: 10, gap: 6, cardRotation: -90, surface: 'flat', facing: 'ring', flip: 'yes',
    fade: 0, fadeMode: 'alpha', tiltX: 0, ringYaw: 0, ringRoll: 51,
    zoom: 105, perspective: 1500, speed: 0.5, hold: 12.5,
  }, GLIDE, SQUARE),
  variant(ring3d, 'orbit-3d-18', 'Ring Lightroom 04', {
    count: 24, gap: 0, diameter: 1000, surface: 'flat', facing: 'ring', flip: 'yes',
    fade: 0, fadeMode: 'alpha', tiltX: 0, ringYaw: 0, ringRoll: 0,
    zoom: 25, perspective: 2000, speed: 0.8, cornerRadius: 0,
  }, LINEAR, PORTRAIT),
  variant(ring3d, 'orbit-3d-19', 'Ring Lightroom 05', {
    count: 6, gap: 15, diameter: 120, surface: 'flat', facing: 'ring', flip: 'yes',
    backface: 'hide', fade: 0, fadeMode: 'solid', tiltX: 0, ringYaw: 0, ringRoll: 0,
    zoom: 125, perspective: 2000, speed: 0.35, direction: 'forward', cornerRadius: 0,
  }, NATURAL, PORTRAIT),
  variant(ring3d, 'orbit-3d-20', 'Ring Lightroom 06', {
    count: 6, gap: 15, diameter: 120, cardRotation: 90, surface: 'flat', facing: 'ring', flip: 'yes',
    backface: 'hide', fade: 0, fadeMode: 'solid', tiltX: 0, ringYaw: 0, ringRoll: -90,
    zoom: 125, perspective: 2000, speed: 0.35, direction: 'forward', cornerRadius: 0,
  }, NATURAL, PORTRAIT),
  variant(ring3d, 'orbit-3d-21', 'Ring Lightroom 07', {
    count: 12, gap: 15, diameter: 58, surface: 'flat', facing: 'ring',
    backface: 'hide', fade: 0, fadeMode: 'solid', tiltX: 0, ringYaw: 0, ringRoll: 0,
    zoom: 37, perspective: 2000, speed: 0.35, direction: 'forward', cornerRadius: 0,
  }, NATURAL, PORTRAIT),
  variant(ring3d, 'orbit-3d-22', 'Ring Lightroom 08', {
    count: 12, gap: 15, diameter: 58, cardRotation: -90, surface: 'flat', facing: 'ring',
    backface: 'hide', fade: 0, fadeMode: 'solid', tiltX: 0, ringYaw: 0, ringRoll: 90,
    zoom: 42, perspective: 2000, speed: 0.35, direction: 'forward', cornerRadius: 0,
  }, NATURAL, PORTRAIT),

  // ----- Bloom: the ring turned toward the camera until it reads as a circle
  // in the frame rather than a wheel in depth -----
  variant(ring3d, 'orbit-3d-23', 'Ring Bloom 01', {
    count: 12, gap: 18, cardTilt: 15, surface: 'flat', facing: 'ring',
    fade: 25, fadeMode: 'solid', tiltX: 0, ringYaw: 0, ringRoll: 0,
    zoom: 85.2, perspective: 610, speed: 0.6, hold: 12.5,
  }, NATURAL, PORTRAIT),
  variant(ring3d, 'orbit-3d-24', 'Ring Bloom 02', {
    count: 12, gap: 0, surface: 'flat', facing: 'camera', fade: 0, fadeMode: 'alpha',
    scaleContrast: 200, tiltX: 0, ringYaw: 85, ringRoll: 90, offsetX: 5,
    zoom: 40, perspective: 2000, speed: 1.2,
  }, LINEAR, SQUARE),
  variant(ring3d, 'orbit-3d-25', 'Ring Bloom 03', {
    count: 12, gap: 0, surface: 'flat', facing: 'camera', fade: 0, fadeMode: 'alpha',
    scaleContrast: 200, tiltX: 24, ringYaw: 75, ringRoll: 90, offsetX: 5, offsetY: 7,
    zoom: 40, perspective: 2000, speed: 1.2,
  }, LINEAR, SQUARE),
  variant(ring3d, 'orbit-3d-26', 'Ring Bloom 04', {
    count: 12, gap: 0, cardTilt: -44, surface: 'flat', facing: 'camera',
    fade: 0, fadeMode: 'alpha', tiltX: 97, ringYaw: -40, ringRoll: 0,
    zoom: 55, perspective: 2000, speed: 1.2,
  }, LINEAR, SQUARE),
  variant(ring3d, 'orbit-3d-27', 'Ring Bloom 05', {
    count: 16, gap: 49, surface: 'flat', facing: 'ring', fade: 0, fadeMode: 'alpha',
    tiltX: 90, ringYaw: 0, ringRoll: 0, zoom: 119.3, perspective: 610, speed: 1.35,
  }, LINEAR, { cardAspect: 0.5625 }),
];
