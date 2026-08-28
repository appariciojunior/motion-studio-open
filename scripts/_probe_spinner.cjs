// Measure MOVO's SPINNER stage numerically: the swept silhouette of the drawn
// content, in fractions of the stage canvas, plus a jpg of one frame.
//
// Two things this had to learn the hard way:
//
//  · Measure the ALPHA channel, not colour. The stage renders on a transparent
//    background, so alpha is a perfect mask while colour is not: a dark card on
//    a dark background reads as background, and that alone made Fan 03's
//    envelope come back a third of its real width — small enough to look like a
//    porting error rather than a measurement one.
//  · Take the union over several samples. A single frame is comparable to
//    nothing, because the phase at capture time is unknown; the union over one
//    symmetry period (loopDuration / count) is the envelope of the whole
//    revolution, which a model of the extracted math can predict exactly.
//
// Even so, an envelope UNDER-reports: a card passing edge-on rasterizes to
// almost nothing, and those are exactly the cards a wrong camera would blow up.
// For camera and pose fidelity, read the scene graph (scripts/_scene_spinner.cjs).
//
// Usage: node scripts/_probe_spinner.cjs "Spinner 01" "Hinge 01"
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const OUT = process.env.MS_OUT || path.join(__dirname, '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv.slice(2);
  if (!wanted.length) throw new Error('pass template names');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 600000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto('https://movo.video/', { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);

  const result = await page.evaluate(async (names, samples) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const explorerOpen = () => !!btnBy(/^Cancel$/);
    const stage = () => [...document.querySelectorAll('canvas')]
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];

    const out = [];
    for (const name of names) {
      if (!explorerOpen()) { const b = btnBy(/^Explore \d+ Templates$/); if (b) b.click(); await wait(1200); }
      if (!byText(name)) { const fam = byText('Spinner'); if (fam) (fam.closest('button') || fam.parentElement).click(); await wait(1500); }
      const item = byText(name);
      if (!item) { out.push({ name, error: 'not listed' }); continue; }
      (item.closest('button') || item.parentElement).click();
      await wait(4500);
      const c = stage();
      if (!c) { out.push({ name, error: 'no stage' }); continue; }

      // Prove the stage really switched: two presets measuring identically is
      // exactly what a silent no-op looks like, and clicking a name is not
      // proof it loaded. Read the panel by LABEL — the row set changes per
      // preset, so an index means a different control on a different template.
      const panel = {};
      for (const label of document.querySelectorAll('.ed-type-section')) {
        const row = label.parentElement; if (!row) continue;
        const input = row.querySelector('input');
        const opts = [...row.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean);
        panel[label.textContent.trim()] = input ? input.value : opts.join('/');
      }

      const W = 300, H = 300;
      let minX = W, maxX = -1, minY = H, maxY = -1, cov = 0, shot = null;
      for (let s = 0; s < samples; s++) {
        const buf = document.createElement('canvas');
        buf.width = W; buf.height = H;
        const g = buf.getContext('2d', { willReadFrequently: true });
        const img = new Image();
        // toDataURL, not a direct read: re-reading a WebGL canvas hands back a
        // stale buffer, which has already made a spinning ring measure as still.
        img.src = c.toDataURL('image/png');
        await img.decode();
        g.clearRect(0, 0, W, H);
        g.drawImage(img, 0, 0, W, H);
        const d = g.getImageData(0, 0, W, H).data;
        if (s === 0) shot = c.toDataURL('image/jpeg', 0.9);
        let lit = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (d[(y * W + x) * 4 + 3] < 40) continue;   // alpha mask
          lit++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        cov = Math.max(cov, lit / (W * H));
        if (s < samples - 1) await wait(430);
      }
      out.push({
        name, stageW: c.width, stageH: c.height,
        x0: +(minX / W).toFixed(4), x1: +((maxX + 1) / W).toFixed(4),
        y0: +(minY / H).toFixed(4), y1: +((maxY + 1) / H).toFixed(4),
        coverage: +cov.toFixed(4), panel, shot,
      });
    }
    return out;
  }, wanted, Number(process.env.MS_SAMPLES || 7));

  for (const r of result) {
    if (r.error) { console.log(r.name + ': ' + r.error); continue; }
    const file = path.join(OUT, 'movo-spinner-' + r.name.replace(/\s+/g, '-').toLowerCase() + '.jpg');
    if (r.shot) fs.writeFileSync(file, Buffer.from(r.shot.split(',')[1], 'base64'));
    delete r.shot;
    const panel = r.panel; delete r.panel;
    console.log(JSON.stringify(r));
    console.log('  painel: ' + Object.entries(panel).map(([k, v]) => k + '=' + v).join(' '));
  }
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
