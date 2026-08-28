#!/usr/bin/env node
// Measures the width profile of the folding card, row by row, in both renders.
// A perspective fold tapers (far edge narrower); an affine one cannot.
const fs = require('node:fs'), path = require('node:path');
const puppeteer = require('puppeteer-core');
const CH = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
const chrome = CH.find(p => fs.existsSync(p));
const b64 = p => 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64');

const SCRATCH = process.env.MS_SCRATCH;
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const targets = [
    { name: 'arqé  f147', src: b64(path.join(SCRATCH, 'arqe-f147.jpg')), scale: 0.75 },
    { name: 'nosso f147', src: b64(path.join(ROOT, '.shots', 'ours-f147.jpg')), scale: 1 },
    { name: 'arqé  f153', src: b64(path.join(SCRATCH, 'arqe-f153.jpg')), scale: 0.75, last: true },
    { name: 'nosso f153', src: b64(path.join(ROOT, '.shots', 'ours-f153.jpg')), scale: 1, last: true },
  ];
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const rows = await page.evaluate(async (targets) => {
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const out = [];
    for (const t of targets) {
      const img = await load(t.src);
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const c = cv.getContext('2d', { willReadFrequently: true });
      c.drawImage(img, 0, 0);
      const W = cv.width, H = cv.height;
      const d = c.getImageData(0, 0, W, H).data;
      // key against the backdrop (#0d0d0d on both), generous for jpeg noise
      const widths = [];
      for (let y = 0; y < H; y++) {
        let a = -1, b = -1;
        const r = y * W * 4;
        for (let x = 0; x < W; x++) {
          const i = r + x * 4;
          if (Math.abs(d[i] - 13) > 12 || Math.abs(d[i + 1] - 13) > 12 || Math.abs(d[i + 2] - 13) > 12) {
            if (a < 0) a = x; b = x;
          }
        }
        widths.push(b < 0 ? 0 : b - a + 1);
      }
      // bands
      const bands = []; let s = -1;
      for (let y = 0; y <= H; y++) {
        const on = y < H && widths[y] > 0;
        if (on && s < 0) s = y;
        if (!on && s >= 0) { bands.push([s, y - 1]); s = -1; }
      }
      const band = t.last ? bands[bands.length - 1] : bands[0];
      const [y0, y1] = band;
      const h = y1 - y0 + 1;
      // sample the width at 10%..90% of the band so jpeg-soft edges don't skew it
      const at = (p) => widths[Math.round(y0 + p * (y1 - y0))] * t.scale;
      out.push({
        name: t.name,
        bandH: +(h * t.scale).toFixed(1),
        w10: +at(0.1).toFixed(1), w50: +at(0.5).toFixed(1), w90: +at(0.9).toFixed(1),
      });
    }
    return out;
  }, targets);

  console.log('largura do cartao em dobra, medida linha a linha (px no palco de 810)\n');
  console.log('render     | altura | 10% da altura | meio  | 90%   | afunilamento');
  console.log('-----------|--------|---------------|-------|-------|-------------');
  for (const r of rows) {
    const lo = Math.min(r.w10, r.w90), hi = Math.max(r.w10, r.w90);
    const taper = hi > 0 ? (100 * (1 - lo / hi)) : 0;
    console.log(`${r.name.padEnd(10)} | ${String(r.bandH).padStart(6)} | ${String(r.w10).padStart(13)} | ${String(r.w50).padStart(5)} | ${String(r.w90).padStart(5)} | ${taper.toFixed(1)}%`);
  }
  await browser.close();
})();
