#!/usr/bin/env node

const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const url = process.env.MOTION_STUDIO_URL || 'http://localhost:3000/';
const candidates = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const executablePath = process.env.CHROME_PATH || candidates.find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('Chrome/Edge not found. Set CHROME_PATH to run the novelty verification.');

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tpl-item');
    const badges = await page.$$eval('.tpl-new, .tpl-new-inline', (nodes) => nodes.length);
    check(badges === 0, 'Novo badges must remain hidden until a future feature launch is explicitly marked.');

    if (failures.length) {
      throw new Error(`Template novelty verification failed:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`);
    }
    console.log('Template novelty verification passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
