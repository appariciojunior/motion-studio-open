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
  SCENE_CAMERA_STOP_PAD, SCENE_CAMERA_STOP_ZOOM, MAX_CAMERA_STOPS,
  SCENE_CAMERA_ON, sceneHasCamera, sceneCameraCoverage, MAX_CAMERA_COVERAGE,
  sceneCameraFrameRect,
  readSceneCameraPath, sceneCameraTravels, cameraLegProgress, sceneCameraAt,
  NO_SCENE_CAMERA_PATH, cameraStopKeys,
} = require('../lib/sceneCamera');
const {
  CAMERA_MOVES, CAMERA_MOVE_KEY, CAMERA_MOVE_STOPS, CUSTOM_MOVE,
  cameraMoveById, cameraMovePatch, MAX_CAMERA_STOPS: MAX_MOVE_STOPS,
} = require('../lib/cameraMoves');

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
// A fresh camera carries the Shot and the Hold, and NO stop: a stop that does
// not exist is absent rather than zeroed, which is what lets the path end.
assert.deepEqual(Object.keys(sanitizeSceneCamera({ lixo: 7 })),
  SCENE_CAMERA_CONTROLS.map((d) => d.key));

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


// ---- the shot MOVES, from stop to stop ----
// The Shot is stop 1. Every stop after it is somewhere the camera goes, with
// its own zoom, so a push in and a pull back are said at the stop where they
// happen. A camera with no stops has to stay bit-identical; one with stops has
// to arrive exactly, never overshoot, and actually SIT at each one.
// `path` is taken by node: this is the camera one.
const rota = (stops) => ({ stops });

assert.deepEqual(readSceneCameraPath(undefined), NO_SCENE_CAMERA_PATH);
assert.deepEqual(readSceneCameraPath({}), NO_SCENE_CAMERA_PATH);
// A leftover Settle from a scene saved before it was removed reads as nothing:
// the key is gone from the model, not merely ignored by the panel.
assert.deepEqual(readSceneCameraPath({ _camHold: 50 }), NO_SCENE_CAMERA_PATH);
assert.deepEqual(readSceneCameraPath({ _camStop2: { x: 40, y: -10 }, _camStop2Zoom: 150, _camHold: 60 }),
  { stops: [{ x: 40, y: -10, zoom: 150 }] });
// Stops are contiguous: a gap ENDS the path rather than leaving a hole the
// renderer would have to guess about.
assert.equal(readSceneCameraPath({ _camStop3: { x: 10, y: 0 } }).stops.length, 0,
  "a path that does not start at stop 2 is not a path");
assert.equal(readSceneCameraPath({ _camStop2: { x: 1, y: 0 }, _camStop4: { x: 9, y: 0 } }).stops.length, 1,
  "the gap at stop 3 ends it");
// A stop with no zoom of its own sits at 100%, not at zero.
assert.equal(readSceneCameraPath({ _camStop2: { x: 1, y: 0 } }).stops[0].zoom, 100);
// Junk reads as no path, never as NaN.
assert.deepEqual(readSceneCameraPath({ _camStop2: 'x' }), NO_SCENE_CAMERA_PATH);
assert.equal(readSceneCameraPath({ _camStop2: { x: NaN, y: 2 } }).stops[0].x, 0);
{
  // HAVING a camera and the camera DOING something are different questions,
  // and conflating them broke the Add button: a camera just added sits exactly
  // where the default one does, so "is it neutral?" answered no-camera and the
  // button appeared to do nothing at all.
  assert.equal(sceneHasCamera(undefined), false);
  assert.equal(sceneHasCamera({}), false, "a scene nobody has filmed has no camera");
  assert.equal(sceneHasCamera(SCENE_CAMERA_DEFAULTS), false,
    "and neither does one carrying only the defaults");
  assert.equal(sceneHasCamera({ [SCENE_CAMERA_ON]: 1 }), true,
    "asking for a camera gives you one, even though it has not moved yet");
  // The flag survives a save. It is not a control, so the sanitiser has to
  // carry it by hand, and forgetting to would lose the camera silently.
  assert.equal(sceneHasCamera(sanitizeSceneCamera({ [SCENE_CAMERA_ON]: 1 })), true,
    "and still has one after a round trip through the sanitiser");
  // Scenes saved before the flag existed are read by what they carry.
  assert.equal(sceneHasCamera({ _camZoom: 140 }), true, "a shot is a camera");
  assert.equal(sceneHasCamera({ _camStop2: { x: 10, y: 0 } }), true, "so is a stop");
  cases += 7;
}

