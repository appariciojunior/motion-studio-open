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
  sceneCameraPlanar, sceneCameraFilterRect,
  SCENE_CAMERA_MOVE_CONTROLS, readSceneCameraMove, sceneCameraTravels, cameraMoveProgress, sceneCameraAt, NO_SCENE_CAMERA_MOVE,
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
// Every declared key, static half and move half — a saved scene carries the
// whole camera or none of it.
assert.deepEqual(Object.keys(sanitizeSceneCamera({ lixo: 7 })),
  [...SCENE_CAMERA_CONTROLS, ...SCENE_CAMERA_MOVE_CONTROLS].map((d) => d.key));

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



// ---- the three lists that must all know about a scene field ----
// A field on SceneState has to be enumerated in three places: the persisted
// partial, the autosave document keys, and the undo snapshot. Missing one is
// silent, and it bit exactly once here: `sceneCamera` was in the first two and
// not in the third, so every undo reset the camera to neutral — `apply` restores
// through `hydrate`, which REBUILDS the field from the partial it is handed.
//
// A text tripwire rather than a semantic test, because none of the three lists
// is exported. It cannot prove the lists are right; it does refuse to let the
// next person add the field to two of them.
for (const file of ['lib/scenePersist.ts', 'store/useHistoryStore.ts']) {
  const src = require('fs').readFileSync(path.join(root, file), 'utf8');
  assert.ok(src.includes("'sceneCamera'") || src.includes('sceneCamera:'),
    `${file} does not mention sceneCamera — a scene field left out of one of these lists is lost on save or on undo`);
  cases++;
}


// ---- the same shot in the 2D compositor ----
// A dolly is a scale and a pan is a translation there, and both have to land on
// the same picture the webgl path gives on the z=0 plane. The numbers below are
// the contract the Pixi renderer assigns straight to its artwork container.
assert.deepEqual(sceneCameraPlanar(cam(), 810, 1080), { scale: 1, x: 405, y: 540 });
assert.deepEqual(sceneCameraPlanar(cam({ zoom: 2 }), 810, 1080), { scale: 2, x: 405, y: 540 });
// Pan moves the IMAGE, so a positive value moves the container the same way —
// and 100% is one frame, the same unit the lens shift uses.
assert.deepEqual(sceneCameraPlanar(cam({ panX: 0.5 }), 810, 1080), { scale: 1, x: 810, y: 540 });
assert.deepEqual(sceneCameraPlanar(cam({ panY: -0.25 }), 810, 1080), { scale: 1, x: 405, y: 270 });
// The 2D path ignores orbit outright, because the gate never lets one through.
assert.deepEqual(sceneCameraPlanar(cam({ orbitX: 40, orbitY: 70 }), 810, 1080),
  sceneCameraPlanar(cam(), 810, 1080));

// `filterArea` is LOCAL, so the rect has to be the canvas seen through the
// inverse of the shot. Without this an artwork-scope effect at 200% covers a
// quarter of the frame.
assert.deepEqual(sceneCameraFilterRect(cam(), 810, 1080), { x: -405, y: -540, width: 810, height: 1080 });
assert.deepEqual(sceneCameraFilterRect(cam({ zoom: 2 }), 810, 1080),
  { x: -202.5, y: -270, width: 405, height: 540 });
{
  // A panned scene: the rect slides against the pan, so it keeps covering the
  // canvas and not the place the artwork used to be.
  const r = sceneCameraFilterRect(cam({ panX: 0.5 }), 810, 1080);
  assert.deepEqual(r, { x: -810, y: -540, width: 810, height: 1080 });
  // The rect, mapped back out through the shot, is the canvas again — the
  // property that actually matters, checked over a sweep.
  for (const zoom of [0.25, 1, 1.5, 3]) {
    for (const panX of [-1, -0.3, 0, 0.5, 1]) {
      for (const panY of [-0.5, 0, 0.75]) {
        const c = cam({ zoom, panX, panY });
        const rc = sceneCameraFilterRect(c, 810, 1080);
        const p = sceneCameraPlanar(c, 810, 1080);
        near(p.x + rc.x * p.scale, 0, 1e-9, 'rect maps back to the canvas left');
        near(p.y + rc.y * p.scale, 0, 1e-9, 'rect maps back to the canvas top');
        near(rc.width * p.scale, 810, 1e-9, 'rect still spans the canvas width');
        near(rc.height * p.scale, 1080, 1e-9, 'rect still spans the canvas height');
        cases++;
      }
    }
  }
}

// ---- orbit is offered only where there is perspective ----
{
  const flat = { controls: [], meta: { engine: 'pixi' } };
  const spatial = { controls: [], meta: { engine: 'webgl' } };
  const flatKeys = sceneCameraControlsFor([flat]).map((d) => d.key);
  assert.deepEqual(flatKeys, ['_camZoom', '_camPanX', '_camPanY'], '2D gets no orbit');
  assert.equal(sceneCameraControlsFor([spatial]).length, 5);
  assert.equal(sceneCameraControlsFor([flat, spatial]).length, 5, 'one 3D layer brings the orbit back');
  // And the values follow: an orbit stored while a webgl layer was visible goes
  // inert in a scene that has none.
  const loud = { zoom: 2, panX: 0.5, panY: 0, orbitX: 40, orbitY: 60 };
  assert.deepEqual(gateSceneCamera(loud, [flat]), { zoom: 2, panX: 0.5, panY: 0, orbitX: 0, orbitY: 0 });
  assert.deepEqual(gateSceneCamera(loud, [flat, spatial]), loud);
  // A template with no controls at all still gets no orbit when it is 2D, which
  // is the case that would otherwise slip through on a default `meta`.
  assert.deepEqual(sceneCameraControlsFor([{ controls: [] }]).map((d) => d.key), ['_camZoom', '_camPanX', '_camPanY']);
  cases += 7;
}


