// Read the LIVE parameter values MOVO's editor is actually rendering, by
// intercepting the clipboard behind its own "Copy Variant Values" button.
// Reading the chunk's baseline table tells you what the preset is authored as;
// this tells you what the stage is running, and the two are the only way to
// tell a stale click apart from a real difference.
//
// Usage: node scripts/_dump_spinner.cjs "Spinner 01" "Spinner 05"
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const OUT = process.env.MS_OUT || path.join(__dirname, '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv.slice(2);
  if (!wanted.length) throw new Error('pass template names');
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 600000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    window.__clip = [];
    const patch = () => {
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          get: () => ({ writeText: (t) => { window.__clip.push(t); return Promise.resolve(); } }),
        });
      } catch (e) { /* keep going: some builds also use execCommand */ }
    };
    patch();
    document.addEventListener('DOMContentLoaded', patch);
  });
  await page.goto('https://movo.video/', { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);

  const out = await page.evaluate(async (names) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const explorerOpen = () => !!btnBy(/^Cancel$/);
    const res = [];
    for (const name of names) {
      if (!explorerOpen()) { const b = btnBy(/^Explore \d+ Templates$/); if (b) b.click(); await wait(1200); }
      if (!byText(name)) { const fam = byText('Spinner'); if (fam) (fam.closest('button') || fam.parentElement).click(); await wait(1500); }
      const item = byText(name);
      if (!item) { res.push({ name, error: 'not listed' }); continue; }
      (item.closest('button') || item.parentElement).click();
      await wait(4000);
      const copy = btnBy(/Copy Variant Values/i);
      if (!copy) { res.push({ name, error: 'no copy button', buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 60) }); continue; }
      const before = window.__clip.length;
      copy.click();
      await wait(900);
      res.push({ name, text: window.__clip.slice(before).join('\n') || null });
    }
    return res;
  }, wanted);

  fs.mkdirSync(OUT, { recursive: true });
  for (const r of out) {
    if (r.error) { console.log(r.name + ': ' + r.error + (r.buttons ? ' | buttons: ' + r.buttons.join(' | ') : '')); continue; }
    const file = path.join(OUT, 'movo-live-' + r.name.replace(/\s+/g, '-').toLowerCase() + '.json');
    fs.writeFileSync(file, r.text || '');
    console.log('=== ' + r.name + ' -> ' + file);
    console.log((r.text || '(nada no clipboard)').slice(0, 2000));
  }
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
