#!/usr/bin/env node

require('sucrase/register');

const { exportSettings } = require('../lib/exportVideo');

const failures = [];
function check(actual, expected, message) {
  if (actual !== expected) failures.push(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const webm = exportSettings('webm', 30, 1920, 1080);
check(webm.frameExtension, 'png', 'WebM frames retain alpha as PNG');
check(webm.pattern, 'frame_%05d.png', 'WebM input pattern selects PNG frames');
check(webm.outputExtension, 'webm', 'WebM output extension');
check(webm.args.includes('libvpx-vp9'), true, 'WebM uses VP9');
check(webm.args.includes('yuva420p'), true, 'WebM keeps an alpha pixel format');
check(webm.args.includes('alpha_mode=1'), true, 'WebM marks the stream as carrying alpha');

const mp4 = exportSettings('mp4', 30, 1920, 1080);
check(mp4.frameExtension, 'jpg', 'MP4 continues to use JPEG frames');
check(mp4.outputExtension, 'mp4', 'MP4 output extension');

if (failures.length) {
  console.error(`WebM export verification failed:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('WebM export verification passed.');
