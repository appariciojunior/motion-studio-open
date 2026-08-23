import type { Template } from '@/lib/types';
import { clamp } from '@/lib/motion';
import { variant } from './variant';
import {
  flatFallback, refCamera, refDepthDim, refFocal, refScale, refSpinRadians,
  rotateVec, mulQuat, eulerQuat, type Quat,
} from './refScene3d';

const BASE = 340;
const DEG = Math.PI / 180;

// ============================================================
//  CAROUSEL RING — a wheel of cards standing on their edges
//
//  The reference's "3D" family, twenty-three presets, plus the five of its
//  Carousel 3D. Both are the same scene branch with a different placement rule,
//  which is why they share a file. Its Orbit family is a third branch of the
//  same scene and is deliberately NOT here.
//
//  This is a different mechanic from our own Orbit group, which came from a
//  different tool and is parameterized by a ring size in percent, an opening
//  angle and a card bend. The reference authors an absolute `orbitRadius` and
//  an absolute `planeSize` on a 1440-tall stage, with a lens that widens rather
//  than a camera that moves — so its presets could not be expressed there
//  without rewriting that family, and the Orbit group is left untouched.
//
//  Read out of its scene class rather than measured:
//
//  · A horizontal ring puts card i at (sin, 0, cos) * radius facing outward;
//    a vertical one at (0, -sin, cos) and tips it about x instead. The card is
//    `planeSize` wide in world units and its height follows the image.
//  · The ring STEPS. Its default time model advances one card-slot per step,
//    `cycles * count` of them in a clip, with the scene curve shaping each
//    step — so a 4-card ring lands four times where a 15-card ring lands
//    fifteen, and the beat is the slot rather than the turn.
//  · `surface: cylinder` bends each card onto the ring it rides, which is
//    `planeSize / (8 * radius)` of sag in card-width units — the sagitta of
//    the arc it spans. Five of its presets ask for it.
//  · Carousel 3D films the ring from the other side with its up vector
//    inverted. Rather than move the camera somewhere `lookAt` cannot resolve a
//    roll for, that is folded into the placement: the same picture is the ring
//    mirrored in z with its cards turned the other way.
//
//  Not carried over: `flipImage`, a texture mirror no pose can state; and its
//  lens shift, which is a projection-matrix offset — the small `offsetX/Y` two
//  presets use land here as a plain screen nudge instead.
// ============================================================

type RingKind = 'ring' | 'carousel';

