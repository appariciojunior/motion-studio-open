// One contact sheet of many templates, laid out to match .shots/movo-orbit.jpg
// so the port can be compared against the reference side by side. shoot.cjs
// makes one sheet PER template, which is the right tool for studying motion
// over time and the wrong one for comparing 21 layouts at a glance.
//
// Usage: node scripts/_sheet_orbit.cjs orbit-3d-04 orbit-3d-05 ...
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.shots');
const URL = process.env.MS_URL || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error('pass template ids');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell',
    protocolTimeout: 300000,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(4000);

  const result = await page.evaluate(async (wanted) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const settle = async (n = 6) => { for (let i = 0; i < n; i++) await raf(); };
    const setInput = (el, value) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const select = document.querySelector('select');
    if (!select) return { error: 'no template select' };
    const names = [];
    const frames = [];
    for (const id of wanted) {
      const option = [...select.options].find((o) => o.value === id);
      if (!option) { names.push(id + ' (missing)'); frames.push(null); continue; }
      setInput(select, id);
      await settle(10);
      // Park the playhead so the picture is a chosen frame, never a race.
      const scrub = document.querySelector('.scrubber input[type=range]');
      if (scrub) { setInput(scrub, Math.round(Number(scrub.max) * 0.25)); await settle(8); }
      const canvas = document.querySelector('canvas.stage-canvas');
      names.push(option.textContent.trim());
      frames.push(canvas ? canvas.toDataURL('image/jpeg', 0.86) : null);
    }
    return { names, frames };
  }, ids);

  if (result.error) throw new Error(result.error);

  // Compose in Node so the page never has to hold 21 bitmaps at once.
  const cols = 5, cw = 250, ch = 333, pad = 6, lab = 16;
  const rows = Math.ceil(ids.length / cols);
  const html = `<canvas id=c width=${cols * cw + (cols + 1) * pad} height=${rows * (ch + lab) + (rows + 1) * pad}></canvas>`;
  const sheet = await page.evaluate(async (markup, data, cfg) => {
    document.body.innerHTML = markup;
    const c = document.getElementById('c');
    const g = c.getContext('2d');
    g.fillStyle = '#101014'; g.fillRect(0, 0, c.width, c.height);
    g.font = '11px ui-monospace, monospace';
    for (let i = 0; i < data.frames.length; i++) {
      const x = cfg.pad + (i % cfg.cols) * (cfg.cw + cfg.pad);
      const y = cfg.pad + Math.floor(i / cfg.cols) * (cfg.ch + cfg.lab + cfg.pad);
      g.fillStyle = '#8a8a94';
      g.fillText(data.names[i], x, y + 11);
      if (!data.frames[i]) continue;
      const img = new Image();
      img.src = data.frames[i];
      await img.decode();
      g.drawImage(img, x, y + cfg.lab, cfg.cw, cfg.ch);
    }
    return c.toDataURL('image/jpeg', 0.85);
  }, html, result, { cols, cw, ch, pad, lab });

  const file = path.join(OUT, 'orbit-sheet.jpg');
  fs.writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log(`${ids.length} templates -> ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
