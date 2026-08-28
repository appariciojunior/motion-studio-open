#!/usr/bin/env node
// ============================================================
//  _probe_mockup_export — does the video on the device screen come out of the
//  EXPORT in step with the timeline?
//
//  The preview probe (_probe_mockup_video.cjs) measures the live clock. This one
//  measures the artifact: it runs a real MP4 export of a mockup whose screen
//  plays a frame-NUMBERED clip, pulls the encoded bytes back out of the page,
//  and writes them to .shots/ so the stamped numbers can be read frame by frame.
//
//  Read it like this: over one export the number on the phone screen must climb
//  monotonically, in step with the scene. A number that freezes, jumps around,
//  or repeats means the screen texture was still on wall-clock.
//
//  Usage: node scripts/_probe_mockup_export.cjs
//  Needs: dev server on MS_URL (default http://localhost:3000)
//         public/demo/_vsync_test.mp4 (frame-numbered clip)
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots');
const URL_BASE = process.env.MS_URL || 'http://localhost:3000';
const CLIP = process.env.MS_CLIP || '/demo/_vsync_test.mp4';
const SECONDS = Number(process.env.MS_SECONDS || 2);

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
    protocolTimeout: 900_000,   // the export blocks the main thread for minutes under SwiftShader
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('  [page error]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console]', m.text().slice(0, 200)); });

    await page.goto(URL_BASE + '/mockup', { waitUntil: 'networkidle2', timeout: 90_000 });
    await page.evaluate(() => {
      const bd = document.querySelector('.modal-backdrop.welcome-backdrop');
      if (bd) bd.style.display = 'none';    // hide only — never tick the consent box
    });

    await page.waitForSelector('.tpl-item', { timeout: 30_000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Devices');
      if (b) b.click();
      [...document.querySelectorAll('.tpl-item')].find((e) => /iPhone 17 Pro/.test(e.textContent)).click();
    });
    await page.waitForSelector('input[accept="image/*,video/*"]', { timeout: 30_000 });
    await sleep(2500);

    // Short scene — every exported frame is a software-rendered WebGL frame here.
    const setNative = (el, v) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const scene = await page.evaluate((secs, src) => {
      const setNativeIn = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const dur = [...document.querySelectorAll('input[type=number]')].find((i) => Number(i.max) === 60);
      if (dur) setNativeIn(dur, secs);
      return { durationFound: !!dur };
    }, SECONDS, null);
    console.log('scene:', JSON.stringify(scene), `(${SECONDS}s)`);
    await sleep(600);

    const loaded = await page.evaluate(async (clip) => {
      const buf = await (await fetch(clip)).arrayBuffer();
      const file = new File([buf], '_vsync_test.mp4', { type: 'video/mp4' });
      const input = document.querySelector('input[accept="image/*,video/*"]');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return buf.byteLength;
    }, CLIP);
    console.log(`clip: ${CLIP} (${loaded} bytes)`);
    await sleep(2500);

    // Open Export, pick MP4 / 720p, run it.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => /^export$/i.test(x.textContent.trim()) || /export/i.test(x.getAttribute('title') || ''));
      if (b) b.click();
    });
    await page.waitForFunction(
      () => [...document.querySelectorAll('button')].some((b) => /start export/i.test(b.textContent)),
      { timeout: 20_000 },
    );
    const picked = await page.evaluate(() => {
      const pills = [...document.querySelectorAll('.pill')];
      const mp4 = pills.find((p) => p.textContent.trim() === 'MP4');
      if (mp4) mp4.click();
      const r720 = pills.find((p) => p.textContent.trim() === '720p');
      if (r720) r720.click();
      const out = [...document.querySelectorAll('*')]
        .map((e) => e.childElementCount === 0 ? e.textContent.trim() : '')
        .find((t) => /^Output\s/.test(t));
      return { mp4: !!mp4, r720: !!r720, out: out || null };
    });
    console.log('export dialog:', JSON.stringify(picked));

    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /start export/i.test(b.textContent)).click();
    });
    // "N demo slots are still in use" gate: the tracks below the mockup still
    // hold demo assets, which is irrelevant here — the mockup screen is what is
    // being measured. Confirm it, or the export simply never starts.
    await sleep(1200);
    const gate = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /export anyway/i.test(x.textContent));
      if (b) { b.click(); return true; }
      return false;
    });
    console.log(`demo-asset gate: ${gate ? 'confirmed' : 'not shown'}`);
    console.log('exporting…');
    // Log progress so a stall is visible instead of looking like a hang.
    for (let i = 0; i < 120; i++) {
      const st = await page.evaluate(() => ({
        link: !!document.querySelector('a[download$=".mp4"]'),
        text: (document.querySelector('.modal') || document.body).innerText.replace(/s+/g, ' ').slice(0, 220),
      }));
      console.log(`  [${i * 5}s] link=${st.link} :: ${st.text}`);
      if (st.link || /failed/i.test(st.text)) break;
      await sleep(5000);
    }

    // Wait for the result link, then read the blob back through the page.
    await page.waitForFunction(
      () => !!document.querySelector('a[download$=".mp4"]')
        || /export failed/i.test(document.body.innerText),
      { timeout: 600_000 },
    );
    const failed = await page.evaluate(() => {
      const m = document.body.innerText.match(/Export failed:.*/);
      return m ? m[0] : null;
    });
    if (failed) throw new Error(failed);

    const result = await page.evaluate(async () => {
      const a = document.querySelector('a[download$=".mp4"]');
      const blob = await (await fetch(a.href)).blob();
      const buf = await blob.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
      return { name: a.getAttribute('download'), b64: btoa(bin), size: bytes.length };
    });

    const out = path.join(OUT_DIR, '_mockup_export.mp4');
    fs.writeFileSync(out, Buffer.from(result.b64, 'base64'));
    console.log(`\nOK  ${result.name}  ${(result.size / 1024).toFixed(0)} KB  ->  .shots/_mockup_export.mp4`);
    console.log('Agora leia os numeros estampados:');
    console.log('  ffmpeg -i .shots/_mockup_export.mp4 -vf fps=4 -q:v 2 .shots/exp_%02d.jpg');
  } finally {
    // Closing can fail on Windows while Chrome still holds its profile db.
    // Let that never mask the real error from the block above.
    try { await browser.close(); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
