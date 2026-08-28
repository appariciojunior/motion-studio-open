#!/usr/bin/env node
// ============================================================
//  A/B — measure our Flip's rendered geometry the same way arqe's was measured
//
//  Both apps run 30fps / 360 frames / 3:4, so frame numbers correspond 1:1 and
//  arqe's 1080x1440 maps onto our 810x1080 by a flat 0.75.
//
//  The two apps use different demo artwork, so diffing content pixels is
//  meaningless. Instead both sides get a flat magenta background and the card
//  SILHOUETTES are segmented out of the real rendered pixels — geometry only,
//  content-independent, and measured through the whole render pipeline rather
//  than from the transform function.
// ============================================================
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const URL = process.env.MS_URL || 'http://localhost:3000';
const TEMPLATE = process.argv[2] || 'flip-01';
const FRAMES = (process.argv[3] || '120,135,147,150,153,165,180').split(',').map(Number);

const CHROME_CANDIDATES = [
  process.env.MS_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);
const findChrome = () => {
  for (const p of CHROME_CANDIDATES) if (p && fs.existsSync(p)) return p;
  throw new Error('Chrome not found. Set MS_CHROME.');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('  [page error]', e.message));
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 });

    // first-run dialog
    const box = await page.$('input[type=checkbox]');
    if (box) {
      await box.click(); await sleep(150);
      for (const b of await page.$$('button')) {
        const t = (await page.evaluate((el) => (el.textContent || '').trim(), b)) || '';
        if (/library|agree|continue|start/i.test(t) && t.length < 40) { await b.click(); break; }
      }
      await sleep(500);
    }
    await page.waitForSelector('canvas.stage-canvas', { timeout: 30_000 });
    await page.waitForSelector('.scrubber input[type=range]', { timeout: 30_000 });

    const result = await page.evaluate(async (id, frames) => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const settle = async (n = 4) => { for (let i = 0; i < n; i++) await raf(); };
      const setInput = (el, value) => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const select = document.querySelector('select');
      setInput(select, id);
      await settle(8);

      const report = {};

      const canvas = document.querySelector('canvas.stage-canvas');
      const scrub = document.querySelector('.scrubber input[type=range]');
      const total = Number(scrub.max) + 1;
      report.total = total;
      report.canvas = [canvas.width, canvas.height];

      const off = document.createElement('canvas');
      off.width = canvas.width; off.height = canvas.height;
      const octx = off.getContext('2d', { willReadFrequently: true });

      // No colour input exists to force a keying background, so key against the
      // stage's own flat backdrop, sampled from a corner. A stray backdrop-
      // coloured pixel inside a photo is harmless: a row only needs ONE non-
      // backdrop pixel to count, and only the row's extreme x values are used.
      let BG = [0, 0, 0];
      const segment = () => {
        octx.clearRect(0, 0, off.width, off.height);
        octx.drawImage(canvas, 0, 0);
        const W = off.width, H = off.height;
        const d = octx.getImageData(0, 0, W, H).data;
        const minX = new Int32Array(H).fill(W), maxX = new Int32Array(H).fill(-1);
        for (let y = 0; y < H; y++) {
          const r = y * W * 4;
          for (let x = 0; x < W; x++) {
            const i = r + x * 4;
            if (Math.abs(d[i] - BG[0]) > 4 || Math.abs(d[i + 1] - BG[1]) > 4 || Math.abs(d[i + 2] - BG[2]) > 4) {
              if (x < minX[y]) minX[y] = x;
              if (x > maxX[y]) maxX[y] = x;
            }
          }
        }
        const bands = []; let s = -1;
        for (let y = 0; y <= H; y++) {
          const on = y < H && maxX[y] >= 0;
          if (on && s < 0) s = y;
          if (!on && s >= 0) {
            let a = W, z = -1;
            for (let q = s; q < y; q++) { if (minX[q] < a) a = minX[q]; if (maxX[q] > z) z = maxX[q]; }
            bands.push([s, y - 1, a, z]); s = -1;
          }
        }
        return bands;
      };

      octx.drawImage(canvas, 0, 0);
      const px = octx.getImageData(2, 2, 1, 1).data;
      BG = [px[0], px[1], px[2]];
      report.backdrop = BG;
      // prove the backdrop really is flat before trusting it as a key
      const c2 = octx.getImageData(off.width - 3, off.height - 3, 1, 1).data;
      report.backdropFarCorner = [c2[0], c2[1], c2[2]];

      report.bands = {};
      for (const f of frames) {
        setInput(scrub, f);
        await settle(6);
        report.bands[f] = segment();
      }
      return report;
    }, TEMPLATE, FRAMES);

    console.log(JSON.stringify(result, null, 1));
    fs.writeFileSync(path.join(ROOT, '.shots', `_ab_${TEMPLATE}.json`), JSON.stringify(result));
  } finally {
    await browser.close();
  }
})();
