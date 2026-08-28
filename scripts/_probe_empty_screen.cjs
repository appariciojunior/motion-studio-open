#!/usr/bin/env node
// ============================================================
//  _probe_empty_screen — what does the iPhone screen look like with NO media?
//
//  Reported symptom: with the screen empty (white), hardware from the BOTTOM of
//  the chassis — speaker grille, connector — shows up INSIDE the white screen
//  area. This captures that state large enough to judge, with the status bar
//  both off and on.
//
//  MS_REF=1 captures against the committed code instead (run it from a worktree
//  at HEAD) so the same shot can be compared before/after a change.
//
//  Usage: node scripts/_probe_empty_screen.cjs
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots');
const URL_BASE = process.env.MS_URL || 'http://localhost:3000';
const TAG = process.env.MS_TAG || 'now';

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
    // Big viewport + DPR 2: the symptom is a few pixels of hardware bleeding
    // through the panel, which a 600px-wide capture cannot settle.
    await page.setViewport({ width: 1700, height: 1100, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => console.error('  [page error]', e.message));

    await page.goto(URL_BASE + '/mockup', { waitUntil: 'networkidle2', timeout: 90_000 });
    await page.evaluate(() => {
      const bd = document.querySelector('.modal-backdrop.welcome-backdrop');
      if (bd) bd.style.display = 'none';
    });
    await page.waitForSelector('.tpl-item', { timeout: 30_000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Devices');
      if (b) b.click();
      [...document.querySelectorAll('.tpl-item')].find((e) => /iPhone 17 Pro/.test(e.textContent)).click();
    });
    await page.waitForSelector('input[accept="image/*,video/*"]', { timeout: 30_000 });
    await sleep(3500);

    // The reported shot has the device tilted mid-animation, not square to the
    // camera — a bleed-through at the chassis edge only shows from some angles,
    // so pose matters as much as the screen content.
    // Solid red on the panel makes its exact boundary readable, so chassis
    // detail can be told apart from screen content in every frame of the sweep.
    await page.evaluate(async () => {
      const buf = await (await fetch('/demo/_orient/phone.png')).arrayBuffer();
      const file = new File([buf], 'phone.png', { type: 'image/png' });
      const input = document.querySelector('input[accept="image/*,video/*"]');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(2500);

    const anim = process.env.MS_ANIM || 'Float & Hover';
    const picked = await page.evaluate((name) => {
      const card = [...document.querySelectorAll('.tpl-card')]
        .find((c) => c.textContent.replace(/\s+/g, ' ').trim() === name);
      if (card) { card.click(); return true; }
      return [...document.querySelectorAll('.tpl-card')].map((c) => c.textContent.trim());
    }, anim);
    console.log(`animation "${anim}":`, picked === true ? 'selected' : `NOT FOUND — available: ${JSON.stringify(picked)}`);
    await sleep(1500);

    const scrub = await page.evaluate(() => {
      const s = document.querySelector('.scrubber input[type=range]')
        || [...document.querySelectorAll('input[type=range]')].find((i) => Number(i.max) > 30);
      window.__scrub = s || null;
      return s ? Number(s.max) : null;
    });
    const total = (scrub ?? 239) + 1;
    const frames = Array.from({ length: 12 }, (_, i) => Math.round((i / 12) * total));
    for (const f of frames) {
      await page.evaluate((v) => {
        const el = window.__scrub;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, f);
      await sleep(1800);
      const el = await page.$('canvas.three3d-layer');
      const buf = await el.screenshot({ type: 'png' });
      const out = path.join(OUT_DIR, `pose_${TAG}_f${String(f).padStart(3, '0')}.png`);
      fs.writeFileSync(out, buf);
      console.log(`  frame ${f} -> ${path.basename(out)} (${(buf.length / 1024).toFixed(0)} KB)`);
    }
  } finally {
    try { await browser.close(); } catch { /* EBUSY on Windows */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
