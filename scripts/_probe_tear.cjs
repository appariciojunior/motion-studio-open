#!/usr/bin/env node
// ============================================================
//  _probe_tear — is the torn/sliced device at one frame a real render defect or
//  a capture artefact?
//
//  Same frame, three captures, then a pixel diff. Byte-identical captures mean
//  the tear is in the render (geometry, material, depth). Captures that differ
//  mean the screenshot caught a redraw and the tear is the probe's own fault.
//
//  Usage: MS_FRAME=200 node scripts/_probe_tear.cjs
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');

const OUT_DIR = path.join(path.resolve(__dirname, '..'), '.shots');
const URL_BASE = process.env.MS_URL || 'http://localhost:3000';
const FRAME = Number(process.env.MS_FRAME || 200);

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
    await page.setViewport({ width: 1700, height: 1100, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => console.error('  [page error]', e.message));

    await page.goto(URL_BASE + '/mockup', { waitUntil: 'networkidle2', timeout: 90_000 });
    await page.evaluate(() => {
      const b = document.querySelector('.modal-backdrop.welcome-backdrop');
      if (b) b.style.display = 'none';
    });
    await page.waitForSelector('.tpl-item', { timeout: 30_000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Devices');
      if (b) b.click();
      [...document.querySelectorAll('.tpl-item')].find((e) => /iPhone 17 Pro/.test(e.textContent)).click();
    });
    await page.waitForSelector('input[accept="image/*,video/*"]', { timeout: 30_000 });
    await sleep(3500);

    // Solid red on the screen: it makes the panel's exact boundary visible, so
    // chassis detail INSIDE the red is a depth failure and detail outside it is
    // legitimate geometry seen at this angle.
    await page.evaluate(async () => {
      const buf = await (await fetch('/demo/_orient/phone.png')).arrayBuffer();
      const file = new File([buf], 'phone.png', { type: 'image/png' });
      const input = document.querySelector('input[accept="image/*,video/*"]');
      const dt = new DataTransfer(); dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(2500);

    await page.evaluate(() => {
      const c = [...document.querySelectorAll('.tpl-card')].find((x) => /Float & Hover/.test(x.textContent));
      if (c) c.click();
      const s = document.querySelector('.scrubber input[type=range]')
        || [...document.querySelectorAll('input[type=range]')].find((i) => Number(i.max) > 30);
      window.__scrub = s;
    });
    await sleep(1500);
    await page.evaluate((v) => {
      const el = window.__scrub;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, FRAME);
    await sleep(3000);

    const hashes = [];
    for (let i = 1; i <= 3; i++) {
      const el = await page.$('canvas.three3d-layer');
      const buf = await el.screenshot({ type: 'png' });
      const file = path.join(OUT_DIR, `tear_f${FRAME}_${i}.png`);
      fs.writeFileSync(file, buf);
      const h = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
      hashes.push(h);
      console.log(`shot ${i}: ${(buf.length / 1024).toFixed(0)} KB  sha1 ${h}`);
      await sleep(2000);
    }
    const allSame = hashes.every((h) => h === hashes[0]);
    console.log(`\nveredito: capturas ${allSame ? 'IDENTICAS -> o defeito esta no render' : 'DIFERENTES -> a captura pegou um redraw (artefato do probe)'}`);
  } finally {
    try { await browser.close(); } catch { /* EBUSY on Windows */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
