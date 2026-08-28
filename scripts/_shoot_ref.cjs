// Photograph a reference template so its GEOMETRY can be studied — is the ring
// a drum or a flat disc, how far do the cards lean, how much of the frame does
// it fill. The browser pane cannot do this: a hidden tab suspends rAF, which
// freezes the reference's canvas on a stale frame. A headless page considers
// itself visible, so its render loop runs normally.
//
// Usage: node scripts/_shoot_ref.cjs "Showcase Stream"
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const OUT = path.join(__dirname, '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv[2] || 'Showcase Stream';
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 300000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto('https://animos.app/editor', { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(4000);

  // Dismiss any first-run tour so the stage is unobstructed.
  for (const label of [/skip tour/i, /got it/i, /close/i]) {
    for (const b of await page.$$('button')) {
      const t = ((await page.evaluate((el) => el.textContent, b)) || '').trim();
      if (label.test(t) && t.length < 24) { await b.click().catch(() => {}); await sleep(400); }
    }
  }

  const result = await page.evaluate(async (name) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const settle = async (n) => { for (let i = 0; i < n; i++) await raf(); };

    const pick = (label) => {
      const b = [...document.querySelectorAll('button')].find((x) => {
        const t = (x.textContent || '').replace(/\s+/g, ' ').trim();
        return t === label + label || t === 'New' + label + label || t === label;
      });
      if (b) b.click();
      return !!b;
    };
    if (!pick(name)) return { error: 'template button not found: ' + name };
    await settle(15);

    const stage = [...document.querySelectorAll('canvas')]
      .filter((c) => c.width >= 800)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!stage) return { error: 'stage canvas not found' };

    // Sample across the loop by letting the reference's own clock advance —
    // its timeline is not addressable from here, so wait between grabs.
    const shots = [];
    for (let i = 0; i < 4; i++) {
      await settle(12);
      shots.push(stage.toDataURL('image/jpeg', 0.9));
    }

    const cellW = 380;
    const cellH = Math.round(cellW * (stage.height / stage.width));
    const cols = 2, rows = 2, pad = 8, label = 18;
    const sheet = document.createElement('canvas');
    sheet.width = cols * cellW + (cols + 1) * pad;
    sheet.height = rows * (cellH + label) + (rows + 1) * pad;
    const g = sheet.getContext('2d');
    g.fillStyle = '#101014';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '12px ui-monospace, monospace';
    g.textBaseline = 'top';

    await Promise.all(shots.map((src, i) => new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const col = i % cols, row = Math.floor(i / cols);
        const x = pad + col * (cellW + pad);
        const y = pad + row * (cellH + label + pad);
        g.fillStyle = '#8a8a94';
        g.fillText('sample ' + (i + 1), x, y);
        g.drawImage(img, x, y + label, cellW, cellH);
        res();
      };
      img.onerror = () => res();
      img.src = src;
    })));

    return { dataUrl: sheet.toDataURL('image/jpeg', 0.88), canvas: [stage.width, stage.height] };
  }, wanted);

  if (result.error) { console.error(result.error); await browser.close(); process.exit(1); }
  const file = path.join(OUT, `_ref-${wanted.replace(/\s+/g, '-').toLowerCase()}.jpg`);
  fs.writeFileSync(file, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
  console.log(`ref canvas ${result.canvas.join('x')} -> ${path.relative(process.cwd(), file)}`);
  await browser.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
