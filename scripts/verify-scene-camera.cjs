// The house camera must re-frame a shot without ever moving it by accident.
// Neutral has to be neutral to the bit, a dolly may not change where the camera
// LOOKS, a pan may not change the view DIRECTION, and an orbit may not change
// the distance. Each of those is a way the control could feel right in one
// preset and wrong in the next.
require('sucrase/register');
const assert = require('node:assert/strict');
const {
  readSceneCamera, isNeutralSceneCamera, frameSceneCamera, NEUTRAL_SCENE_CAMERA, SCENE_CAMERA_CONTROLS,
  SCENE_CAMERA_DEFAULTS, sanitizeSceneCamera,
} = require('../lib/sceneCamera');

const near = (a, b, tol = 1e-7, what = '') => assert.ok(Math.abs(a - b) < tol, `${what} ${a} != ${b}`);
const dist = (p, t) => Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
const cam = (over = {}) => ({ ...NEUTRAL_SCENE_CAMERA, ...over });

// ---- reading values off a track ----
assert.deepEqual(readSceneCamera(undefined), NEUTRAL_SCENE_CAMERA);
assert.deepEqual(readSceneCamera({}), NEUTRAL_SCENE_CAMERA);
assert.ok(isNeutralSceneCamera(readSceneCamera({ perspective: 140, count: 9 })));
assert.deepEqual(readSceneCamera({ _camZoom: 200, _camPanX: 50, _camPanY: -25, _camOrbitX: 12, _camOrbitY: -30 }),
  { zoom: 2, panX: 0.5, panY: -0.25, orbitX: 12, orbitY: -30 });
// Garbage in a saved scene must read as neutral, not as NaN — a NaN reaches
// three as a broken projection matrix and the track renders nothing at all.
assert.deepEqual(readSceneCamera({ _camZoom: NaN, _camPanX: 'x', _camPanY: undefined, _camOrbitX: Infinity }),
  NEUTRAL_SCENE_CAMERA);
assert.equal(readSceneCamera({ _camZoom: 0 }).zoom, 0.05);   // clamped, never a divide by zero
// Every control declares a default that reads back as neutral.
const fromDefaults = {};
for (const def of SCENE_CAMERA_CONTROLS) fromDefaults[def.key] = def.default;
assert.deepEqual(readSceneCamera(fromDefaults), NEUTRAL_SCENE_CAMERA);
assert.equal(SCENE_CAMERA_CONTROLS.length, 5);
assert.ok(SCENE_CAMERA_CONTROLS.every((d) => d.key.startsWith('_cam')), 'house keys stay prefixed');

// ---- what gets stored on the scene, and survives a save ----
// A project saved before the shot existed, or with a stale/garbage value, has to
// open neutral. And the value must be a FRESH object every time: the autosave
// decides a document changed by comparing these fields by identity.
assert.deepEqual(sanitizeSceneCamera(undefined), SCENE_CAMERA_DEFAULTS);
assert.deepEqual(sanitizeSceneCamera(null), SCENE_CAMERA_DEFAULTS);
assert.deepEqual(sanitizeSceneCamera('nope'), SCENE_CAMERA_DEFAULTS);
assert.deepEqual(sanitizeSceneCamera({}), SCENE_CAMERA_DEFAULTS);
assert.ok(isNeutralSceneCamera(readSceneCamera(SCENE_CAMERA_DEFAULTS)));
assert.notEqual(sanitizeSceneCamera(undefined), SCENE_CAMERA_DEFAULTS, 'must not hand out the shared default object');
assert.deepEqual(sanitizeSceneCamera({ _camZoom: 5000, _camOrbitX: -999, _camPanX: 1e9 }),
  { ...SCENE_CAMERA_DEFAULTS, _camZoom: 300, _camOrbitX: -80, _camPanX: 100 });
assert.deepEqual(sanitizeSceneCamera({ _camZoom: NaN, _camPanY: 'x', _camOrbitY: null }), SCENE_CAMERA_DEFAULTS);
assert.deepEqual(sanitizeSceneCamera({ _camZoom: 140, lixo: 7 }), { ...SCENE_CAMERA_DEFAULTS, _camZoom: 140 });
assert.deepEqual(Object.keys(sanitizeSceneCamera({ lixo: 7 })), SCENE_CAMERA_CONTROLS.map((d) => d.key));

// ---- the poses a template can hand us ----
const POSES = [
  { position: { x: 0, y: 0, z: 1000 }, target: { x: 0, y: 0, z: 0 } },          // the default fit
  { position: { x: 0, y: 0, z: 2400 }, target: { x: 0, y: 0, z: 0 } },
  { position: { x: 300, y: -120, z: 900 }, target: { x: 0, y: 0, z: 0 } },      // Box-style explicit position
  { position: { x: -80, y: 40, z: 1500 }, target: { x: 50, y: -30, z: 200 } },  // off-axis target too
  { position: { x: 0, y: 900, z: 40 }, target: { x: 0, y: 0, z: 0 } },          // almost straight down
];
const FOVS = [15, 50, 95];
const ASPECTS = [16 / 9, 1, 9 / 16];

let cases = 0;

