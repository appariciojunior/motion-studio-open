// Does Card Bend behave? Wrap at 0 must be the pure ring hug, the slider has to
// move it both ways from there, and Flip must not silently invert its meaning.
// Written because the sign of a bend is invisible in a screenshot and this one
// went in backwards on the first try.
//
// Usage: node scripts/_bend_orbit.cjs [template-id]
const path = require('path');
const Module = require('module');
require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};
const { getTemplate, defaultsFor, easingFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');

const id = process.argv[2] || 'orbit-3d-04';
const t = getTemplate(id);
const base = defaultsFor(id);
const ease = resolveEasing(easingFor(id));
const ctx = {
  fps: 30, width: 1080, height: 1080, duration: 8, totalFrames: 240, ease,
  easedPhase: (p) => Math.floor(p) + ease(p - Math.floor(p)), cardAspect: 1,
};
const bend = (patch) => t.transform3d(0, 0, base.count, { ...base, ...patch }, ctx).bend;
const rows = [
  ['surface wrap, bend   0', { surface: 'cylinder', cardBend: 0 }],
  ['surface wrap, bend +20', { surface: 'cylinder', cardBend: 20 }],
  ['surface wrap, bend -20', { surface: 'cylinder', cardBend: -20 }],
  ['surface flat, bend   0', { surface: 'flat', cardBend: 0 }],
  ['surface flat, bend +20', { surface: 'flat', cardBend: 20 }],
  ['surface flat, bend -20', { surface: 'flat', cardBend: -20 }],
  ['wrap + flip,  bend   0', { surface: 'cylinder', cardBend: 0, flip: 'yes' }],
  ['wrap + flip,  bend +20', { surface: 'cylinder', cardBend: 20, flip: 'yes' }],
];
console.log(id, '(count ' + base.count + ')');
for (const [label, patch] of rows) console.log('  ' + label + ' ->', bend(patch).toFixed(4));
