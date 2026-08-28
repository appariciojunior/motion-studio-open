#!/usr/bin/env node
// Captures our Flip at given frames with arqe's own demo artwork loaded, so the
// two renders can be compared on APPEARANCE and not just geometry.
const fs = require('node:fs'), path = require('node:path');
const puppeteer = require('puppeteer-core');

const URL = 'http://localhost:3000';
const ASSETS = process.env.MS_ASSETS;
const OUT = process.env.MS_OUT || path.join(__dirname, '..', '.shots');
const TEMPLATE = process.argv[2] || 'flip-01';
const FRAMES = (process.argv[3] || '120,147,153').split(',').map(Number);

const CH = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
const chrome = CH.find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await b.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    page.on('pageerror', e => console.error('  [page error]', e.message));
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });

    const box = await page.$('input[type=checkbox]');
    if (box) {
      await box.click(); await sleep(150);
      for (const btn of await page.$$('button')) {
        const t = await page.evaluate(e => (e.textContent || '').trim(), btn);
        if (/library|agree|continue|start/i.test(t) && t.length < 40) { await btn.click(); break; }
      }
      await sleep(500);
    }
    await page.waitForSelector('canvas.stage-canvas', { timeout: 30000 });
    await page.waitForSelector('.scrubber input[type=range]', { timeout: 30000 });

    // pick the template first so the asset count settles to its own
    await page.evaluate((id) => {
      const s = document.querySelector('select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, id);
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }, TEMPLATE);
    await sleep(1200);

    if (ASSETS) {
      const files = fs.readdirSync(ASSETS).filter(f => /\.(png|jpe?g)$/i.test(f)).sort()
        .map(f => path.join(ASSETS, f));
      const input = await page.$('.dropzone input[type=file]');
      await input.uploadFile(...files);
      await sleep(3500);
    }

    const names = await page.evaluate(() =>
      [...document.querySelectorAll('.asset-name')].map(e => e.textContent.trim()));
    console.log('assets:', names.join(' | '));

    for (const f of FRAMES) {
      const dataUrl = await page.evaluate(async (frame) => {
        const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const scrub = document.querySelector('.scrubber input[type=range]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(scrub, String(frame));
        scrub.dispatchEvent(new Event('input', { bubbles: true }));
        scrub.dispatchEvent(new Event('change', { bubbles: true }));
        for (let i = 0; i < 8; i++) await raf();
        return document.querySelector('canvas.stage-canvas').toDataURL('image/jpeg', 0.92);
      }, f);
      const file = path.join(OUT, `ours-f${f}.jpg`);
      fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`f${f} -> ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
    }
  } finally { await b.close(); }
})();
