// Measure ONE card on the reference — its width, its height, and the ring's
// radius — instead of inferring them from how densely a ring fills its box.
//
// Two earlier measurements of the same quantity disagreed: sweeping Gap said
// the card is 1/(1+gap/100) of its slot, while backing a card size out of the
// rendered density said closer to (100-gap)/100. Density is a poor instrument
// here because it folds card size, card shape, overlap and ring tilt into one
// number. So: turn the ring face-on, drop the count until the cards are far
// apart, label the connected blobs, and read the card off directly.
//
// Usage: node scripts/_card_movo.cjs "Pure 04" [count] [gap]
const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wanted = process.argv[2] || 'Pure 04';
  const count = Number(process.argv[3] || 6);
  const gap = process.argv[4] === undefined ? null : Number(process.argv[4]);
const persp = process.argv[5] === undefined ? null : Number(process.argv[5]);

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

  const out = await page.evaluate(async (name, wantCount, wantGap, wantPersp) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (t) => [...document.querySelectorAll('*')]
      .find((n) => n.children.length === 0 && (n.textContent || '').trim() === t);
    const btnBy = (re) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
    const stage = () => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];

    btnBy(/^Explore \d+ Templates$/).click();
    await wait(1200);
    if (!byText(name)) { const f = byText('Orbit'); (f.closest('button') || f.parentElement).click(); await wait(1200); }
    const item = byText(name);
    if (!item) return { error: name + ' not listed' };
    (item.closest('button') || item.parentElement).click();
    await wait(4000);

    const setNum = async (label, value) => {
      const l = byText(label);
      if (!l) return false;
      const input = l.parentElement && l.parentElement.querySelector('input');
      if (!input) return false;
      const proto = Object.getPrototypeOf(input);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.blur();
      await wait(2500);
      return true;
    };

    // Face-on, few cards, no rig roll — the arrangement where a card and the
    // ring radius can both be read without untangling a projection.
    await setNum('X', 90);
    await setNum('Y', 0);
    await setNum('Z', 0);
    await setNum('Count', wantCount);
    if (wantGap !== null) await setNum('Gap', wantGap);
    // Tip the ring so near and far cards are at different depths — the only
    // arrangement where perspective strength is directly readable.
    if (wantPersp !== null) { await setNum('X', 55); await setNum('Perspective', wantPersp); }
    await wait(2500);

    // Label connected blobs of non-background pixels.
    const c = stage();
    const G = 400;
    const buf = document.createElement('canvas');
    buf.width = G; buf.height = G;
    const g = buf.getContext('2d', { willReadFrequently: true });
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await img.decode();
    const sw = c.height * 0.8, sx = (c.width - sw) / 2;
    g.drawImage(img, sx, 0, sw, c.height, 0, 0, G, G);
    const d = g.getImageData(0, 0, G, G).data;
    const bg = [d[0], d[1], d[2]];
    const lit = new Uint8Array(G * G);
    for (let i = 0; i < G * G; i++) {
      const p = i * 4;
      lit[i] = (Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2])) > 30 ? 1 : 0;
    }
    const seen = new Uint8Array(G * G);
    const blobs = [];
    for (let i = 0; i < G * G; i++) {
      if (!lit[i] || seen[i]) continue;
      const stack = [i];
      seen[i] = 1;
      let minX = G, maxX = -1, minY = G, maxY = -1, n = 0, sxs = 0, sys = 0;
      while (stack.length) {
        const q = stack.pop();
        const x = q % G, y = (q - x) / G;
        n++; sxs += x; sys += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
          const k = ny * G + nx;
          if (lit[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      if (n < 40) continue;
      blobs.push({ w: maxX - minX + 1, h: maxY - minY + 1, n, cx: sxs / n, cy: sys / n });
    }
    return { blobs, G };
  }, wanted, count, gap, persp);

  if (out.error) throw new Error(out.error);
  const { blobs, G } = out;
  if (!blobs.length) throw new Error('no blobs found');
  blobs.sort((a, b) => b.n - a.n);

  // Ring radius from the blob centroids' spread about their common centre.
  const cx = blobs.reduce((s, b) => s + b.cx, 0) / blobs.length;
  const cy = blobs.reduce((s, b) => s + b.cy, 0) / blobs.length;
  const radii = blobs.map((b) => Math.hypot(b.cx - cx, b.cy - cy));
  const R = radii.reduce((a, b) => a + b, 0) / radii.length;
  const card = blobs[0];
  const slot = (Math.PI * 2 * R) / blobs.length;

  console.log(`${wanted} — face-on, ${blobs.length} blob(s) on a ${G}px stage grid`);
  console.log(`  card        ${card.w} x ${card.h} px   (aspect w/h ${(card.w / card.h).toFixed(3)})`);
  console.log(`  ring radius ${R.toFixed(1)} px  (spread ${Math.min(...radii).toFixed(1)}..${Math.max(...radii).toFixed(1)})`);
  console.log(`  slot arc    ${slot.toFixed(1)} px`);
  console.log(`  card / slot ${(card.w / slot).toFixed(3)}`);
  const areas = blobs.map((b) => b.n).sort((a, b) => b - a);
  // Near-over-far card area is a direct read of how strong the lens is.
  console.log(`  perto/longe ${(areas[0] / areas[areas.length - 1]).toFixed(2)}x  (areas ${areas.join(' ')})`);
  await browser.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
