#!/usr/bin/env node

require('sucrase/register');

const { captureCanvasFrame, compositeAlpha, exportSettings, webmFfmpegArgs } = require('../lib/exportVideo');

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

const dataUrlCalls = [];
const fakeCanvas = { toDataURL: (...args) => { dataUrlCalls.push(args); return `data:${args[0]}`; } };
check(captureCanvasFrame(fakeCanvas, 'image/png'), 'data:image/png', 'PNG capture returns a PNG data URL');
check(dataUrlCalls[0].length, 1, 'PNG capture does not pass a lossy quality value');
check(captureCanvasFrame(fakeCanvas, 'image/jpeg'), 'data:image/jpeg', 'JPEG capture remains available');
check(dataUrlCalls[1][1], 0.92, 'JPEG capture retains its quality setting');

const webmWithAudio = webmFfmpegArgs(webm, 30, 'audio.input', 'motion.webm');
check(webmWithAudio.includes('audio.input'), true, 'WebM consumes the uploaded audio input');
check(webmWithAudio.includes('libopus'), true, 'WebM encodes audio with Opus');
check(webmWithAudio.includes('-shortest'), true, 'WebM stops at the shortest video/audio stream');

check(compositeAlpha(0, 0.5, 1), 0.5, 'compositing over transparency preserves layer alpha');
check(compositeAlpha(0.25, 0.5, 0.5), 0.4375, 'compositing combines base, layer, and track opacity');

const mp4 = exportSettings('mp4', 30, 1920, 1080);
check(mp4.frameExtension, 'jpg', 'MP4 continues to use JPEG frames');
check(mp4.outputExtension, 'mp4', 'MP4 output extension');

if (failures.length) {
  console.error(`WebM export verification failed:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('WebM export verification passed.');
