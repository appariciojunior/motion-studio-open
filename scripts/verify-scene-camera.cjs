// The house camera must re-frame a shot without ever moving it by accident, and
// it must never offer a move the panel already offers.
//
// Neutral has to be neutral to the bit. A dolly may not change where the camera
// LOOKS, an orbit may not change its distance, and a pan may not move it at all
// — a pan is a shift of the lens, not a move in space. Each of those is a way a
// control could feel right in one preset and wrong in the next.
//
// The second half sweeps the REAL catalogue: for every webgl preset, a house
// control is shown exactly when the template does not already declare that
// move, and a hidden one is proven inert rather than merely invisible.
const path = require('path');
const Module = require('module');
require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};
const assert = require('node:assert/strict');
const {
  readSceneCamera, isNeutralSceneCamera, frameSceneCamera, NEUTRAL_SCENE_CAMERA, SCENE_CAMERA_CONTROLS,
  SCENE_CAMERA_DEFAULTS, sanitizeSceneCamera, sceneLensShift,
  SCENE_CAMERA_DUPLICATES, sceneCameraControlsFor, gateSceneCamera,
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
      const same = frameSceneCamera(pose.position, pose.target, cam());
      assert.deepEqual(same.position, pose.position);
      assert.deepEqual(same.target, pose.target);

      // 2. Dolly: distance scales by 1/zoom, aim is untouched, direction kept.
      for (const zoom of [0.25, 0.5, 1.5, 2, 3]) {
        const out = frameSceneCamera(pose.position, pose.target, cam({ zoom }));
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
          const out = frameSceneCamera(pose.position, pose.target, cam({ orbitX, orbitY }));
          assert.deepEqual(out.target, pose.target, 'an orbit may not move the target');
          near(dist(out.position, out.target), base, base * 1e-9, 'orbit radius');
          cases++;
        }
      }

      // 4. Pan is a LENS SHIFT: it may not move the camera by so much as a
      //    float. Whatever it does happens in the projection, and the pose
      //    that comes out has to be the pose a pan-free camera would give.
      for (const [panX, panY] of [[0.5, 0], [0, 0.5], [-1, 0], [0, -1], [0.25, -0.75]]) {
        for (const zoom of [1, 2]) {
          const out = frameSceneCamera(pose.position, pose.target, cam({ panX, panY, zoom }));
          const before = frameSceneCamera(pose.position, pose.target, cam({ zoom }));
          assert.deepEqual(out, before, 'a pan may not move the camera');
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
  const out = frameSceneCamera(P, T, cam({ orbitY: 90 }));
  near(out.position.x, 1000, 1e-6, 'orbit Y +90 sits on +x');
  near(out.position.z, 0, 1e-6);
  // Orbit X positive LIFTS the camera. Pose y is canvas-down, so up is -y.
  const up = frameSceneCamera(P, T, cam({ orbitX: 90 }));
  near(up.position.y, -1000, 1e-6, 'orbit X +90 lifts the camera');
  near(up.position.z, 0, 1e-6);
  // Pan never appears in the pose.
  assert.deepEqual(frameSceneCamera(P, T, cam({ panX: 1, panY: -1 })), frameSceneCamera(P, T, cam()));
}
{
  // ---- the lens shift, which is where a pan actually lives ----
  // The control moves the IMAGE, like the Offset pad: +x sends it right, +y
  // sends it down. three renders the window [x, x+width] of a larger frame, so
  // sliding that window LEFT (a negative x) is what sends the image right.
  assert.equal(sceneLensShift(cam(), 810, 1080), null, 'no pan, no offset to set');
  assert.equal(sceneLensShift(cam({ zoom: 2, orbitY: 30 }), 810, 1080), null, 'only a pan shifts the lens');
  // 0.3 is not a binary fraction, so these use halves and quarters: the point
  // is the sign and the scale, and a float artefact would only hide them.
  assert.deepEqual(sceneLensShift(cam({ panX: 0.5 }), 810, 1080),
    { fullWidth: 810, fullHeight: 1080, x: -405, y: 0, width: 810, height: 1080 });
  assert.deepEqual(sceneLensShift(cam({ panY: 0.25 }), 810, 1080),
    { fullWidth: 810, fullHeight: 1080, x: 0, y: -270, width: 810, height: 1080 });
  // 100% is exactly one frame, and the sign survives it.
  assert.deepEqual(sceneLensShift(cam({ panX: 1, panY: -1 }), 810, 1080),
    { fullWidth: 810, fullHeight: 1080, x: -810, y: 1080, width: 810, height: 1080 });
  // The shift is measured on the frame, so it does not care about zoom or orbit.
  assert.deepEqual(sceneLensShift(cam({ panX: 0.5, zoom: 3, orbitX: 40 }), 1080, 1080),
    sceneLensShift(cam({ panX: 0.5 }), 1080, 1080));
  // A shot looking straight down the up axis has no natural "right": the basis
  // falls back to world x instead of producing NaN.
  const pole = frameSceneCamera({ x: 0, y: 1000, z: 0 }, T, cam({ panX: 0.5, panY: 0.5 }), 50, 1);
  for (const k of ['x', 'y', 'z']) {
    assert.ok(Number.isFinite(pole.position[k]) && Number.isFinite(pole.target[k]), 'pole pan stays finite');
  }
  near(pole.position.y, 1000, 1e-6, 'a top-down pan stays at its height');
}


// ---- the duplicate gate, against the REAL catalogue ----
// The rule chosen for this feature: never two knobs for one move. So a house
// control may only appear where no visible layer declares the same move. This
// half of the suite exists because the list of duplicate keys is the kind of
// thing that rots silently — a template renames `zoom` and the gate quietly
// stops gating.
const { catalogTemplateList } = require('../templates');
const webgl = catalogTemplateList.filter((t) => t.meta.engine === 'webgl');
assert.ok(webgl.length > 50, `expected a webgl catalogue, got ${webgl.length}`);

// 1. Every key the gate names still exists on some webgl preset.
const declaredKeys = new Set();
for (const t of webgl) for (const c of t.controls) declaredKeys.add(c.key);
for (const [house, keys] of Object.entries(SCENE_CAMERA_DUPLICATES)) {
  assert.ok(SCENE_CAMERA_CONTROLS.some((d) => d.key === house), `${house} is not a house control`);
  for (const key of keys) {
    assert.ok(declaredKeys.has(key), `${house} guards against '${key}', which no webgl preset declares any more`);
  }
}

// 2. The invariant, swept over the whole catalogue: a preset never gets a house
//    control whose move it already offers, and never loses one it does not.
let gated = 0, offered = 0;
for (const t of webgl) {
  const keys = new Set(t.controls.map((c) => c.key));
  const shown = new Set(sceneCameraControlsFor([t]).map((d) => d.key));
  for (const def of SCENE_CAMERA_CONTROLS) {
    const duplicates = (SCENE_CAMERA_DUPLICATES[def.key] ?? []).some((k) => keys.has(k));
    assert.equal(shown.has(def.key), !duplicates,
      `${t.meta.id}: ${def.key} ${shown.has(def.key) ? 'shown' : 'hidden'} but duplicate=${duplicates}`);
    if (duplicates) gated++; else offered++;
    cases++;
  }
  // 3. A hidden control must be INERT, not merely invisible.
  const loud = { zoom: 2, panX: 0.5, panY: -0.5, orbitX: 40, orbitY: 60 };
  const g = gateSceneCamera(loud, [t]);
  assert.equal(g.zoom, shown.has('_camZoom') ? 2 : 1);
  assert.equal(g.panX, shown.has('_camPanX') ? 0.5 : 0);
  assert.equal(g.panY, shown.has('_camPanY') ? -0.5 : 0);
  assert.equal(g.orbitX, shown.has('_camOrbitX') ? 40 : 0);
  assert.equal(g.orbitY, shown.has('_camOrbitY') ? 60 : 0);
  cases++;
}

// 4. No layers at all: nothing on offer, and every value inert.
assert.deepEqual(sceneCameraControlsFor([]), SCENE_CAMERA_CONTROLS, 'with no template nothing is duplicated');
// 5. Stacked layers: one layer offering a move is enough to hide it, because
//    there is one camera for the scene.
{
  const comZoom = webgl.find((t) => t.controls.some((c) => c.key === 'zoom' || c.key === 'distance'));
  const semNada = webgl.find((t) => {
    const keys = new Set(t.controls.map((c) => c.key));
    return !Object.values(SCENE_CAMERA_DUPLICATES).some((l) => l.some((k) => keys.has(k)));
  });
  assert.ok(comZoom && semNada, 'catalogue should hold both kinds');
  assert.equal(sceneCameraControlsFor([semNada]).length, SCENE_CAMERA_CONTROLS.length);
  assert.ok(!sceneCameraControlsFor([semNada, comZoom]).some((d) => d.key === '_camZoom'),
    'a layer with its own zoom hides the house zoom for the scene');
  assert.equal(gateSceneCamera({ ...NEUTRAL_SCENE_CAMERA, zoom: 3 }, [semNada, comZoom]).zoom, 1);
  cases += 4;
}
console.log(`  gate: ${gated} control/preset pairs hidden as duplicates, ${offered} offered, over ${webgl.length} webgl presets.`);

console.log(`Scene camera: ${cases} framing cases passed; neutral is exact, dolly keeps aim, orbit keeps radius, and a pan never moves the camera — it shifts the lens.`);
