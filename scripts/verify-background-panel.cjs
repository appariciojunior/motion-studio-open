#!/usr/bin/env node

require('sucrase/register');

let panel = {};
try {
  panel = require('../lib/backgroundPanel');
} catch {
  // The first TDD run intentionally reaches this branch: the desired
  // background state model does not exist yet.
}

let BackgroundPanel;
try {
  BackgroundPanel = require('../components/BackgroundPanel').default;
} catch {
  // Added after the state model in the second TDD cycle.
}

const failures = [];
function check(actual, expected, message) {
  if (actual !== expected) failures.push(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check(typeof panel.backgroundMode, 'function', 'Background mode resolver exists');
check(typeof panel.backgroundPatchForMode, 'function', 'Background mode transition exists');
check(typeof panel.normalizeBackgroundHex, 'function', 'Eight-digit colour normalizer exists');
check(typeof panel.backgroundSourceForHex, 'function', 'Transparent alpha mapping exists');
check(typeof panel.validateBackgroundImage, 'function', 'Background upload validation exists');
check(typeof panel.hexToHsva, 'function', 'Hex to HSVA conversion exists');
check(typeof panel.hsvaToHex, 'function', 'HSVA to hex conversion exists');
check(Array.isArray(panel.BACKGROUND_GRADIENT_PRESETS), true, 'Gradient presets exist');
check(typeof BackgroundPanel, 'function', 'Interactive BackgroundPanel component exists');

if (typeof panel.backgroundMode === 'function') {
  check(panel.backgroundMode({ source: 'color', gradient: false }), 'colour', 'Solid backgrounds use the Colour tab');
  check(panel.backgroundMode({ source: 'transparent', gradient: false }), 'colour', 'Transparent backgrounds stay in the Colour tab');
  check(panel.backgroundMode({ source: 'color', gradient: true }), 'gradient', 'Gradient backgrounds use the Gradient tab');
  check(panel.backgroundMode({ source: 'image', gradient: false }), 'image', 'Uploaded backgrounds use the Image tab');
  check(panel.backgroundMode({ source: 'card', gradient: false }), 'colour', 'Legacy card backgrounds receive a safe visible tab');
}

if (typeof panel.backgroundPatchForMode === 'function') {
  check(JSON.stringify(panel.backgroundPatchForMode('colour')), JSON.stringify({ source: 'color', gradient: false }), 'Colour tab disables the gradient');
  check(JSON.stringify(panel.backgroundPatchForMode('gradient')), JSON.stringify({ source: 'color', gradient: true }), 'Gradient tab enables the gradient');
  check(
    JSON.stringify(panel.backgroundPatchForMode('gradient', { source: 'color', gradient: false, color: '#0d0d0d', color2: '#f0f0f0' })),
    JSON.stringify({ source: 'color', gradient: true, color: '#7386e8', color2: '#182768' }),
    'Opening Gradient from a custom solid selects the first visual preset',
  );
  check(JSON.stringify(panel.backgroundPatchForMode('image')), JSON.stringify({ source: 'image' }), 'Image tab selects the uploaded image source');
}

if (typeof panel.normalizeBackgroundHex === 'function') {
  check(panel.normalizeBackgroundHex('#101014'), '#101014ff', 'Six-digit colours become opaque eight-digit colours');
  check(panel.normalizeBackgroundHex('#10101400'), '#10101400', 'Existing alpha is retained');
  check(panel.normalizeBackgroundHex('invalid'), '#101014ff', 'Invalid colours fall back safely');
}

if (typeof panel.backgroundSourceForHex === 'function') {
  check(panel.backgroundSourceForHex('#10101400'), 'transparent', 'Zero alpha selects transparent rendering');
  check(panel.backgroundSourceForHex('#10101480'), 'color', 'Partial alpha remains a colour background');
}

if (typeof panel.validateBackgroundImage === 'function') {
  check(panel.validateBackgroundImage({ size: 5 * 1024 * 1024, type: 'image/png' }), null, 'A 5 MB image is accepted');
  check(panel.validateBackgroundImage({ size: 5 * 1024 * 1024 + 1, type: 'image/png' }), 'Image must be 5 MB or smaller.', 'An oversized image is rejected');
  check(panel.validateBackgroundImage({ size: 100, type: 'text/plain' }), 'Choose an image file.', 'A non-image file is rejected');
}

if (typeof panel.hexToHsva === 'function') {
  const red = panel.hexToHsva('#ff000080');
  check(red.h, 0, 'Red hue is preserved');
  check(red.s, 100, 'Red saturation is preserved');
  check(red.v, 100, 'Red value is preserved');
  check(Math.round(red.a * 100), 50, 'Hex alpha becomes picker opacity');
}

if (typeof panel.hsvaToHex === 'function') {
  check(panel.hsvaToHex({ h: 0, s: 100, v: 100, a: 0.5 }), '#ff000080', 'Picker opacity returns eight-digit hex');
  check(panel.hsvaToHex({ h: 120, s: 100, v: 100, a: 0 }), '#00ff0000', 'Picker transparency returns a zero-alpha hex');
}

if (Array.isArray(panel.BACKGROUND_GRADIENT_PRESETS)) {
  check(panel.BACKGROUND_GRADIENT_PRESETS.length, 8, 'Seven gradients and Custom are available');
  check(panel.BACKGROUND_GRADIENT_PRESETS.at(-1)?.custom, true, 'Custom is the final gradient choice');
}

if (failures.length) {
  console.error(`Background panel verification failed:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('Background panel state verification passed.');
