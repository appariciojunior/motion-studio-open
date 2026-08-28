#!/usr/bin/env node
// ============================================================
//  _probe_screen_orientation — is the screen content the right way up on EVERY
//  bundled device?
//
//  The bundled GLBs do not share one authored UV vertical direction, so the
//  compositor flips the screen texture per device (DeviceDef.screenTextureFlipY).
//  That flag is a claim about each mesh; this measures it.
//
//  Each device gets a test image whose orientation cannot be misread:
//    · red band + "TOPO" at the top, yellow band + "BASE" at the bottom
//      -> catches a vertical flip
//    · a large green "F", which has no symmetry at all
//      -> catches a horizontal mirror, which no flag would explain
//
//  Output: .shots/_orientation.jpg — one labelled cell per device. Read it.
//
//  Usage: node scripts/_probe_screen_orientation.cjs
//  Needs: dev server on MS_URL, public/demo/_orient/{phone,laptop,tablet,display}.png
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots');
const URL_BASE = process.env.MS_URL || 'http://localhost:3000';

const CHROME_CANDIDATES = [
  process.env.MS_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('Chrome not found. Set MS_CHROME to the executable path.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// label -> which slot image to load. Order matches the device picker.
const DEVICES = [
  { label: 'iPhone 17 Pro', slot: 'phone' },
  { label: 'iPhone Air', slot: 'phone' },
  { label: 'MacBook Pro 14', slot: 'laptop' },
  { label: 'iPad Pro', slot: 'tablet' },
  { label: 'iPad Air', slot: 'tablet' },
  { label: 'Pro Display XDR', slot: 'display' },
  { label: 'Studio Display', slot: 'display' },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'shell',
    protocolTimeout: 600_000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('  [page error]', e.message));

    await page.goto(URL_BASE + '/mockup', { waitUntil: 'networkidle2', timeout: 90_000 });
    await page.evaluate(() => {
      const bd = document.querySelector('.modal-backdrop.welcome-backdrop');
      if (bd) bd.style.display = 'none';   // hide only — never tick the consent box
    });
    await page.waitForSelector('.tpl-item', { timeout: 30_000 });

    const shots = [];
    for (const dev of DEVICES) {
      process.stdout.write(`${dev.label} … `);

      await page.evaluate((label) => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Devices');
        if (b) b.click();
        const it = [...document.querySelectorAll('.tpl-item')]
          .find((e) => e.textContent.replace(/\s+/g, ' ').includes(label));
        if (!it) throw new Error('device not in picker: ' + label);
        it.click();
      }, dev.label);

      // The GLB loads async; wait for the screen upload control to exist again.
      await page.waitForSelector('input[accept="image/*,video/*"]', { timeout: 30_000 });
      await sleep(1500);

      // Load this slot's orientation image (slots are shared, so re-upload each
      // time — cheap, and it removes any doubt about which asset is on screen).
      const bytes = await page.evaluate(async (slot) => {
        const buf = await (await fetch(`/demo/_orient/${slot}.png`)).arrayBuffer();
        const file = new File([buf], `${slot}.png`, { type: 'image/png' });
        const input = document.querySelector('input[accept="image/*,video/*"]');
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return buf.byteLength;
      }, dev.slot);
      // A missing target 404s into Next's HTML error page, which uploads
      // "successfully" and leaves the screen blank — and a blank screen reads as
      // a rendering regression rather than as a missing fixture. It cost one
      // full run here, so fail loudly instead.
      if (bytes < 5000) {
        throw new Error(
          `/demo/_orient/${dev.slot}.png ausente ou nao e imagem (${bytes} bytes).`
          + ' Regenere os 4 alvos de orientacao (phone/laptop/tablet/display) antes de rodar.',
        );
      }

      // Wait until the compositor has actually painted this image onto the
      // screen canvas — a fixed sleep here reads a stale texture on a cold app.
      await page.waitForFunction(
        () => {
          const c = document.querySelector('canvas.three3d-layer');
          return !!c && c.width > 0;
        },
        { timeout: 30_000, polling: 250 },
      );
      await sleep(2500);

      // Screenshot the ELEMENT, not canvas.toDataURL(): the mockup renderer is
      // created without preserveDrawingBuffer, so reading its pixels outside the
      // render tick returns an empty buffer — measured, a fully black sheet.
      // Chrome's own capture reads the composited frame and has no such problem.
      const el = await page.$('canvas.three3d-layer');
      if (!el) throw new Error('stage canvas not found');
      const buf = await el.screenshot({ type: 'jpeg', quality: 92 });
      const cell = path.join(OUT_DIR, 'orient', `${String(shots.length).padStart(2, '0')}.jpg`);
      fs.mkdirSync(path.dirname(cell), { recursive: true });
      fs.writeFileSync(cell, buf);
      shots.push({ label: dev.label, file: cell });
      // A black capture means the probe measured nothing — say so here rather
      // than letting it read as "this device is fine".
      const dark = buf.length < 3000;
      console.log(`captured (${(buf.length / 1024).toFixed(0)} KB${dark ? ' — SUSPEITO: quase vazio' : ''})`);
    }

    // Contact sheet via ffmpeg — labels burned in, so a cell can never be read
    // against the wrong device.
    const { execFileSync } = require('node:child_process');
    // The label is drawn OVER the frame in its own box. Padding the frame first
    // fails: scale=W:-1 rounds the height, and pad's ih+N is evaluated against
    // the pre-rounded value, so the padded area comes out a pixel short and
    // ffmpeg refuses the filter.
    shots.forEach((s, i) => {
      execFileSync('ffmpeg', [
        '-y', '-v', 'error', '-i', s.file,
        '-vf', `scale=330:440,drawtext=fontfile=/Windows/Fonts/arialbd.ttf:text='${s.label.replace(/'/g, '')}':fontcolor=white:fontsize=17:x=6:y=6:box=1:boxcolor=black@0.85:boxborderw=5`,
        '-frames:v', '1', '-q:v', '2', path.join(OUT_DIR, 'orient', `L${String(i).padStart(2, '0')}.jpg`),
      ], { stdio: 'pipe' });
    });
    // tile over a numbered sequence — one input, no per-cell layout expression
    // to get wrong (an xstack layout string silently dropped 3 of 7 cells).
    const sheetFile = path.join(OUT_DIR, '_orientation.jpg');
    execFileSync('ffmpeg', [
      '-y', '-v', 'error', '-start_number', '0',
      '-i', path.join(OUT_DIR, 'orient', 'L%02d.jpg'),
      '-vf', `tile=4x2:padding=4:color=0x181820`,
      '-frames:v', '1', '-q:v', '2', sheetFile,
    ], { stdio: 'pipe' });
    console.log(`\n-> .shots/_orientation.jpg  (${(fs.statSync(sheetFile).size / 1024).toFixed(0)} KB)`);
  } finally {
    try { await browser.close(); } catch { /* EBUSY on Windows — never mask the real error */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
