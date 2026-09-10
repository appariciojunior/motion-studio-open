import type { ControlDef } from './types';

// ----- The house camera: a SHOT, on top of whatever the template poses -----
//
// A webgl template may declare `camera(values, ctx) -> CameraPose`, and 17 of
// them do. The other webgl presets leave the camera parked on the z axis at the
// fov-derived fit distance and pose the CARDS instead, so the same motion can
// only ever be seen from one place. This is that missing half: five controls
// that move the camera itself, composed onto the template's pose rather than
// replacing it, so a preset with its own camera work keeps it and merely gets
// re-framed.
//
// Why these five and not more:
//
//   · Zoom is a DOLLY, not a lens change. It divides the camera's distance to
//     its target, which makes the subject fill more of the frame at the same
//     fov — the keystone/perspective feel is untouched. Widening the lens is a
//     different move and already belongs to each template's own `perspective`.
//   · Pan trucks the camera AND its target by the same vector, so the view
//     direction never changes. On a scene with depth this is not the same
//     picture as sliding the layer: near cards shift more than far ones.
//   · Orbit swings the camera around the target on a sphere — pitch first, then
//     yaw, which is what makes the pair read as one orbit instead of two
//     independent shears.
//   · There is deliberately NO roll. Rolling a pinhole camera about its optical
//     axis produces exactly the image you get by rotating the finished frame,
//     and the track transform already has `rotation`. A control that duplicates
//     an existing one is worse than a missing one.
//
// Every default is exactly neutral, and `isNeutralSceneCamera` lets the
// renderer skip the whole composition — an untouched scene renders the same
// numbers it rendered before this file existed.

export interface SceneCameraValues {
  zoom: number;    // 1 = the template's own distance
  panX: number;    // fractions of the visible frame (1 = a full frame across)
  panY: number;
  orbitX: number;  // degrees; positive lifts the camera and looks down
  orbitY: number;  // degrees; positive swings the camera to the right
}

// Reserved keys, stored in the track's own `values` alongside the template's.
// Prefixed so they can never collide with a template control, and so a glance
// at a saved scene says which keys are the house's.
export const SCENE_CAMERA_CONTROLS: ControlDef[] = [
  { key: '_camZoom', label: 'Zoom', type: 'slider', min: 25, max: 300, step: 1, default: 100, unit: '%',
    description: 'Moves the camera closer to what it is aimed at. The lens stays the same width.' },
  { key: '_camPanX', label: 'Pan X', type: 'slider', min: -100, max: 100, step: 1, default: 0, unit: '%',
    description: 'Slides the frame sideways. Like the Offset pad, the control moves the image.' },
  { key: '_camPanY', label: 'Pan Y', type: 'slider', min: -100, max: 100, step: 1, default: 0, unit: '%' },
  { key: '_camOrbitY', label: 'Orbit Y', type: 'slider', min: -90, max: 90, step: 1, default: 0, unit: '°',
    description: 'Swings the camera around the subject horizontally.' },
  { key: '_camOrbitX', label: 'Orbit X', type: 'slider', min: -80, max: 80, step: 1, default: 0, unit: '°',
    description: 'Raises the camera above the subject. Stops short of the pole, where the view would flip.' },
];

export const NEUTRAL_SCENE_CAMERA: SceneCameraValues = { zoom: 1, panX: 0, panY: 0, orbitX: 0, orbitY: 0 };

const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// A track that has never been re-framed has none of these keys, so every read
// falls back to neutral. Percentages become fractions here, once, so the math
// below never has to remember which unit it is in.
export function readSceneCamera(values: Record<string, any> | undefined): SceneCameraValues {
  if (!values) return NEUTRAL_SCENE_CAMERA;
  return {
    zoom: Math.max(0.05, num(values._camZoom, 100) / 100),
    panX: num(values._camPanX, 0) / 100,
    panY: num(values._camPanY, 0) / 100,
    orbitX: num(values._camOrbitX, 0),
    orbitY: num(values._camOrbitY, 0),
  };
}

