#!/usr/bin/env node
// Com DUAS camadas, a camera de cena move as duas ou so a ativa?
//
// Duas camadas do mesmo template, deslocadas no transform para a esquerda e
// para a direita, ficam separaveis no quadro. A medida e a caixa envolvente de
// cada METADE do canvas: se so uma metade muda de tamanho quando o Zoom sobe,
// a camera esta por camada, nao por cena.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3123';
const TPL = process.argv[3] || 'spinner-01';

const MEDIR = function () {
  const c = document.querySelector('canvas.stage-canvas');
  if (!c || !c.width) return null;
  const o = document.createElement('canvas');
  o.width = c.width; o.height = c.height;
  const g = o.getContext('2d'); g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const hist = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  let fundo = [0, 0, 0], max = 0;
  for (const [k, n] of hist) if (n > max) { max = n; fundo = k.split(',').map(Number); }
  const meia = (x0lim, x1lim) => {
    let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = x0lim; x < x1lim; x++) {
        const i = (y * c.width + x) * 4;
        const dif = Math.abs(d[i] - fundo[0]) + Math.abs(d[i + 1] - fundo[1]) + Math.abs(d[i + 2] - fundo[2]);
        if (dif < 24) continue;
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return n ? { arte: n, cw: x1 - x0 + 1, ch: y1 - y0 + 1 } : { arte: 0 };
  };
  const meio = Math.floor(c.width / 2);
  return { esquerda: meia(0, meio), direita: meia(meio, c.width) };
};

const semear = function (templateId) {
  const track = (id, x) => ({ id, templateId, visible: true, opacity: 1, blend: 'normal',
    inFrame: 0, outFrame: 1e9, offset: 0, timeScale: 1, fade: 0, assetIds: [],
    name: 'L' + id, transform: { x, y: 0, scale: 0.55, rotation: 0 } });
  const scene = {
    activeTemplateId: templateId,
    activeTrackId: 't0',
    tracks: [track('t0', -190), track('t1', 190)],
    width: 810, height: 1080, fps: 30, duration: 8,
    background: { source: 'color', color: '#1a1a1a', gradient: false, color2: '#1a1a1a', imageUrl: null, blur: 28 },
    effects: [],
  };
  localStorage.setItem('motion-welcome-seen', '1');
  localStorage.setItem('motion-tour-seen', '1');
  localStorage.setItem('motion-scene-v1', JSON.stringify(scene));
  localStorage.setItem('motion-project-cl', JSON.stringify(scene));
  localStorage.setItem('motion-projects-v1', JSON.stringify({
    activeId: 'cl', projects: [{ id: 'cl', name: 'Camadas', createdAt: 1, updatedAt: 2, mode: '2d' }],
  }));
};

const abrirAdjust = async function () {
  const b = Array.from(document.querySelectorAll('button,[role=tab],a')).find((e) => e.textContent.trim() === 'Adjust');
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 1200));
  return 'eyebrows=' + Array.from(document.querySelectorAll('.eyebrow')).map((e) => e.textContent.trim()).join('|')
    + '  titulos=' + Array.from(document.querySelectorAll('.ctl-section-title')).map((e) => e.textContent).join(',');
};

const digitar = async function (rotulo, valor) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cab = Array.from(document.querySelectorAll('.section-head'))
    .find((el) => ((el.querySelector('.eyebrow') || {}).textContent || '').trim() === 'Camera');
  const secao = cab ? cab.nextElementSibling : null;
  if (!secao) return 'sem secao Camera';
  const row = Array.from(secao.querySelectorAll('.ctl-row'))
    .find((r) => ((r.querySelector('.ctl-label') || {}).textContent || '').trim() === rotulo);
  if (!row) return 'sem controle ' + rotulo;
  row.querySelector('.strack').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(150);
  const input = row.querySelector('.sval-input');
  if (!input) return 'editor nao abriu';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, valor);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(150);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(600);
  return ((row.querySelector('.sval') || {}).textContent || '?').trim();
};

const lerStore = function () {
  try {
    const s = JSON.parse(localStorage.getItem('motion-project-cl'));
    return 'cena:' + JSON.stringify(s.sceneCamera)
      + ' | camadas:' + (s.tracks || []).map((t) => t.id + '=' + Object.keys(t.values || {}).filter((k) => k.startsWith('_cam')).length).join(',');
  } catch (e) { return String(e); }
};

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: process.env.HEADED ? false : 'new',
    args: ['--enable-gpu'], defaultViewport: { width: 1600, height: 1000 },
  });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.evaluate(semear, TPL);
  await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
  await p.evaluate(() => {
    document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
  });
  const pintou = await p.waitForFunction(
    function (fn) { const m = new Function('return (' + fn + ')()')(); return !!m && m.esquerda.arte > 1000 && m.direita.arte > 1000; },
    { timeout: 90000, polling: 700 }, MEDIR.toString(),
  ).then(() => true).catch(() => false);
  if (!pintou) { console.log('duas camadas nao pintaram: ' + JSON.stringify(await p.evaluate(MEDIR))); await b.close(); return; }
  console.log('secoes: ' + await p.evaluate(abrirAdjust));
  await p.evaluate(async () => {
    const btn = document.querySelector('.play-btn');
    if (btn && btn.getAttribute('title') === 'Pause') { btn.click(); await new Promise((r) => setTimeout(r, 600)); }
  });
  console.log('neutro      ' + JSON.stringify(await p.evaluate(MEDIR)));
  console.log('Zoom -> ' + await p.evaluate(digitar, 'Zoom', '200'));
  console.log('zoom 200%   ' + JSON.stringify(await p.evaluate(MEDIR)));
  console.log('store       ' + await p.evaluate(lerStore));
  await b.close();
})();
