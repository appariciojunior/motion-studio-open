import type { ControlDef } from './types';

// ----- The house camera: a SHOT, on top of whatever the template poses -----
//
// A webgl template may declare `camera(values, ctx) -> CameraPose`, and 72 of
// the 82 webgl presets in the catalogue do — measured, not guessed. So the gap
// was never that the camera has no pose: it is that the pose is a function of
// the TEMPLATE's own controls, so each preset had exactly one framing and the
// person using it had none. This is that missing half: five controls that move
// the camera itself, composed onto the template's pose rather than replacing
// it, so a preset with its own camera work keeps it and merely gets re-framed.
//
// Why these five and not more:
//
//   · Zoom is a DOLLY, not a lens change. It divides the camera's distance to
//     its target, which makes the subject fill more of the frame at the same
//     fov — the keystone/perspective feel is untouched. Widening the lens is a
//     different move and already belongs to each template's own `perspective`.
//   · Pan is a LENS SHIFT — it slides the film gate across the projection
//     (three's `setViewOffset`), it does not move the camera. Trucking the
//     camera sideways was the first implementation and it was wrong for a
//     REFRAMING control: measured on Spinner 01, a +30% truck widened the
//     silhouette's box from 172px to 201px, because moving the camera off axis
//     adds keystone. The shot is supposed to be re-centred, not re-shaped. A
//     lens shift translates the frame and leaves every angle intact, and it
//     cannot push a template's authored composition out of shape.
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

// Reserved keys, stored on the SCENE (see SceneCameraState below). Prefixed so
// they can never collide with a template control, and so a glance at a saved
// scene says which keys are the house's.
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

// ----- Where each house control is allowed to appear -----
//
// Most of these moves already exist as a control the TEMPLATE declares, and a
// second knob for the same move makes the panel fiddlier instead of more
// capable. Measured over the 82 webgl presets in the catalogue:
//
//   Zoom     duplicated in 67 (`zoom` 35, `distance` 32)   -> new in 15
//   Pan X/Y  duplicated in 61 (`offset` xypad 50, `offsetX/Y` 11) -> new in 21
//   Orbit Y  duplicated in 31 (`ringYaw` 20, `rotationY` 11)
//
// `tilt` is NOT on that list, and the reason is worth keeping: it looked like a
// duplicate because ONE preset (ticker-02) labels it "Rotation Y". In the other
// fifteen that declare it — Deck 04, Box, Card Tunnel, Surface — it is a ROLL or
// a lean (box.ts: "rolls the whole prism in the view plane"; deck.ts applies it
// as `rotation`). Gating on the label hid a control nobody duplicated and zeroed
// a value the person had set. Read what a key DOES, not how it is labelled.
//   Orbit X  duplicated in 31 (`tiltX` 20, `rotationX` 11, plus the 9 coil
//            presets whose `cameraView` pills ARE the elevation: side/down)
//
// So the house camera shows a control only where no visible layer already
// offers that move. Nine presets — the six Poster and three Stickers — declare
// no camera control at all and get the whole set.
//
// What is deliberately NOT treated as a duplicate: `cardRotation`, `cardTilt`,
// `fanRotation`, `dragRotation`, `motionRotation`. Those turn the CARDS, which
// is a different move from turning the camera — the cards keep facing wherever
// the template aimed them.
//
// The consequence in a stacked scene is explicit: one layer offering its own
// zoom hides the house Zoom for the whole scene, because the camera is one
// camera. Never two knobs for one move is the rule that was chosen.
export const SCENE_CAMERA_DUPLICATES: Record<string, string[]> = {
  _camZoom: ['zoom', 'distance'],
  _camPanX: ['offset', 'offsetX'],
  _camPanY: ['offset', 'offsetY'],
  _camOrbitX: ['rotationX', 'tiltX', 'cameraView'],
  _camOrbitY: ['rotationY', 'ringYaw'],
};

interface HasControls { controls: ControlDef[] }

// The controls to show for a given set of layers. Empty means the whole
// section goes away — every move on offer is already on the panel.
export function sceneCameraControlsFor(templates: HasControls[]): ControlDef[] {
  const declared = new Set<string>();
  for (const t of templates) for (const c of t.controls) declared.add(c.key);
  return SCENE_CAMERA_CONTROLS.filter(
    (def) => !(SCENE_CAMERA_DUPLICATES[def.key] ?? []).some((key) => declared.has(key)),
  );
}