export function isNeutralSceneCamera(cam: SceneCameraValues): boolean {
  return cam.zoom === 1 && cam.panX === 0 && cam.panY === 0 && cam.orbitX === 0 && cam.orbitY === 0;
}

export interface Vec3 { x: number; y: number; z: number }

const DEG = Math.PI / 180;

// Everything here is in the renderer's POSE space: x right, y DOWN (canvas
// convention — renderer3d negates y when it hands the vector to three), z
// toward the viewer. Keeping the composition in pose space means the caller
// can feed it a template's CameraPose untouched.
export function frameSceneCamera(
  position: Vec3,
  target: Vec3,
  cam: SceneCameraValues,
  fov: number,
  aspect: number,
): { position: Vec3; target: Vec3 } {
  let vx = position.x - target.x;
  let vy = position.y - target.y;
  let vz = position.z - target.z;

  // 1. Dolly. A divisor, so 200% is half the distance — twice as close.
  if (cam.zoom !== 1) {
    vx /= cam.zoom; vy /= cam.zoom; vz /= cam.zoom;
  }

  // 2. Orbit, pitch then yaw. Pose y points down, so a POSITIVE pitch has to
  //    push the camera's y negative for it to rise above the subject.
  if (cam.orbitX !== 0) {
    const a = cam.orbitX * DEG;
    const y = vy * Math.cos(a) - vz * Math.sin(a);
    const z = vy * Math.sin(a) + vz * Math.cos(a);
    vy = y; vz = z;
  }
  if (cam.orbitY !== 0) {
    const a = cam.orbitY * DEG;
    const x = vx * Math.cos(a) + vz * Math.sin(a);
    const z = -vx * Math.sin(a) + vz * Math.cos(a);
    vx = x; vz = z;
  }

  const out = {
    position: { x: target.x + vx, y: target.y + vy, z: target.z + vz },
    target: { x: target.x, y: target.y, z: target.z },
  };

  // 3. Pan. Measured against the frame the camera can see AT ITS TARGET, after
  //    the dolly — so a pan of 100% is always one frame across, whatever the
  //    zoom. Camera and target move together: the view direction is unchanged.
  if (cam.panX !== 0 || cam.panY !== 0) {
    const dist = Math.hypot(vx, vy, vz) || 1;
    const frameH = 2 * dist * Math.tan((fov * DEG) / 2);
    const frameW = frameH * aspect;
    // Camera basis. Forward runs position -> target; world up in pose space is
    // (0,-1,0) because y is down. right = up x forward, up = forward x right.
    const fx = -vx / dist, fy = -vy / dist, fz = -vz / dist;
    let rx = -fz, ry = 0, rz = fx;          // (0,-1,0) x forward
    const rlen = Math.hypot(rx, ry, rz);
    if (rlen < 1e-9) {
      // Looking straight down the world up axis: any right vector will do, and
      // x is the one that keeps a top-down shot's pan reading left/right.
      rx = 1; ry = 0; rz = 0;
    } else {
      rx /= rlen; ry /= rlen; rz /= rlen;
    }
    const ux = fy * rz - fz * ry;
    const uy = fz * rx - fx * rz;
    const uz = fx * ry - fy * rx;

    // The control moves the IMAGE, in canvas convention (x right, y down) —
    // the same contract as the Offset pad. Moving the image right means
    // trucking the camera LEFT; moving it down means lifting the camera.
    const dx = -rx * cam.panX * frameW + ux * cam.panY * frameH;
    const dy = -ry * cam.panX * frameW + uy * cam.panY * frameH;
    const dz = -rz * cam.panX * frameW + uz * cam.panY * frameH;
    out.position.x += dx; out.position.y += dy; out.position.z += dz;
    out.target.x += dx; out.target.y += dy; out.target.z += dz;
  }

  return out;
}
