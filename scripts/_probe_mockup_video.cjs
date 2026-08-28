#!/usr/bin/env node
// ============================================================
//  _probe_mockup_video — does the video on the device screen actually run,
//  and is it tied to the timeline clock?
//
//  Drives the real app in a real Chrome (same harness pattern as shoot.cjs),
//  puts a frame-numbered test clip on the iPhone screen and measures, per
//  phase, every drawImage(<video>) the mockup renderer performs:
//
//    A idle    timeline paused at frame 0
//    B play    timeline playing
//    C rewind  timeline scrubbed back to frame 0
//
//  What matters is the VIDEO's own currentTime at each draw. If it advances
//  while the timeline is parked, the clip is on wall-clock, not the timeline.
//
//  Usage: node scripts/_probe_mockup_video.cjs
//  Needs: dev server on MS_URL (default http://localhost:3000)
//         public/demo/_vsync_test.mp4 (frame-numbered clip)
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const URL_BASE = process.env.MS_URL || 'http://localhost:3000';
const CLIP = process.env.MS_CLIP || '/demo/_vsync_test.mp4';

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
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'shell',
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      ...(process.env.MS_AUTOPLAY === 'force' ? ['--autoplay-policy=no-user-gesture-required'] : []),
      '--hide-scrollbars',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('  [page error]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console]', m.text().slice(0, 200)); });

    // Instrument BEFORE the app boots so no <video> or draw escapes the hooks.
    await page.evaluateOnNewDocument(() => {
      window.__vids = [];
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag, ...rest) {
        const el = origCreate(tag, ...rest);
        if (String(tag).toLowerCase() === 'video') window.__vids.push(el);
        return el;
      };
      window.__draws = [];
      const origDraw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (src, ...args) {
        if (src instanceof HTMLVideoElement) {
          window.__draws.push({
            w: performance.now(),
            vt: src.currentTime,
            paused: src.paused,
            frame: window.__probeFrame ? window.__probeFrame() : -1,
          });
          if (window.__draws.length > 20000) window.__draws.shift();
        }
        return origDraw.call(this, src, ...args);
      };
      window.__gl = 0;
      const hookGl = (proto) => {
        if (!proto) return;
        const oe = proto.drawElements;
        proto.drawElements = function (...a) { window.__gl++; return oe.apply(this, a); };
      };
      hookGl(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
      hookGl(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    });

    await page.goto(URL_BASE + '/mockup', { waitUntil: 'networkidle2', timeout: 90_000 });

    // Only hide the first-run dialog's backdrop — never tick its consent box.
    await page.evaluate(() => {
      const bd = document.querySelector('.modal-backdrop.welcome-backdrop');
      if (bd) bd.style.display = 'none';
    });

    // Pick the iPhone 17 Pro so a known "Screen" mesh and slot exist.
    await page.waitForSelector('.tpl-item', { timeout: 30_000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Devices');
      if (b) b.click();
      const it = [...document.querySelectorAll('.tpl-item')].find((e) => /iPhone 17 Pro/.test(e.textContent));
      it.click();
    });
    await page.waitForSelector('input[accept="image/*,video/*"]', { timeout: 30_000 });
    await sleep(2500); // let the GLB load and the render loop settle

    // Expose the timeline frame to the draw hook, and find the transport.
    const ui = await page.evaluate(() => {
      const scrub = document.querySelector('.scrubber input[type=range]')
        || [...document.querySelectorAll('input[type=range]')].find((i) => Number(i.max) > 30);
      const playBtn = [...document.querySelectorAll('button')]
        .find((b) => /^(play|pause)$/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || ''));
      window.__scrub = scrub || null;
      window.__probeFrame = () => (window.__scrub ? Number(window.__scrub.value) : -1);
      return {
        scrub: scrub ? { max: Number(scrub.max), value: Number(scrub.value), cls: scrub.className } : null,
        playBtn: playBtn ? (playBtn.getAttribute('title') || playBtn.getAttribute('aria-label')) : null,
        canvases: [...document.querySelectorAll('canvas')].map((c) => c.className),
        gl: window.__gl,
      };
    });
    console.log('UI:', JSON.stringify(ui));
    if (!ui.scrub) throw new Error('scrubber not found — cannot drive the timeline');
    if (!ui.gl) throw new Error('WebGL drew nothing — the render loop is not running in this Chrome');

    // Put the frame-numbered clip on the screen through the real file input.
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
    // A missing clip 404s into the Next error page, which is a few KB of HTML —
    // the upload "succeeds" and the wait below times out 60 s later looking like
    // a renderer bug. Fail here with the real reason instead.
    if (loaded < 40_000) {
      throw new Error(
        `${CLIP} nao existe ou nao e video (${loaded} bytes). Gere o clipe de teste:\n`
        + `  ffmpeg -y -f lavfi -i "color=c=black:s=606x1312:r=30:d=4" \\\n`
        + `    -vf "drawtext=fontfile=/Windows/Fonts/arialbd.ttf:text='%{eif\\:n\\:d}':`
        + `fontcolor=white:fontsize=260:x=(w-text_w)/2:y=(h-text_h)/2" \\\n`
        + `    -c:v libx264 -pix_fmt yuv420p -g 60 -an public${CLIP}`,
      );
    }
    // Wait for the CONDITION, not a guessed delay: the renderer creates its
    // <video> on a later loop tick, and a cold dev server (recompiling, GLB
    // still loading) can take far longer than any fixed sleep. Measuring before
    // the element is decodable reads as "the clip never runs" — a false
    // negative that already cost one run here.
    await page.waitForFunction(
      () => {
        const v = window.__vids.find((x) => !document.contains(x));
        return !!v && v.readyState >= 2 && v.duration > 0;
      },
      { timeout: 60_000, polling: 250 },
    );
    await sleep(500);   // let one full loop tick paint with it

    const setFrame = (f) => page.evaluate((v) => {
      const el = window.__scrub;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, f);

    const clickPlay = () => page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => /^(play|pause)$/i.test(x.getAttribute('title') || x.getAttribute('aria-label') || ''));
      if (b) { b.click(); return b.getAttribute('title') || b.getAttribute('aria-label'); }
      return null;
    });

    // Reads the ELEMENT's own clock across the window, not the number of
    // drawImage calls. The renderer only recomposites when the frame would
    // actually differ, so a correctly paused preview draws ZERO times — counting
    // draws made "working" and "idle" indistinguishable and reported a healthy
    // build as broken. Draw count is still collected, but only to confirm the
    // panel was painted at all.
    const readVideo = () => page.evaluate(() => {
      const v = window.__vids.find((x) => !document.contains(x));
      return v ? {
        ct: +v.currentTime.toFixed(3), paused: v.paused, rs: v.readyState,
        dur: v.duration, vw: v.videoWidth, err: v.error ? v.error.code : null,
      } : null;
    });

    const phase = async (label, ms) => {
      const before = await readVideo();
      await page.evaluate(() => { window.__draws.length = 0; window.__gl = 0; });
      await sleep(ms);
      const after = await readVideo();
      const counts = await page.evaluate(() => ({ gl: window.__gl, draws: window.__draws.length }));
      const span = (before && after) ? +(after.ct - before.ct).toFixed(3) : null;
      console.log(`\n[${label}]  glDraws=${counts.gl}  videoDraws=${counts.draws}  video.currentTime ${before?.ct} -> ${after?.ct} (span ${span}s)  paused=${after?.paused}`);
      return { ...counts, before, after, span };
    };

    console.log('\n=== A · timeline PARADA no frame 0 ===');
    await setFrame(0);
    await sleep(2000);   // let the seek to 0 land before sampling the baseline
    const A = await phase('A idle', 2000);

    console.log('\n=== B · timeline TOCANDO ===');
    const pb = await clickPlay();
    console.log('  play button:', pb);
    await sleep(400);
    const B = await phase('B play', 2500);

    console.log('\n=== C · timeline VOLTA para o frame 0 ===');
    await setFrame(0);              // Timeline.onChange also pauses playback
    await sleep(2000);   // same: the rewind seek must land before sampling
    const C = await phase('C rewind', 1500);

    // Scrubbing is the sharpest test of "the timeline owns the clip": park the
    // playhead on a known frame and the clip must sit on that exact second.
    const fps = await page.evaluate(() => 30); // scene fps default; read below
    console.log('\n=== D · SCRUB para frames conhecidos (parado) ===');
    const D = [];
    for (const f of [0, 30, 60, 90, 150]) {
      await setFrame(f);
      await sleep(2000);   // SwiftShader runs the loop at ~2 fps; give the seek room
      const r = await page.evaluate(() => {
        const v = window.__vids.find((x) => !document.contains(x));
        const d = window.__draws;
        return {
          ct: v ? +v.currentTime.toFixed(3) : null,
          paused: v ? v.paused : null,
          seeking: v ? v.seeking : null,
          sceneFrame: window.__probeFrame(),
          drawnVt: d.length ? +d[d.length - 1].vt.toFixed(3) : null,
        };
      });
      const expected = +((f / fps) % 4).toFixed(3);   // clip is 4 s → scene time wraps into it
      const off = r.ct === null ? null : +Math.abs(r.ct - expected).toFixed(3);
      D.push({ f, expected, ...r, off });
      console.log(`  frame ${String(f).padStart(3)} (cena ${r.sceneFrame}) -> esperado ${expected}s | video.currentTime ${r.ct}s | desvio ${off}s | paused ${r.paused} | seeking ${r.seeking}`);
    }

    console.log('\n================ VEREDITO ================');
    const scrubOk = D.every((d) => d.off !== null && d.off <= 0.1);
    const pausedOk = D.every((d) => d.paused === true);
    const ok = (c) => (c ? 'SIM' : 'NAO');
    console.log(`1. <video> da tela do aparelho criado?         ${ok(A.after)}`);
    console.log(`2. desenhado na tela (drawImage)?              ${ok(A.draws + B.draws > 0)}`);
    console.log(`3. PARA quando a timeline esta parada?         ${A.span !== null && Math.abs(A.span) <= 0.05 ? 'SIM' : `NAO (andou ${A.span}s)`}`);
    console.log(`4. anda quando a timeline toca?                ${ok(B.span !== null && B.span > 0.05 && B.after?.paused === false)}`);
    console.log(`5. volta ao inicio quando a timeline volta?    ${C.after && C.after.ct < 0.15 ? 'SIM' : `NAO (ficou em ${C.after?.ct}s)`}`);
    console.log(`6. scrub casa frame da cena com tempo do clip? ${scrubOk ? 'SIM (<=0.1s)' : 'NAO'}`);
    console.log(`7. fica pausado enquanto a timeline esta parada? ${ok(pausedOk)}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
