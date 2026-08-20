// Photograph the reference's Orbit stage — through puppeteer's own screenshot
// rather than canvas.toDataURL.
//
// This exists because the toDataURL route LIES on their stage. Their WebGL
// context is created without preserveDrawingBuffer, so reading the canvas from
// script outside the drawing frame returns a cleared buffer: two presets
// (Lightroom 05 and 07) measured as "nothing rendered at all" while two others
// captured in the same session came back correctly. A composited page
// screenshot has no such race, and it is the only capture that can be trusted
// to answer "does the reference draw anything here".
//
// Usage: [MS_FAMILY=Wheel] node scripts/_shot_orbit.cjs "Lightroom 05" "Arc 01"
//
// MS_FAMILY is the accordion to expand. The Arc presets are NOT in the Orbit
// family — the reference files them under Wheel — so shooting them needs it.
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

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
  const wanted = process.argv.slice(2);
  if (!wanted.length) throw new Error('pass one or more template names');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 900000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(refUrl(), { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);
  fs.mkdirSync(OUT, { recursive: true });

  const family = process.env.MS_FAMILY || 'Orbit';
  for (const name of wanted) {
    const step = await page.evaluate(async ({ wantedName, family }) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const byText = (t) => [...document.querySelectorAll('*')]
        .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
      const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
      // "Explore N Templates" is a TOGGLE and the family list is an accordion,
      // so clicking blind undoes the previous step. Read the state instead:
      // the Cancel button only exists while the explorer is open.
      if (!btnBy(/^Cancel$/)) { const b = btnBy(/^Explore \d+ Templates$/); if (b) b.click(); await wait(1200); }
      if (!byText(wantedName)) { const fam = byText(family); if (fam) (fam.closest('button') || fam.parentElement).click(); await wait(1500); }
      const item = byText(wantedName);
      if (!item) return { error: wantedName + ' not listed' };
      (item.closest('button') || item.parentElement).click();
      await wait(6000);
      // Read the panel back by LABEL, never by input position: the set of rows
      // changes per preset, so a positional read silently reports another
      // control's value and two presets measuring the same is exactly what a
      // no-op click looks like.
      const panel = {};
      for (const label of ['Count', 'Gap', 'Diameter', 'Zoom', 'Perspective', 'Backface', 'Frontface', 'Flip', 'Surface', 'Face']) {
        const node = byText(label);
        const row = node && node.closest('div') && node.closest('div').parentElement;
        const input = row && row.querySelector('input');
        panel[label] = input ? input.value : (row ? (row.textContent || '').replace(label, '').trim() : null);
      }
      // Photograph the ARTBOARD, not the canvas. Its stage canvas is a square
      // sized to the browser window and the artboard is a much smaller CSS
      // window onto the middle of it (scripts/_canvas_orbit.cjs) — the artboard
      // is the frame the viewer gets, and shooting the canvas instead puts the
      // whole editor in the picture.
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const board = c.parentElement;
      const r = board.getBoundingClientRect();
      return { panel, box: { x: r.x, y: r.y, width: r.width, height: r.height } };
    }, { wantedName: name, family });
    if (step.error) { console.log(name, 'ERROR', step.error); continue; }
    const tag = name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    const file = path.join(OUT, 'ref-stage-' + tag + '.png');
    await page.screenshot({ path: file, clip: step.box });
    console.log(name, JSON.stringify(step.panel), '->', file);
  }
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
