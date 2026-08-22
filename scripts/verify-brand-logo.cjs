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
if (!executablePath) throw new Error('Chrome/Edge not found. Set CHROME_PATH to run the brand verification.');

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1294, height: 912, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.rail-logo svg');

    const logo = await page.evaluate(() => {
      const container = document.querySelector('.rail-logo');
      const svg = container.querySelector('svg');
      const path = svg.querySelector('path');
      const containerStyle = getComputedStyle(container);
      const svgRect = svg.getBoundingClientRect();
      return {
        background: containerStyle.backgroundColor,
        color: containerStyle.color,
        width: Math.round(svgRect.width),
        height: Math.round(svgRect.height),
        viewBox: svg.getAttribute('viewBox'),
        pathFill: path ? getComputedStyle(path).fill : null,
      };
    });

    assertEqual(logo.background, 'rgba(0, 0, 0, 0)', 'logo background');
    assertEqual(logo.color, 'rgb(244, 201, 20)', 'logo color');
    assertEqual(logo.pathFill, 'rgb(244, 201, 20)', 'logo path fill');
    assertEqual(logo.width, 30, 'logo width');
    assertEqual(logo.height, 30, 'logo height');
    assertEqual(logo.viewBox, '0 0 30 30', 'logo viewBox');

    console.log('Brand logo verification passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
