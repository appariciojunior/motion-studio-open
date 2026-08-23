// List every JS chunk the reference loads once a family is actually open, so
// its own maths can be READ instead of measured.
//
// This is the cheapest probe in this folder and it should be the first one run
// for any new family. The reference is a Next.js app: its per-family module —
// preset table, computeFrame, camera, easing — sits in a chunk that is only
// requested when a template from that family is selected, so fetching the HTML
// alone finds nothing. Driving the explorer once and recording the requests
// yields the file that contains the answer.
//
// What came out of it for Spinner: SPINNER_PLANE_SIZE, applySpinnerCamera,
// computeFrame, steppedSpinAngle, computeViewFades and all fourteen authored
// presets — none of which is deducible from screenshots, and one of which
// (the camera) had already survived a pixel sweep while being wrong.
//
// Usage: MS_REF_URL=<url> MS_OUT=<dir> [MS_FAMILY=Orbit MS_PRESET='Pure 01'] node scripts/_chunks_ref.cjs
//   then: while read u; do curl -s "$u" -o "chunks/$(basename ${u%%\?*})"; done < chunk-urls.txt
//         grep -l spinner chunks/*.js
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const OUT = process.env.MS_OUT || __dirname;
// Parameterized so the same probe serves every family: the accordion label and
// the preset clicked are the only things that change.
const FAMILY = process.env.MS_FAMILY || 'Spinner';
const PRESET = process.env.MS_PRESET || 'Spinner 01';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The reference editor's URL is deliberately NOT committed: point this probe at
// it with MS_REF_URL. Nothing the app ships reads it — these dev probes are its
// only readers, and the comparison they do is local.
const REF_URL = process.env.MS_REF_URL;
function refUrl() {
  if (!REF_URL) throw new Error('set MS_REF_URL to the reference editor to compare against');
  return REF_URL;
}


(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 300000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  const urls = new Set();
  page.on('request', (r) => { const u = r.url(); if (/\.js(\?|$)/.test(u)) urls.add(u); });
  await page.goto(refUrl(), { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);
  // Open the explorer, expand Spinner, select Spinner 01 so its chunk loads.
  const step = await page.evaluate(async ({ FAMILY, PRESET }) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && (n.textContent||'').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent||'').trim()));
    const log = [];
    const open = btnBy(/^Explore \d+ Templates$/);
    if (!open) return { error: 'no explore button', log };
    open.click(); await wait(1500);
    log.push('explorer opened');
    if (!byText(PRESET)) {
      const fam = byText(FAMILY);
      if (!fam) return { error: 'no family ' + FAMILY, log };
      (fam.closest('button') || fam.parentElement).click(); await wait(2000);
      log.push(FAMILY + ' family expanded');
    }
    const names = [...document.querySelectorAll('*')].filter(n => n.children.length===0 && /^([A-Z][A-Za-z]+( [A-Za-z]+)?)\s*\d+$/.test((n.textContent||'').trim())).map(n=>n.textContent.trim());
    const item = byText(PRESET);
    if (item) { (item.closest('button') || item.parentElement).click(); await wait(5000); log.push(PRESET + ' selected'); } else log.push(PRESET + ' NOT FOUND');
    return { log, names: [...new Set(names)] };
  }, { FAMILY, PRESET });
  console.log(JSON.stringify(step, null, 1));
  await sleep(3000);
  const list = [...urls];
  fs.writeFileSync(path.join(OUT, 'chunk-urls.txt'), list.join('\n'));
  console.log('js urls:', list.length);
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
