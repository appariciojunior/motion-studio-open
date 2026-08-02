#!/usr/bin/env node
// ============================================================
//  shoot — take deterministic photographs of a template
//
//  Every verification this project has (scripts/verify-tilt.cjs and the loop
//  seam suites) measures CORRECTNESS: coplanarity, seam closure, finiteness,
//  quaternion normalization. None of them looks at a pixel. That gap is why a
//  template can pass everything and still look wrong.
//
//  This drives the real app in a real Chrome, steps the timeline to fixed
//  frames, reads the stage canvas, and writes a contact sheet you can open.
//  Nothing here touches production code — it drives the UI exactly as a person
//  would, so it cannot change how the app behaves.
//
//  Usage:
//    node scripts/shoot.cjs orbit-3d-01
//    node scripts/shoot.cjs orbit-3d-01 globe-01 box-01
//    MS_FRAMES=9 node scripts/shoot.cjs helix3d-01
//    MS_URL=http://localhost:3001 node scripts/shoot.cjs box-01
//
//  Output: .shots/<template-id>.jpg
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots');
const URL = process.env.MS_URL || 'http://localhost:3000';
const SHOTS = Math.max(2, Number(process.env.MS_FRAMES || 6));
const COLS = Number(process.env.MS_COLS || 3);

// puppeteer-core ships no browser; point it at the installed Chrome.
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
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.error('usage: node scripts/shoot.cjs <template-id> [more ids...]');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'shell',
    args: [
      // Headless Chrome has no GPU; SwiftShader gives it a real WebGL context so
      // the Three renderer draws instead of silently producing a blank canvas.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-lcd-text',
      '--hide-scrollbars',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('  [page error]', e.message));

    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 });
    await dismissWelcome(page);
    await page.waitForSelector('canvas.stage-canvas', { timeout: 30_000 });
    await page.waitForSelector('.scrubber input[type=range]', { timeout: 30_000 });

    for (const id of ids) {
      process.stdout.write(`shooting ${id} ... `);
      const result = await shoot(page, id);
      if (result.error) { console.log('FAILED: ' + result.error); continue; }
      const file = path.join(OUT_DIR, `${id}.jpg`);
      fs.writeFileSync(file, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
      console.log(`${result.frames.join(', ')}  ->  .shots/${id}.jpg  (${result.w}x${result.h}, ${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
    }
  } finally {
    await browser.close();
  }
}

async function dismissWelcome(page) {
  // The dialog is first-run only; skip quietly when it is already gone.
  const box = await page.$('input[type=checkbox]');
  if (!box) return;
  await box.click();
  await sleep(150);
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const t = (await page.evaluate((el) => (el.textContent || '').trim(), b)) || '';
    if (/library|agree|continue|start/i.test(t) && t.length < 40) { await b.click(); break; }
  }
  await sleep(500);
}

async function shoot(page, templateId) {
  return page.evaluate(async (id, shots, cols) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const settle = async (n = 3) => { for (let i = 0; i < n; i++) await raf(); };

    // React tracks input values on the DOM node; bypass its cache with the
    // native setter so the change event carries the new value.
    const setInput = (el, value) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const select = document.querySelector('select');
    if (!select) return { error: 'template <select> not found' };
    if (![...select.options].some((o) => o.value === id)) return { error: `unknown template ${id}` };
    setInput(select, id);
    await settle(6);

    const scrub = document.querySelector('.scrubber input[type=range]');
    if (!scrub) return { error: 'scrubber not found' };
    // Setting the scrubber also pauses playback (Timeline.tsx onChange), so the
    // frames below are the frames drawn — never a wall-clock race.
    const total = Number(scrub.max) + 1;

    const canvas = document.querySelector('canvas.stage-canvas');
    if (!canvas) return { error: 'stage canvas not found' };

    // Sample evenly across one loop, excluding the duplicate end frame.
    const frames = Array.from({ length: shots }, (_, i) => Math.round((i / shots) * total) % total);

    const cellW = 380;
    const cellH = Math.round(cellW * (canvas.height / canvas.width));
    const rows = Math.ceil(frames.length / cols);
    const pad = 8, label = 18;
    const sheet = document.createElement('canvas');
    sheet.width = cols * cellW + (cols + 1) * pad;
    sheet.height = rows * (cellH + label) + (rows + 1) * pad;
    const g = sheet.getContext('2d');
    g.fillStyle = '#101014';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '12px ui-monospace, monospace';
    g.textBaseline = 'top';

    for (let i = 0; i < frames.length; i++) {
      setInput(scrub, frames[i]);
      await settle(4);
      const col = i % cols, row = Math.floor(i / cols);
      const x = pad + col * (cellW + pad);
      const y = pad + row * (cellH + label + pad);
      g.fillStyle = '#8a8a94';
      g.fillText(`f${frames[i]} / ${total}`, x, y);
      g.drawImage(canvas, x, y + label, cellW, cellH);
    }

    // Is anything actually drawn? A blank sheet means the WebGL context failed,
    // not that the template is empty — worth catching here rather than in my eyes.
    const probe = g.getImageData(0, 0, sheet.width, sheet.height).data;
    let lit = 0;
    for (let i = 0; i < probe.length; i += 4 * 97) {
      if (Math.abs(probe[i] - 16) + Math.abs(probe[i + 1] - 16) + Math.abs(probe[i + 2] - 20) > 24) lit++;
    }
    if (lit < 8) return { error: 'sheet is blank — WebGL context probably failed in headless' };

    return { dataUrl: sheet.toDataURL('image/jpeg', 0.86), frames, w: sheet.width, h: sheet.height };
  }, templateId, SHOTS, COLS);
}

main().catch((e) => { console.error(e); process.exit(1); });
