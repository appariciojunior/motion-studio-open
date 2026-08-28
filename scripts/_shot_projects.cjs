#!/usr/bin/env node
// ============================================================
//  _shot_projects — photograph the Projects tab in a real Chrome
//
//  The Browser pane in this environment doesn't composite frames, so the only
//  way to LOOK at a layout is to drive Chrome directly (same approach as
//  scripts/shoot.cjs). This seeds a believable project list — varied names,
//  canvas ratios, backgrounds, some with posters and some without — then
//  screenshots /projects in light and dark.
//
//  It writes only to the throwaway Chrome profile puppeteer creates, so the
//  developer's own localStorage is untouched.
//
//  Usage: node scripts/_shot_projects.cjs [suffix]
//  Output: .shots/projects-<suffix>-light.png / -dark.png
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots');
const URL = process.env.MS_URL || 'http://localhost:3000';
const SUFFIX = process.argv[2] || 'now';

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
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-lcd-text', '--hide-scrollbars'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('  [page error]', e.message));

    await page.goto(URL + '/library', { waitUntil: 'networkidle2', timeout: 90_000 });
    await seed(page);
    await page.goto(URL + '/projects', { waitUntil: 'networkidle2', timeout: 90_000 });
    await dismissWelcome(page);
    await page.waitForSelector('.pb-card, .pj-card', { timeout: 30_000 });
    await sleep(1500);

    const light = path.join(OUT_DIR, `projects-${SUFFIX}-light.png`);
    await page.screenshot({ path: light });
    console.log('->', path.relative(ROOT, light));

    // Dark theme lives on the rail's bottom button.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.rail-item')].find((el) => /Dark|Light/.test(el.textContent || ''));
      b?.click();
    });
    await sleep(900);
    const dark = path.join(OUT_DIR, `projects-${SUFFIX}-dark.png`);
    await page.screenshot({ path: dark });
    console.log('->', path.relative(ROOT, dark));

    // Hover state of one card, so the actions row is in a photograph too.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.rail-item')].find((el) => /Dark|Light/.test(el.textContent || ''));
      b?.click();
    });
    await sleep(700);
    const card = await page.$('.pb-card, .pj-card');
    if (card) {
      await card.hover();
      await sleep(400);
      const hover = path.join(OUT_DIR, `projects-${SUFFIX}-hover.png`);
      await page.screenshot({ path: hover });
      console.log('->', path.relative(ROOT, hover));
    }

    // The editor, so the project dock (name + save state) is photographed too,
    // once closed and once with its menu open.
    await page.goto(URL + '/library', { waitUntil: 'networkidle2', timeout: 90_000 });
    await page.waitForSelector('.pdock-chip', { timeout: 30_000 });
    await sleep(2500);
    const editor = path.join(OUT_DIR, `projects-${SUFFIX}-editor.png`);
    await page.screenshot({ path: editor });
    console.log('->', path.relative(ROOT, editor));

    await page.click('.pdock-chip');
    await sleep(500);
    const menu = path.join(OUT_DIR, `projects-${SUFFIX}-dock.png`);
    await page.screenshot({ path: menu, clip: await page.evaluate(() => {
      const r = document.querySelector('.pdock').getBoundingClientRect();
      return { x: Math.max(0, r.left - 360), y: Math.max(0, r.top - 12), width: Math.min(700, r.width + 380), height: 460 };
    }) });
    console.log('->', path.relative(ROOT, menu));
  } finally {
    await browser.close();
  }
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
  await sleep(400);
}

