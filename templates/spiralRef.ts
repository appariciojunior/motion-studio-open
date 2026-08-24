import type { Template } from '@/lib/types';
import { clamp } from '@/lib/motion';
import { variant } from './variant';
import {
  flatFallback, refCamera, refDepthDim, refFocal, refScale, refSpinRadians,
  quatFromBasis, rotateVec, mulQuat, eulerQuat, type Quat, type Vec3,
} from './refScene3d';

const BASE = 340;
const DEG = Math.PI / 180;

// ============================================================
//  HELIX 05-13 — a corkscrew of cards climbing a turning axis
//
//  The reference's Spiral family, nine presets, shipped INTO the Helix group
//  rather than beside it. They are the same family by the only test that
//  settles it, which is the control surface and not the name: both place
//  cards on a helix from a radius, a number of turns, a card size and a
//  vertical extent — Helix states that extent as a per-card pitch and these
//  state it as a total height, which is the same quantity divided by the
//  count. Helix 01-04 are the flat version of it and these are the spatial
//  one, so one shelf holds both.
//
//  Read out of its scene class:
//
//  · Cards are spread EVENLY along the coil by index, not by height: card i of
//    n sits at u = (i + 0.5)/n, angle u * turns * 360 and height -H/2 + u*H.
//    So `turns` alone decides whether it reads as a wide ramp or a tight drill.
//  · The coil turns about y; nothing about the cards themselves moves.
//  · With Face Camera off, a card does not billboard and does not lie flat
//    either — the scene points it at twice its own radius, which is straight
//    OUT from the axis with its top still up.
//  · Three presets film it from directly overhead. The reference moves its
//    camera there and flips its up vector; the same picture comes from leaving
//    the camera alone and tipping the whole coil a quarter turn, which is what
//    happens here — a camera pointing straight down has no defined roll for
//    `lookAt` to resolve.
//  · `flipImage` shows every card its reverse. Coil 09 needs it: filmed from
//    overhead and from inside, its cards read mirrored otherwise, and a plane
//    turned a half turn about its own vertical axis IS that mirror.
//  · `wobble` tips the rig itself by up to 0.6 rad, in step with the spin, so
//    the coil nutates like a spun top.
// ============================================================

/** Card `i` of `n` on the coil, in reference units. */
function coilPoint(i: number, n: number, radius: number, turns: number, height: number): Vec3 {
  const u = n === 1 ? 0.5 : (i + 0.5) / n;
  const a = u * Math.max(1e-4, turns) * Math.PI * 2;
  return { x: radius * Math.cos(a), y: -height / 2 + u * height, z: radius * Math.sin(a) };
}

