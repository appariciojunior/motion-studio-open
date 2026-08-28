#!/usr/bin/env node
// Photographs of the catalogue thumbnails for one family. They are DOM, not
// canvas, so these are plain viewport clips — taken tall enough that the whole
// grid is on screen, and with the first-run dialog's blurred backdrop hidden
// (it does not block a DOM read, but it fogs every photograph).
//
// Usage: MS_CHROME=... MS_GROUP=Spinner node scripts/_shot_thumbs.cjs
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const GROUP = process.env.MS_GROUP || 'Spinner';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.MS_CHROME, headless: 'shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1900, deviceScaleFactor: 3 });
  await page.goto(process.env.MS_URL || 'http://localhost:3000', { waitUntil: 'networkidle2', timeout: 90000 });
  const box = await page.$('input[type=checkbox]');
  if (box) { await box.click(); await sleep(150);
    for (const b of await page.$$('button')) { const t = (await page.evaluate((el) => (el.textContent||'').trim(), b))||'';
      if (/library|agree|continue|start/i.test(t) && t.length < 40) { await b.click(); break; } }
    await sleep(500); }
  await page.evaluate(() => { for (const el of document.querySelectorAll('.modal-backdrop')) el.style.display = 'none'; });
  await page.evaluate((g) => {
    const el = [...document.querySelectorAll('button.tpl-item')].find((e) => (e.textContent || '').trim().startsWith(g));
    if (el) el.click();
  }, GROUP);
  await sleep(2500);
  const rects = await page.evaluate(() => [...document.querySelectorAll('.tpl-card')]
    .map((c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  if (!rects.length) { console.error('nenhum cartao'); await browser.close(); process.exit(1); }
  const x0 = Math.min(...rects.map((r) => r.x)), x1 = Math.max(...rects.map((r) => r.x + r.w));
  const ys = rects.map((r) => r.y).sort((a, b) => a - b);
  const rows = [...new Set(ys.map((y) => Math.round(y)))];
  const half = rows[Math.ceil(rows.length / 2)];
  fs.mkdirSync('.shots', { recursive: true });
  const slug = GROUP.toLowerCase();
  const shots = [
    { name: `.shots/thumbs-${slug}-a.png`, y: rows[0] - 4, h: half - rows[0] },
    { name: `.shots/thumbs-${slug}-b.png`, y: half - 4, h: Math.max(...rects.map((r) => r.y + r.h)) - half + 8 },
  ];
  for (const s of shots) {
    await page.screenshot({ path: s.name, clip: { x: x0 - 4, y: s.y, width: x1 - x0 + 8, height: s.h } });
    console.log('-> ' + s.name);
  }
  await browser.close();
})();