{
  // How much more scene a camera makes a template build. The view reaches
  // width*(0.5 + |pan|)/zoom from the centre, so it needs (1 + 2|pan|)/zoom of
  // the default extent, at the WORST moment of the path -- the wall is built
  // once and has to survive the whole clip.
  const parado = { zoom: 1, panX: 0, panY: 0, orbitX: 0, orbitY: 0 };
  near(sceneCameraCoverage(parado, rota([])), 1, 1e-12, "a camera that stands still asks for nothing extra");
  near(sceneCameraCoverage({ ...parado, zoom: 0.5 }, rota([])), 2, 1e-12, "half the zoom is twice the scene");
  near(sceneCameraCoverage({ ...parado, panX: 0.25 }, rota([])), 1.5, 1e-12, "a pan of a quarter frame reaches half a frame further, both ways");
  // Pushing IN never needs more scene than standing still.
  near(sceneCameraCoverage({ ...parado, zoom: 3 }, rota([])), 1, 1e-12);
  // The worst stop decides, not the shot.
  near(sceneCameraCoverage(parado, rota([{ x: 0, y: 0, zoom: 40 }])), 2.5, 1e-12,
    "a stop that pulls back is what the wall has to survive");
  // Capped: past a point this asks for thousands of cards.
  assert.equal(sceneCameraCoverage({ ...parado, zoom: 0.05 }, rota([])), MAX_CAMERA_COVERAGE);
  cases += 6;
}

{
  // The rectangle of scene the camera sees. The 2D renderer culls a repeating
  // motif's offscreen copies against this, and it used to cull them against the
  // CANVAS -- so pulling back hid every copy the camera had just moved to look
  // at, and the wall shrank instead of opening up.
  const parado = { zoom: 1, panX: 0, panY: 0, orbitX: 0, orbitY: 0 };
  const W = 810, H = 1080;

  // THE property that keeps this from changing anything that already shipped:
  // with no camera the frame IS the canvas, to the last decimal.
  const nada = sceneCameraFrameRect(parado, W, H);
  assert.deepEqual(nada, { cx: 0, cy: 0, halfW: W / 2, halfH: H / 2 },
    "a scene nobody is filming culls against the canvas, exactly as before");

  // Half the zoom is twice the frame, both ways from the same centre.
  const largo = sceneCameraFrameRect({ ...parado, zoom: 0.5 }, W, H);
  near(largo.halfW, W, 1e-9, "pulling back to 50% doubles what is in shot");
  near(largo.halfH, H, 1e-9);
  near(largo.cx, 0, 1e-9, "and a pull-back on its own does not move the frame");

  // A pan moves the frame OPPOSITE to the pad, because the pad moves the
  // picture: shifting the image right is the camera looking left.
  const pan = sceneCameraFrameRect({ ...parado, panX: 0.25 }, W, H);
  near(pan.cx, -0.25 * W, 1e-9, "a pan of a quarter frame moves the frame the other way");
  near(pan.halfW, W / 2, 1e-9, "and a pan alone does not change how much is in shot");

  // The rect must agree with the transform that actually draws: a card at the
  // frame's own edge lands on the canvas edge, at any zoom and pan.
  for (const zoom of [0.25, 0.5, 1, 2.5]) {
    for (const panX of [-0.4, 0, 0.3]) {
      const c = { ...parado, zoom, panX };
      const r = sceneCameraFrameRect(c, W, H);
      const shot = sceneCameraPlanar(c, W, H);
      const naTela = (x) => x * shot.scale + shot.x;
      near(naTela(r.cx - r.halfW), 0, 1e-6, `zoom ${zoom} pan ${panX}: the left of the frame is the left of the canvas`);
      near(naTela(r.cx + r.halfW), W, 1e-6, `zoom ${zoom} pan ${panX}: and the right is the right`);
      cases += 2;
    }
  }
  cases += 6;
}

