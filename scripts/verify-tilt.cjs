const path = require('path');
const Module = require('module');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { templateList, catalogTemplateList, templateGroups, getTemplate, defaultsFor, easingFor, layerCountFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');
const { tiltPointCanvas, tiltNormalCanvas } = require('../lib/tilt3d');

let assertions = 0;
function assert(ok, message) {
  assertions++;
  if (!ok) throw new Error(message);
}
function finitePose(pose, label) {
  for (const [key, value] of Object.entries(pose)) {
    if (typeof value === 'number') assert(Number.isFinite(value), `${label}.${key} is not finite`);
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) {
        if (typeof child === 'number') assert(Number.isFinite(child), `${label}.${key}.${childKey} is not finite`);
      }
    }
  }
  if (pose.quaternion) {
    const q = pose.quaternion;
    assert(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-6, `${label}.quaternion is not normalized`);
  }
  if (pose.thickness !== undefined) assert(pose.thickness >= 0, `${label}.thickness is negative`);
}
function angleDistance(a, b) {
  return Math.abs(((a - b + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
}
function samePose(a, b, label) {
  const angular = new Set(['rotation', 'rotationX', 'rotationY', 'rotationZ']);
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (typeof a[key] !== 'number' || typeof b[key] !== 'number') continue;
    const delta = angular.has(key) ? angleDistance(a[key], b[key]) : Math.abs(a[key] - b[key]);
    assert(delta < 1e-5, `${label}.${key} loop delta ${delta}`);
  }
}

// Rotations are rigid: points keep their distance and normals stay normalized.
for (const rig of [{ pitch: 35 }, { yaw: -42, roll: 17 }, { pitch: 22, yaw: 31, roll: -9 }]) {
  const point = { x: 120, y: -75, z: 240 };
  const rotated = tiltPointCanvas(point, rig);
  assert(Math.abs(Math.hypot(point.x, point.y, point.z) - Math.hypot(rotated.x, rotated.y, rotated.z)) < 1e-8, 'Tilt changed point length');
  const normal = tiltNormalCanvas({ x: 0.2, y: -0.4, z: 0.8 }, rig);
  assert(Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1) < 1e-8, 'Tilt normal is not normalized');
}

// Plane tilt keeps every card centre on one plane.
const planeRig = { pitch: 37, yaw: -24, roll: 8 };
const plane = [
  tiltPointCanvas({ x: -200, y: -120, z: 0 }, planeRig),
  tiltPointCanvas({ x: 200, y: -120, z: 0 }, planeRig),
  tiltPointCanvas({ x: -200, y: 120, z: 0 }, planeRig),
  tiltPointCanvas({ x: 200, y: 120, z: 0 }, planeRig),
];
const ab = { x: plane[1].x-plane[0].x, y: plane[1].y-plane[0].y, z: plane[1].z-plane[0].z };
const ac = { x: plane[2].x-plane[0].x, y: plane[2].y-plane[0].y, z: plane[2].z-plane[0].z };
const normal = { x: ab.y*ac.z-ab.z*ac.y, y: ab.z*ac.x-ab.x*ac.z, z: ab.x*ac.y-ab.y*ac.x };
const ad = { x: plane[3].x-plane[0].x, y: plane[3].y-plane[0].y, z: plane[3].z-plane[0].z };
assert(Math.abs(normal.x*ad.x + normal.y*ad.y + normal.z*ad.z) < 1e-6, 'Plane tilt broke coplanarity');

// Ring and curved-surface tilts are rigid rotations: radius and pairwise
// distances cannot change when pitch/yaw/roll change.
for (let i = 0; i < 24; i++) {
  const a = i / 24 * Math.PI * 2;
  const p = tiltPointCanvas({ x: Math.sin(a)*380, y: 0, z: Math.cos(a)*380 }, planeRig);
  assert(Math.abs(Math.hypot(p.x, p.y, p.z) - 380) < 1e-7, 'Ring tilt changed radius');
}

const ctx = {
  fps: 30, width: 1080, height: 1080, duration: 8, totalFrames: 240,
  ease: (t) => t,
  easedPhase: (p) => p,
};
const groupedTemplates = templateGroups.flatMap((group) => group.items);
assert(groupedTemplates.length === catalogTemplateList.length, 'The catalogue dropped a published template while grouping');
assert(new Set(groupedTemplates.map((item) => item.meta.id)).size === catalogTemplateList.length, 'The catalogue duplicated a template while grouping');
for (const hidden of templateList.filter((item) => item.meta.catalogHidden)) {
  assert(!groupedTemplates.some((item) => item.meta.id === hidden.meta.id), `${hidden.meta.id} leaked into the catalogue`);
  assert(getTemplate(hidden.meta.id).meta.id === hidden.meta.id, `${hidden.meta.id} can no longer load persisted scenes`);
}
assert(templateGroups.every((group) => group.items.every((item) => group.group === (
  item.meta.group === '3D & Perspective'
    ? item.meta.group
    : item.meta.catalog3d ? `${item.meta.group} 3D` : item.meta.group
))), 'A template leaked into a different visual family');
const relevantGroups = new Set(['3D & Perspective', 'Runway', 'Orbit', 'Globe', 'Surface', 'Helix', 'Isometric', 'Coverflow', 'Ticker', 'Deck', 'Depth', 'Box', 'Bounce', 'Dock', 'Editorial']);

// Box Carousel follows the CSS 3D model: it rests on a face, then rotates
// exactly one face step. Seven assets repeat after seven steps, not after the
// least-common-multiple of asset and physical-face ownership.
const box = templateList.find((item) => item.meta.id === 'box-01');
const boxValues = defaultsFor('box-01');
assert(box && box.transform3d, 'Box 01 must provide a WebGL transform');
const boxCount = boxValues.count;
for (let i = 0; i < boxCount; i++) {
  const rest = box.transform3d(0, i, boxCount, boxValues, ctx);
  const held = box.transform3d(10, i, boxCount, boxValues, ctx);
  samePose(rest, held, `box-01 hold[${i}]`);
}
const turningFaces = Array.from({ length: boxCount }, (_, i) => box.transform3d(23, i, boxCount, boxValues, ctx))
  .filter((pose) => pose.alpha > 0.01);
assert(turningFaces.length === 2, `Box turn should expose exactly two faces, got ${turningFaces.length}`);

// Card shape changes the real mesh width/height. The Box apothem must follow
// that same resolved dimension or its corners open on one of the spin axes.
const boxCross = (axis, cardAspect) => {
  const pose = box.transform3d(0, 1, boxCount, { ...boxValues, axis, faces: 4, girth: 1 }, { ...ctx, cardAspect });
  return Math.abs(axis === 'vertical' ? pose.x : pose.y);
};
const defaultAspect = box.meta.cardAspect;
const defaultVerticalCross = boxCross('vertical', defaultAspect);
const defaultHorizontalCross = boxCross('horizontal', defaultAspect);
for (const aspect of [4 / 5, 1, 16 / 9]) {
  const expectedVerticalRatio = Math.min(1, aspect) / Math.min(1, defaultAspect);
  const expectedHorizontalRatio = Math.min(1, 1 / aspect) / Math.min(1, 1 / defaultAspect);
  assert(Math.abs(boxCross('vertical', aspect) / defaultVerticalCross - expectedVerticalRatio) < 1e-7,
    `Box vertical geometry ignored card aspect ${aspect}`);
  assert(Math.abs(boxCross('horizontal', aspect) / defaultHorizontalCross - expectedHorizontalRatio) < 1e-7,
    `Box horizontal geometry ignored card aspect ${aspect}`);
}

for (const template of templateList.filter((item) => relevantGroups.has(item.meta.group))) {
  const values = defaultsFor(template.meta.id);
  const count = layerCountFor(template.meta.id, values, { width: ctx.width, height: ctx.height });
  const controls = template.controls.filter((control) => control.type === 'slider' && ['tilt','tiltX','tiltAmount','ringTilt','curvature','perspective'].includes(control.key));
  const samples = [values, ...controls.flatMap((control) => [
    { ...values, [control.key]: control.min },
    { ...values, [control.key]: control.max },
  ])];

  for (const sample of samples) {
    for (const index of [0, Math.floor(count / 2), count - 1]) {
      if (index < 0 || index >= count) continue;
      const p0 = template.transform(0, index, count, sample, ctx);
      const pN = template.transform(ctx.totalFrames, index, count, sample, ctx);
      finitePose(p0, `${template.meta.id}[${index}]`);
      samePose(p0, pN, `${template.meta.id}[${index}]`);
      if (template.transform3d) {
        const q0 = template.transform3d(0, index, count, sample, ctx);
        const qN = template.transform3d(ctx.totalFrames, index, count, sample, ctx);
        finitePose(q0, `${template.meta.id}.3d[${index}]`);
        samePose(q0, qN, `${template.meta.id}.3d[${index}]`);
      }
    }
  }
}

// ---------- Card Bend must curve BOTH ways ----------
// The bent-plane geometry accepts a signed sag, but its arc used to be derived
// from (a - centre).angle() * 2, which only holds while the arc centre sits
// BELOW the chord — i.e. for a positive bend. Vector2.angle() returns
// [0, 2*PI), so a negative bend picked the REFLEX angle and swept the card
// nearly all the way round its own circle: at bend -0.04 the centre vertex
// landed 6.25 units out instead of 0.04, about 150x too far. Nothing caught it
// because no control could reach a negative bend until Orbit 3D's Card Bend
// was centred on zero.
{
  const THREE = require('three');
  const bentGeometry = (sag) => {
    // Mirrors lib/renderer3d makeBentPlaneGeometry.
    const bend = Math.max(-0.45, Math.min(0.45, sag));
    const g = new THREE.PlaneGeometry(1, 1, 20, 8);
    if (Math.abs(bend) < 0.0001) return g;
    const a = new THREE.Vector2(-0.5, 0), b = new THREE.Vector2(0, bend), c = new THREE.Vector2(0.5, 0);
    const ab = new THREE.Vector2().subVectors(a, b);
    const bc = new THREE.Vector2().subVectors(b, c);
    const ac = new THREE.Vector2().subVectors(a, c);
    const radius = (ab.length() * bc.length() * ac.length()) / (2 * Math.abs(ab.cross(ac)));
    const centre = new THREE.Vector2(0, bend - Math.sign(bend) * radius);
    const angleA = new THREE.Vector2().subVectors(a, centre).angle();
    const angleC = new THREE.Vector2().subVectors(c, centre).angle();
    let arc = angleA - angleC;
    if (arc > Math.PI) arc -= Math.PI * 2;
    if (arc < -Math.PI) arc += Math.PI * 2;
    const uv = g.attributes.uv, position = g.attributes.position;
    const pt = new THREE.Vector2();
    for (let i = 0; i < uv.count; i++) {
      const ratio = 1 - uv.getX(i);
      const y = position.getY(i);
      pt.copy(c).rotateAround(centre, arc * ratio);
      position.setXYZ(i, pt.x, y, -pt.y);
    }
    return g;
  };
  const centreZ = (sag) => {
    const p = bentGeometry(sag).attributes.position;
    let cz = null, maxAbsX = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      maxAbsX = Math.max(maxAbsX, Math.abs(x));
      if (Math.abs(x) < 1e-6 && cz === null) cz = p.getZ(i);
    }
    return { cz, maxAbsX };
  };
  // 0.45 is the renderer's own ceiling and Card Bend's maximum — about
  // 168 degrees of arc, where the circumradius maths is closest to degenerate.
  for (const sag of [0.04, 0.12, 0.3, 0.45]) {
    const pos = centreZ(sag), neg = centreZ(-sag);
    // The centre displaces by exactly the sag, opposite ways, and the card
    // never widens — a runaway arc shows up as either.
    assert(Math.abs(pos.cz + sag) < 1e-6,
      `Card Bend +${sag} put the centre vertex at ${pos.cz}, expected ${-sag}`);
    assert(Math.abs(neg.cz - sag) < 1e-6,
      `Card Bend -${sag} put the centre vertex at ${neg.cz}, expected ${sag}`);
    assert(Math.abs(pos.maxAbsX - 0.5) < 1e-6,
      `Card Bend +${sag} widened the card to ${pos.maxAbsX * 2}`);
    assert(Math.abs(neg.maxAbsX - 0.5) < 1e-6,
      `Card Bend -${sag} widened the card to ${neg.maxAbsX * 2}`);
  }
}

