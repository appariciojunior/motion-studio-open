#!/usr/bin/env node
// ============================================================
//  _shot_shape — photograph a template at a FORCED card shape
//
//  scripts/shoot.cjs always shoots the scene as it loads, which is the
//  template's declared card shape. The shape is the SCENE's to choose, and a
//  whole class of layout bug only appears at the shapes nobody photographs:
//  the Ticker family held its authored gap as a centre distance and collided
//  with itself at the 1:1 card in 24 of its 25 presets.
//
//  Usage: MS_SHAPE=1:1 MS_FRAMES=2 node scripts/_shot_shape.cjs ticker-21
//  Output: .shots/<id>-shape-<shape>.jpg
// ============================================================
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const URL = process.env.MS_URL || 'http://localhost:3000';
const SHAPE = process.env.MS_SHAPE || '1:1';
const SHOTS = Number(process.env.MS_FRAMES || 2);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ids = process.argv.slice(2);
  fs.mkdirSync('.shots', { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-lcd-text','--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('  [page error]', e.message));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
  const box = await page.$('input[type=checkbox]');
  if (box) { await box.click(); await sleep(150);
    for (const b of await page.$$('button')) {
      const t = (await page.evaluate((el) => (el.textContent || '').trim(), b)) || '';
      if (/library|agree|continue|start/i.test(t) && t.length < 40) { await b.click(); break; }
    }
    await sleep(600);
  }
  await page.waitForSelector('canvas.stage-canvas', { timeout: 30000 });

  for (const id of ids) {
    const out = await page.evaluate(async (id, shape, shots) => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const settle = async (n = 4) => { for (let i = 0; i < n; i++) await raf(); };
      const setInput = (el, value) => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setInput(document.querySelector('select'), id);
      await settle(6);

      // Open whichever rail tab owns the card-shape pills, then click the shape.
      let pills = document.querySelector('.card-shape-pills');
      if (!pills) {
        for (const b of document.querySelectorAll('.icon-rail button, [class*=rail] button')) {
          b.click(); await settle(2);
          pills = document.querySelector('.card-shape-pills');
          if (pills) break;
        }
      }
      if (!pills) return { error: 'card shape pills not found' };
      const hit = [...pills.querySelectorAll('button')].find((b) => b.textContent.trim() === shape);
      if (!hit) return { error: 'shape ' + shape + ' not offered' };
      hit.click();
      await settle(8);

      const scrub = document.querySelector('.scrubber input[type=range]');
      const total = Number(scrub.max) + 1;
      const canvas = document.querySelector('canvas.stage-canvas');
      const frames = Array.from({ length: shots }, (_, i) => Math.round((i / shots) * total) % total);
      const cellW = 380, cellH = Math.round(cellW * (canvas.height / canvas.width));
      const pad = 8, label = 18;
      const sheet = document.createElement('canvas');
      sheet.width = frames.length * cellW + (frames.length + 1) * pad;
      sheet.height = cellH + label + 2 * pad;
      const g = sheet.getContext('2d');
      g.fillStyle = '#101014'; g.fillRect(0, 0, sheet.width, sheet.height);
      g.font = '12px ui-monospace, monospace'; g.textBaseline = 'top';
      for (let i = 0; i < frames.length; i++) {
        setInput(scrub, frames[i]); await settle(4);
        const x = pad + i * (cellW + pad);
        g.fillStyle = '#8a8a94';
        g.fillText(`${id}  card ${shape}  f${frames[i]}`, x, pad);
        g.drawImage(canvas, x, pad + label, cellW, cellH);
      }
      return { dataUrl: sheet.toDataURL('image/jpeg', 0.86), frames };
    }, id, SHAPE, SHOTS);
    if (out.error) { console.log(`${id}: FAILED ${out.error}`); continue; }
    const file = path.join('.shots', `${id}-shape-${SHAPE.replace(':','x')}.jpg`);
    fs.writeFileSync(file, Buffer.from(out.dataUrl.split(',')[1], 'base64'));
    console.log(`${id} @ card ${SHAPE} -> ${file}`);
  }
  await browser.close();
})();
