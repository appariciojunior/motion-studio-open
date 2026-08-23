import type { Template } from '@/lib/types';
import { clamp } from '@/lib/motion';
import { variant } from './variant';
import {
  flatFallback, refCamera, refFocal, refScale, mulQuat, eulerQuat, refSpinRadians, rotateVec,
  type Quat,
} from './refScene3d';

const BASE = 340;
const DEG = Math.PI / 180;

/** A half turn about the solid's own vertical axis: front cover to back cover. */
const HALF_TURN: Quat = { x: 0, y: 1, z: 0, w: 0 };

// ============================================================
//  MAGAZINE 05-09 — the shut magazine, turning on the spot
//
//  The reference files these under the same Magazine name as its page-turning
//  scene, but they are a different thing entirely: not sheets at all, a single
//  SOLID with real thickness, spinning about its spine axis under a key light.
//  They follow its four page-turning presets here as 05 to 09.
//
//  Its own numbers, out of `buildOrUpdateBook`:
//
//  · `planeSize` is the magazine's HEIGHT; its width comes from the cover
//    image's own aspect and its depth is `thickness` percent of the height —
//    5% of 1450, so 72.5 units on a 1450-tall book. Restated here as a
//    thickness in sprite units, which works out to a constant 17 whatever the
//    canvas is.
//  · It turns about y only, `cycleDeg` per cycle, and the authored
//    pitch/yaw/roll sit outside that on the rig — which is what makes 06 and 07
//    read as a magazine held at an angle rather than one on a turntable.
//
//  The reference paints FOUR faces — cover, spine, back cover, and a generated
//  page-edge texture on the fore-edge. A pose carries one texture, and these
//  presets turn a full half or whole revolution, so a single solid spends half
//  the loop showing an unpainted back. Two solids fix it: the same box twice,
//  the second turned to face the other way with the next image on it, and each
//  drawn only while its own cover points at the camera. The spine and the
//  fore-edge are still the cover's colours — that part does not carry over.
// ============================================================

function bookPose(
  frame: number, index: number, v: Record<string, any>,
  ctx: { width: number; height: number; totalFrames: number; cardAspect?: number; easedPhase: (p: number) => number },
) {
  const k = refScale(ctx.height);
  const dir = v.direction === 'reverse' ? -1 : 1;
  const spin = dir * refSpinRadians('continuous', frame, ctx.totalFrames, ctx.easedPhase, 1, v.cycles, v.cycleDeg);
  const rig = mulQuat(
    eulerQuat(v.rotationX * DEG, v.rotationY * DEG, v.rotationZ * DEG),
    eulerQuat(0, spin, 0),
  );
  // Layer 1 is the same solid turned to face the other way, so its own cover
  // image becomes the magazine's back cover.
  const isBack = index % 2 === 1;
  const quat = isBack ? mulQuat(rig, HALF_TURN) : rig;
  // Only the one whose cover points at the camera is drawn; the other would be
  // inside it.
  const facing = rotateVec({ x: 0, y: 0, z: 1 }, quat).z;
  if (facing < 0) return { x: 0, y: 0, z: 0, quat, scale: 0, project: 1, alpha: 0, dim: 0, depth: -1 };

  const camZ = Math.abs(v.distance);
  const depth = Math.max(1, camZ);
  return {
    x: (v.offsetX / 100) * ctx.width,
    y: (v.offsetY / 100) * ctx.height,
    z: 0,
    quat,
    // `planeSize` is the height, and the renderer normalizes a portrait
    // sprite's long edge — its height — to BASE.
    scale: (v.planeSize * k) / BASE,
    project: refFocal('ring3d', v.perspective, ctx.height) / depth,
    alpha: 1,
    dim: 0,
    depth: 0,
  };
}

