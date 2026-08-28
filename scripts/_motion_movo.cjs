// Does this template MOVE continuously, or step and hold?
//
// The panel shows an Action time and a Pause time on some Orbit presets and
// not others, which suggests a stepped conveyor — but a control's presence is
// not proof of its effect. This samples the stage over wall-clock time and
// reports how much changed between consecutive samples. A continuous ring
// gives a flat series; a stepped one gives peaks separated by near-zero holds.
//
// Reports NUMBERS, not pictures: judging "did it pause" by eye across a strip
// of frames is exactly the kind of call that has been wrong before.
//
// Usage: node scripts/_motion_movo.cjs "Carousel 03" [samples] [intervalMs]
const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv[2] || 'Carousel 03';
  const samples = Number(process.argv[3] || 40);
  const gap = Number(process.argv[4] || 150);

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

  const series = await page.evaluate(async (name, n, ms) => {
    const wait = (t) => new Promise((r) => setTimeout(r, t));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((x) => x.children.length === 0 && (x.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const stage = () => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];

    const open = btnBy(/^Explore \d+ Templates$/);
    open.click();
    await wait(1200);
    if (!byText(name)) {
      const fam = byText('Orbit');
      (fam.closest('button') || fam.parentElement).click();
      await wait(1200);
    }
    const item = byText(name);
    if (!item) return { error: name + ' not listed' };
    (item.closest('button') || item.parentElement).click();
    await wait(4000);

    const canvas = stage();
    if (!canvas) return { error: 'no stage canvas' };
    // Downsample hard: the question is "how much of the picture changed", and a
    // coarse grid answers it while keeping 40 samples cheap enough to hold.
    const W = 96, H = 96;
    const buf = document.createElement('canvas');
    buf.width = W; buf.height = H;
    const g = buf.getContext('2d', { willReadFrequently: true });
    const grab = async () => {
      const url = canvas.toDataURL('image/png');
      const img = new Image();
      img.src = url;
      await img.decode();
      g.clearRect(0, 0, W, H);
      g.drawImage(img, 0, 0, W, H);
      return g.getImageData(0, 0, W, H).data;
    };

    const out = [];
    let previous = await grab();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      await wait(ms);
      const now = await grab();
      let sum = 0;
      for (let p = 0; p < now.length; p += 4) sum += Math.abs(now[p] - previous[p]);
      out.push({ t: Math.round(performance.now() - t0), d: Math.round(sum / (W * H)) });
      previous = now;
    }
    return { out };
  }, wanted, samples, gap);

  if (series.error) throw new Error(series.error);
  const values = series.out.map((s) => s.d);
  const peak = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  // A hold is a sample where almost nothing moved relative to this clip's own
  // busiest moment, so the threshold scales with the template.
  const holds = values.filter((v) => v < peak * 0.12).length;

  console.log(`${wanted}: ${values.length} samples every ${gap}ms`);
  console.log('  change per sample: ' + values.join(' '));
  console.log(`  peak ${peak}  mean ${mean.toFixed(1)}  peak/mean ${(peak / Math.max(mean, 0.01)).toFixed(2)}`);
  console.log(`  near-still samples (<12% of peak): ${holds}/${values.length}`);
  console.log(`  verdict: ${holds >= values.length * 0.15 ? 'STEPS AND HOLDS' : 'continuous'}`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
