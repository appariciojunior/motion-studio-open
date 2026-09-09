const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
require('sucrase/register');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', request.slice(2)) : request, ...args);
};
const { getTemplate, defaultsFor, catalogTemplateList, templateGroups } = require('../templates');
const { SCENE_SOURCES, TEMPLATE_MANIFEST } = require('../lib/exportSources');
const { resolveEasing } = require('../lib/easing');

const visibleIds = ['field-01', 'canvas-gallery-01', 'canvas-gallery-02'];
const hiddenIds = ['blank-01', 'field-02', 'field-03', 'field-04', 'canvas-gallery-03'];
assert.deepEqual(catalogTemplateList.filter(template => template.meta.group === 'Canvas').map(template => template.meta.id), visibleIds);
assert.ok(!templateGroups.some(group => group.group === 'Warp'));
for (const id of hiddenIds) {
  assert.equal(getTemplate(id).meta.id, id);
  assert.ok(getTemplate(id).meta.catalogHidden);
  assert.ok(!catalogTemplateList.some(template => template.meta.id === id));
  assert.ok(Object.values(TEMPLATE_MANIFEST).some(entry => entry.ids.includes(id)));
}
for (const file of ['field.ts', 'gallery.ts', 'blank.ts']) {
  assert.ok(SCENE_SOURCES[file].includes('catalogHidden: true'), `${file}: export catalogue is stale`);
}

let assertions = 0;
const check = (condition, message) => { assertions++; assert.ok(condition, message); };
const close = (actual, expected, message) => check(Math.abs(actual - expected) < 1e-6, message);
for (const id of [...visibleIds, ...hiddenIds]) {
  const template = getTemplate(id);
  const values = defaultsFor(id);
  for (const [width, height] of [[810, 1080], [864, 1080], [608, 1080], [1080, 1080], [1080, 810], [1080, 608]]) {
    for (const cardAspect of [1, 4 / 5, 3 / 4, 4 / 3, 9 / 16, 16 / 9]) {
      for (const easing of ['linear', 'smooth']) {
        const ease = resolveEasing({ id: easing });
        const ctx = { width, height, cardAspect, duration: 8, fps: 30, totalFrames: 240, ease,
          easedPhase: phase => Math.floor(phase) + ease(phase - Math.floor(phase)) };
        for (let frame = 0; frame < 240; frame += 5) {
          let readable = 0;
          for (let index = 0; index < values.count; index++) {
            const pose = template.transform(frame, index, values.count, values, ctx);
            const next = template.transform(frame + 240, index, values.count, values, ctx);
            const large = template.transform(frame, index, values.count, values, { ...ctx, width: width * 2, height: height * 2 });
            check(Object.values(pose).every(Number.isFinite), `${id}: non-finite pose`);
            close(pose.alpha, next.alpha, `${id}: loop alpha`);
            for (const key of ['x', 'y', 'scale']) {
              if (pose.alpha > 0.001) close(pose[key], next[key], `${id}: loop ${key}`);
              close(pose[key] * 2, large[key], `${id}: resolution ${key}`);
            }
            const cardLong = pose.scale * 340;
            if (pose.alpha > 0.4 && cardLong > 60 && Math.abs(pose.x) < width / 2 && Math.abs(pose.y) < height / 2) readable++;
            if (visibleIds.includes(id)) check(cardLong <= values.cardSize * 1.5, `${id}: uncontrolled growth`);
          }
          if (visibleIds.includes(id)) check(readable >= 3, `${id}: only ${readable} readable cards at ${frame}, ${width}x${height}, ${cardAspect}, ${easing}`);
        }
      }
    }
  }
}

for (const id of ['canvas-gallery-01', 'canvas-gallery-02']) {
  const template = getTemplate(id);
  for (const pathMode of ['straight', 'spiral']) for (const holdT of [0, 2]) {
    const values = { ...defaultsFor(id), path: pathMode, holdT };
    const lifetime = values.appearT + values.holdT + values.exitT;
    const laps = Math.max(1, Math.round(8 / lifetime));
    const ctx = { width: 810, height: 1080, cardAspect: 1, duration: 8, fps: 30, totalFrames: 240, ease: phase => phase, easedPhase: phase => phase };
    for (const boundary of [0, values.appearT / lifetime, (values.appearT + holdT) / lifetime, 1]) {
      const frame = boundary * 240 / laps;
      const before = template.transform(frame - 0.00001, 0, values.count, values, ctx);
      const after = template.transform(frame + 0.00001, 0, values.count, values, ctx);
      close(before.alpha, after.alpha, `${id}: lifecycle alpha discontinuity`);
      if (before.alpha > 0.001) {
        check(Math.hypot(before.x - after.x, before.y - after.y) < 0.001, `${id}: lifecycle position discontinuity`);
        check(Math.abs(before.scale - after.scale) < 0.001, `${id}: lifecycle scale discontinuity`);
      }
    }
  }
}

const blank = getTemplate('blank-01');
for (const cardAspect of [1, 4 / 5, 16 / 9]) {
  const values = defaultsFor('blank-01');
  const ctx = { width: 810, height: 1080, cardAspect };
  const first = blank.transform(0, 0, 4, values, ctx);
  const right = blank.transform(0, 1, 4, values, ctx);
  const below = blank.transform(0, 2, 4, values, ctx);
  close(right.x - first.x - values.cardSize * Math.min(1, cardAspect), values.gap, 'Canvas 01 horizontal gutter');
  close(below.y - first.y - values.cardSize * Math.min(1, 1 / cardAspect), values.gap, 'Canvas 01 vertical gutter');
}

console.log(`Canvas verification passed (${assertions} assertions; 3 curated presets, 5 loadable legacy presets).`);
