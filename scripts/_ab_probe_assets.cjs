const fs = require('node:fs'), path = require('node:path');
const puppeteer = require('puppeteer-core');
const URL = 'http://localhost:3000';
const CH = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
const chrome = CH.find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
  const box = await page.$('input[type=checkbox]');
  if (box) { await box.click(); await sleep(150);
    for (const btn of await page.$$('button')) {
      const t = await page.evaluate(e => (e.textContent||'').trim(), btn);
      if (/library|agree|continue|start/i.test(t) && t.length < 40) { await btn.click(); break; }
    } await sleep(500); }
  await page.waitForSelector('canvas.stage-canvas', { timeout: 30000 });
  const info = await page.evaluate(() => {
    const fileInputs = [...document.querySelectorAll('input[type=file]')].map(i => ({
      accept: i.accept, multiple: i.multiple, cls: i.className,
      parentCls: i.parentElement && i.parentElement.className,
    }));
    // asset slot chrome
    const slots = [...document.querySelectorAll('[class*=asset], [class*=slot]')]
      .slice(0, 14).map(e => e.className + ' :: ' + (e.textContent||'').trim().slice(0, 24));
    const btnTexts = [...document.querySelectorAll('button')]
      .map(b => (b.title || b.getAttribute('aria-label') || b.textContent || '').trim())
      .filter(t => t && t.length < 28);
    return { fileInputs, slots, btnSample: [...new Set(btnTexts)].slice(0, 40) };
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 3000));
  await b.close();
})();
