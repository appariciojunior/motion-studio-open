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
if (!executablePath) throw new Error('Chrome/Edge not found. Set CHROME_PATH to verify the background panel.');

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1294, height: 912, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('aside.rail');

    await page.evaluate(() => {
      const library = [...document.querySelectorAll('aside.rail button')]
        .find((element) => element.textContent?.trim() === 'Library');
      if (!(library instanceof HTMLElement)) throw new Error('Library navigation is missing');
      library.click();
    });
    await page.waitForSelector('.collapsible-head');
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('.collapsible-head')]
        .find((element) => element.textContent?.trim().includes('Background'));
      if (!(heading instanceof HTMLElement)) throw new Error('Background collapsible is missing');
      heading.click();
    });
    await page.waitForSelector('.background-tabs');

    const tabLabels = await page.$$eval('.background-tabs button', (buttons) => buttons.map((button) => button.textContent?.trim()));
    assertEqual(tabLabels.join('|'), 'Colour|Gradient|Image', 'Background tabs match the reference');

    await page.click('[data-background-tab="colour"]');
    await page.waitForSelector('.background-colour-panel');
    const colourValue = await page.$eval('.background-hex-field', (input) => input.value);
    if (!/^#[0-9a-f]{8}$/i.test(colourValue)) throw new Error(`Expected #RRGGBBAA colour, received ${colourValue}`);
    await page.click('.background-colour-swatch');
    await page.waitForSelector('.background-colour-picker');

    await page.click('[data-background-tab="gradient"]');
    await page.waitForSelector('.background-gradient-grid');
    assertEqual(await page.$$eval('.background-gradient-preset', (presets) => presets.length), 8, 'Gradient preset count');
    await page.click('.background-gradient-preset[data-custom="true"]');
    await page.waitForSelector('.background-gradient-custom');

    await page.click('[data-background-tab="image"]');
    await page.waitForSelector('.background-image-panel');
    assertEqual(
      await page.$eval('.background-image-upload', (element) => element.textContent?.trim()),
      'Upload image (max 5 MB)',
      'Image upload label',
    );
    assertEqual(await page.$eval('.background-image-input', (input) => input.accept), 'image/*', 'Image input accept type');

    console.log('Background panel UI verification passed for all three states.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
