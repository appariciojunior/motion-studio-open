// Probe ONE MOVO control: photograph a template, change a single value, and
// photograph it again. Some controls cannot be inferred from the parameter
// dump — "Flip" is a yes/no with no hint of what it flips — and guessing has
// already cost a rebuild once. Two pictures answer it.
//
// Usage: node scripts/_probe_movo.cjs "Lightroom 01" Flip
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const OUT = path.join(__dirname, '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv[2] || 'Lightroom 01';
  const control = process.argv[3] || 'Flip';
const setTo = process.argv[4] !== undefined ? Number(process.argv[4]) : null;
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

  const result = await page.evaluate(async (name, controlLabel, setTo) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const stage = () => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];

    // Select the template.
    const open = btnBy(/^Explore \d+ Templates$/);
    if (!open) return { error: 'no explore button' };
    open.click();
    await wait(1200);
    if (!byText(name)) {
      const fam = byText('Orbit');
      if (!fam) return { error: 'no Orbit family' };
      (fam.closest('button') || fam.parentElement).click();
      await wait(1200);
    }
    const item = byText(name);
    if (!item) return { error: 'template ' + name + ' not listed' };
    (item.closest('button') || item.parentElement).click();
    await wait(4000);

    const shot = () => { const c = stage(); return c ? c.toDataURL('image/jpeg', 0.85) : null; };
    const before = shot();
    if (!before) return { error: 'no stage canvas' };

    const label = byText(controlLabel);
    if (!label) return { error: 'control ' + controlLabel + ' not in panel' };
    let row = label.parentElement;
    for (let i = 0; i < 4 && row && !row.querySelector('input, button'); i++) row = row.parentElement;

    // A numeric control is driven by typing a value, so the caller can ask for
    // a specific one. React caches the DOM value, so set it through the native
    // setter or the change event carries the stale one.
    if (setTo !== null && row && row.querySelector('input')) {
      const input = row.querySelector('input');
      const proto = Object.getPrototypeOf(input);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, String(setTo));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.blur();
      await wait(4000);
      return { before, after: shot(), labels: ['as shipped', 'set to ' + setTo], clicked: String(setTo) };
    }

    // Otherwise it is a pill/toggle row: click the option that is not current.
    const opts = row ? [...row.querySelectorAll('button')] : [];
    if (opts.length < 2) return { error: 'control has no option buttons' };
    // Toggle to the other option; report both labels so the caller knows which
    // picture is which.
    const labels = opts.map((b) => (b.textContent || '').trim());
    const target = opts.find((b) => !/true/.test(String(b.getAttribute('aria-pressed')))
      && !(b.className || '').toString().includes('active')) || opts[opts.length - 1];
    target.click();
    await wait(4000);
    const after = shot();
    return { before, after, labels, clicked: (target.textContent || '').trim() };
  }, wanted, control, setTo);

  if (result.error) throw new Error(result.error);
  const slug = (wanted + '-' + control + (setTo === null ? '' : '-' + setTo)).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  for (const [key, data] of [['before', result.before], ['after', result.after]]) {
    if (!data) continue;
    const file = path.join(OUT, `probe-${slug}-${key}.jpg`);
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log(`${key} -> ${file}`);
  }
  console.log('options:', result.labels.join(' / '), '| clicked:', result.clicked);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