{
  // MOVES YOU CHOOSE. The pad asks for coordinates over time, which is the
  // hardest thing in this app and was the only way in; a move is a name and at
  // most two knobs, and it writes the same stops the pad writes.
  const ids = CAMERA_MOVES.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "two moves cannot share an id");
  assert.ok(!ids.includes(CUSTOM_MOVE), "custom is what a hand-edited path becomes, not a move you pick");
  for (const m of CAMERA_MOVES) {
    assert.ok(m.label && m.hint, `${m.id}: a move picked by name needs a name and a line saying what it does`);
    // Three: Amount, a direction where one makes sense, and Stops. The rule
    // used to be two, and Stops broke it deliberately — see lib/cameraMoves.
    assert.ok(m.knobs.length <= 3, `${m.id}: ${m.knobs.length} knobs — a move is a choice, not a form`);
    assert.ok(m.defaultStops >= 1 && m.defaultStops <= MAX_CAMERA_STOPS,
      `${m.id}: defaultStops ${m.defaultStops} is outside what a path can hold`);
    cases += 3;
  }
  assert.equal(cameraMoveById(CUSTOM_MOVE), null);
  assert.equal(cameraMoveById(undefined), null, "junk reads as no move rather than throwing");
  cases += 4;
}

{
  // Every move must actually MOVE, at every amount, and must produce a path
  // the engine is happy with — the same no-freeze bar a hand-built one meets.
  for (const m of CAMERA_MOVES) {
    for (const amount of [10, 60, 100]) {
      const patch = cameraMovePatch(m.id, amount, 'right');
      assert.equal(patch[SCENE_CAMERA_ON], 1, `${m.id}: choosing a move gives the scene a camera`);
      assert.equal(patch[CAMERA_MOVE_KEY], m.id);
      const limpo = sanitizeSceneCamera(patch);
      const c = readSceneCamera(limpo);
      const caminho = readSceneCameraPath(limpo);
      assert.ok(sceneCameraTravels(caminho), `${m.id} at ${amount}: a move that does not move is not a move`);
      // 210 samples because that is the reference clip's own frame count, and
      // this ratio is sensitive to how densely you sample: the same Survey
      // reads 69x at 120 samples and 32x at 210, purely because at 120 one of
      // its six legs happens to be sampled nearer its own boundary. Compare
      // like with like or the number means nothing.
      let ant = sceneCameraAt(c, caminho, 0);
      let lento = Infinity, rapido = 0;
      for (let i = 1; i <= 210; i++) {
        const at = sceneCameraAt(c, caminho, i / 210);
        const v = Math.hypot((at.panX - ant.panX) * 100, (at.panY - ant.panY) * 100)
          + Math.abs(at.zoom - ant.zoom) * 100;
        lento = Math.min(lento, v); rapido = Math.max(rapido, v);
        ant = at;
      }
      assert.ok(lento > 0, `${m.id} at ${amount}: no frame of a move may be a freeze`);
      // The clip measured 22x over six stops; our single-leg moves land at 18x
      // and the six-stop Survey at 32x. 45 leaves headroom without letting a
      // move sneak back towards a freeze.
      assert.ok(rapido / lento < 45, `${m.id} at ${amount}: ${(rapido / lento).toFixed(0)}x between slowest and fastest frame`);
      cases += 4;
    }
  }
}

{
  // Amount scales the move and nothing else: more amount, more travel.
  const viagem = (id, amount) => {
    const limpo = sanitizeSceneCamera(cameraMovePatch(id, amount, 'right'));
    const c = readSceneCamera(limpo);
    const p = readSceneCameraPath(limpo);
    const pontos = [{ x: c.panX * 100, y: c.panY * 100, zoom: c.zoom * 100 }, ...p.stops];
    let d = 0;
    for (let i = 1; i < pontos.length; i++) {
      d += Math.hypot(pontos[i].x - pontos[i - 1].x, pontos[i].y - pontos[i - 1].y)
        + Math.abs(pontos[i].zoom - pontos[i - 1].zoom);
    }
    return d;
  };
  for (const m of CAMERA_MOVES) {
    assert.ok(viagem(m.id, 100) > viagem(m.id, 20) * 1.2,
      `${m.id}: turning Amount up has to make the move bigger`);
    cases++;
  }
}