for (const pose of POSES) {
  for (const fov of FOVS) {
    for (const aspect of ASPECTS) {
      const base = dist(pose.position, pose.target);

      // 1. Neutral is neutral to the bit.
      const same = frameSceneCamera(pose.position, pose.target, cam(), fov, aspect);
      assert.deepEqual(same.position, pose.position);
      assert.deepEqual(same.target, pose.target);

      // 2. Dolly: distance scales by 1/zoom, aim is untouched, direction kept.
      for (const zoom of [0.25, 0.5, 1.5, 2, 3]) {
        const out = frameSceneCamera(pose.position, pose.target, cam({ zoom }), fov, aspect);
        assert.deepEqual(out.target, pose.target, 'a dolly may not move the target');
        near(dist(out.position, out.target), base / zoom, base * 1e-9, 'dolly distance');
        // same ray from the target, so the subject stays centred
        const a = { x: pose.position.x - pose.target.x, y: pose.position.y - pose.target.y, z: pose.position.z - pose.target.z };
        const b = { x: out.position.x - out.target.x, y: out.position.y - out.target.y, z: out.position.z - out.target.z };
        const cross = Math.hypot(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
        near(cross / (base * base), 0, 1e-9, 'dolly direction');
        cases++;
      }

      // 3. Orbit: the distance to the target is invariant, the target is not moved.
      for (const orbitX of [-80, -37, 0, 12, 80]) {
        for (const orbitY of [-90, -45, 0, 63, 90]) {
          const out = frameSceneCamera(pose.position, pose.target, cam({ orbitX, orbitY }), fov, aspect);
          assert.deepEqual(out.target, pose.target, 'an orbit may not move the target');
          near(dist(out.position, out.target), base, base * 1e-9, 'orbit radius');
          cases++;
        }
      }

      // 4. Pan: the view direction is untouched (camera and target move as one),
      //    and the displacement is exactly the requested fraction of the frame.
      for (const [panX, panY] of [[0.5, 0], [0, 0.5], [-1, 0], [0, -1], [0.25, -0.75]]) {
        for (const zoom of [1, 2]) {
          const out = frameSceneCamera(pose.position, pose.target, cam({ panX, panY, zoom }), fov, aspect);
          const before = frameSceneCamera(pose.position, pose.target, cam({ zoom }), fov, aspect);
          for (const k of ['x', 'y', 'z']) {
            near(out.position[k] - out.target[k], before.position[k] - before.target[k], base * 1e-9, 'pan direction');
          }
          const moved = Math.hypot(out.target.x - before.target.x, out.target.y - before.target.y, out.target.z - before.target.z);
          const frameH = 2 * (base / zoom) * Math.tan((fov * Math.PI) / 360);
          const want = Math.hypot(panX * frameH * aspect, panY * frameH);
          near(moved, want, Math.max(1e-6, want * 1e-9), 'pan magnitude');
          assert.ok(Number.isFinite(moved), 'pan stays finite');
          cases++;
        }
      }
    }
  }
}

// ---- signs, read off the one pose whose axes are unambiguous ----
const P = { x: 0, y: 0, z: 1000 }, T = { x: 0, y: 0, z: 0 };
{
  // Orbit Y positive swings the camera to the RIGHT of the subject.
  const out = frameSceneCamera(P, T, cam({ orbitY: 90 }), 50, 1);
  near(out.position.x, 1000, 1e-6, 'orbit Y +90 sits on +x');
  near(out.position.z, 0, 1e-6);
  // Orbit X positive LIFTS the camera. Pose y is canvas-down, so up is -y.
  const up = frameSceneCamera(P, T, cam({ orbitX: 90 }), 50, 1);
  near(up.position.y, -1000, 1e-6, 'orbit X +90 lifts the camera');
  near(up.position.z, 0, 1e-6);
  // Pan moves the IMAGE, like the Offset pad: +x sends the image right, which
  // trucks the camera left; +y sends the image down, which lifts the camera.
  const px = frameSceneCamera(P, T, cam({ panX: 1 }), 50, 1);
  assert.ok(px.position.x < 0, 'pan X + trucks the camera left');
  near(px.position.x, -2 * 1000 * Math.tan((50 * Math.PI) / 360), 1e-6, 'pan X is one frame wide');
  const py = frameSceneCamera(P, T, cam({ panY: 1 }), 50, 1);
  assert.ok(py.position.y < 0, 'pan Y + lifts the camera');
  near(py.position.z, 1000, 1e-6, 'a pan does not dolly');
}
{
  // A shot looking straight down the up axis has no natural "right": the basis
  // falls back to world x instead of producing NaN.
  const pole = frameSceneCamera({ x: 0, y: 1000, z: 0 }, T, cam({ panX: 0.5, panY: 0.5 }), 50, 1);
  for (const k of ['x', 'y', 'z']) {
    assert.ok(Number.isFinite(pole.position[k]) && Number.isFinite(pole.target[k]), 'pole pan stays finite');
  }
  near(pole.position.y, 1000, 1e-6, 'a top-down pan stays at its height');
}

console.log(`Scene camera: ${cases} framing cases passed; neutral is exact, dolly keeps aim, orbit keeps radius, pan keeps direction.`);
