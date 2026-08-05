const path = require('path');
const Module = require('module');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { templateList, catalogTemplateList, templateGroups, getTemplate, defaultsFor } = require('../templates');
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
  const count = Math.max(1, Math.round(values.count ?? 6));
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

console.log(`Tilt verification passed (${assertions} assertions across ${templateList.length} templates).`);