// A list that looks like a real week of work: different canvas ratios, different
// backgrounds, four with posters, three without (so the fallback sketch is in
// the photograph too), one long name for the truncation case.
function seed(page) {
  return page.evaluate(async () => {
    const DAY = 86_400_000;
    const now = Date.now();
    const specs = [
      { name: 'Launch teaser — vertical cut for stories', ago: 0.002, w: 1080, h: 1920, c1: '#0d0d0d', c2: '#242424', grad: true, tpl: 'grid-01', tracks: 3, poster: ['#12121a', '#3b3b52'] },
      { name: 'Hero carousel', ago: 0.05, w: 1080, h: 1350, c1: '#ffffff', c2: '#e8e8e8', grad: false, tpl: 'stack-01', tracks: 2, poster: ['#f3f4f6', '#c9ced8'] },
      { name: 'Device tour', ago: 0.4, w: 1920, h: 1080, c1: '#fbfbfc', c2: '#e6e8eb', grad: true, tpl: 'orbit-01', tracks: 1, poster: ['#e9eef5', '#9fb2c9'], device: 'iPhone 17 Pro', mode: 'mockup' },
      { name: 'Poster set', mode: 'mockup', ago: 1.2, w: 1080, h: 1080, c1: '#101820', c2: '#233140', grad: true, tpl: 'sticker-01', tracks: 4, poster: ['#101820', '#2f4356'] },
      { name: 'Client sandbox', ago: 3.1, w: 1080, h: 1350, c1: '#f7f2ea', c2: '#e5d9c6', grad: true, tpl: 'wall-01', tracks: 2 },
      { name: 'Spinner tests', ago: 6.4, w: 810, h: 1080, c1: '#0d0d0d', c2: '#1f1f1f', grad: false, tpl: 'spinner-01', tracks: 1, device: 'MacBook Pro 14"' },
      { name: 'Untitled', ago: 14, w: 1080, h: 1350, c1: '#0d0d0d', c2: '#1f1f1f', grad: false, tpl: null, tracks: 0 },
    ];

    const jpeg = (c1, c2, w, h) => new Promise((res) => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, c1); grad.addColorStop(1, c2);
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      // a few cards, so the poster reads as a motion scene rather than a swatch
      g.globalAlpha = 0.9;
      for (let i = 0; i < 5; i++) {
        const cw = w * 0.26, ch = cw * 1.25;
        const x = w * (0.1 + i * 0.18) - cw / 2, y = h * (0.35 + 0.12 * Math.sin(i));
        g.fillStyle = i % 2 ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)';
        g.fillRect(x, y, cw, ch);
      }
      cv.toBlob((b) => res(b), 'image/jpeg', 0.8);
    });

    const idbPut = (key, blob) => new Promise((res, rej) => {
      const r = indexedDB.open('motion-assets', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('blobs'); };
      r.onsuccess = () => {
        const tx = r.result.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put(blob, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      };
      r.onerror = () => rej(r.error);
    });

    const projects = [];
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const id = `seed${i}`;
      const t = now - s.ago * DAY;
      projects.push({ id, name: s.name, createdAt: t - DAY, updatedAt: t, mode: s.mode ?? '2d' });
      // The ACTIVE project deliberately has no scene blob, so the editor boots
      // on its own defaults instead of hydrating a hand-written partial.
      if (i > 0) {
        localStorage.setItem(`motion-project-${id}`, JSON.stringify({
          width: s.w, height: s.h,
          background: { source: 'color', color: s.c1, gradient: s.grad, color2: s.c2, imageUrl: null, blur: 28 },
          activeTemplateId: s.tpl,
          tracks: Array.from({ length: s.tracks }, (_, k) => ({ id: 't' + k, templateId: s.tpl })),
        }));
      }
      if (s.device) {
        localStorage.setItem(`motion-3d-v1:${id}`, JSON.stringify({ models: { mockup: { name: s.device, url: '/3d/devices/x.glb' } } }));
      }
      if (s.poster) await idbPut(`poster:${id}`, await jpeg(s.poster[0], s.poster[1], 384, Math.round(384 * (s.h / s.w))));
    }
    localStorage.setItem('motion-projects-v1', JSON.stringify({ activeId: 'seed0', projects }));
    localStorage.setItem('motion-welcome-seen', '1');
    localStorage.setItem('motion-tour-seen', '1');
    localStorage.setItem('motion-mockup-tour-seen', '1');
    return projects.length;
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
