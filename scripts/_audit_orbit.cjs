// Field-by-field audit of the ported Orbit presets against the reference's own
// values, which were read out of its editor with "Copy Variant Values".
//
// Eyeballing a contact sheet catches a preset that looks wrong and misses one
// that looks plausible and carries the wrong number. This compares every field
// that has a defined conversion and prints only the disagreements.
const path = require('path');
const Module = require('module');
require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};
const { getTemplate, defaultsFor, templateList } = require('../templates');

const TAU = Math.PI * 2;
// Their stage's short edge, measured — not the 1080 first assumed.
const STAGE_SHORT = 1280;

// [count, gap, surface, cardAlign, orbitRadius, cardTilt, cardRotation,
//  rotX, rotY, rotZ, direction, backface, fade, fadeMode, contrast, flip, corner]
const REF = {
  'Ring Pure 01':      [18,  35, 'cylinder', 'radial',   0,   0,   0, -10, -10,  50, 'reverse', 'show', 30, 'solid',   0, 'no',  10],
  'Ring Pure 02':      [ 9,  15, 'cylinder', 'radial',   0,   0,   0, -10, -10,  50, 'reverse', 'show', 15, 'solid',   0, 'no',  10],
  'Ring Pure 03':      [ 9,  15, 'cylinder', 'radial',   0,   0,   0,  -7,   0,   0, 'reverse', 'show', 15, 'solid',   0, 'no',  10],
  'Ring Pure 04':      [18,  15, 'cylinder', 'radial',   0,   0,   0,   0,   0,   0, 'reverse', 'show', 15, 'solid',   0, 'no',  10],
  'Ring Pure 05':      [12,  15, 'cylinder', 'radial',  60,   0,   0,   0,   0,   0, 'reverse', 'show', 15, 'solid',   0, 'no',  10],
  'Ring Pure 06':      [18,   0, 'cylinder', 'radial',  60,   0,  90,   0,   0, -90, 'forward', 'show', 15, 'solid',   0, 'no',   0],
  'Ring Carousel 01':  [18,  35, 'flat',     'normal',   0,   0,   0, -10, -10,  50, 'reverse', 'show', 30, 'solid',   0, 'no',  10],
  'Ring Carousel 02':  [ 9,  15, 'flat',     'normal',   0,   0,   0, -10, -10,  50, 'reverse', 'show', 15, 'solid',   0, 'no',  10],
  'Ring Carousel 03':  [ 9,  15, 'flat',     'normal',   0,   0,   0,   0,   0,  56, 'reverse', 'show', 15, 'solid',  50, 'no',  10],
  'Ring Carousel 04':  [20, -50, 'flat',     'normal',   0,   0,   0,   0,   0,  90, 'reverse', 'show', 15, 'solid', 200, 'no',  10],
  'Ring Carousel 05':  [ 9, -15, 'flat',     'normal',   0,   0,   0,   0,   0,   0, 'reverse', 'show', 15, 'solid', 200, 'no',  10],
  'Ring Lightroom 01': [10,   6, 'cylinder', 'radial',   0,   0,   0,   0,   0,   0, 'reverse', 'show',  0, 'alpha',   0, 'yes', 10],
  'Ring Lightroom 02': [10,   6, 'flat',     'radial',   0,   0, -90,   0,   0,  90, 'reverse', 'show',  0, 'alpha',   0, 'yes', 10],
  'Ring Lightroom 03': [10,   6, 'flat',     'radial',   0,   0, -90,   0,   0,  51, 'reverse', 'show',  0, 'alpha',   0, 'yes', 10],
  'Ring Lightroom 04': [ 9,  63, 'flat',     'radial', 150,   0, -90,   0,   0,  90, 'reverse', 'hide',  0, 'alpha',   0, 'yes', 10],
  'Ring Lightroom 05': [24,   0, 'flat',     'radial', 500,   0,   0,   0,   0,   0, 'reverse', 'show',  0, 'alpha',   0, 'yes',  0],
  'Ring Bloom 01':     [12,  18, 'flat',     'radial',   0,  15,   0,   0,   0,   0, 'reverse', 'show', 25, 'solid',   0, 'no',  10],
  'Ring Bloom 02':     [12,   0, 'flat',     'normal',   0,   0,   0,   0,  85,  90, 'reverse', 'show',  0, 'alpha', 200, 'no',  10],
  'Ring Bloom 03':     [12,   0, 'flat',     'normal',   0,   0,   0,  24,  75,  90, 'reverse', 'show',  0, 'alpha', 200, 'no',  10],
  'Ring Bloom 04':     [12,   0, 'flat',     'normal',   0, -44,   0,  97, -40,   0, 'reverse', 'show',  0, 'alpha',   0, 'no',  10],
  'Ring Bloom 05':     [16,  49, 'flat',     'radial',   0,   0,   0,  90,   0,   0, 'reverse', 'show',  0, 'alpha',   0, 'no',  10],
};

const byName = Object.fromEntries(templateList.map((t) => [t.meta.name, t]));
const problems = [];
let checked = 0;

for (const [name, ref] of Object.entries(REF)) {
  const template = byName[name];
  if (!template) { problems.push(`${name}: TEMPLATE NAO EXISTE`); continue; }
  const v = defaultsFor(template.meta.id);
  const [count, gap, surface, align, diameter, cardTilt, cardRotation,
    rotX, rotY, rotZ, direction, backface, fade, fadeMode, contrast, flip, corner] = ref;

  // The conversions, all of them measured on the reference.
  const cardPct = Math.round(100 / (1 + gap / 100));
  const share = cardPct / 100;
  const alpha = (TAU / count) * share;
  const wantBend = surface === 'cylinder' ? Math.round(50 * Math.tan(alpha / 4) * 2) / 2 : 0;
  const want = {
    count,
    cardSizePct: cardPct,
    cardBend: wantBend,
    facing: align === 'radial' ? 'ring' : 'camera',
    ringOffset: Math.round((diameter / STAGE_SHORT) * 100),
    cardTilt, cardRotation,
    tiltX: rotX, ringYaw: rotY, ringRoll: rotZ,
    direction, backface, fade, fadeMode, scaleContrast: contrast, flip,
    cornerRadius: corner,
  };

  for (const [key, expected] of Object.entries(want)) {
    checked++;
    const actual = v[key];
    const same = typeof expected === 'number'
      ? Math.abs((actual ?? 0) - expected) < 0.51
      : actual === expected;
    if (!same) problems.push(`${name}: ${key} = ${JSON.stringify(actual)}, esperado ${JSON.stringify(expected)}`);
  }
}

console.log(`auditados ${checked} campos em ${Object.keys(REF).length} presets`);
if (!problems.length) console.log('nenhuma divergencia');
else { console.log(`\n${problems.length} divergencia(s):`); for (const p of problems) console.log('  ' + p); }