{
  // THE leftover bug this guards: a short move chosen after a long one must
  // not inherit the tail of it, or the camera visits somewhere nobody asked for.
  const survey = sanitizeSceneCamera(cameraMovePatch('survey', 100, 'centre'));
  const nSurvey = readSceneCameraPath(survey).stops.length;
  assert.ok(nSurvey >= 4, `survey should be a tour, got ${nSurvey} stops`);
  const depois = sanitizeSceneCamera({ ...survey, ...cameraMovePatch('push', 60, 'right') });
  assert.equal(readSceneCameraPath(depois).stops.length, 1,
    'a one-stop move after a six-stop one leaves exactly one stop');
  cases += 2;
}

{
  // SEVERAL STOPS IN ANY MOVE. Survey shipped with six and every other move
  // with one, so a staged push through three framings was only reachable by
  // hand-placing pins and losing the named move doing it. Reported as "o
  // Contact Sheet permite colocar várias câmeras numa parte só, deixe eu fazer
  // isso em outros".
  for (const m of CAMERA_MOVES) {
    for (const pedido of [1, 2, 3, MAX_CAMERA_STOPS]) {
      // Survey tops out at the six stops actually measured off the clip.
      const n = Math.min(pedido, m.maxStops);
      const limpo = sanitizeSceneCamera(cameraMovePatch(m.id, 60, 'right', pedido));
      const caminho = readSceneCameraPath(limpo);
      assert.equal(caminho.stops.length, n,
        `${m.id} asked for ${pedido} stops (ceiling ${m.maxStops}) and produced ${caminho.stops.length}`);
      assert.equal(Number(limpo[CAMERA_MOVE_STOPS]), n, `${m.id}: the count has to survive a save`);
      // Every stop distinct from the one before it: a count that just repeats
      // the same framing n times is a longer list, not a longer move.
      const pontos = [{ x: Number(limpo._camPanX), y: Number(limpo._camPanY), zoom: Number(limpo._camZoom) },
        ...caminho.stops];
      for (let i = 1; i < pontos.length; i++) {
        const d = Math.hypot(pontos[i].x - pontos[i - 1].x, pontos[i].y - pontos[i - 1].y)
          + Math.abs(pontos[i].zoom - pontos[i - 1].zoom);
        assert.ok(d > 0.5, `${m.id} at ${n} stops: stop ${i} sits on top of the one before it`);
      }
      cases += 2 + caminho.stops.length;
    }
  }
  // And the default is the move's own: picking Survey gives its six, not a stub.
  assert.equal(readSceneCameraPath(sanitizeSceneCamera(cameraMovePatch('survey', 60, 'centre'))).stops.length, 6);
  assert.equal(readSceneCameraPath(sanitizeSceneCamera(cameraMovePatch('push', 60, 'right'))).stops.length, 1);
  cases += 2;
}

assert.equal(sceneCameraTravels(rota([])), false);
assert.equal(sceneCameraTravels(rota([{ x: 0, y: 0, zoom: 100 }])), true,
  "a stop that happens to sit where the shot does is still a stop");
cases += 10;

{
  // No stops: the pose, untouched, at every point of the clip — same object,
  // so a still camera costs nothing.
  const still = cam({ zoom: 2, panX: 0.3 });
  for (const p of [0, 0.25, 0.5, 0.99, 1]) {
    assert.equal(sceneCameraAt(still, rota([]), p), still, "a still camera must not even allocate");
    cases++;
  }
}

{
  // One stop: it leaves the Shot and arrives at the stop, zoom included.
  const from = cam({ panX: -0.3, zoom: 1.05 });
  const one = rota([{ x: 40, y: 0, zoom: 135 }]);
  near(sceneCameraAt(from, one, 0).panX, -0.3, 1e-9, "starts at the shot");
  near(sceneCameraAt(from, one, 0).zoom, 1.05, 1e-9);
  near(sceneCameraAt(from, one, 1).panX, 0.4, 1e-9, "arrives at the stop");
  near(sceneCameraAt(from, one, 1).zoom, 1.35, 1e-9, "and at its zoom");
  // Monotonic and inside the leg, everywhere.
  let ant = -Infinity;
  for (let p = 0; p <= 1.0001; p += 0.02) {
    const x = sceneCameraAt(from, one, p).panX;
    assert.ok(x >= ant - 1e-12, "a leg may not go backwards");
    assert.ok(x >= -0.3 - 1e-12 && x <= 0.4 + 1e-12, "a leg may not overshoot");
    ant = x;
    cases++;
  }
  // It touches nothing it was not asked to.
  const out = sceneCameraAt(cam({ orbitY: 30, orbitX: -10 }), one, 0.5);
  assert.equal(out.orbitY, 30);
  assert.equal(out.orbitX, -10);
  cases += 6;
}

