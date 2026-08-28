// Reference and ours, side by side, one pair per preset.
//
// Numbers localise a difference but do not explain it — a bounding-box ratio
// says "too wide" and not "the cards face the wrong way". This puts the two
// renders next to each other so the difference can just be seen.
//
// Usage: node scripts/_side_by_side.cjs        (needs our dev server up)
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
const ONLY = process.argv.slice(2);
const PICK = ONLY.length ? NAMES.map((n, i) => [n, IDS[i]]).filter(([n]) => ONLY.includes(n))
  : NAMES.map((n, i) => [n, IDS[i]]);

function launch() {
  return puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 300000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
}

async function reference(names) {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto('https://movo.video/', { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);
  const out = await page.evaluate(async (wanted) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const explorerOpen = () => !!btnBy(/^Cancel$/);
    const stage = () => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const res = {};
    for (const name of wanted) {
      if (!explorerOpen()) { btnBy(/^Explore \d+ Templates$/).click(); await wait(900); }
      if (!byText(name)) { const f = byText('Orbit'); if (f) (f.closest('button') || f.parentElement).click(); await wait(900); }
      const item = byText(name);
      if (!item) { res[name] = null; continue; }
      (item.closest('button') || item.parentElement).click();
      await wait(4200);
      const c = stage();
      // Crop the letterboxed 4:5 stage out of their square canvas so the pair
      // is framed the same way on both sides.
      const sw = c.height * 0.8, sx = (c.width - sw) / 2;
      const cut = document.createElement('canvas');
      cut.width = 640; cut.height = 800;
      cut.getContext('2d').drawImage(c, sx, 0, sw, c.height, 0, 0, 640, 800);
      res[name] = cut.toDataURL('image/jpeg', 0.85);
    }
    return res;
  }, names);
  await browser.close();
  return out;
}

async function ours(pairs) {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(OURS_URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(4000);
  const out = await page.evaluate(async (list) => {
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
    for (const [name, id] of list) {
      setInput(select, id);
      await settle(10);
      const scrub = document.querySelector('.scrubber input[type=range]');
      if (scrub) { setInput(scrub, 0); await settle(8); }
      const c = document.querySelector('canvas.stage-canvas');
      const cut = document.createElement('canvas');
      cut.width = 640; cut.height = 800;
      cut.getContext('2d').drawImage(c, 0, 0, c.width, c.height, 0, 0, 640, 800);
      res[name] = cut.toDataURL('image/jpeg', 0.85);
    }
    return res;
  }, pairs);
  await browser.close();
  return out;
}

(async () => {
  const names = PICK.map(([n]) => n);
  const ref = await reference(names);
  const mine = await ours(PICK);

  const browser = await launch();
  const page = await browser.newPage();
  const perRow = Number(process.env.MS_PER_ROW || 3);
  const cw = Number(process.env.MS_CW || 320), ch = Math.round(cw * 1.25), pad = 8, lab = 18;
  const rows = Math.ceil(names.length / perRow);
  const data = await page.evaluate(async (list, refMap, mineMap, cfg) => {
    const c = document.createElement('canvas');
    c.width = cfg.perRow * (cfg.cw * 2 + cfg.pad) + cfg.pad;
    c.height = cfg.rows * (cfg.ch + cfg.lab + cfg.pad) + cfg.pad;
    const g = c.getContext('2d');
    g.fillStyle = '#101014'; g.fillRect(0, 0, c.width, c.height);
    g.font = '13px ui-monospace, monospace';
    for (let i = 0; i < list.length; i++) {
      const x = cfg.pad + (i % cfg.perRow) * (cfg.cw * 2 + cfg.pad);
      const y = cfg.pad + Math.floor(i / cfg.perRow) * (cfg.ch + cfg.lab + cfg.pad);
      g.fillStyle = '#c8c8d0';
      g.fillText(list[i] + '   [ referencia | nosso ]', x, y + 13);
      for (const [k, src] of [[0, refMap[list[i]]], [1, mineMap[list[i]]]]) {
        if (!src) continue;
        const img = new Image();
        img.src = src;
        await img.decode();
        g.drawImage(img, x + k * cfg.cw, y + cfg.lab, cfg.cw, cfg.ch);
      }
      g.strokeStyle = '#3a3a44';
      g.strokeRect(x + cfg.cw, y + cfg.lab, 1, cfg.ch);
    }
    return c.toDataURL('image/jpeg', 0.86);
  }, names, ref, mine, { perRow, cw, ch, pad, lab, rows });

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'orbit-side-by-side.jpg');
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`${names.length} pares -> ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
