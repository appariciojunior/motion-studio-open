// Photograph MOVO's Orbit family so its 21 variations can be studied side by
// side. The explorer renders a LIVE canvas per template, so one sheet of the
// open explorer is a complete visual reference — far better than reading 21
// parameter dumps and imagining the result.
//
// Headless on purpose: a hidden tab suspends rAF and every preview freezes on
// a stale frame, which is exactly the trap the browser pane falls into here.
//
// Usage: node scripts/_shoot_movo.cjs
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const OUT = path.join(__dirname, '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 300000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  // MOVO serves a "no mobile version" gate below a desktop width.
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto('https://movo.video/', { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);

  const result = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));

    const open = btnBy(/^Explore \d+ Templates$/);
    if (!open) return { error: 'no explore button' };
    open.click();
    await wait(1200);
    // Orbit is an accordion — only expand it if its names are not already up.
    if (!byText('Pure 01')) {
      const fam = byText('Orbit');
      if (!fam) return { error: 'no Orbit family' };
      (fam.closest('button') || fam.parentElement).click();
      await wait(1500);
    }
    // Let every preview canvas paint a few frames.
    await wait(4000);

    const names = ['Pure 01','Pure 02','Pure 03','Pure 04','Pure 05','Pure 06',
      'Carousel 01','Carousel 02','Carousel 03','Carousel 04','Carousel 05',
      'Lightroom 01','Lightroom 02','Lightroom 03','Lightroom 04','Lightroom 05',
      'Bloom 01','Bloom 02','Bloom 03','Bloom 04','Bloom 05'];
    const cards = [...document.querySelectorAll('canvas')].filter((c) => c.width > 300 && c.width < 500);
    if (!cards.length) return { error: 'no preview canvases' };

    const cw = 250, ch = 167, pad = 6, lab = 16, cols = 5;
    const rows = Math.ceil(cards.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * cw + (cols + 1) * pad;
    sheet.height = rows * (ch + lab) + (rows + 1) * pad;
    const g = sheet.getContext('2d');
    g.fillStyle = '#101014';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '11px ui-monospace, monospace';
    cards.forEach((c, i) => {
      const x = pad + (i % cols) * (cw + pad);
      const y = pad + Math.floor(i / cols) * (ch + lab + pad);
      g.fillStyle = '#8a8a94';
      g.fillText(names[i] || ('#' + i), x, y + 11);
      try { g.drawImage(c, x, y + lab, cw, ch); } catch (e) {}
    });
    return { data: sheet.toDataURL('image/jpeg', 0.85), count: cards.length };
  });

  if (result.error) throw new Error(result.error);
  const file = path.join(OUT, 'movo-orbit.jpg');
  fs.writeFileSync(file, Buffer.from(result.data.split(',')[1], 'base64'));
  console.log(`${result.count} previews -> ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
