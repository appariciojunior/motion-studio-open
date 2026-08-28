// One preset, one optional control nudge, one stage photograph. Used to settle
// a disagreement between a pixel measurement and a model of the extracted math:
// a bounding box can be blind to a nearly edge-on card, and that card is
// exactly where a wrong camera would show up.
//
// Usage: MS_SET="Perspective=2000" node scripts/_shot_spinner.cjs "Spinner 01"
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const OUT = process.env.MS_OUT || path.join(__dirname, '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error('pass a template name');
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

  const out = await page.evaluate(async (wanted, set, shots) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const explorerOpen = () => !!btnBy(/^Cancel$/);
    const stage = () => [...document.querySelectorAll('canvas')]
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];

    if (!explorerOpen()) { const b = btnBy(/^Explore \d+ Templates$/); if (b) b.click(); await wait(1200); }
    if (!byText(wanted)) { const fam = byText('Spinner'); if (fam) (fam.closest('button') || fam.parentElement).click(); await wait(1500); }
    const item = byText(wanted);
    if (!item) return { error: wanted + ' not listed' };
    (item.closest('button') || item.parentElement).click();
    await wait(4500);

    let echo = null;
    if (set) {
      const [lbl, val] = set.split('=');
      const label = byText(lbl);
      const row = label && label.parentElement;
      const input = row && row.querySelector('input');
      if (!input) return { error: 'control "' + lbl + '" not found' };
      const proto = Object.getPrototypeOf(input);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, String(val));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.blur();
      await wait(3500);
      echo = lbl + '=' + input.value;
    }
    const frames = [];
    for (let i = 0; i < shots; i++) { frames.push(stage().toDataURL('image/jpeg', 0.9)); if (i < shots - 1) await wait(420); }
    return { echo, frames, w: stage().width, h: stage().height };
  }, name, process.env.MS_SET || null, Number(process.env.MS_SHOTS || 1));

  if (out.error) throw new Error(out.error);
  fs.mkdirSync(OUT, { recursive: true });
  const tag = (name + (out.echo ? '-' + out.echo : '')).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
  out.frames.forEach((f, i) => {
    const file = path.join(OUT, 'movo-shot-' + tag + (out.frames.length > 1 ? '-' + i : '') + '.jpg');
    fs.writeFileSync(file, Buffer.from(f.split(',')[1], 'base64'));
    console.log(`${name} ${out.echo || ''} (${out.w}x${out.h}) -> ${file}`);
  });
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
