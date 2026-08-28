#!/usr/bin/env node
// Measures, in a real Chrome, what one export frame costs for a card <video>
// under three strategies, so the fix is chosen on numbers instead of on the
// comment that says seeking is slow.
//
//   play   — current path: resume playback, wait for a presented frame >= target
//   seek   — exact seek to target, wait for 'seeked' + a presented frame
//   both are run against the source file AND against an all-intra proxy.

const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const URL_BASE = process.env.MS_URL || 'http://localhost:3000';
const FRAMES = Number(process.env.MS_N || 60);
const FPS = 30;

const CHROME = [
  process.env.MS_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });

    for (const file of (process.env.MS_FILES || 'longgop.mp4,heavy1080.mp4').split(',')) {
      // Build the all-intra proxy through the app's own route, exactly as
      // lib/videoTexture.ts:useVideoProxies would.
      const proxy = await page.evaluate(async (src) => {
        const blob = await (await fetch(src)).blob();
        const res = await fetch('/api/export', { method: 'PUT', body: blob });
        if (!res.ok) return null;
        return (await res.json()).url;
      }, `/_vtest/${file}`);

      for (const [label, url] of [['source', `/_vtest/${file}`], ['proxy ', proxy]]) {
        if (!url) { console.log(`${file} ${label}: proxy build failed`); continue; }
        const r = await page.evaluate(async (u, n, fps, isProxy) => {
          const v = document.createElement('video');
          v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = u;
          await new Promise((res, rej) => {
            v.addEventListener('loadeddata', res, { once: true });
            v.addEventListener('error', rej, { once: true });
          });
          const rvfc = (el) => new Promise((res) => el.requestVideoFrameCallback((_n, m) => res(m.mediaTime)));

          const exact = async (t) => {
            v.pause();
            const p = rvfc(v);
            v.currentTime = t;
            await new Promise((res) => v.addEventListener('seeked', res, { once: true }));
            return p;
          };
          const play = async (t, prev) => {
            const tol = 0.5 / fps;
            if (v.currentTime + tol >= t) return v.currentTime;
            return new Promise((res) => {
              const step = (_n, m) => {
                if (m.mediaTime + tol >= t) { v.pause(); res(m.mediaTime); }
                else v.requestVideoFrameCallback(step);
              };
              v.requestVideoFrameCallback(step);
              v.play().catch(() => res(v.currentTime));
            });
          };

          const out = {};
          for (const mode of ['exact', 'play']) {
            v.pause(); v.loop = false; v.currentTime = 0;
            await new Promise((res) => v.addEventListener('seeked', res, { once: true }));
            const got = [];
            const t0 = performance.now();
            for (let f = 0; f < n; f++) {
              const target = (f / fps) % v.duration;
              got.push(mode === 'exact' ? await exact(target) : await play(target));
            }
            const ms = performance.now() - t0;
            const distinct = new Set(got.map((x) => Math.round(x * 1000))).size;
            out[mode] = { msPerFrame: +(ms / n).toFixed(1), distinct, n };
          }
          out.dims = `${v.videoWidth}x${v.videoHeight}`;
          out.isProxy = isProxy;
          return out;
        }, url, FRAMES, FPS, label.trim() === 'proxy');
        console.log(`${file.padEnd(16)} ${label}  ${r.dims.padEnd(10)}` +
          `  exact: ${String(r.exact.msPerFrame).padStart(6)} ms/frame, ${r.exact.distinct}/${r.exact.n} distinct` +
          `   |   play: ${String(r.play.msPerFrame).padStart(6)} ms/frame, ${r.play.distinct}/${r.play.n} distinct`);
      }
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
