const path = require('path');
const Module = require('module');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { templateList, catalogTemplateList, templateGroups, getTemplate, defaultsFor, layerCountFor } = require('../templates');
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
  // 0.45 is the renderer's own ceiling and Card Bend's new maximum — about
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

console.log(`Tilt verification passed (${assertions} assertions across ${templateList.length} templates).`);
