// What is the reference's stage canvas, exactly?
//
// Written because a photograph of its stage disagreed with its own scene graph:
// the camera reproduced to four decimals while the drum photographed about 2.5x
// bigger than that camera can account for. Either the canvas is not the size it
// looks, or there is more than one — and "the largest canvas on the page" (what
// every earlier probe picked) is not necessarily the stage.
//
// Usage: node scripts/_canvas_orbit.cjs "Pure 01"
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');

const OUT = process.env.MS_OUT || path.join(__dirname, '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The reference editor's URL is deliberately NOT committed: point this probe at
// it with MS_REF_URL. Nothing the app ships reads it — these dev probes are its
// only readers, and the comparison they do is local.
const REF_URL = process.env.MS_REF_URL;
function refUrl() {
  if (!REF_URL) throw new Error('set MS_REF_URL to the reference editor to compare against');
  return REF_URL;
}


async function main() {
  const name = process.argv[2] || 'Pure 01';
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 900000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  // The viewport is a variable here on purpose: whether the stage canvas is a
  // fixed square or one sized to the window decides whether the artboard's crop
  // of it is part of the composition or an accident of the browser size.
  await page.setViewport({
    width: Number(process.env.MS_VW || 1600),
    height: Number(process.env.MS_VH || 1000),
    deviceScaleFactor: 1,
  });
  await page.goto(refUrl(), { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);

  const info = await page.evaluate(async (wanted) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    if (!btnBy(/^Cancel$/)) { const b = btnBy(/^Explore \d+ Templates$/); if (b) b.click(); await wait(1200); }
    if (!byText(wanted)) { const fam = byText('Orbit'); if (fam) (fam.closest('button') || fam.parentElement).click(); await wait(1500); }
    const item = byText(wanted);
    if (!item) return { error: wanted + ' not listed' };
    (item.closest('button') || item.parentElement).click();
    await wait(6000);
    // Commit the preset, so what is measured is the real stage and not the
    // explorer's preview — "Use this template" is the button that does it.
    const use = btnBy(/^Use this template$/);
    if (use) { use.click(); await wait(6000); }
    return {
      dpr: window.devicePixelRatio,
      canvases: [...document.querySelectorAll('canvas')].map((c) => {
        const r = c.getBoundingClientRect();
        const st = getComputedStyle(c);
        return {
          drawing: [c.width, c.height],
          css: [+r.width.toFixed(1), +r.height.toFixed(1)],
          at: [+r.x.toFixed(1), +r.y.toFixed(1)],
          transform: st.transform,
          parentTransform: c.parentElement ? getComputedStyle(c.parentElement).transform : null,
          // Any ancestor scale would magnify the render without touching the camera.
          chain: (() => {
            const out = [];
            for (let e = c.parentElement, i = 0; e && i < 6; e = e.parentElement, i++) {
              const s = getComputedStyle(e);
              const b = e.getBoundingClientRect();
              out.push({ tag: e.tagName + (e.className && typeof e.className === 'string' ? '.' + e.className.split(/\s+/)[0] : ''), t: s.transform, box: [+b.width.toFixed(1), +b.height.toFixed(1)], zoom: s.zoom });
            }
            return out;
          })(),
        };
      }),
    };
  }, name);
  if (info.error) { console.log(JSON.stringify(info)); await browser.close(); return; }
  const stage = info.canvases[0];
  const artboard = stage.chain[0].box;
  console.log('canvas', stage.drawing.join('x'), 'css', stage.css.join('x'), '| artboard', artboard.join('x'),
    '| the artboard shows', (artboard[1] / stage.css[1]).toFixed(4), 'of the canvas height');
  fs.mkdirSync(OUT, { recursive: true });
  const handle = (await page.$$('canvas'))[0];
  const file = path.join(OUT, 'ref-orbit-canvas-' + name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() + '.png');
  // omitBackground keeps the alpha channel, and their stage renders onto a
  // transparent clear colour — so alpha is a perfect mask. A luminance
  // threshold is not: their cards are photographs, some of them nearly black.
  await handle.screenshot({ path: file, omitBackground: true });
  const { data, info: raw } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = raw.width, x1 = -1, y0 = raw.height, y1 = -1, lit = 0;
  for (let y = 0; y < raw.height; y++) {
    for (let x = 0; x < raw.width; x++) {
      if (data[(y * raw.width + x) * raw.channels + 3] < 40) continue;
      lit++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  console.log('drawn box', w + 'x' + h, '| of the CANVAS height', (h / raw.height).toFixed(4),
    '| of the ARTBOARD height', (h / (artboard[1] * (raw.height / stage.css[1]))).toFixed(4),
    '| coverage', (lit / (raw.width * raw.height)).toFixed(4), '->', file);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