function ringPose(
  kind: RingKind,
  frame: number, index: number, count: number, v: Record<string, any>,
  ctx: { width: number; height: number; totalFrames: number; cardAspect?: number; easedPhase: (p: number) => number },
) {
  const n = Math.max(1, Math.round(count));
  const k = refScale(ctx.height);
  const radius = Math.max(1, v.orbitRadius);
  const camZ = Math.abs(v.distance);
  const dir = v.direction === 'reverse' ? -1 : 1;
  const vertical = kind === 'ring' && v.axis === 'vertical';

  const spinAngle = dir * refSpinRadians(
    kind === 'carousel' ? 'continuous' : 'step',
    frame, ctx.totalFrames, ctx.easedPhase, n, v.cycles, v.cycleDeg,
  );
  // Its own sign rule: a horizontal ring turns with the angle, a vertical one
  // against it.
  const spin = vertical ? eulerQuat(-spinAngle, 0, 0) : eulerQuat(0, spinAngle, 0);
  // The two branches read their authored angles in DIFFERENT Euler orders —
  // XYZ for the ring, ZYX for the carousel — which is not a detail: on
  // Carousel 3D 01's 30/38 the two orders put the same card 67px apart.
  const rx = v.rotationX * DEG, ry = v.rotationY * DEG, rz = v.rotationZ * DEG;
  const authored = kind === 'carousel'
    ? mulQuat(mulQuat(eulerQuat(0, 0, rz), eulerQuat(0, ry, 0)), eulerQuat(rx, 0, 0))
    : eulerQuat(rx, ry, rz);
  // Carousel 3D films the ring from BEHIND with its up vector inverted, and
  // flips its cards' texture to compensate. Both halves of that are one half
  // turn about x: the outer one moves the whole rig round to the camera we
  // have, the inner one puts each card's own image back the right way up.
  // Verified against its live scene — every card lands on the same pixel.
  const mirror: Quat = kind === 'carousel' ? { x: 1, y: 0, z: 0, w: 0 } : { x: 0, y: 0, z: 0, w: 1 };
  const total = mulQuat(mirror, mulQuat(authored, spin));

  const c = (index % n) / n * Math.PI * 2;
  const sin = Math.sin(c), cos = Math.cos(c);

  let local: { x: number; y: number; z: number };
  let face: Quat;
  if (kind === 'carousel') {
    local = { x: radius * cos, y: 0, z: radius * sin };
    const b = ((((180 - (index % n) / n * 360) % 180) + 180) % 180) * DEG;
    face = mulQuat(eulerQuat(0, b, 0), mirror);
  } else if (vertical) {
    local = { x: 0, y: -radius * sin, z: radius * cos };
    face = eulerQuat(c, 0, 0);
  } else {
    local = { x: radius * sin, y: 0, z: radius * cos };
    face = eulerQuat(0, c, 0);
  }

  const world = rotateVec(local, total);
  const quat = mulQuat(total, face);

  const gone = { x: 0, y: 0, z: 0, quat: { x: 0, y: 0, z: 0, w: 1 } as Quat, scale: 0, project: 1, alpha: 0, dim: 0, depth: -1, bend: 0 };
  const depth = camZ - world.z;
  if (depth <= 1) return gone;

  // Backface culling, which the reference does itself when asked: a card whose
  // own normal has turned away is showing its reverse.
  if (kind === 'ring' && v.backface === 'hide') {
    const normal = rotateVec({ x: 0, y: 0, z: 1 }, quat);
    const toCam = { x: -world.x, y: -world.y, z: camZ - world.z };
    const len = Math.max(1e-6, Math.hypot(toCam.x, toCam.y, toCam.z));
    if ((normal.x * toCam.x + normal.y * toCam.y + normal.z * toCam.z) / len <= 0) return gone;
  }

  const aspect = Math.max(0.05, ctx.cardAspect ?? 3 / 4);
  const scale = (v.planeSize * k) / (BASE * aspect);

  // The sagitta of the arc one card spans, as a share of its own width. The
  // sign puts the belly of the card AWAY from the ring's centre, i.e. toward
  // whoever is outside it.
  const bend = v.surface === 'cylinder'
    ? -clamp(v.planeSize / (8 * radius), 0, 0.45)
    : 0;

  // The 3D renderer divides by depth itself; the 2D fallback the thumbnails and
  // the pixi path use does not, so hand it the projected numbers too.
  const project = refFocal(kind === 'carousel' ? 'carousel3d' : 'ring3d', v.perspective, ctx.height) / depth;

  return {
    x: world.x * k + (v.offsetX / 100) * ctx.width,
    y: -world.y * k + (v.offsetY / 100) * ctx.height,
    z: world.z * k,
    quat,
    scale,
    project,
    alpha: 1,
    dim: refDepthDim(v.fade, (radius - world.z) / (2 * radius)),
    depth: world.z,
    bend,
  };
}

const SHARED_CONTROLS = [
  { key: 'direction',    label: 'Direction',     type: 'pills' as const,  options: ['forward','reverse'], default: 'forward', section: 'Motion' as const },
  { key: 'count',        label: 'Count',         type: 'slider' as const, min: 3, max: 40, step: 1,       default: 10 },
  { key: 'planeSize',    label: 'Plane Size',    type: 'slider' as const, min: 50, max: 9000, step: 1,    default: 3015, section: 'Layout' as const },
  { key: 'orbitRadius',  label: 'Ring Radius',   type: 'slider' as const, min: 50, max: 14000, step: 1,   default: 10915, section: 'Layout' as const },
  { key: 'rotationX',    label: 'Pitch',         type: 'slider' as const, min: -180, max: 360, step: 1,   default: 0, unit: '°' as const, section: 'Layout' as const },
  { key: 'rotationY',    label: 'Yaw',           type: 'slider' as const, min: -180, max: 360, step: 1,   default: 0, unit: '°' as const, section: 'Layout' as const },
  { key: 'rotationZ',    label: 'Roll',          type: 'slider' as const, min: -180, max: 360, step: 1,   default: 0, unit: '°' as const, section: 'Layout' as const },
  { key: 'fade',         label: 'Fade',          type: 'slider' as const, min: 0, max: 100, step: 1,      default: 0, unit: '%' as const, section: 'Depth' as const },
  { key: 'distance',     label: 'Distance',      type: 'slider' as const, min: 0, max: 30000, step: 1,    default: 24212, section: 'Depth' as const },
  { key: 'perspective',  label: 'Perspective',   type: 'slider' as const, min: 10, max: 300, step: 5,     default: 100, section: 'Depth' as const },
  { key: 'cycles',       label: 'Cycles',        type: 'slider' as const, min: 0.25, max: 12, step: 0.25, default: 1, section: 'Motion' as const },
  { key: 'cornerRadius', label: 'Corner Radius', type: 'slider' as const, min: 0, max: 400, step: 1,      default: 0 },
  { key: 'offsetX',      label: 'Shift X',       type: 'slider' as const, min: -50, max: 50, step: 0.5,   default: 0, unit: '%' as const, section: 'Layout' as const, precision: 1 },
  { key: 'offsetY',      label: 'Shift Y',       type: 'slider' as const, min: -50, max: 50, step: 0.5,   default: 0, unit: '%' as const, section: 'Layout' as const, precision: 1 },
];

