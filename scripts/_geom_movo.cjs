// Measure the reference's ring GEOMETRY as a function of one control.
//
// Its Orbit presets size the ring from the count and the gap — there is no
// ring-size control at all — so the whole family's radius is a consequence of
// two numbers. Which law it follows depends on what "Gap 35%" is a percentage
// OF, and the two candidates disagree badly at the extremes:
//
//   gap is a share of the CARD   radius proportional to (1 + gap/100)
//   gap is a share of the SLOT   radius proportional to 1/(1 - gap/100)
//
// At gap 50 those are 1.5x and 2.0x. So: set the gap, measure the drawn
// content's bounding box, and read the law off the numbers.
//
// Usage: node scripts/_geom_movo.cjs "Pure 04" Gap 0 25 50
const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv[2] || 'Pure 04';
  const control = process.argv[3] || 'Gap';
  const values = process.argv.slice(4).map(Number);
const PIN = process.env.MS_PIN || null; // "X=30" pins a second axis
  if (!values.length) throw new Error('pass at least one value');

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

  const out = await page.evaluate(async (name, controlLabel, vals, pin) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const stage = () => [...document.querySelectorAll('canvas')]
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];

    btnBy(/^Explore \d+ Templates$/).click();
    await wait(1200);
    if (!byText(name)) { const fam = byText('Orbit'); (fam.closest('button') || fam.parentElement).click(); await wait(1200); }
    const item = byText(name);
    if (!item) return { error: name + ' not listed' };
    (item.closest('button') || item.parentElement).click();
    await wait(4000);

    // Bounding box of everything that is not background. Read through
    // toDataURL: re-reading a WebGL canvas directly hands back a stale buffer,
    // which has already made a spinning ring measure as motionless here.
    const measure = async () => {
      const c = stage();
      const W = 200, H = 200;
      const buf = document.createElement('canvas');
      buf.width = W; buf.height = H;
      const g = buf.getContext('2d', { willReadFrequently: true });
      const img = new Image();
      img.src = c.toDataURL('image/png');
      await img.decode();
      g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;
      // The stage background is a flat light grey (#F9F9F9 in their params);
      // anything meaningfully darker or lighter is a card.
      let minX = W, maxX = -1, minY = H, maxY = -1, lit = 0;
      const bg = [d[0], d[1], d[2]];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = (y * W + x) * 4;
          const diff = Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]);
          if (diff < 24) continue;
          lit++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      return { w: maxX - minX + 1, h: maxY - minY + 1, coverage: +(lit / (W * H)).toFixed(4) };
    };

    if (pin) { const [pk, pv] = pin.split('='); const pl = byText(pk);
      if (pl) { const pi = pl.parentElement && pl.parentElement.querySelector('input');
        if (pi) { const pr = Object.getPrototypeOf(pi);
          Object.getOwnPropertyDescriptor(pr, 'value').set.call(pi, String(pv));
          pi.dispatchEvent(new Event('input', { bubbles: true }));
          pi.dispatchEvent(new Event('change', { bubbles: true }));
          pi.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          pi.blur(); await wait(3000); } } }
    const label = byText(controlLabel);
    if (!label) return { error: 'control ' + controlLabel + ' not found' };
    const row = label.parentElement;
    const input = row && row.querySelector('input');

    // A pill row has no input; drive it by option label instead, so the same
    // measurement works for Surface (Flat/Wrap) as for Gap.
    if (!input) {
      const buttons = [...row.querySelectorAll('button')];
      if (!buttons.length) return { error: controlLabel + ' has neither input nor options' };
      const results = [];
      for (const want of vals) {
        const target = buttons[Number(want)] || buttons[0];
        target.click();
        await wait(3500);
        results.push({ val: (target.textContent || '').trim(), ...(await measure()) });
      }
      return { results, pill: true };
    }

    const results = [];
    for (const val of vals) {
      const proto = Object.getPrototypeOf(input);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, String(val));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.blur();
      await wait(3500);
      results.push({ val, ...(await measure()) });
    }
    return { results };
  }, wanted, control, values, PIN);

  if (out.error) throw new Error(out.error);
  const base = out.results[0];
  console.log(`${wanted} — ${control} sweep (bounding box of drawn content, 200x200 grid)`);
  console.log('| valor | largura | altura | cobertura | largura vs 1o |');
  console.log('|---|---|---|---|---|');
  for (const r of out.results) {
    console.log(`| ${r.val} | ${r.w} | ${r.h} | ${r.coverage} | ${(r.w / base.w).toFixed(3)}x |`);
  }
  if (!out.pill) {
    console.log('\nprevisto se gap e fracao do CARTAO:  '
      + out.results.map((r) => ((1 + r.val / 100) / (1 + base.val / 100)).toFixed(3) + 'x').join('  '));
    console.log('previsto se gap e fracao do SLOT:    '
      + out.results.map((r) => ((1 - base.val / 100) / (1 - r.val / 100)).toFixed(3) + 'x').join('  '));
  }
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
