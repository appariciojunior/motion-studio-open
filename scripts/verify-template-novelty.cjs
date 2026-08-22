#!/usr/bin/env node

const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const url = process.env.MOTION_STUDIO_URL || 'http://localhost:3000/';
const storageKey = 'motion-seen-templates-v1';
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

async function groupState(page) {
  return page.evaluate(() => {
    const groupButton = [...document.querySelectorAll('.tpl-item')]
      .find((button) => button.querySelector('.tpl-name')?.textContent === 'Spiral');
    const panel = document.querySelector('#template-group-spiral');
    return {
      hasGroupBadge: !!groupButton?.querySelector('.tpl-new-inline'),
      cardBadgeCount: panel?.querySelectorAll('.tpl-new').length ?? 0,
      isOpen: !!panel,
    };
  });
}

(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate((key) => localStorage.removeItem(key), storageKey);
    await page.reload({ waitUntil: 'networkidle0' });

    const before = await groupState(page);
    check(before.hasGroupBadge, 'Spiral must begin with a Novo badge for an unseen user');

    await page.evaluate(() => {
      const button = [...document.querySelectorAll('.tpl-item')]
        .find((candidate) => candidate.querySelector('.tpl-name')?.textContent === 'Spiral');
      button?.click();
    });
    await page.waitForSelector('#template-group-spiral');

    const afterOpen = await groupState(page);
    check(afterOpen.cardBadgeCount === 0, 'opening Spiral must remove Novo from every visible card');
    check(!afterOpen.hasGroupBadge, 'opening Spiral must remove Novo from the family title');

    const persisted = await page.evaluate((key) => {
      try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
    }, storageKey);
    check(Array.isArray(persisted) && persisted.length >= 2, 'opening Spiral must persist all viewed template ids');

    await page.reload({ waitUntil: 'networkidle0' });
    const afterReload = await groupState(page);
    check(!afterReload.hasGroupBadge, 'viewed families must stay without Novo after reload');

    if (Array.isArray(persisted) && persisted.length > 0) {
      await page.evaluate((key, ids) => localStorage.setItem(key, JSON.stringify(ids.slice(1))), storageKey, persisted);
      await page.reload({ waitUntil: 'networkidle0' });
      const withFutureUnseen = await groupState(page);
      check(withFutureUnseen.hasGroupBadge, 'an unseen template id must make Novo appear again');
    }

    await page.evaluate((key) => localStorage.setItem(key, '{broken'), storageKey);
    await page.reload({ waitUntil: 'networkidle0' });
    const afterCorruption = await groupState(page);
    check(afterCorruption.hasGroupBadge, 'corrupt novelty storage must fail safely and show unseen content');

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
