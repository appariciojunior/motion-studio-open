import type { Template } from '@/lib/types';
import { clamp } from '@/lib/motion';
import { variant } from './variant';
import {
  refCamera, refDepthDim, refFocal, refScale, refSpinRadians, refStopIndex,
  radialQuat, rotateVec, mulQuat, eulerQuat, slerp, conjugate,
  type Quat, type Vec3,
} from './refScene3d';

const BASE = 340;
const DEG = Math.PI / 180;

// ============================================================
//  SPHERE — cards on a globe, turning under a fixed camera
//
//  The reference's own Globe family, sixteen presets of it, under our own name
//  because two of its numbers collide with the withheld shelf's. Our catalogue has
//  a Card Globe and an Orbit Globe already, but they came from a different
//  tool with a different parametrization and they live in the withheld
//  "3D & Perspective" shelf; this is the reference's, in its own numbers, and
//  it is visible.
//
//  Read out of its scene class rather than measured. Four things in it are not
//  guessable from watching:
//
//  · Cards sit on a FIBONACCI sphere — `acos(1 - 2(i+0.5)/n)` for the polar
//    angle and the golden angle for the azimuth — which is why the spacing
//    stays even at any count instead of bunching at the poles.
//  · A card's size is SCREEN space, not world space. The scene multiplies its
//    world scale by `(camZ - z) / focal`, exactly cancelling the perspective
//    shrink, so `minScale`/`maxScale` are a straight lerp on how far round the
//    sphere a card has turned — the front is big and the back is small because
//    the preset says so, not because it is farther away. Here that means
//    dividing back out by the same factor to hand the renderer a world scale.
//  · `fade` darkens toward the background rather than fading to transparent —
//    its shader blends the card to `bgColor` — so this is `dim`, not `alpha`.
//  · Its two motions are different mechanisms, not one with a switch.
//    `continuous` spins the sphere on an axis. `stepped` SLERPS it so that one
//    chosen card after another swings round to face the camera, and it picks
//    those cards by a golden-ratio stride through the count so consecutive
//    stops land on opposite sides.
//
//  `flipImage` is legibility, not decoration: Sphere 06 puts the camera at the
//  globe's own centre, where every card is seen from behind and reads mirrored.
//  A pose cannot mirror a texture, but a plane turned a half turn about its own
//  vertical axis IS its mirror — what you then see is its reverse.
// ============================================================

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Card `i` of `n` on the Fibonacci sphere, as a unit direction. */
function sphereDir(i: number, n: number): Vec3 {
  const l = (i + 0.5) / Math.max(1, n);
  const polar = Math.acos(1 - 2 * l);
  const azim = GOLDEN_ANGLE * i;
  return {
    x: Math.sin(polar) * Math.cos(azim),
    y: Math.cos(polar),
    z: Math.sin(polar) * Math.sin(azim),
  };
}

/** The sphere rotation that brings card `i` round to face the camera. */
function faceCameraQuat(i: number, n: number, inside: boolean): Quat {
  const d = sphereDir(i, n);
  const q = conjugate(radialQuat(d));
  // Seen from inside the sphere the card that is "in front" is the one on the
  // far side, so the reference spins the whole thing half a turn about up.
  return inside ? mulQuat({ x: 0, y: 1, z: 0, w: 0 }, q) : q;
}