const coil: Template = {
  meta: {
    id: 'coil-01',
    name: 'Helix 05',
    group: 'Helix',
    engine: 'webgl',
    isNew: true,
    defaultEasing: { id: 'linear' },
    cardAspect: 3 / 4,
    repeatAssets: true,
  },

  controls: [
    { key: 'direction',      label: 'Direction',     type: 'pills',  options: ['forward','reverse'], default: 'forward', section: 'Motion' },
    { key: 'count',          label: 'Count',         type: 'slider', min: 6, max: 160, step: 1,      default: 70 },
    { key: 'turns',          label: 'Turns',         type: 'slider', min: 0.5, max: 12, step: 0.5,   default: 6, section: 'Layout' },
    { key: 'radius',         label: 'Radius',        type: 'slider', min: 100, max: 3200, step: 5,   default: 1060, section: 'Layout' },
    { key: 'height',         label: 'Height',        type: 'slider', min: 500, max: 9000, step: 50,  default: 5000, section: 'Layout' },
    { key: 'planeSize',      label: 'Plane Size',    type: 'slider', min: 30, max: 900, step: 5,     default: 250, section: 'Layout' },
    { key: 'autoFaceCamera', label: 'Face Camera',   type: 'toggle', options: ['on','off'],          default: 'on', section: 'Layout' },
    { key: 'flipImage',      label: 'Mirror',        type: 'toggle', options: ['off','on'],          default: 'off', section: 'Layout', description: 'Show every card\u2019s reverse \u2014 what a coil filmed from the inside needs.' },
    { key: 'cameraView',     label: 'View',          type: 'pills',  options: ['side','down'],       default: 'side', section: 'Depth', description: 'down films the coil from directly above.' },
    { key: 'wobble',         label: 'Wobble',        type: 'slider', min: 0, max: 100, step: 1,      default: 0, unit: '%', section: 'Motion', description: 'Nutate the whole coil in step with its spin.' },
    { key: 'fade',           label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,      default: 0, unit: '%', section: 'Depth' },
    { key: 'distance',       label: 'Distance',      type: 'slider', min: 0, max: 6000, step: 50,    default: 3050, section: 'Depth' },
    { key: 'perspective',    label: 'Perspective',   type: 'slider', min: 10, max: 300, step: 5,     default: 100, section: 'Depth' },
    { key: 'cycles',         label: 'Cycles',        type: 'slider', min: 0.25, max: 12, step: 0.25, default: 1, section: 'Motion' },
    { key: 'cycleDeg',       label: 'Cycle Turn',    type: 'slider', min: 15, max: 360, step: 15,    default: 360, unit: '°', section: 'Motion' },
    { key: 'cornerRadius',   label: 'Corner Radius', type: 'slider', min: 0, max: 200, step: 1,      default: 0 },
    { key: 'offset',         label: 'Offset',        type: 'xypad',                                  default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => flatFallback(coilPose(frame, index, count, v, ctx), ctx, BASE),

  transform3d: (frame, index, count, v, ctx) => {
    const p = coilPose(frame, index, count, v, ctx);
    return { x: p.x, y: p.y, z: p.z, quaternion: p.quat, scale: p.scale, alpha: p.alpha, dim: p.dim };
  },

  camera: (v, ctx) => refCamera(
    'spiral', v.perspective, v.distance, ctx.height,
    Math.max(v.radius, v.height / 2) + v.planeSize,
  ),
};

function coilPose(
  frame: number, index: number, count: number, v: Record<string, any>,
  ctx: { width: number; height: number; totalFrames: number; cardAspect?: number; easedPhase: (p: number) => number },
) {
  const n = Math.max(1, Math.round(count));
  const k = refScale(ctx.height);
  const radius = Math.max(1, v.radius);
  const camZ = Math.abs(v.distance);
  const dir = v.direction === 'reverse' ? -1 : 1;

  const spinAngle = dir * refSpinRadians(
    'continuous', frame, ctx.totalFrames, ctx.easedPhase, n, v.cycles, v.cycleDeg,
  );
  const spin = eulerQuat(0, spinAngle, 0);

  // The rig: wobble first (it nutates with the spin), then the quarter turn
  // that stands in for the overhead camera.
  const w = (clamp(v.wobble, 0, 100) / 100) * 0.6;
  const nutate = w > 0 ? eulerQuat(w * Math.cos(spinAngle), 0, w * Math.sin(spinAngle)) : { x: 0, y: 0, z: 0, w: 1 };
  const overhead = v.cameraView === 'down' ? eulerQuat(Math.PI / 2, 0, 0) : { x: 0, y: 0, z: 0, w: 1 };
  const rig = mulQuat(overhead, nutate);
  const total = mulQuat(rig, spin);

  const local = coilPoint(index % n, n, radius, v.turns, v.height);
  const world = rotateVec(local, total);

  const gone = { x: 0, y: 0, z: 0, quat: { x: 0, y: 0, z: 0, w: 1 } as Quat, scale: 0, project: 1, alpha: 0, dim: 0, depth: -1 };
  const depth = camZ - world.z;
  if (depth <= 1) return gone;

  // A half turn about the card's own vertical axis shows its reverse, which is
  // the same picture mirrored — the reference's `flipImage`.
  const half: Quat = { x: 0, y: 1, z: 0, w: 0 };
  const mirror = v.flipImage === 'on';
  let quat: Quat = mirror ? half : { x: 0, y: 0, z: 0, w: 1 };
  if (v.autoFaceCamera === 'off') {
    // Outward from the axis, top still up — the reference aims each card at
    // twice its own radius, which is the same direction.
    const nx = Math.hypot(local.x, local.z) > 1e-6
      ? { x: local.x, y: 0, z: local.z }
      : { x: 0, y: 0, z: 1 };
    const len = Math.hypot(nx.x, nx.z);
    const zAxis = { x: nx.x / len, y: 0, z: nx.z / len };
    const xAxis = { x: zAxis.z, y: 0, z: -zAxis.x };
    const yAxis = { x: 0, y: 1, z: 0 };
    const facing = quatFromBasis(xAxis, yAxis, zAxis);
    quat = mulQuat(total, mirror ? mulQuat(facing, half) : facing);
  }

  const aspect = Math.max(0.05, ctx.cardAspect ?? 3 / 4);
  // Its plane size is a WORLD width, unlike the sphere's screen-space one, so
  // a card genuinely shrinks with depth here.
  const scale = (v.planeSize * k) / (BASE * aspect);

  // The 2D fallback has no camera, so it needs the depth division applied.
  const project = refFocal('spiral', v.perspective, ctx.height) / depth;

  return {
    x: world.x * k + v.offset.x,
    y: -world.y * k + v.offset.y,
    z: world.z * k,
    quat,
    scale,
    project,
    alpha: 1,
    dim: refDepthDim(v.fade, (radius - world.z) / (2 * radius)),
    depth: world.z,
  };
}

// The reference's nine presets, off its own `paramsPerModeBaseline`,
// 2026-08-23, renumbered to follow the four Helix presets already on the
// shelf. Height is 5000 on every one of them. Its own label is kept per line
// so a value can be traced back.
const LINEAR = { id: 'linear' as const };

export const coilVariants: Template[] = [
  coil, // its Spiral 01 — 70 cards, 6 turns, r1060, plane 250, 10s
  variant(coil, 'coil-02', 'Helix 06', {
    count: 72, turns: 3.5, radius: 1435, planeSize: 265, fade: 43,
    distance: 3150, direction: 'reverse', autoFaceCamera: 'off',
  }, LINEAR),
  variant(coil, 'coil-03', 'Helix 07', {
    count: 33, turns: 2, radius: 1195, planeSize: 320, distance: 3100, direction: 'reverse',
  }, LINEAR),
  // Its camera sits at the origin on this one, inside the coil.
  variant(coil, 'coil-04', 'Helix 08', {
    count: 55, turns: 10, radius: 915, planeSize: 300, distance: 0,
    direction: 'reverse', perspective: 215,
  }, LINEAR),
  variant(coil, 'coil-05', 'Helix 09', {
    count: 120, turns: 3, radius: 955, planeSize: 145, fade: 29,
    distance: 1200, perspective: 300,
  }, LINEAR),
  variant(coil, 'coil-06', 'Helix 10', {
    count: 120, turns: 2, radius: 450, planeSize: 50, cycles: 12, cycleDeg: 60,
    distance: 700, perspective: 260,
  }, LINEAR),
  variant(coil, 'coil-07', 'Helix 11', {
    count: 73, turns: 7.5, radius: 1595, planeSize: 235, wobble: 50,
    distance: 3450, cameraView: 'down',
  }, LINEAR),
  variant(coil, 'coil-08', 'Helix 12', {
    count: 73, turns: 2, radius: 1535, planeSize: 170, distance: 3450, cameraView: 'down',
  }, LINEAR),
  variant(coil, 'coil-09', 'Helix 13', {
    flipImage: 'on', count: 53, turns: 10, radius: 3000, planeSize: 810, cycles: 12, cycleDeg: 60,
    distance: 4650, direction: 'reverse', cameraView: 'down',
    perspective: 140, autoFaceCamera: 'off',
  }, { id: 'custom', bezier: [0.8, 0.27, 0.2, 0.75] }),
];
