// Crop geometry must stay identical in the editor, Pixi and Three texture views.
require('sucrase/register');
const assert = require('node:assert/strict');
const { coverCrop, cropKey, cropFromRect, normalizeCrop, cardAspectFor } = require('../lib/crop');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
assert.deepEqual(coverCrop(1200, 800, 1), { fx: 200, fy: 0, fw: 800, fh: 800 });
assert.deepEqual(coverCrop(1200, 800, 1, { x: 1, y: 0 }), { fx: 400, fy: 0, fw: 800, fh: 800 });
assert.deepEqual(coverCrop(1200, 800, 1, { x: .5, y: .5, zoom: 2 }), { fx: 400, fy: 200, fw: 400, fh: 400 });
assert.deepEqual(normalizeCrop({ x: NaN, y: Infinity, zoom: NaN }), { x: .5, y: .5, zoom: 1 });
assert.deepEqual(normalizeCrop({ x: -2, y: 8, zoom: 90 }), { x: 0, y: 1, zoom: 5 });
assert.equal(cropKey('a', 1), cropKey('a', 1, { x: .5, y: .5, zoom: 1 }));
assert.notEqual(cropKey('a', 1), cropKey('a', 1, { x: .5, y: .5, zoom: 2 }));
assert.equal(cardAspectFor({ cardAspect: 'canvas' }, 1920, 1080, '1:1'), 1920 / 1080);
let cases = 0;
for (const [w, h] of [[1200, 800], [800, 1200], [1000, 1000], [1, 1]]) {
  for (const aspect of [.1, 9/16, .8, 1, 16/9, 10]) {
    for (const zoom of [1, 1.01, 2, 5]) {
      for (const x of [0, .27, .5, 1]) for (const y of [0, .63, 1]) {
        const r = coverCrop(w, h, aspect, {x, y, zoom});
        near(r.fw / r.fh, aspect);
        assert.ok(r.fx >= 0 && r.fy >= 0 && r.fx + r.fw <= w + 1e-7 && r.fy + r.fh <= h + 1e-7);
        {
          const roundtrip = coverCrop(w, h, aspect, cropFromRect(w, h, aspect, r.fx, r.fy, r.fw));
          for (const key of ['fx', 'fy', 'fw', 'fh']) near(roundtrip[key], r[key]);
        }
        cases++;
      }
    }
  }
}
console.log(`Crop: ${cases} geometry cases passed; legacy crops, zoom, bounds and cache invalidation passed.`);
