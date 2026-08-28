// Photograph each section's heading area, so I look at what the user looks at
// instead of arguing with a number.
const puppeteer = require('puppeteer-core');
const path = require('node:path');
const OUT = 'C:/Users/k13/AppData/Local/Temp/claude/C--Users-k13-Downloads-motion-studio-open-main/e316da77-4eaa-4671-bd28-fabf216789fc/scratchpad';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false, protocolTimeout: 300000,
    args: ['--window-size=1500,1000', '--hide-scrollbars'],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  });
  const p = await b.newPage();
  await p.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await sleep(12000);

  const names = ['Motion catalogue', 'Device mockup studio', 'The editor', 'Why Motion Studio'];
  for (let i = 0; i < names.length; i++) {
    await p.evaluate((txt) => {
      const e = [...document.querySelectorAll('.eyebrow')].find((n) => (n.textContent || '').trim() === txt);
      e.scrollIntoView({ block: 'start', behavior: 'instant' });
      window.scrollBy(0, -90);
    }, names[i]);
    await sleep(1600);
    const file = path.join(OUT, 'sec-' + i + '.png');
    await p.screenshot({ path: file, captureBeyondViewport: false });
    console.log('sec-' + i + '.png  <-', names[i]);
  }
  await b.close();
})().catch((e) => { console.error('FALHOU', e.message); process.exit(1); });