const ring: Template = {
  meta: {
    id: 'ring-r01', name: 'Ring 01', group: 'Ring', engine: 'webgl', isNew: true,
    defaultEasing: { id: 'custom', bezier: [0.86, 0.14, 0.14, 0.86] },
    cardAspect: 3 / 4, repeatAssets: true,
  },
  controls: [
    { key: 'axis', label: 'Axis', type: 'pills', options: ['horizontal','vertical'], default: 'horizontal', section: 'Motion' },
    ...SHARED_CONTROLS,
    { key: 'surface',  label: 'Surface',  type: 'pills', options: ['flat','cylinder'], default: 'flat', section: 'Layout', description: 'cylinder bends each card onto the ring it rides.' },
    { key: 'backface', label: 'Backface', type: 'pills', options: ['show','hide'],     default: 'show', section: 'Depth' },
    { key: 'cycleDeg', label: 'Cycle Turn', type: 'slider', min: 15, max: 360, step: 15, default: 360, unit: '°', section: 'Motion', advanced: true },
  ],
  transform: (frame, index, count, v, ctx) => flatFallback(ringPose('ring', frame, index, count, v, ctx), ctx, BASE),
  transform3d: (frame, index, count, v, ctx) => {
    const p = ringPose('ring', frame, index, count, v, ctx);
    return { x: p.x, y: p.y, z: p.z, quaternion: p.quat, bend: p.bend, scale: p.scale, alpha: p.alpha, dim: p.dim };
  },
  camera: (v, ctx) => refCamera('ring3d', v.perspective, v.distance, ctx.height),
};

const carousel3d: Template = {
  meta: {
    id: 'carousel3d-01', name: 'Carousel 3D 01', group: 'Carousel 3D', engine: 'webgl', isNew: true,
    defaultEasing: { id: 'linear' },
    cardAspect: 3 / 4, repeatAssets: true,
  },
  controls: [
    ...SHARED_CONTROLS.map((c) => (
      c.key === 'count' ? { ...c, default: 12 }
        : c.key === 'planeSize' ? { ...c, min: 50, max: 1200, default: 400 }
          : c.key === 'orbitRadius' ? { ...c, min: 50, max: 2000, default: 280 }
            : c.key === 'distance' ? { ...c, min: 0, max: 6000, default: 1300 }
              : c.key === 'perspective' ? { ...c, default: 140 }
                : c.key === 'rotationX' ? { ...c, default: 30 }
                  : c.key === 'rotationY' ? { ...c, default: 38 }
                    : c
    )),
    { key: 'cycleDeg', label: 'Cycle Turn', type: 'slider', min: 15, max: 360, step: 15, default: 360, unit: '°', section: 'Motion' },
  ],
  transform: (frame, index, count, v, ctx) => flatFallback(ringPose('carousel', frame, index, count, v, ctx), ctx, BASE),
  transform3d: (frame, index, count, v, ctx) => {
    const p = ringPose('carousel', frame, index, count, v, ctx);
    return { x: p.x, y: p.y, z: p.z, quaternion: p.quat, scale: p.scale, alpha: p.alpha, dim: p.dim };
  },
  camera: (v, ctx) => refCamera('carousel3d', v.perspective, v.distance, ctx.height),
};

const E86 = { id: 'custom' as const, bezier: [0.86, 0.14, 0.14, 0.86] as [number, number, number, number] };
const LIN = { id: 'linear' as const };

