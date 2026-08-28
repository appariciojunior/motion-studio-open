#!/usr/bin/env node
// ============================================================
//  _probe_thumbs — measure what the CATALOGUE MENU actually draws
//
//  The thumbnails are DOM, not canvas, so the browser's own layout IS the
//  ground truth: every card is a div whose rendered rect and computed matrix
//  can be read back and checked against the pose the template handed over. A
//  screenshot cannot tell a hairline from a card seen edge-on; a rect can.
//  Heights are reported in the thumbnail's own 810-wide preview space, so they
//  compare directly with what the template predicts.
//
//  Usage: MS_CHROME=<chrome.exe> node scripts/_probe_thumbs.cjs
// ============================================================
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const URL = process.env.MS_URL || 'http://localhost:3000';
const CHROME = process.env.MS_CHROME;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!CHROME || !fs.existsSync(CHROME)) { console.error('set MS_CHROME to chrome.exe'); process.exit(1); }
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'shell',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('  [page error]', e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90_000 });
  const box = await page.$('input[type=checkbox]');
  if (box) {
    await box.click(); await sleep(150);
    for (const b of await page.$$('button')) {
      const t = (await page.evaluate((el) => (el.textContent || '').trim(), b)) || '';
      if (/library|agree|continue|start/i.test(t) && t.length < 40) { await b.click(); break; }
    }
    await sleep(500);
  }
  // Open the Spinner group — its cards do not exist in the DOM until then.
  const opened = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button.tpl-item, button, summary')]
      .find((e) => /^Spinner(NEW)?$/.test((e.textContent || '').trim()));
    if (!el) return false;
    el.click();
    return true;
  });
  if (!opened) { console.error('grupo Spinner nao encontrado'); await browser.close(); process.exit(1); }
  await sleep(1200);

  const rows = await page.evaluate(() => {
    const out = [];
    for (const card of document.querySelectorAll('.tpl-card')) {
      const name = (card.querySelector('.tpl-card-label')?.textContent || '').trim();
      const thumb = card.querySelector('.tpl-thumb');
      if (!thumb) continue;
      const tb = thumb.getBoundingClientRect();
      if (tb.width < 4) continue;
      const k = 810 / tb.width;              // thumbnail px -> preview px
      const els = [...thumb.querySelectorAll('.tpl-thumb-el')];
      const cards = els.map((el) => {
        const cs = getComputedStyle(el);
        const m = new DOMMatrixReadOnly(cs.transform);
        // The element's own box, before its matrix.
        const w = parseFloat(cs.width) * k, h = parseFloat(cs.height) * k;
        // What the matrix actually draws: the parallelogram's extents.
        const ex = Math.abs(m.a) * w + Math.abs(m.c) * h;
        const ey = Math.abs(m.b) * w + Math.abs(m.d) * h;
        return { w, h, ex, ey, a: m.a, b: m.b, c: m.c, d: m.d, op: parseFloat(cs.opacity) };
      });
      out.push({ name, drawn: cards.length, thumbW: tb.width, cards });
    }
    return out;
  });

  console.log('preset            desenhados | caixa do cartao (px de preview)   | extensao desenhada | fios de cabelo');
  for (const r of rows) {
    const hs = r.cards.map((c) => c.h), ws = r.cards.map((c) => c.w);
    const ey = r.cards.map((c) => c.ey);
    const hair = r.cards.filter((c) => c.h < 1 || c.ey < 1).length;
    console.log('  ' + r.name.padEnd(14), String(r.drawn).padStart(4), '  |',
      'alt', Math.min(...hs).toFixed(1).padStart(7) + '-' + Math.max(...hs).toFixed(1).padStart(7),
      'larg', Math.min(...ws).toFixed(1).padStart(7) + '-' + Math.max(...ws).toFixed(1).padStart(7), '|',
      'y', Math.min(...ey).toFixed(1).padStart(7) + '-' + Math.max(...ey).toFixed(1).padStart(7), '|',
      String(hair).padStart(6));
  }
  require("node:fs").writeFileSync(".shots/thumb-dom.json", JSON.stringify(rows, null, 1));
  console.log("-> .shots/thumb-dom.json");
  await browser.close();
})();