const globeRef: Template = {
  meta: {
    id: 'globe-r01',
    name: 'Sphere 01',
    group: 'Sphere',
    engine: 'webgl',
    isNew: true,
    defaultEasing: { id: 'linear' },
    cardAspect: 3 / 4,
    repeatAssets: true,
  },

  controls: [
    { key: 'axis',           label: 'Axis',           type: 'pills',  options: ['y','x','z'],           default: 'y', section: 'Motion' },
    { key: 'direction',      label: 'Direction',      type: 'pills',  options: ['forward','reverse'],   default: 'forward', section: 'Motion' },
    { key: 'motion',         label: 'Motion',         type: 'pills',  options: ['continuous','stepped'], default: 'continuous', section: 'Motion', description: 'continuous spins the globe; stepped swings one card at a time to the front.' },
    { key: 'count',          label: 'Count',          type: 'slider', min: 4, max: 80, step: 1,         default: 40 },
    { key: 'radius',         label: 'Radius',         type: 'slider', min: 50, max: 1600, step: 5,      default: 355, section: 'Layout' },
    { key: 'minScale',       label: 'Min Scale',      type: 'slider', min: 0, max: 100, step: 0.01,     default: 10, unit: '%', precision: 2, section: 'Depth', description: 'Card size at the back of the globe.' },
    { key: 'maxScale',       label: 'Max Scale',      type: 'slider', min: 0, max: 200, step: 0.01,     default: 20, unit: '%', precision: 2, section: 'Depth', description: 'Card size at the front.' },
    { key: 'fade',           label: 'Fade',           type: 'slider', min: 0, max: 100, step: 1,        default: 0, unit: '%', section: 'Depth', description: 'Darken the far side toward the background.' },
    { key: 'backface',       label: 'Backface',       type: 'pills',  options: ['show','hide'],         default: 'show', section: 'Depth' },
    { key: 'autoFaceCamera', label: 'Face Camera',    type: 'toggle', options: ['on','off'],            default: 'on', section: 'Layout', description: 'on billboards every card; off lays them flat on the sphere.' },
    { key: 'flipImage',      label: 'Mirror',         type: 'toggle', options: ['off','on'],            default: 'off', section: 'Layout', description: 'Show every card\u2019s reverse \u2014 what the globe needs when the camera is inside it.' },
    { key: 'distance',       label: 'Distance',       type: 'slider', min: 0, max: 6000, step: 50,      default: 1000, section: 'Depth' },
    { key: 'perspective',    label: 'Perspective',    type: 'slider', min: 10, max: 300, step: 5,       default: 100, section: 'Depth', description: 'Lens width. Lower is wider; the camera does not move.' },
    { key: 'roll',           label: 'Roll',           type: 'slider', min: -180, max: 180, step: 1,     default: 0, unit: '°', section: 'Layout', description: 'Tip the whole globe about the view axis.' },
    { key: 'cycles',         label: 'Cycles',         type: 'slider', min: 0.25, max: 12, step: 0.25,   default: 1, section: 'Motion', description: 'Rounded to complete rotations or complete tours of the stops so the clip loops.' },
    { key: 'cycleDeg',       label: 'Cycle Turn',     type: 'slider', min: 15, max: 360, step: 15,      default: 360, unit: '°', section: 'Motion', visibleWhen: { key: 'motion', equals: 'continuous' }, description: 'Degrees the globe turns per cycle.' },
    { key: 'stops',          label: 'Stops',          type: 'slider', min: 0, max: 24, step: 1,         default: 0, section: 'Motion', visibleWhen: { key: 'motion', equals: 'stepped' }, description: 'Cards visited per cycle. 0 visits them all.' },
    { key: 'cornerRadius',   label: 'Corner Radius',  type: 'slider', min: 0, max: 200, step: 1,        default: 0 },
    { key: 'offset',         label: 'Offset',         type: 'xypad',                                    default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const p = globePose(frame, index, count, v, ctx);
    return {
      x: p.x * p.project, y: p.y * p.project, scale: p.scale, rotation: 0, alpha: p.alpha, dim: p.dim, depth: p.depth,
    };
  },

  transform3d: (frame, index, count, v, ctx) => {
    const p = globePose(frame, index, count, v, ctx);
    return {
      x: p.x, y: p.y, z: p.z,
      quaternion: p.quat,
      scale: p.scale, alpha: p.alpha, dim: p.dim,
    };
  },

  camera: (v, ctx) => refCamera('sphere', v.perspective, v.distance, ctx.height, v.radius + 1000),
};

function globePose(
  frame: number, index: number, count: number, v: Record<string, any>,
  ctx: { width: number; height: number; totalFrames: number; cardAspect?: number; easedPhase: (p: number) => number; ease: (t: number) => number },
) {
  const n = Math.max(1, Math.round(count));
  const k = refScale(ctx.height);
  const radius = Math.max(1, v.radius);
  const focal = refFocal('sphere', v.perspective, ctx.height);
  const camZ = Math.abs(v.distance);
  const dir = v.direction === 'reverse' ? -1 : 1;
  const stepped = v.motion === 'stepped';

  // The globe's own rotation this frame.
  let spin: Quat;
  if (stepped) {
    // One card after another is slerped round to the front. The number of
    // stops in a clip is `cycles * stops`, and landing back on stop 0 at the
    // end is what closes the loop.
    const stops = v.stops > 0 ? clamp(Math.round(v.stops), 1, n) : n;
    const total = v.cycles === 0 ? 0 : Math.max(1, Math.round(v.cycles)) * stops;
    const p = (frame / Math.max(1, ctx.totalFrames)) * total;
    const step = Math.floor(p);
    const eased = ctx.ease(clamp(p - step, 0, 1));
    const inside = camZ < radius;
    const at = (s: number) => refStopIndex(((dir >= 0 ? s : -s) % stops + stops) % stops, n);
    spin = slerp(faceCameraQuat(at(step), n, inside), faceCameraQuat(at(step + 1), n, inside), eased);
  } else {
    const angle = dir * refSpinRadians(
      'continuous', frame, ctx.totalFrames, ctx.easedPhase, n, v.cycles, v.cycleDeg,
    );
    // Its axis rule: y turns positive, x and z turn negative. That sign is not
    // decoration — it is what makes `reverse` read as reverse on all three.
    spin = v.axis === 'x' ? eulerQuat(-angle, 0, 0)
      : v.axis === 'z' ? eulerQuat(0, 0, -angle)
        : eulerQuat(0, angle, 0);
  }

  const authored = eulerQuat(0, 0, v.roll * DEG);
  const total = mulQuat(authored, spin);
  const d = sphereDir(index % n, n);
  const world = rotateVec({ x: d.x * radius, y: d.y * radius, z: d.z * radius }, total);

  const gone = { x: 0, y: 0, z: 0, quat: { x: 0, y: 0, z: 0, w: 1 }, scale: 0, project: 1, alpha: 0, dim: 0, depth: -1 };

  // How far round the globe this card has come: -1 dead behind, +1 dead front.
  const front = clamp(world.z / radius, -1, 1);

  // The reference culls the far hemisphere itself when backfaces are hidden and
  // the cards lie flat, because a flat card there is showing its own reverse.
  const radial = v.autoFaceCamera === 'off';
  if (v.backface === 'hide' && radial && front <= radius / (focal + camZ)) return gone;

  // Everything in front of the lens, or the projection flips it inside out.
  const depth = camZ - world.z;
  if (depth <= 1) return gone;

  const size = Math.max(0.001, v.minScale / 100 + (v.maxScale - v.minScale) / 100 * ((front + 1) / 2));
  const aspect = Math.max(0.05, ctx.cardAspect ?? 3 / 4);
  // Its plane is a constant 1000 units wide before `size`, and `size` is a
  // share of the SCREEN — so undo the perspective the renderer is about to
  // apply, which is what the scene does to keep the size screen-space.
  const screenPx = 1000 * size * k;
  const scale = (screenPx / (BASE * aspect)) * (depth / focal);

  const half: Quat = { x: 0, y: 1, z: 0, w: 0 };
  const facing: Quat = radial ? mulQuat(total, radialQuat(d)) : { x: 0, y: 0, z: 0, w: 1 };
  const quat = v.flipImage === 'on' ? mulQuat(facing, half) : facing;

  // The 2D fallback has no camera. Its card size is already screen-space, so
  // only the placement needs the depth division.
  const project = focal / depth;

  return {
    x: world.x * k + v.offset.x,
    y: -world.y * k + v.offset.y,
    z: world.z * k,
    quat,
    scale,
    project,
    alpha: 1,
    dim: refDepthDim(v.fade, (1 - front) / 2),
    depth: world.z,
  };
}

// The reference's sixteen presets, read live out of its own
// `paramsPerModeBaseline` on 2026-08-23. Clip lengths are pinned in
// store/useSceneStore: `duration * cycles` for the continuous ones, and its
// `duration` outright for the stepped ones.
const LINEAR = { id: 'linear' as const };
const EASE_86 = { id: 'custom' as const, bezier: [0.86, 0.14, 0.14, 0.86] as [number, number, number, number] };
const EASE_80 = { id: 'custom' as const, bezier: [0.8, 0.27, 0.2, 0.75] as [number, number, number, number] };
const EASE_87 = { id: 'custom' as const, bezier: [0.87, 0, 0.13, 1] as [number, number, number, number] };

export const globeRefVariants: Template[] = [
  globeRef, // Globe 01 — y, r355, 10-20%, 7s
  variant(globeRef, 'globe-r02', 'Sphere 02', {
    axis: 'x', radius: 300, maxScale: 22, cycles: 6, cycleDeg: 60,
  }, EASE_80),
  variant(globeRef, 'globe-r03', 'Sphere 03', {
    axis: 'z', radius: 890, minScale: 3, maxScale: 22, distance: 900, perspective: 150,
  }, LINEAR),
  variant(globeRef, 'globe-r04', 'Sphere 04', {
    radius: 480, minScale: 2, maxScale: 6, fade: 23, distance: 750,
    direction: 'reverse', perspective: 135,
  }, LINEAR),
  variant(globeRef, 'globe-r05', 'Sphere 05', {
    count: 60, radius: 480, minScale: 6, maxScale: 10.5, fade: 40, distance: 1250,
    direction: 'reverse', perspective: 110, autoFaceCamera: 'off',
  }, LINEAR),
  // Its camera sits INSIDE this one — distance 0 against a 505 radius.
  variant(globeRef, 'globe-r06', 'Sphere 06', {
    flipImage: 'on', count: 60, radius: 505, minScale: 7, maxScale: 12, distance: 0,
    direction: 'reverse', perspective: 145, autoFaceCamera: 'off',
  }, LINEAR),
  variant(globeRef, 'globe-r07', 'Sphere 07', {
    count: 60, radius: 800, minScale: 0.01, maxScale: 15.46, fade: 44, distance: 4450,
    perspective: 35, autoFaceCamera: 'off', backface: 'hide',
  }, LINEAR),
  variant(globeRef, 'globe-r08', 'Sphere 08', {
    count: 60, radius: 480, minScale: 1.5, maxScale: 6, fade: 15, cycles: 2, cycleDeg: 180,
    distance: 650, perspective: 150,
  }, EASE_86),
  variant(globeRef, 'globe-r09', 'Sphere 09', {
    radius: 580, minScale: 14, maxScale: 51.5, cycles: 2, distance: 2000,
    direction: 'reverse', backface: 'hide', perspective: 135,
  }, { id: 'custom', bezier: [0.7, 0.101, 0.3, 0.899] }),
  variant(globeRef, 'globe-r10', 'Sphere 10', {
    count: 10, radius: 480, minScale: 5, maxScale: 20, cycles: 6, cycleDeg: 60,
    distance: 650, direction: 'reverse', perspective: 150,
  }, EASE_80),
  variant(globeRef, 'globe-r11', 'Sphere 11', {
    motion: 'stepped', stops: 8, radius: 595, minScale: 0.01, maxScale: 33.09,
    direction: 'reverse', perspective: 90, autoFaceCamera: 'off',
  }, { id: 'custom', bezier: [0.33, 0, 0, 1] }),
  variant(globeRef, 'globe-r12', 'Sphere 12', {
    axis: 'x', count: 30, motion: 'stepped', stops: 6, fade: 26, radius: 595,
    minScale: 0.01, maxScale: 33.09, perspective: 90,
  }, EASE_87),
  variant(globeRef, 'globe-r13', 'Sphere 13', {
    axis: 'x', count: 16, motion: 'stepped', stops: 6, fade: 26, radius: 595,
    minScale: 4.4, maxScale: 44.79, perspective: 85,
  }, EASE_87),
  variant(globeRef, 'globe-r14', 'Sphere 14', {
    count: 41, motion: 'stepped', stops: 6, radius: 905, minScale: 19.59, maxScale: 66.06,
    distance: 150, perspective: 105,
  }, EASE_87),
  variant(globeRef, 'globe-r15', 'Sphere 15', {
    count: 60, motion: 'stepped', stops: 6, radius: 165, minScale: 6.73, maxScale: 23.99,
    distance: 150, perspective: 160,
  }, { id: 'custom', bezier: [0.76, 0, 0.24, 1] }),
  variant(globeRef, 'globe-r16', 'Sphere 16', {
    radius: 480, minScale: 1.19, maxScale: 13.77, fade: 23, distance: 750,
    direction: 'reverse', roll: 33, perspective: 135,
  }, LINEAR),
];
