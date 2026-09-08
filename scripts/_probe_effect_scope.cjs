#!/usr/bin/env node
// O escopo do efeito muda o que ele alcanca?
//
// O Wave desloca a coordenada de amostragem. No quadro composto ele arrasta o
// FUNDO junto, e como a amostra sai do quadro e volta transparente, aparece uma
// faixa vazia na borda da cena. Sobre a arte, o fundo tem de sair intacto.
//
// A medida e a BORDA, nao a impressao: quantos pixels das colunas extremas
// deixaram de ser a cor do fundo. Com escopo 'scene' esse numero tem de subir;
// com 'artwork' tem de ficar no chao. Mede tambem quantos pixels do quadro
// inteiro sao exatamente a cor de fundo, que e o "o fundo passou intacto?".
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';
const EFEITO = process.argv[3] || 'Wave';

const CASOS = [
  { nome: '2D (Pixi)', preset: null },
  { nome: 'webgl (three)', preset: { rotulo: 'Ring Stream', grupo: 'Orbit 3D' } },
];

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
  const igualAoFundo = (i) => Math.abs(d[i] - fundo[0]) + Math.abs(d[i + 1] - fundo[1]) + Math.abs(d[i + 2] - fundo[2]) < 12;
  // colunas extremas: 6 px de cada lado, onde a faixa vazia do wave aparece
  let bordaTotal = 0, bordaQuebrada = 0;
  for (let y = 0; y < c.height; y++) {
    for (const x of [0, 1, 2, 3, 4, 5, c.width - 6, c.width - 5, c.width - 4, c.width - 3, c.width - 2, c.width - 1]) {
      const i = (y * c.width + x) * 4;
      bordaTotal++;
      if (!igualAoFundo(i)) bordaQuebrada++;
    }
  }
  let pixelsDeFundo = 0;
  for (let i = 0; i < d.length; i += 4) if (igualAoFundo(i)) pixelsDeFundo++;
  return { fundo: fundo.join(','), pixelsDeFundo, bordaQuebrada, bordaTotal };
};

const semear = function () {
  const scene = {
    activeTemplateId: 'arc-01',
    tracks: [{ id: 't0', templateId: 'arc-01' }],
    width: 810, height: 1080, fps: 30, duration: 8,
    background: { source: 'color', color: '#1a1a1a', gradient: false, color2: '#1a1a1a', imageUrl: null, blur: 28 },
    effects: [],
  };
  localStorage.setItem('motion-welcome-seen', '1');
  localStorage.setItem('motion-tour-seen', '1');
  localStorage.setItem('motion-scene-v1', JSON.stringify(scene));
  localStorage.setItem('motion-project-fx', JSON.stringify(scene));
  localStorage.setItem('motion-projects-v1', JSON.stringify({
    activeId: 'fx', projects: [{ id: 'fx', name: 'Escopo', createdAt: 1, updatedAt: 2, mode: '2d' }],
  }));
};

const escolher = async function (rotulo, grupo) {
  document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
  const achar = () => Array.from(document.querySelectorAll('.tpl-card'))
    .find((el) => { const l = el.querySelector('.tpl-card-label'); return l && l.textContent.trim() === rotulo; });
  if (!achar()) {
    const linha = Array.from(document.querySelectorAll('.tpl-item'))
      .find((el) => (el.textContent || '').trim().startsWith(grupo));
    if (!linha) return 'grupo nao achado';
    linha.click();
    await new Promise((r) => setTimeout(r, 900));
  }
  const card = achar();
  if (!card) return 'preset nao apareceu';
  (card.querySelector('.tpl-card-label') || card).click();
  await new Promise((r) => setTimeout(r, 3000));
  return 'ok';
};

const adicionar = async function (nome) {
  const sel = Array.from(document.querySelectorAll('select'))
    .find((s) => Array.from(s.options).some((o) => o.textContent.trim() === nome));
  if (!sel) return 'sem select';
  sel.value = Array.from(sel.options).find((o) => o.textContent.trim() === nome).value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Add').click();
  await new Promise((r) => setTimeout(r, 1500));
  const card = Array.from(document.querySelectorAll('.effect-card'))
    .find((c) => { const t = c.querySelector('.effect-title'); return t && t.textContent.trim() === nome; });
  if (!card) return 'card nao apareceu';
  const escopo = card.querySelector('.effect-scope-row select');
  return 'escopo inicial: ' + (escopo ? escopo.value : 'SEM SELETOR');
};

const trocarEscopo = async function (nome, valor) {
  const card = Array.from(document.querySelectorAll('.effect-card'))
    .find((c) => { const t = c.querySelector('.effect-title'); return t && t.textContent.trim() === nome; });
  const sel = card && card.querySelector('.effect-scope-row select');
  if (!sel) return 'sem seletor';
  const opt = Array.from(sel.options).find((o) => o.value === valor || o.value.startsWith(valor));
  if (!opt) return 'sem opcao ' + valor + ' (tem: ' + Array.from(sel.options).map((o) => o.value).join(',') + ')';
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
  return opt.value;
};

(async () => {
  for (const caso of CASOS) {
    console.log('');
    console.log('=== ' + caso.nome + ' — ' + EFEITO + ' ===');
    const b = await puppeteer.launch({
      executablePath: CHROME, headless: process.env.HEADED ? false : 'new',
      args: ['--enable-gpu'], defaultViewport: { width: 1600, height: 1000 },
    });
    const p = await b.newPage();
    p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 180)));
    await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await p.evaluate(semear);
    await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
    await p.evaluate(() => {
      document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
    });
    if (caso.preset) console.log('  preset ', await p.evaluate(escolher, caso.preset.rotulo, caso.preset.grupo));
    const pintou = await p.waitForFunction(
      function (fn) { const m = new Function('return (' + fn + ')()')(); return !!m && m.pixelsDeFundo > 50000; },
      { timeout: 60000, polling: 700 }, MEDIR.toString(),
    ).then(() => true).catch(() => false);
    if (!pintou) { console.log('  palco nao pintou'); await b.close(); continue; }
    console.log('  sem efeito     ', JSON.stringify(await p.evaluate(MEDIR)));
    console.log('  add            ', await p.evaluate(adicionar, EFEITO));
    // pausa: as tres leituras tem de sair do mesmo frame
    await p.evaluate(async () => {
      const btn = document.querySelector('.play-btn');
      if (btn && btn.getAttribute('title') === 'Pause') { btn.click(); await new Promise((r) => setTimeout(r, 600)); }
    });
    for (const alvo of ['artwork', 'scene', 'track:']) {
      const aplicado = await p.evaluate(trocarEscopo, EFEITO, alvo);
      console.log('  ' + String(alvo).padEnd(9) + ' -> ' + String(aplicado).padEnd(14) + JSON.stringify(await p.evaluate(MEDIR)));
    }
    await b.close();
  }
})();