// The reference's twenty-three "3D" presets, off its own
// `paramsPerModeBaseline`, 2026-08-23. Clip lengths pinned in
// store/useSceneStore: its ring steps per card, so the Duration is what fixes
// the seconds per slot.
export const ringRefVariants: Template[] = [
  ring, // 3D 01 — horizontal, 10 cards, plane 3015, r10915, 12.8s
  variant(ring, 'ring-r02', 'Ring 02', { axis: 'vertical', distance: 18770 }, E86),
  variant(ring, 'ring-r03', 'Ring 03', { count: 6, cycles: 2, distance: 15683, planeSize: 5000, orbitRadius: 7182 }, E86),
  variant(ring, 'ring-r04', 'Ring 04', { axis: 'vertical', count: 6, cycles: 2, distance: 17570, planeSize: 5899, orbitRadius: 8581 }, E86),
  variant(ring, 'ring-r05', 'Ring 05', { count: 4, cycles: 2, distance: 15683, planeSize: 8685, orbitRadius: 4344 }, E86),
  variant(ring, 'ring-r06', 'Ring 06', { axis: 'vertical', count: 4, cycles: 2, distance: 15683, planeSize: 7940, orbitRadius: 5270 }, E86),
  variant(ring, 'ring-r07', 'Ring 07', { offsetY: -3.5, rotationX: 12 }, LIN),
  variant(ring, 'ring-r08', 'Ring 08', { axis: 'vertical', count: 15, distance: 20302, planeSize: 1566 }, E86),
  variant(ring, 'ring-r09', 'Ring 09', { count: 15, distance: 23257, planeSize: 1566 }, E86),
  variant(ring, 'ring-r10', 'Ring 10', { distance: 0, planeSize: 4041, rotationY: 180, orbitRadius: 7235, perspective: 140 }, E86),
  variant(ring, 'ring-r11', 'Ring 11', { axis: 'vertical', distance: 0, rotationX: 180, rotationZ: 180, orbitRadius: 7587 }, E86),
  variant(ring, 'ring-r12', 'Ring 12', { count: 4, distance: 1511, planeSize: 3889, rotationY: 180, orbitRadius: 5934 }, E86),
  variant(ring, 'ring-r13', 'Ring 13', { axis: 'vertical', count: 4, distance: 1511, planeSize: 3889, rotationX: 180, rotationZ: 180, orbitRadius: 5934 }, E86),
  variant(ring, 'ring-r14', 'Ring 14', { count: 4, cycles: 2, distance: 15683, planeSize: 7105, orbitRadius: 6556 }, E86),
  variant(ring, 'ring-r15', 'Ring 15', { axis: 'vertical', count: 4, cycles: 2, distance: 15683, planeSize: 7105, orbitRadius: 6556 }, E86),
  variant(ring, 'ring-r16', 'Ring 16', { axis: 'vertical', backface: 'hide', planeSize: 4460, orbitRadius: 12924 }, E86),
  variant(ring, 'ring-r17', 'Ring 17', { count: 14, backface: 'hide', distance: 20384, planeSize: 4226, orbitRadius: 12924, perspective: 150 }, E86),
  variant(ring, 'ring-r18', 'Ring 18', { axis: 'vertical', backface: 'hide', distance: 16706, planeSize: 4222, orbitRadius: 8662, perspective: 110 }, { id: 'custom', bezier: [0.33, 0, 0, 1] }),
  variant(ring, 'ring-r19', 'Ring 19', { count: 16, offsetY: 5, surface: 'cylinder', distance: 20302, planeSize: 2478, rotationX: 20, rotationY: 230, rotationZ: 48, orbitRadius: 9047 }, LIN),
  variant(ring, 'ring-r20', 'Ring 20', { count: 16, surface: 'cylinder', backface: 'hide', distance: 12909, planeSize: 2478, rotationY: 360, orbitRadius: 7073, perspective: 120 }, LIN),
  variant(ring, 'ring-r21', 'Ring 21', { axis: 'vertical', surface: 'cylinder', distance: 16754, planeSize: 4222, orbitRadius: 8920 }, E86),
  variant(ring, 'ring-r22', 'Ring 22', { axis: 'vertical', surface: 'cylinder', distance: 7740, planeSize: 4222, rotationZ: 180, orbitRadius: 8920, perspective: 90 }, E86),
  variant(ring, 'ring-r23', 'Ring 23', { count: 16, surface: 'cylinder', distance: 4214, planeSize: 2478, rotationY: 360, orbitRadius: 7073, perspective: 120 }, LIN),
];

// Its five Carousel 3D presets. This branch runs the continuous time model, so
// `cycles` and `cycleDeg` are what set the beat rather than the card count.
export const carousel3dRefVariants: Template[] = [
  carousel3d, // Carousel 3D 01 — 12 cards, r280, plane 400, pitch 30, yaw 38
  variant(carousel3d, 'carousel3d-02', 'Carousel 3D 02', {
    count: 9, cycles: 6, cycleDeg: 60, distance: 990, direction: 'reverse',
    rotationX: 6, rotationY: 18, rotationZ: -17, orbitRadius: 330, perspective: 100,
  }, E86),
  variant(carousel3d, 'carousel3d-03', 'Carousel 3D 03', {
    count: 12, cycles: 2, cycleDeg: 180, distance: 1870, direction: 'reverse',
    rotationX: 0, rotationY: -17, orbitRadius: 330, perspective: 210,
  }, E86),
  variant(carousel3d, 'carousel3d-04', 'Carousel 3D 04', {
    count: 9, cycles: 6, cycleDeg: 60, offsetX: 50.5, distance: 1250, direction: 'reverse',
    planeSize: 410, rotationX: 0, rotationY: 0, orbitRadius: 210, perspective: 300,
  }, E86),
  variant(carousel3d, 'carousel3d-05', 'Carousel 3D 05', {
    count: 33, offsetY: -6, distance: 1370, direction: 'reverse', planeSize: 250,
    rotationX: 22, rotationY: 0, orbitRadius: 480, perspective: 160,
  }, LIN),
];