{
  // Two stops, and a leg gets time in proportion to how FAR it goes.
  //
  // Equal slices was the first version, and a real path showed why it is
  // wrong: on a two-leg path of 60 units and 25, both took 4s, so the short
  // leg crawled at 42% of the long one. A camera that changes pace for no
  // reason reads as a mistake.
  const from = cam();
  const two = rota([{ x: 50, y: 0, zoom: 100 }, { x: -50, y: 0, zoom: 200 }]);
  // leg 1 travels 50 across and no zoom; leg 2 travels 100 across and 100 of
  // zoom. 50 and 200 of a 250 total, so stop 2 arrives a FIFTH of the way in.
  const arrivesAt = 50 / 250;
  near(sceneCameraAt(from, two, 0).panX, 0, 1e-9);
  near(sceneCameraAt(from, two, arrivesAt).panX, 0.5, 1e-9, "stop 2 arrives when its share of the distance is done");
  near(sceneCameraAt(from, two, 1).panX, -0.5, 1e-9, "the end of the clip is the last stop");
  near(sceneCameraAt(from, two, 1).zoom, 2, 1e-9);
  // The zoom only starts changing on the leg that changes it.
  near(sceneCameraAt(from, two, arrivesAt / 2).zoom, 1, 1e-9, "the first leg holds its zoom");
  assert.ok(sceneCameraAt(from, two, 0.75).zoom > 1, "the second leg is the one that pushes in");
  cases += 6;
}

{
  // The property that fix is FOR: every leg travels at the same average speed.
  // Measured by walking the clip densely and totting up the distance covered
  // inside each leg — no easing to confuse it, so speed is the flat thing it
  // should be.
  const from = cam();
  const legs = [
    { x: 60, y: 0, zoom: 100 },     // 60 across
    { x: 85, y: 0, zoom: 100 },     // 25 across — the short leg that used to crawl
    { x: 85, y: -60, zoom: 100 },   // 60 down
  ];
  const uneven = rota(legs, 0);
  const pontos = [{ x: 0, y: 0 }, ...legs];
  const comprimentos = legs.map((to, i) => Math.hypot(to.x - pontos[i].x, to.y - pontos[i].y));
  const total = comprimentos.reduce((a, b) => a + b, 0);
  // Where each stop is reached, and how far the camera had gone by then.
  let acumulado = 0;
  for (let i = 0; i < legs.length; i++) {
    acumulado += comprimentos[i];
    const quando = acumulado / total;
    const onde = sceneCameraAt(from, uneven, quando);
    near(onde.panX * 100, legs[i].x, 1e-6, `stop ${i + 2} arrives at its share of the distance`);
    near(onde.panY * 100, legs[i].y, 1e-6);
    cases += 2;
  }
  // And the speed itself: distance covered per unit of clip, leg by leg.
  const velocidades = [];
  let inicio = 0;
  for (let i = 0; i < legs.length; i++) {
    const fim = inicio + comprimentos[i] / total;
    const a = sceneCameraAt(from, uneven, inicio + (fim - inicio) * 0.25);
    const b = sceneCameraAt(from, uneven, inicio + (fim - inicio) * 0.75);
    const andou = Math.hypot((b.panX - a.panX) * 100, (b.panY - a.panY) * 100);
    velocidades.push(andou / ((fim - inicio) * 0.5));
    inicio = fim;
  }
  const maior = Math.max(...velocidades);
  const menor = Math.min(...velocidades);
  assert.ok((maior - menor) / maior < 0.02,
    `every leg should travel at the same speed, got ${velocidades.map((v) => v.toFixed(1)).join(", ")}`);
  cases += 1;
}

{
  // A path whose stops all sit on top of each other has nowhere to go. It must
  // still produce a clip rather than dividing by zero.
  const from = cam();
  const parado = rota([{ x: 0, y: 0, zoom: 100 }, { x: 0, y: 0, zoom: 100 }]);
  for (const p of [0, 0.5, 1]) {
    const out = sceneCameraAt(from, parado, p);
    assert.ok(Number.isFinite(out.panX) && Number.isFinite(out.zoom), "a path with no distance stays finite");
    cases++;
  }
}