// ---- the shot MOVES ----
// A still camera has to stay bit-identical, a travelling one has to arrive
// exactly where it was sent, and Hold has to buy real stillness at both ends —
// not a slower version of the same drift.
const mv = (over = {}) => ({ ...NO_SCENE_CAMERA_MOVE, ...over });

assert.deepEqual(readSceneCameraMove(undefined), NO_SCENE_CAMERA_MOVE);
assert.deepEqual(readSceneCameraMove({}), NO_SCENE_CAMERA_MOVE);
assert.deepEqual(readSceneCameraMove({ _camTravel: { x: 50, y: -25 }, _camHold: 60 }),
  { travelX: 0.5, travelY: -0.25, hold: 0.6 });
// Junk in a saved scene reads as no move, never as NaN.
assert.deepEqual(readSceneCameraMove({ _camTravel: 'nope', _camHold: 'x' }), NO_SCENE_CAMERA_MOVE);
assert.deepEqual(readSceneCameraMove({ _camTravel: { x: NaN, y: 1 } }).travelX, 0);
assert.equal(readSceneCameraMove({ _camHold: 999 }).hold, 0.9, "hold is capped short of the whole clip");
assert.equal(sceneCameraTravels(mv()), false);
assert.equal(sceneCameraTravels(mv({ travelX: 0.1 })), true);
assert.equal(sceneCameraTravels(mv({ travelY: -0.1 })), true);
cases += 8;

{
  // A camera that does not travel is the pose, untouched, at every point of
  // the clip — the same object identity, so a still scene pays nothing.
  const still = cam({ zoom: 2, panX: 0.3 });
  for (const p of [0, 0.25, 0.5, 0.99, 1]) {
    assert.equal(sceneCameraAt(still, mv(), p), still, "a still camera must not even allocate");
    cases++;
  }
}

{
  // With no hold, it starts at the start and arrives at the end.
  const from = cam();
  const move = mv({ travelX: 0.5, travelY: -0.25 });
  near(sceneCameraAt(from, move, 0).panX, 0, 1e-9, "starts where it stands");
  near(sceneCameraAt(from, move, 1).panX, 0.5, 1e-9, "arrives at the travel");
  near(sceneCameraAt(from, move, 1).panY, -0.25, 1e-9);
  // It only ever moves forward, and never past the destination.
  let anterior = -Infinity;
  for (let p = 0; p <= 1.0001; p += 0.02) {
    const x = sceneCameraAt(from, move, p).panX;
    assert.ok(x >= anterior - 1e-12, "the travel may not go backwards");
    assert.ok(x >= -1e-12 && x <= 0.5 + 1e-12, "the travel may not overshoot");
    anterior = x;
    cases++;
  }
  // Travel composes with where the camera already stands.
  near(sceneCameraAt(cam({ panX: 0.2 }), move, 1).panX, 0.7, 1e-9, "it travels FROM the shot");
  // and it touches nothing else.
  const out = sceneCameraAt(cam({ zoom: 1.5, orbitY: 30 }), move, 0.5);
  assert.equal(out.zoom, 1.5);
  assert.equal(out.orbitY, 30);
  cases += 4;
}

{
  // Hold is real stillness at BOTH ends: with 60%, nothing moves through the
  // first 30% or the last 30%, and the whole travel happens in the middle 40%.
  const h = 0.6;
  near(cameraMoveProgress(0, h), 0, 1e-12);
  near(cameraMoveProgress(0.29, h), 0, 1e-12, "still parked just before it leaves");
  near(cameraMoveProgress(0.71, h), 1, 1e-12, "already arrived just after it lands");
  near(cameraMoveProgress(1, h), 1, 1e-12);
  near(cameraMoveProgress(0.5, h), 0.5, 1e-9, "halfway through the clip is halfway through the move");
  // No hold: it is travelling everywhere except the very ends.
  assert.ok(cameraMoveProgress(0.1, 0) > 0, "without hold it is already moving at 10%");
  assert.ok(cameraMoveProgress(0.9, 0) < 1, "and still moving at 90%");
  // Monotonic for every hold, which is what keeps a move from stuttering.
  for (const hold of [0, 0.2, 0.5, 0.9, 1.5]) {
    let ant = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const t = cameraMoveProgress(p, hold);
      assert.ok(t >= ant - 1e-12 && t >= -1e-12 && t <= 1 + 1e-12, `hold ${hold} at ${p}: ${t}`);
      ant = t;
      cases++;
    }
  }
  cases += 7;
}

{
  // The pad is stored as a pair and survives a save, clamped to its own range.
  const saved = sanitizeSceneCamera({ _camTravel: { x: 5000, y: -5000 }, _camHold: 200 });
  assert.deepEqual(saved._camTravel, { x: 100, y: -100 }, 'the pad clamps to its range');
  assert.equal(saved._camHold, 90);
  assert.deepEqual(sanitizeSceneCamera({})._camTravel, { x: 0, y: 0 }, 'and defaults to no travel');
  assert.notEqual(sanitizeSceneCamera({})._camTravel, SCENE_CAMERA_DEFAULTS._camTravel,
    'the pair must be a fresh object, or two scenes would share one pad');
  assert.equal(SCENE_CAMERA_MOVE_CONTROLS.length, 2);
  cases += 5;
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
// No layers at all: nothing duplicates anything, and there is no perspective
// either, so what comes back is the planar three. Moot in practice — the panel
// does not ask when the scene is empty, and an empty scene draws nothing — but
// pinned here so the empty case can never silently become 'everything'.
assert.deepEqual(sceneCameraControlsFor([]).map((d) => d.key), ['_camZoom', '_camPanX', '_camPanY']);
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
