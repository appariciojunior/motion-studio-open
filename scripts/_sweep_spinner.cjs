// Sweep ONE control of a MOVO spinner preset and measure the swept bounding box
// at each value. A single frame is not comparable to anything (the phase at
// capture is unknown), so every value is measured as the union over several
// samples — the envelope of the whole revolution, which a model of the
// extracted math can predict exactly.
//
// Usage: node scripts/_sweep_spinner.cjs "Spinner 01" Perspective 125 500 1000 1500
const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv[2];
  const control = process.argv[3];
  const values = process.argv.slice(4);
  if (!wanted || !control || !values.length) throw new Error('usage: preset control v1 v2 ...');

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 900000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto('https://movo.video/', { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);

  const out = await page.evaluate(async (name, controlLabel, vals) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const explorerOpen = () => !!btnBy(/^Cancel$/);
    const stage = () => [...document.querySelectorAll('canvas')]
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];

    if (!explorerOpen()) { const b = btnBy(/^Explore \d+ Templates$/); if (b) b.click(); await wait(1200); }
    if (!byText(name)) { const fam = byText('Spinner'); if (fam) (fam.closest('button') || fam.parentElement).click(); await wait(1500); }
    const item = byText(name);
    if (!item) return { error: name + ' not listed' };
    (item.closest('button') || item.parentElement).click();
    await wait(4500);

    const N = 300;
    const envelope = async (samples) => {
      const c = stage();
      let minX = N, maxX = -1, minY = N, maxY = -1;
      for (let s = 0; s < samples; s++) {
        const buf = document.createElement('canvas');
        buf.width = N; buf.height = N;
        const g = buf.getContext('2d', { willReadFrequently: true });
        const img = new Image();
        img.src = c.toDataURL('image/png');   // a direct read hands back a stale buffer
        await img.decode();
        g.drawImage(img, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        const bg = [d[0], d[1], d[2]];
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const p = (y * N + x) * 4;
          if (Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]) < 24) continue;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        if (s < samples - 1) await wait(430);
      }
      return { x0: +(minX / N).toFixed(4), x1: +((maxX + 1) / N).toFixed(4),
               y0: +(minY / N).toFixed(4), y1: +((maxY + 1) / N).toFixed(4) };
    };

    const label = byText(controlLabel);
    if (!label) return { error: 'control "' + controlLabel + '" not in panel', labels: [...document.querySelectorAll('.ed-type-section')].map((n) => n.textContent.trim()) };
    const row = label.parentElement;
    const input = row && row.querySelector('input');
    const results = [];
    for (const val of vals) {
      if (input) {
        const proto = Object.getPrototypeOf(input);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, String(val));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        input.blur();
      } else {
        const buttons = [...row.querySelectorAll('button')];
        const target = buttons.find((b) => b.textContent.trim().toLowerCase() === String(val).toLowerCase()) || buttons[Number(val)] || buttons[0];
        if (target) target.click();
      }
      await wait(3200);
      // Read the row back: the value that stuck is the only one worth reporting.
      const echoed = input ? input.value : [...row.querySelectorAll('button')].map((b) => b.textContent.trim()).join('/');
      results.push({ val, echoed, ...(await envelope(6)) });
    }
    return { results };
  }, wanted, control, values);

  if (out.error) { console.log(out.error); if (out.labels) console.log('labels: ' + out.labels.join(' | ')); process.exit(1); }
  console.log(`${wanted} — ${control}`);
  console.log('| valor | eco | x0 | x1 | y0 | y1 | largura | altura |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of out.results) {
    console.log(`| ${r.val} | ${r.echoed} | ${r.x0} | ${r.x1} | ${r.y0} | ${r.y1} | ${(r.x1 - r.x0).toFixed(4)} | ${(r.y1 - r.y0).toFixed(4)} |`);
  }
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
