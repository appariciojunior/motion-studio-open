// Photograph MOVO's STAGE for a list of templates, not its explorer thumbnails.
//
// The thumbnails are 250x167 landscape while our stage is 4:5 portrait, so a
// tightly framed preset fills one and not the other. Comparing the two made a
// faithfully converted camera distance look wrong. The stage renders at the
// preset's own 4:5, which is what our sheet renders too.
//
// Usage: node scripts/_stage_movo.cjs "Lightroom 04" "Carousel 05" "Bloom 01"
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const OUT = path.join(__dirname, '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv.slice(2);
  if (!wanted.length) throw new Error('pass template names');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 300000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto('https://movo.video/', { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);

  const result = await page.evaluate(async (names) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const explorerOpen = () => !!btnBy(/^Cancel$/);
    const stage = () => [...document.querySelectorAll('canvas')]
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];

    const shots = [];
    for (const name of names) {
      // "Explore" is a toggle and the family header is an accordion — read the
      // state before clicking either, or every other pick silently no-ops.
      if (!explorerOpen()) { btnBy(/^Explore \d+ Templates$/).click(); await wait(1000); }
      if (!byText(name)) { const fam = byText('Orbit'); if (fam) (fam.closest('button') || fam.parentElement).click(); await wait(1000); }
      const item = byText(name);
      if (!item) { shots.push({ name, data: null }); continue; }
      (item.closest('button') || item.parentElement).click();
      await wait(4500);
      const c = stage();
      shots.push({ name, data: c ? c.toDataURL('image/jpeg', 0.85) : null, w: c && c.width, h: c && c.height });
    }
    return shots;
  }, wanted);

  for (const shot of result) {
    if (!shot.data) { console.log(shot.name + ': NOT CAPTURED'); continue; }
    const file = path.join(OUT, 'movo-stage-' + shot.name.replace(/\s+/g, '-').toLowerCase() + '.jpg');
    fs.writeFileSync(file, Buffer.from(shot.data.split(',')[1], 'base64'));
    console.log(`${shot.name} (${shot.w}x${shot.h}) -> ${file}`);
  }
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
