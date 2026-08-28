#!/usr/bin/env node
// Replays the proxy swap step by step in a real Chrome and times each await,
// so a hang in "Preparing videos…" points at one line instead of a phase.

const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const URL_BASE = process.env.MS_URL || 'http://localhost:3000';
const FILES = (process.env.MS_FILES || 'longgop.mp4,short.mp4,vp9.webm').split(',');
const CHROME = [
  process.env.MS_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean).find((p) => fs.existsSync(p));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => console.log('  [page]', m.text()));
    await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });

    const out = await page.evaluate(async (files) => {
      const log = [];
      const mark = async (label, p, capMs = 20_000) => {
        const t0 = performance.now();
        let timedOut = false;
        const res = await Promise.race([p, new Promise((r) => setTimeout(() => { timedOut = true; r('TIMEOUT'); }, capMs))]);
        log.push(`${label}: ${(performance.now() - t0).toFixed(0)} ms${timedOut ? '  <-- HUNG' : ''}`);
        return res;
      };

      // A card <video> exactly as lib/videoTexture.ts:createCardVideo builds it.
      const makeCard = (url) => {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.loop = true; v.muted = true; v.defaultMuted = true;
        v.playsInline = true; v.autoplay = true; v.preload = 'auto';
        v.src = url;
        return v;
      };
      const whenReady = (v) => new Promise((resolve, reject) => {
        if (v.readyState >= 2 && v.videoWidth) return resolve(v);
        const ok = () => { cleanup(); resolve(v); };
        const bad = () => { cleanup(); reject(new Error('video load failed')); };
        const cleanup = () => { v.removeEventListener('loadeddata', ok); v.removeEventListener('error', bad); };
        v.addEventListener('loadeddata', ok, { once: true });
        v.addEventListener('error', bad, { once: true });
      });

      for (const f of files) {
        const blob = await (await fetch(`/_vtest/${f}`)).blob();
        const blobUrl = URL.createObjectURL(blob);
        const v = makeCard(blobUrl);
        await mark(`${f} initial load`, whenReady(v));
        v.play().catch(() => {});

        const res = await fetch('/api/export', { method: 'PUT', body: blob });
        const { url: proxyUrl } = await res.json();

        // ---- the swap, as useVideoProxies performs it ----
        v.pause();
        v.dataset.motionIntraProxy = '1';
        const before = { rs: v.readyState, vw: v.videoWidth };
        v.src = proxyUrl;
        const after = { rs: v.readyState, vw: v.videoWidth };
        log.push(`${f} readyState before src= ${before.rs}/${before.vw}, right after= ${after.rs}/${after.vw}`);
        await mark(`${f} whenVideoReady(proxy)`, whenReady(v).catch(() => 'ERR'));
        log.push(`${f} after swap: rs=${v.readyState} dur=${v.duration} ${v.videoWidth}x${v.videoHeight} err=${v.error && v.error.code}`);

        // ---- one exact seek, the new per-frame cost ----
        const seekOnce = (t) => new Promise((resolve) => {
          let done = false;
          const fin = () => { if (!done) { done = true; resolve(); } };
          v.addEventListener('seeked', fin, { once: true });
          if (v.fastSeek) v.fastSeek(t); else v.currentTime = t;
        });
        await mark(`${f} exact seek to 1.0`, seekOnce(1.0), 10_000);
        // and the rVFC the current helper additionally waits for
        await mark(`${f} rVFC after seek (paused)`, new Promise((r) => {
          if (!v.requestVideoFrameCallback) return r('no rVFC');
          v.requestVideoFrameCallback(() => r('fired'));
        }), 5_000);
      }
      return log;
    }, FILES);
    out.forEach((l) => console.log(l));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
