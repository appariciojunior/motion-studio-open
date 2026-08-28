// Compare OUR 21 Orbit presets against the reference's, render against render.
//
// The earlier field audit checked our values against my own conversion table,
// which is circular: if a conversion is wrong, it reports "matches". This
// measures what each tool actually draws and ranks the disagreements, so a
// preset that is wrong for a reason I have not thought of still shows up.
//
// Both sides are normalised to the 4:5 STAGE, not the canvas — the reference
// letterboxes its stage inside a 1600x1600 element, and comparing raw canvases
// makes every one of its presets look smaller than ours.
//
// Usage: node scripts/_compare_orbit.cjs        (needs our dev server up)
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const OUT = path.join(__dirname, '..', '.shots');
const OURS_URL = process.env.MS_URL || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMES = [
  'Pure 01', 'Pure 02', 'Pure 03', 'Pure 04', 'Pure 05', 'Pure 06',
  'Carousel 01', 'Carousel 02', 'Carousel 03', 'Carousel 04', 'Carousel 05',
  'Lightroom 01', 'Lightroom 02', 'Lightroom 03', 'Lightroom 04', 'Lightroom 05',
  'Bloom 01', 'Bloom 02', 'Bloom 03', 'Bloom 04', 'Bloom 05',
];
const IDS = NAMES.map((_, i) => 'orbit-3d-' + String(i + 4).padStart(2, '0'));

// Shape statistics of whatever is drawn, on a stage-normalised grid. Reported
// as fractions of the stage so the two tools' different pixel sizes cancel.
const STATS = `(canvas, cropToFourFive) => {
  const G = 160;
  const buf = document.createElement('canvas');
  buf.width = G; buf.height = G;
  const g = buf.getContext('2d', { willReadFrequently: true });
  const img = new Image();
  return new Promise(async (resolve) => {
    img.src = canvas.toDataURL('image/png');
    await img.decode();
    // The reference letterboxes a 4:5 stage inside a square canvas.
    const sw = cropToFourFive ? canvas.height * 0.8 : canvas.width;
    const sx = cropToFourFive ? (canvas.width - sw) / 2 : 0;
    g.drawImage(img, sx, 0, sw, canvas.height, 0, 0, G, G);
    const d = g.getImageData(0, 0, G, G).data;
    const bg = [d[0], d[1], d[2]];
    let minX = G, maxX = -1, minY = G, maxY = -1, lit = 0, sx2 = 0, sy2 = 0;
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const p = (y * G + x) * 4;
      if (Math.abs(d[p]-bg[0]) + Math.abs(d[p+1]-bg[1]) + Math.abs(d[p+2]-bg[2]) < 28) continue;
      lit++; sx2 += x; sy2 += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (lit === 0) return resolve(null);
    resolve({
      w: +((maxX - minX + 1) / G).toFixed(3),
      h: +((maxY - minY + 1) / G).toFixed(3),
      coverage: +(lit / (G * G)).toFixed(4),
      cx: +((sx2 / lit) / G).toFixed(3),
      cy: +((sy2 / lit) / G).toFixed(3),
    });
  });
}`;

async function launch() {
  return puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 300000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
}

async function reference() {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto('https://movo.video/', { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);
  const out = await page.evaluate(async (names, statsSrc) => {
    const stats = eval('(' + statsSrc + ')');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const explorerOpen = () => !!btnBy(/^Cancel$/);
    const stage = () => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const res = {};
    for (const name of names) {
      if (!explorerOpen()) { btnBy(/^Explore \d+ Templates$/).click(); await wait(900); }
      if (!byText(name)) { const f = byText('Orbit'); if (f) (f.closest('button') || f.parentElement).click(); await wait(900); }
      const item = byText(name);
      if (!item) { res[name] = null; continue; }
      (item.closest('button') || item.parentElement).click();
      await wait(4200);
      res[name] = await stats(stage(), true);
    }
    return res;
  }, NAMES, STATS);
  await browser.close();
  return out;
}

async function ours() {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(OURS_URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(4000);
  const out = await page.evaluate(async (ids, names, statsSrc) => {
    const stats = eval('(' + statsSrc + ')');
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const settle = async (n) => { for (let i = 0; i < n; i++) await raf(); };
    const setInput = (el, value) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const select = document.querySelector('select');
    const res = {};
    for (let i = 0; i < ids.length; i++) {
      setInput(select, ids[i]);
      await settle(10);
      const scrub = document.querySelector('.scrubber input[type=range]');
      if (scrub) { setInput(scrub, 0); await settle(8); }
      res[names[i]] = await stats(document.querySelector('canvas.stage-canvas'), false);
    }
    return res;
  }, IDS, NAMES, STATS);
  await browser.close();
  return out;
}

(async () => {
  const [ref, mine] = [await reference(), await ours()];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'orbit-compare.json'), JSON.stringify({ ref, mine }, null, 1));

  const rows = [];
  for (const name of NAMES) {
    const a = ref[name], b = mine[name];
    if (!a || !b) { rows.push({ name, note: !a ? 'referencia nao capturada' : 'nosso nao capturado', score: 99 }); continue; }
    // Size disagreement as a ratio, position as absolute stage fractions.
    const wR = b.w / a.w, hR = b.h / a.h;
    const score = Math.abs(Math.log(wR)) + Math.abs(Math.log(hR))
      + Math.abs(b.cx - a.cx) * 3 + Math.abs(b.cy - a.cy) * 3;
    rows.push({ name, a, b, wR, hR, score });
  }
  rows.sort((x, y) => y.score - x.score);
  console.log('| preset | ref w x h | nosso w x h | largura | altura | centro dy | desvio |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    if (r.note) { console.log(`| ${r.name} | ${r.note} | | | | | |`); continue; }
    console.log(`| ${r.name} | ${r.a.w} x ${r.a.h} | ${r.b.w} x ${r.b.h} | ${r.wR.toFixed(2)}x | ${r.hR.toFixed(2)}x | ${(r.b.cy - r.a.cy).toFixed(2)} | ${r.score.toFixed(2)} |`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