// The same decision, applied to the VALUES the renderer reads. A control that
// the panel hides has to be inert, not merely invisible: a scene saved while a
// control was on offer must not keep steering the camera from behind a panel
// that no longer shows it.
export function gateSceneCamera(cam: SceneCameraValues, templates: HasControls[]): SceneCameraValues {
  const allowed = new Set(sceneCameraControlsFor(templates).map((def) => def.key));
  if (allowed.size === SCENE_CAMERA_CONTROLS.length) return cam;
  return {
    zoom: allowed.has('_camZoom') ? cam.zoom : NEUTRAL_SCENE_CAMERA.zoom,
    panX: allowed.has('_camPanX') ? cam.panX : NEUTRAL_SCENE_CAMERA.panX,
    panY: allowed.has('_camPanY') ? cam.panY : NEUTRAL_SCENE_CAMERA.panY,
    orbitX: allowed.has('_camOrbitX') ? cam.orbitX : NEUTRAL_SCENE_CAMERA.orbitX,
    orbitY: allowed.has('_camOrbitY') ? cam.orbitY : NEUTRAL_SCENE_CAMERA.orbitY,
  };
}

// How the shot is STORED: the raw control values, keyed by control key, so the
// panel is a straight map and the declared defaults stay the single source of
// truth. It lives on the scene, not on a track — a camera is a property of the
// SHOT, and two layers composited from two different camera positions cannot be
// one. Measured before this moved: with the values on the track, Zoom 200% grew
// the active layer's silhouette from 105x182 to 136x363 and left the other
// layer byte-identical at 104x182.
export type SceneCameraState = Record<string, number>;

export const SCENE_CAMERA_DEFAULTS: SceneCameraState = Object.fromEntries(
  SCENE_CAMERA_CONTROLS.map((def) => [def.key, Number(def.default)]),
);

// A saved scene may carry no camera at all (saved before the shot existed), a
// stale key, or garbage. Rebuild it from the declared controls every time and
// clamp to each control's own range: an out-of-range value is not hypothetical
// here — a slider in this app once stored 3405 on a control whose max was 360.
export function sanitizeSceneCamera(raw: unknown): SceneCameraState {
  const out: SceneCameraState = { ...SCENE_CAMERA_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const def of SCENE_CAMERA_CONTROLS) {
    const v = Number((raw as Record<string, unknown>)[def.key]);
    if (!Number.isFinite(v)) continue;
    const min = def.min ?? -Infinity;
    const max = def.max ?? Infinity;
    out[def.key] = Math.min(max, Math.max(min, v));
  }
  return out;
}

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

  // Pan is NOT here: it is a lens shift on the projection, not a move in
  // space. See sceneLensShift.
  return {
    position: { x: target.x + vx, y: target.y + vy, z: target.z + vz },
    target: { x: target.x, y: target.y, z: target.z },
  };
}

// The pan, as the projection offset three wants for setViewOffset: the window
// this camera renders, expressed inside a larger frame. Sliding that window
// LEFT is what makes the image move RIGHT, hence the negation — so a positive
// Pan X sends the image right and a positive Pan Y sends it down, the canvas
// convention the Offset pad already uses. 100% is exactly one frame.
// Returns null when there is nothing to shift, so the caller can clear the
// offset instead of setting a no-op one (the cameras are reused frame to
// frame; a stale offset would outlive the value that asked for it).
export function sceneLensShift(
  cam: SceneCameraValues,
  width: number,
  height: number,
): { fullWidth: number; fullHeight: number; x: number; y: number; width: number; height: number } | null {
  if (cam.panX === 0 && cam.panY === 0) return null;
  // `-0` for the untouched axis is what a plain negation produces, and it is
  // not the same value as `0` to anything comparing offsets. Normalise it.
  const zero = (v: number) => (v === 0 ? 0 : v);
  return {
    fullWidth: width,
    fullHeight: height,
    x: zero(-cam.panX * width),
    y: zero(-cam.panY * height),
    width,
    height,
  };
}