// Every Layout slider on the Orbit ring has to move the ring.
//
// A ring over-determines itself: radius, count and card size are three
// controls for two degrees of freedom, so a naive guard makes one of them
// silently lose. Both arrangements were measured on the shipped preset and
// both shipped a dead slider — capping the card killed Card Size above 16% of
// its range, and growing the ring instead killed Ring Size and Ring Opening
// outright. Card Size is now a share of its own angular slot, which removes
// the contest; this is the assertion that keeps it removed.
//
// Deliberately narrow. The same sweep across the whole catalogue accuses 577
// sliders, almost all falsely: it reads only transform/transform3d at frame 0,
// so a control the RENDERER reads (Corner Radius), one camera() reads (Camera
// FOV), or one that only shows over time (Speed) looks inert to it. A sound
// catalogue-wide version would have to cover those three surfaces too.
{
  const ringCtx = {
    fps: 30, width: 810, height: 1080, duration: 6, totalFrames: 180,
    ease: (t) => t, easedPhase: (p) => p, cardAspect: 4 / 5,
  };
  // Position and size are not the whole pose. Card Rotation only turns the
  // card in place, so a signature of x/y/z/scale reported it as inert when it
  // was working — the summary was incomplete, not the control. Orientation
  // counts, so the quaternion is in.
  const poseSignature = (tpl, values) => {
    const count = values.count;
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = tpl.transform3d(0, i, count, values, ringCtx);
      const q = p.quaternion || { x: 0, y: 0, z: 0, w: 1 };
      out.push([p.x, p.y, p.z, p.scale, q.x, q.y, q.z, q.w].map((n) => n.toFixed(4)).join(','));
    }
    return out.join('|');
  };
  for (const id of ['orbit-3d-01', 'orbit-3d-02', 'orbit-3d-03']) {
    const tpl = getTemplate(id);
    const base = defaultsFor(id);
    for (const control of tpl.controls) {
      if (control.type !== 'slider' || control.section !== 'Layout') continue;
      // Sweep each control in the style that actually shows it — Ring Width is
      // showcase-only, so on a stream preset it is hidden, not broken.
      const shown = control.visibleWhen
        ? { ...base, [control.visibleWhen.key]: control.visibleWhen.equals }
        : base;
      let dead = 0, steps = 0;
      let previous = poseSignature(tpl, { ...shown, [control.key]: control.min });
      for (let x = control.min + control.step; x <= control.max + 1e-9; x += control.step) {
        const next = poseSignature(tpl, { ...shown, [control.key]: x });
        steps++;
        if (next === previous) dead++;
        previous = next;
      }
      assert(dead === 0, `${id} ${control.label} is inert for ${dead}/${steps} of its range`);
    }
    // The three motion modes must stay distinguishable.
    //
    // The ring advances a slot per step, shaped by the curve and optionally
    // held. Those settings sit in two different places — the curve on
    // meta.defaultEasing, the hold on a control — and a `variant` that drops
    // either one leaves a preset that still renders, still loops, still passes
    // every geometric check, and simply moves like all the others. That has
    // already happened twice in this family with transform3d and layerCount.
    //
    // Measured per frame as how far one card travels:
    //   linear, no hold   peak/mean 1.00, no still frames — a constant spin
    //   shaped, no hold   peak/mean 4.30, half the frames near still
    //   shaped + hold     peak/mean 5.44 and up
    {
      const rate = (id) => {
        const template = getTemplate(id);
        const values = defaultsFor(id);
        const ease = resolveEasing(easingFor(id));
        const motionCtx = {
          fps: 30, width: 810, height: 1080, duration: 8, totalFrames: 240, ease,
          easedPhase: (p) => Math.floor(p) + ease(p - Math.floor(p)), cardAspect: 4 / 5,
        };
        const steps = [];
        for (let f = 0; f < 240; f++) {
          const a = template.transform3d(f, 0, values.count, values, motionCtx);
          const b = template.transform3d(f + 1, 0, values.count, values, motionCtx);
          steps.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
        }
        const peak = Math.max(...steps);
        const mean = steps.reduce((x, y) => x + y, 0) / steps.length;
        return { ratio: peak / Math.max(mean, 1e-6), still: steps.filter((d) => d < peak * 0.12).length };
      };
      // Which preset belongs on which side of this is now read off the
      // reference's own authored table rather than guessed from watching it.
      // Lightroom 04 used to sit in the stepped list, on a Glide curve with a
      // 36% hold; its authored row is Linear with pause 0, so it spins — and
      // this assertion is the one that would have caught the old reading.
      for (const [id, name] of [['orbit-3d-04', 'Ring Pure 01'], ['orbit-3d-18', 'Ring Lightroom 04'], ['orbit-3d-24', 'Ring Bloom 02']]) {
        const spin = rate(id);
        assert(spin.ratio < 1.05 && spin.still === 0,
          `${name} should spin at a constant rate, got peak/mean ${spin.ratio.toFixed(2)} with ${spin.still} still frames`);
      }
      for (const [id, name] of [['orbit-3d-07', 'Ring Pure 04'], ['orbit-3d-12', 'Ring Carousel 03'], ['orbit-3d-19', 'Ring Lightroom 05'], ['orbit-3d-23', 'Ring Bloom 01']]) {
        const stepped = rate(id);
        assert(stepped.ratio > 2 && stepped.still > 240 * 0.25,
          `${name} should step rather than spin, got peak/mean ${stepped.ratio.toFixed(2)} with ${stepped.still} still frames`);
      }
    }

    // And the shipped defaults must not overlap: a card has to fit its slot.
    const count = base.count;
    const metrics = tpl.transform3d(0, 0, count, base, ringCtx);
    const radius = Math.hypot(metrics.x, metrics.y, metrics.z);
    const slot = (Math.PI * 2 * radius) / count;
    assert(metrics.scale * 340 < slot,
      `${id} cards are ${metrics.scale * 340} wide in a ${slot} slot — they collide`);
  }
}

console.log(`Tilt verification passed (${assertions} assertions across ${templateList.length} templates).`);