{
  // A leg is all travel: it starts where it starts, ends where it ends, and is
  // symmetric about its middle.
  near(cameraLegProgress(0), 0, 1e-12);
  near(cameraLegProgress(1), 1, 1e-12);
  near(cameraLegProgress(0.5), 0.5, 1e-12, "the middle of the leg is half the travel");
  near(cameraLegProgress(0.25) + cameraLegProgress(0.75), 1, 1e-12, "and it is symmetric about that middle");
  // Moving immediately, in both directions from the ends: this is the property
  // the old Settle broke. It parked the first half of every leg, so a camera
  // built here held still for frames at a time.
  assert.ok(cameraLegProgress(0.02) > 0, "a leg is under way from its first moment");
  assert.ok(cameraLegProgress(0.98) < 1, "and has not arrived before its last");
  // Monotonic, bounded, and clamped outside 0..1.
  let ant = -Infinity;
  for (let u = -0.2; u <= 1.2001; u += 0.01) {
    const t = cameraLegProgress(u);
    assert.ok(t >= ant - 1e-12 && t >= -1e-12 && t <= 1 + 1e-12, `at ${u}: ${t}`);
    ant = t;
    cases++;
  }
  cases += 6;
}

{
  // THE defect this replaced, asserted on the finished camera rather than on
  // the curve: walk a real path frame by frame and no frame may be a freeze.
  //
  // Measured on the reference clip — 209 frames, six stops — not one frame sits
  // still: the slowest moment is 0.58 px/frame against a peak of 12.77, a ratio
  // of 22. Ours used to produce EXACT zeroes for half of every leg. The bar
  // here is the reference's own: the slowest frame of a clip must stay above a
  // fiftieth of its fastest.
  const from = cam();
  const trajeto = rota([
    { x: 60, y: 0, zoom: 150 },
    { x: 85, y: -40, zoom: 110 },
    { x: -20, y: 30, zoom: 200 },
  ]);
  const QUADROS = 210;
  let ant = sceneCameraAt(from, trajeto, 0);
  const vels = [];
  for (let i = 1; i <= QUADROS; i++) {
    const at = sceneCameraAt(from, trajeto, i / QUADROS);
    vels.push(Math.hypot((at.panX - ant.panX) * 100, (at.panY - ant.panY) * 100)
      + Math.abs(at.zoom - ant.zoom) * 100);
    ant = at;
  }
  const rapido = Math.max(...vels), lento = Math.min(...vels);
  const razao = rapido / lento;
  assert.ok(lento > 0, "no frame of a camera move may be a freeze");
  // Bracketed on both sides. Too high and the stops are freezes again; too low
  // and there is no easing left, which is a camera on rails that changes
  // direction at a corner.
  assert.ok(razao < 35, `the slowest frame should stay within 35x of the fastest, got ${razao.toFixed(0)}x`);
  assert.ok(razao > 8, `and a leg must still ease into its stop, got only ${razao.toFixed(0)}x`);
  cases += 3;
}

{
  // Stops survive a save, clamped to their own ranges, and the keys are the
  // ones the panel writes.
  const keys = cameraStopKeys(0);
  assert.deepEqual(keys, { pad: '_camStop2', zoom: '_camStop2Zoom' });
  const saved = sanitizeSceneCamera({ [keys.pad]: { x: 5000, y: -5000 }, [keys.zoom]: 9000, _camHold: 200 });
  assert.deepEqual(saved[keys.pad], { x: 100, y: -100 }, "a stop clamps to the pad range");
  assert.equal(saved[keys.zoom], 300, "and to the zoom range");
  assert.ok(!('_camHold' in saved), 'a scene saved with the old Settle does not carry it forward');
  // More stops than the ceiling are dropped rather than kept and ignored.
  const demais = {};
  for (let i = 0; i < MAX_CAMERA_STOPS + 3; i++) {
    const k = cameraStopKeys(i);
    demais[k.pad] = { x: i, y: 0 };
    demais[k.zoom] = 100;
  }
  assert.equal(readSceneCameraPath(sanitizeSceneCamera(demais)).stops.length, MAX_CAMERA_STOPS);
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
