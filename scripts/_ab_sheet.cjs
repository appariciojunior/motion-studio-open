#!/usr/bin/env node
// Side-by-side appearance sheet: arqe vs ours, same artwork, same frames.
// arqe renders 1080x1440 and we render 810x1080 — both 3:4 — so both are drawn
// into identical cells and any difference you see is real, not a scale artefact.
const fs = require('node:fs'), path = require('node:path');
const puppeteer = require('puppeteer-core');
const CH = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'];
const chrome = CH.find(p => fs.existsSync(p));

const SCRATCH = process.env.MS_SCRATCH;
const ROOT = path.resolve(__dirname, '..');
const FRAMES = [[120, 'repouso'], [147, 'u=0,45 — cartao de cima dobrando'], [153, 'u=0,55 — cartao de baixo desdobrando']];
const CW = 330, CH_ = 440, PAD = 16, HEAD = 30;

const b64 = p => 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64');

(async () => {
  const pairs = FRAMES.map(([f, label]) => ({
    f, label,
    a: b64(path.join(SCRATCH, `arqe-f${f}.jpg`)),
    o: b64(path.join(ROOT, '.shots', `ours-f${f}.jpg`)),
  }));

  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const W = PAD + 2 * (CW + PAD);
  const H = HEAD + FRAMES.length * (CH_ + 40) + PAD;
  await page.setViewport({ width: W, height: H });

  const dataUrl = await page.evaluate(async (pairs, W, H, CW, CH_, PAD, HEAD) => {
    const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#0d0d0f'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#e8e8ea'; c.font = '600 14px monospace';
    c.fillText('arqé', PAD, 20);
    c.fillText('nosso', PAD + CW + PAD, 20);
    for (let r = 0; r < pairs.length; r++) {
      const p = pairs[r];
      const y = HEAD + r * (CH_ + 40);
      const [ia, io] = await Promise.all([load(p.a), load(p.o)]);
      c.drawImage(ia, PAD, y, CW, CH_);
      c.drawImage(io, PAD + CW + PAD, y, CW, CH_);
      c.strokeStyle = '#2a2a30'; c.lineWidth = 1;
      c.strokeRect(PAD + .5, y + .5, CW, CH_);
      c.strokeRect(PAD + CW + PAD + .5, y + .5, CW, CH_);
      c.fillStyle = '#9a9aa4'; c.font = '12px monospace';
      c.fillText(`f${p.f}  ${p.label}`, PAD, y + CH_ + 20);
    }
    return cv.toDataURL('image/jpeg', 0.94);
  }, pairs, W, H, CW, CH_, PAD, HEAD);

  const out = path.join(ROOT, '.shots', 'ab-flip-appearance.jpg');
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
  await browser.close();
})();
