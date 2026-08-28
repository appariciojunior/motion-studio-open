#!/usr/bin/env node
// ============================================================
//  _vidprobe — diagnose video cards during export
//
//  Drives the real app in a real Chrome: uploads test videos as assets,
//  selects a template, runs a WebM export, and records for every card
//  <video> the currentTime it actually held at each captured frame.
//
//  A card that "does not start" shows up here as a currentTime trace that
//  never leaves 0 (or that repeats the same value), which is a measurement,
//  not an impression of a screenshot.
//
//  Usage: node scripts/_vidprobe.cjs [template-id]
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const URL_BASE = process.env.MS_URL || 'http://localhost:3000';
const TEMPLATE = process.argv[2] || 'grid-01';
const OUT_DIR = path.join(ROOT, '.vidprobe');
const VIDEOS = (process.env.MS_VIDS || 'longgop.mp4,short.mp4,vp9.webm').split(',').map((f) => path.join(ROOT, 'public', '_vtest', f));

const CHROME_CANDIDATES = [
  process.env.MS_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error('Chrome not found. Set MS_CHROME.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('  [page error]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console]', m.text()); });

    // Installed before any app script: card <video> elements are detached from
    // the DOM, so the only way to see them is to catch them at creation.
    await page.evaluateOnNewDocument(() => {
      window.__vids = [];
      window.__blobs = [];
      window.__frames = [];   // one entry per encoded export frame
      const origCreate = Document.prototype.createElement;
      Document.prototype.createElement = function (tag, ...rest) {
        const el = origCreate.call(this, tag, ...rest);
        if (String(tag).toLowerCase() === 'video') window.__vids.push(el);
        return el;
      };
      const origURL = URL.createObjectURL;
      URL.createObjectURL = function (obj) {
        const url = origURL.call(this, obj);
        if (obj instanceof Blob) window.__blobs.push({ url, blob: obj, at: performance.now(), type: obj.type, size: obj.size });
        return url;
      };
      // Every captured export frame is wrapped in a VideoFrame right after the
      // renderer drew it. Sampling here gives the exact video clock the encoder
      // saw for that frame — no polling, no wall-clock guessing.
      if (window.VideoFrame) {
        const Orig = window.VideoFrame;
        window.VideoFrame = new Proxy(Orig, {
          construct(target, argv) {
            window.__frames.push({
              ts: argv[1] && argv[1].timestamp,
              ct: window.__vids.map((v) => Number(v.currentTime.toFixed(3))),
            });
            return Reflect.construct(target, argv);
          },
        });
      }
    });

    await page.goto(URL_BASE, { waitUntil: 'networkidle2', timeout: 90_000 });
    await dismissWelcome(page);
    await page.waitForSelector('canvas.stage-canvas', { timeout: 30_000 });

    // ---- upload the test videos as assets ----
    const input = await page.$('input[type=file]');
    if (!input) throw new Error('assets file input not found');
    await input.uploadFile(...VIDEOS);
    await sleep(3000);

    const assets = await page.evaluate(() => {
      const vids = window.__vids;
      return {
        created: vids.length,
        detail: vids.map((v) => ({
          src: String(v.currentSrc || v.src).slice(-40),
          readyState: v.readyState,
          w: v.videoWidth, h: v.videoHeight,
          dur: v.duration, loop: v.loop, paused: v.paused,
          err: v.error ? v.error.code : null,
        })),
      };
    });
    console.log('after upload:', JSON.stringify(assets, null, 2));

    // ---- pick the template ----
    await page.evaluate((id) => {
      const setInput = (el, value) => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const sel = document.querySelector('select');
      if (sel && [...sel.options].some((o) => o.value === id)) setInput(sel, id);
    }, TEMPLATE);
    await sleep(2500);

    await page.evaluate(() => { window.__frames = []; window.__exportStart = performance.now(); });

    // ---- open export dialog and run the export ----
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find((el) => /^export$/i.test((el.textContent || '').trim()));
      if (!b) throw new Error('export trigger not found');
      b.click();
    });
    await page.waitForSelector('.export-modal', { timeout: 15_000 });
    await sleep(600);

    const fmt = (process.env.MS_FMT || 'webm').toUpperCase();
    await page.evaluate((f) => {
      const pill = [...document.querySelectorAll('.export-modal .pill')]
        .find((el) => (el.textContent || '').trim().toUpperCase() === f);
      pill?.click();
    }, fmt);
    await sleep(400);
    await page.evaluate(() => {
      const pill = [...document.querySelectorAll('.export-modal .pill')]
        .find((el) => (el.textContent || '').trim() === '720p');
      pill?.click();
    });
    await sleep(400);

    console.log('  modal before start:', await page.evaluate(() =>
      (document.querySelector('.export-modal-body') || {}).innerText));

    await page.evaluate(() => document.querySelector('.export-primary-action')?.click());
    await sleep(600);
    // Demo slots still in use → a confirmation gate sits in front of the run.
    const gated = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.export-demo-actions button')]
        .find((el) => /export anyway/i.test(el.textContent || ''));
      if (b) { b.click(); return true; }
      return false;
    });
    console.log('  demo gate clicked:', gated);

    // ---- wait for the export to finish, narrating the modal as it goes ----
    let finished = false;
    let last = '';
    const deadline = Date.now() + Number(process.env.MS_TIMEOUT || 180_000);
    while (Date.now() < deadline) {
      const st = await page.evaluate(() => {
        const m = document.querySelector('.export-modal');
        if (!m) return { gone: true };
        return {
          done: !!m.querySelector('.export-done'),
          error: (m.querySelector('.export-error') || {}).textContent || '',
          progress: (m.querySelector('.progress') || {}).textContent || '',
          frames: window.__frames.length,
        };
      });
      if (st.gone) { console.log('  [modal disappeared]'); break; }
      const line = `${st.progress || (st.done ? 'DONE' : st.error || 'idle')} | frames=${st.frames}`;
      if (line !== last) { console.log('  ' + line); last = line; }
      if (st.done || st.error) { finished = true; break; }
      await sleep(1000);
    }
    await sleep(500);

    const result = await page.evaluate(() => {
      // Only blobs minted after the export click can be the encoded output.
      const out = window.__blobs.filter((b) => b.at > window.__exportStart && b.size > 5_000);
      return {
        text: document.body.innerText.slice(0, 1200),
        frames: window.__frames,
        outUrl: out.length ? out[out.length - 1].url : null,
        outType: out.length ? out[out.length - 1].type : null,
        vids: window.__vids.map((v) => ({
          src: String(v.currentSrc || v.src).slice(-12),
          dur: v.duration, loop: v.loop, paused: v.paused, ct: v.currentTime,
        })),
      };
    });

    console.log('\nfinished =', finished);
    console.log(`captured export frames: ${result.frames.length}`);
    console.log('vids after export:', JSON.stringify(result.vids));

    // Per-video: what clock did each card hold at each ENCODED frame?
    const n = result.vids.length;
    for (let i = 0; i < n; i++) {
      const series = result.frames.map((f) => f.ct[i]).filter((x) => x !== undefined);
      if (!series.length) continue;
      const uniq = new Set(series);
      const verdict = uniq.size <= 1 ? '  <-- FROZEN' : '';
      console.log(`  video[${i}] ${result.vids[i].src} dur=${result.vids[i].dur}  distinct=${uniq.size}/${series.length}${verdict}`);
      console.log(`      ${series.join(' ')}`);
    }

    // ---- pull the encoded file out ----
    if (result.outUrl) {
      const b64 = await page.evaluate(async (url) => {
        const entry = window.__blobs.find((b) => b.url === url);
        const buf = new Uint8Array(await entry.blob.arrayBuffer());
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
        return btoa(s);
      }, result.outUrl);
      const ext = (process.env.MS_FMT || 'webm').toLowerCase();
      const out = path.join(OUT_DIR, `${TEMPLATE}.${ext}`);
      fs.writeFileSync(out, Buffer.from(b64, 'base64'));
      console.log(`\nwrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${result.outType})`);
    } else {
      console.log('\nno output blob — export did not produce a file');
      console.log(result.text);
    }
  } finally {
    await browser.close();
  }
}

async function clickByText(page, re) {
  return page.evaluate((src, flags) => {
    const rx = new RegExp(src, flags);
    const b = [...document.querySelectorAll('button')]
      .find((el) => rx.test((el.textContent || '').trim()));
    if (b) { b.click(); return true; }
    return false;
  }, re.source, re.flags);
}

async function dismissWelcome(page) {
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

main().catch((e) => { console.error(e); process.exit(1); });
