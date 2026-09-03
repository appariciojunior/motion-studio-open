#!/usr/bin/env node
// Diagnostico: por que o palco webgl nao pinta no headless.
const fs = require('fs'), path = require('path');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';
const OUT = path.resolve(__dirname, '..', '..', '_fx-shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: process.env.HEADED ? false : 'new',
    args: (process.env.GLARGS||'--enable-gpu').split(','), defaultViewport: { width: 1600, height: 1000 } });
  const p = await b.newPage();
  p.on('console', (m) => { const t = m.text(); if (!/^\[Fast Refresh/.test(t)) console.log('  [console:' + m.type() + ']', t.slice(0, 220)); });
  p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));
  await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.evaluate(() => {
    localStorage.setItem('motion-welcome-seen', '1');
    localStorage.setItem('motion-tour-seen', '1');
  });
  await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
  await new Promise((r) => setTimeout(r, 4000));

  const antes = await p.evaluate(() => Array.from(document.querySelectorAll('canvas'))
    .map((c) => c.width + 'x' + c.height + ' [' + c.className + ']'));
  console.log('canvases antes:', JSON.stringify(antes));

  console.log('clique:', await p.evaluate(async () => {
    document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
    const linha = Array.from(document.querySelectorAll('.tpl-item'))
      .find((el) => (el.textContent || '').trim().startsWith('Orbit 3D'));
    if (!linha) return 'sem grupo Orbit 3D';
    linha.click();
    await new Promise((r) => setTimeout(r, 1200));
    const card = Array.from(document.querySelectorAll('.tpl-card'))
      .find((el) => { const l = el.querySelector('.tpl-card-label'); return l && l.textContent.trim() === 'Ring Stream'; });
    if (!card) return 'sem card Ring Stream';
    (card.querySelector('.tpl-card-label') || card).click();
    await new Promise((r) => setTimeout(r, 5000));
    return 'clicou';
  }));

  const dep = await p.evaluate(() => {
    const out = { canvases: [], amostras: [] };
    for (const c of Array.from(document.querySelectorAll('canvas'))) {
      out.canvases.push({ wh: c.width + 'x' + c.height, cls: c.className, visivel: c.getBoundingClientRect().width | 0 });
    }
    const c = document.querySelector('canvas.stage-canvas');
    if (c && c.width) {
      const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
      const g = o.getContext('2d'); g.drawImage(c, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let maxA = 0, maxL = 0, soma = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > maxA) maxA = d[i + 3];
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (l > maxL) maxL = l;
        soma += l;
      }
      out.leitura = { maxAlpha: maxA, maxLuma: Math.round(maxL), mediaLuma: +(soma / (d.length / 4)).toFixed(2) };
    }
    const st = localStorage.getItem('motion-scene-v1');
    out.cenaAtiva = st ? JSON.parse(st).activeTemplateId : null;
    return out;
  });
  console.log('depois:', JSON.stringify(dep, null, 2));
  await p.screenshot({ path: path.join(OUT, 'diag-webgl-stage.png') });
  await b.close();
  console.log('foto:', path.join(OUT, 'diag-webgl-stage.png'));
})();