const magazineSolid: Template = {
  meta: {
    id: 'magazine-05', name: 'Magazine 05', group: 'Magazine', engine: 'webgl', isNew: true,
    defaultEasing: { id: 'custom', bezier: [0.86, 0.14, 0.14, 0.86] },
    cardAspect: 3 / 4, repeatAssets: true,
  },

  controls: [
    { key: 'direction',      label: 'Direction',     type: 'pills',  options: ['forward','reverse'], default: 'forward', section: 'Motion' },
    { key: 'planeSize',      label: 'Height',        type: 'slider', min: 200, max: 3000, step: 10,  default: 1450, section: 'Layout' },
    { key: 'thickness',      label: 'Thickness',     type: 'slider', min: 0.5, max: 30, step: 0.5,   default: 5, unit: '%', precision: 1, section: 'Layout', description: 'Spine depth as a share of the height.' },
    { key: 'rotationX',      label: 'Pitch',         type: 'slider', min: -90, max: 90, step: 1,     default: 0, unit: '°', section: 'Layout' },
    { key: 'rotationY',      label: 'Yaw',           type: 'slider', min: -90, max: 90, step: 1,     default: 0, unit: '°', section: 'Layout' },
    { key: 'rotationZ',      label: 'Roll',          type: 'slider', min: -90, max: 90, step: 1,     default: 0, unit: '°', section: 'Layout' },
    { key: 'cycles',         label: 'Cycles',        type: 'slider', min: 0.25, max: 8, step: 0.25,  default: 2, section: 'Motion' },
    { key: 'cycleDeg',       label: 'Cycle Turn',    type: 'slider', min: 15, max: 360, step: 15,    default: 180, unit: '°', section: 'Motion' },
    { key: 'distance',       label: 'Distance',      type: 'slider', min: 200, max: 6000, step: 10,  default: 2200, section: 'Depth' },
    { key: 'perspective',    label: 'Perspective',   type: 'slider', min: 10, max: 300, step: 5,     default: 100, section: 'Depth' },
    { key: 'lightIntensity', label: 'Light',         type: 'slider', min: 0, max: 200, step: 5,      default: 125, unit: '%', section: 'Finish' },
    { key: 'shadow',         label: 'Shadow',        type: 'slider', min: 0, max: 100, step: 1,      default: 35, unit: '%', section: 'Finish' },
    { key: 'offsetX',        label: 'Shift X',       type: 'slider', min: -50, max: 50, step: 0.5,   default: 0, unit: '%', precision: 1, section: 'Layout' },
    { key: 'offsetY',        label: 'Shift Y',       type: 'slider', min: -50, max: 50, step: 0.5,   default: 0, unit: '%', precision: 1, section: 'Layout' },
  ],

  // One solid for the cover, one for the back cover.
  layerCount: () => 2,

  transform: (frame, index, count, v, ctx) => flatFallback(bookPose(frame, index, v, ctx), ctx, BASE),

  transform3d: (frame, index, count, v, ctx) => {
    const p = bookPose(frame, index, v, ctx);
    return {
      x: p.x, y: p.y, z: p.z,
      quaternion: p.quat,
      // A share of the height, and the sprite's long edge IS the height, so the
      // conversion cancels the canvas out: 1450 tall at 5% is always 17 here.
      thickness: (BASE * clamp(v.thickness, 0.5, 30)) / 100,
      materialExposure: Math.max(0, v.lightIntensity / 100),
      shadowStrength: clamp(v.shadow / 100, 0, 1),
      scale: p.scale,
      alpha: 1,
    };
  },

  camera: (v, ctx) => refCamera('ring3d', v.perspective, v.distance, ctx.height, v.planeSize),
};

const E86 = { id: 'custom' as const, bezier: [0.86, 0.14, 0.14, 0.86] as [number, number, number, number] };
const LIN = { id: 'linear' as const };

// Its Magazine 03-07, off its own `paramsPerModeBaseline` on 2026-08-23. All
// five run planeSize 1450, thickness 5 and distance 2200. Clip lengths pinned
// in store/useSceneStore as duration * cycles.
export const magazineSolidVariants: Template[] = [
  magazineSolid, // its Magazine 03 — 2 cycles of 180 degrees over 5s each
  variant(magazineSolid, 'magazine-06', 'Magazine 06', {
    cycles: 1, cycleDeg: 360, direction: 'reverse',
  }, LIN),
  variant(magazineSolid, 'magazine-07', 'Magazine 07', {
    cycles: 1, cycleDeg: 360, lightIntensity: 100,
  }, E86),
  variant(magazineSolid, 'magazine-08', 'Magazine 08', {
    cycles: 1, cycleDeg: 360, direction: 'reverse',
    rotationX: -17, rotationY: -27, rotationZ: -11, lightIntensity: 120,
  }, LIN),
  variant(magazineSolid, 'magazine-09', 'Magazine 09', {
    rotationX: -18, rotationY: -48, rotationZ: 1, lightIntensity: 100,
  }, E86),
];
