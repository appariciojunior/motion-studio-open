// Read a MOVO template's FULL control panel — both tabs, with each control's
// live value. The Composition tab was read on the first pass and the Animation
// tab was not, which is a good way to port a family's shape and miss its feel.
//
// Usage: node scripts/_panel_movo.cjs "Carousel 03"
const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv[2] || 'Carousel 03';
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

  const out = await page.evaluate(async (name) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));

    const open = btnBy(/^Explore \d+ Templates$/);
    if (!open) return { error: 'no explore button' };
    open.click();
    await wait(1200);
    if (!byText(name)) {
      const fam = byText(process.env.MS_FAM || 'Orbit');
      if (!fam) return { error: 'no Orbit family' };
      (fam.closest('button') || fam.parentElement).click();
      await wait(1200);
    }
    const item = byText(name);
    if (!item) return { error: name + ' not listed' };
    (item.closest('button') || item.parentElement).click();
    await wait(3000);

    // Pair each control with its own value instead of dumping a bare list of
    // inputs. Reading them positionally means counting rows by eye, and the
    // row set CHANGES per preset — a Billboard preset shows fields a radial one
    // does not — so the same index means different controls on different
    // templates. That is how a Zoom got read as a scale contrast.
    // Iterate the LABELS, not the inputs. MOVO builds each control row as
    // <span class="ed-type-section">Name</span> followed by its widget, and the
    // row set changes per preset — a Billboard preset shows fields a radial one
    // does not — so reading inputs positionally means the same index is a
    // different control on a different template. That is exactly how a Zoom of
    // 400% got read as a depth contrast.
    const readPanel = () => {
      const rows = [];
      for (const label of document.querySelectorAll('.ed-type-section')) {
        const row = label.parentElement;
        if (!row) continue;
        const input = row.querySelector('input');
        const buttons = [...row.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean);
        const name = label.textContent.trim();
        if (!name) continue;
        rows.push({ label: name, value: input ? input.value : (buttons.length ? buttons.join('/') : '') });
      }
      return { rows, text: document.body.innerText };
    };
    const tabs = {};
    for (const tab of ['Composition', 'Animation']) {
      const b = btnBy(new RegExp('^' + tab + '$'));
      if (!b) { tabs[tab] = { error: 'tab not found' }; continue; }
      b.click();
      await wait(1200);
      tabs[tab] = readPanel();
    }
    return { tabs };
  }, wanted);

  if (out.error) throw new Error(out.error);
  for (const [tab, data] of Object.entries(out.tabs)) {
    console.log('\n===== ' + tab + ' =====');
    if (data.error) { console.log(data.error); continue; }
    for (const r of data.rows) console.log('  ' + r.label.padEnd(18) + r.value);

  }
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
