#!/usr/bin/env node
// A camera de cena move o QUADRO de verdade?
//
// O teste puro prova a matematica da pose. Isto prova o pixel: para cada caso,
// mede a silhueta do que nao e fundo — quantos pixels, onde fica a caixa
// envolvente e onde fica o centroide.
//
//   · neutro  -> tem de bater com o neutro do fim da lista (a leitura e estavel)
//   · zoom    -> a caixa cresce/encolhe e o centroide fica no lugar
//   · pan X + -> o centroide anda para a DIREITA (o controle move a imagem)
//   · pan Y + -> o centroide anda para BAIXO
//   · orbit   -> a silhueta muda de forma
//
// Roda com o ANGLE padrao do Chrome: --use-angle=gl derruba o palco three.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3123';

const PRESETS = process.argv[3]
  ? [{ id: process.argv[3], nome: process.argv[3] }]
  : [
    { id: 'spinner-01', nome: 'Spinner 01 (declara camera())' },
    { id: 'ticker-02', nome: 'Ticker Tilt (sem camera())' },
  ];

const CASOS = [
  { nome: 'neutro', vals: {} },
  { nome: 'Zoom 200%', vals: { Zoom: '200' } },
  { nome: 'Zoom 50%', vals: { Zoom: '50' } },
  { nome: 'Pan X +30%', vals: { 'Pan X': '30' } },
  { nome: 'Pan Y +30%', vals: { 'Pan Y': '30' } },
  { nome: 'Orbit Y 45', vals: { 'Orbit Y': '45' } },
  { nome: 'Orbit X 40', vals: { 'Orbit X': '40' } },
  { nome: 'neutro (volta)', vals: {} },
];
const NEUTRO = { Zoom: '100', 'Pan X': '0', 'Pan Y': '0', 'Orbit Y': '0', 'Orbit X': '0' };

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
  let n = 0, sx = 0, sy = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const dif = Math.abs(d[i] - fundo[0]) + Math.abs(d[i + 1] - fundo[1]) + Math.abs(d[i + 2] - fundo[2]);
      if (dif < 24) continue;
      n++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (!n) return { arte: 0, fundo: fundo.join(',') };
  // Perfil por coluna e por linha: a soma do desvio em relacao ao fundo. Uma
  // TRANSLACAO aparece como deslocamento do perfil, e a correlacao mede isso em
  // pixels — o centroide nao mede, porque com a arte cobrindo o quadro o que
  // sai por uma borda move o centroide para o lado CONTRARIO ao do pan.
  const perfilX = new Array(c.width).fill(0);
  const perfilY = new Array(c.height).fill(0);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const dif = Math.abs(d[i] - fundo[0]) + Math.abs(d[i + 1] - fundo[1]) + Math.abs(d[i + 2] - fundo[2]);
      perfilX[x] += dif;
      perfilY[y] += dif;
    }
  }
  return {
    w: c.width, h: c.height, fundo: fundo.join(','),
    arte: n,
    cx: +(sx / n).toFixed(1), cy: +(sy / n).toFixed(1),
    caixa: `${x0}..${x1} x ${y0}..${y1}`,
    cw: x1 - x0 + 1, ch: y1 - y0 + 1,
    perfilX, perfilY,
  };
};

const semear = function (templateId) {
  const scene = {
    activeTemplateId: templateId,
    tracks: [{ id: 't0', templateId }],
    width: 810, height: 1080, fps: 30, duration: 8,
    background: { source: 'color', color: '#1a1a1a', gradient: false, color2: '#1a1a1a', imageUrl: null, blur: 28 },
    effects: [],
  };
  localStorage.setItem('motion-welcome-seen', '1');
  localStorage.setItem('motion-tour-seen', '1');
  localStorage.setItem('motion-scene-v1', JSON.stringify(scene));
  localStorage.setItem('motion-project-cam', JSON.stringify(scene));
  localStorage.setItem('motion-projects-v1', JSON.stringify({
    activeId: 'cam', projects: [{ id: 'cam', name: 'Camera', createdAt: 1, updatedAt: 2, mode: '2d' }],
  }));
};

// A secao Camera agora e de CENA: section-head com eyebrow "Camera" e o
// section-body seguinte — nao mais um .ctl-section dentro do bloco da camada.
const secaoCamera = function () {
  const cab = Array.from(document.querySelectorAll('.section-head'))
    .find((el) => ((el.querySelector('.eyebrow') || {}).textContent || '').trim() === 'Camera');
  const secao = cab ? cab.nextElementSibling : null;
  if (!secao) return null;
  return Array.from(secao.querySelectorAll('.ctl-row')).map((r) => (r.querySelector('.ctl-label') || {}).textContent);
};

// Entrada digitada real: Enter na trilha abre o editor, o valor entra pelo
// setter nativo + evento `input`, e um segundo Enter commita. Nao usa blur —
// React escuta focusout e o documento headless nao tem foco.
const digitar = async function (rotulo, valor) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cab = Array.from(document.querySelectorAll('.section-head'))
    .find((el) => ((el.querySelector('.eyebrow') || {}).textContent || '').trim() === 'Camera');
  const secao = cab ? cab.nextElementSibling : null;
  if (!secao) return 'sem secao Camera';
  const row = Array.from(secao.querySelectorAll('.ctl-row'))
    .find((r) => ((r.querySelector('.ctl-label') || {}).textContent || '').trim() === rotulo);
  if (!row) return 'sem controle ' + rotulo;
  const track = row.querySelector('.strack');
  if (!track) return 'sem trilha';
  track.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(150);
  const input = row.querySelector('.sval-input');
  if (!input) return 'editor nao abriu';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, valor);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(150);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(500);
  return ((row.querySelector('.sval') || {}).textContent || '?').trim();
};

// EFEITO=Halftone adiciona um efeito antes de medir. Serve para a interacao de
// risco do caminho 2D: `filterArea` do Pixi e LOCAL, entao um palco com zoom
// precisa do inverso do shot — sem isso o Pixi recorta a arte no retangulo
// errado e a caixa envolvente encolhe.
const adicionarEfeito = async function (nome) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sel = Array.from(document.querySelectorAll('select'))
    .find((x) => Array.from(x.options).some((o) => o.textContent.trim() === nome));
  if (!sel) return 'sem select de efeito';
  const opt = Array.from(sel.options).find((o) => o.textContent.trim() === nome);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(200);
  const add = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Add');
  if (!add) return 'sem botao Add';
  add.click();
  await sleep(1800);
  const card = Array.from(document.querySelectorAll('.effect-card'))
    .find((c) => ((c.querySelector('.effect-title') || {}).textContent || '').trim() === nome);
  if (!card) return 'card do efeito nao apareceu';
  const escopo = card.querySelector('.effect-scope-row select');
  return 'escopo ' + (escopo ? escopo.value : '?');
};

// Canal de leitura que nao mente: o autosave do projeto.
const lerStore = function () {
  try {
    const raw = localStorage.getItem('motion-project-cam');
    return JSON.parse(raw).sceneCamera || 'SEM sceneCamera';
  } catch (e) { return String(e); }
};

// Correlacao 1D por soma de diferencas absolutas: devolve o deslocamento (em
// pixels) que melhor alinha `b` sobre `a`. Varre ate 45% do eixo, o suficiente
// para um pan de 30% e barato o bastante para rodar por caso.
function melhorLag(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  const n = a.length;
  const max = Math.round(n * 0.45);
  let melhor = 0, menor = Infinity;
  for (let lag = -max; lag <= max; lag++) {
    let soma = 0, contados = 0;
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j < 0 || j >= n) continue;
      soma += Math.abs(a[i] - b[j]);
      contados++;
    }
    if (!contados) continue;
    const media = soma / contados;
    if (media < menor) { menor = media; melhor = lag; }
  }
  return melhor;
}

(async () => {
  for (const preset of PRESETS) {
    let base = null;
    console.log('');
    console.log('=== ' + preset.nome + ' ===');
    const b = await puppeteer.launch({
      executablePath: CHROME, headless: process.env.HEADED ? false : 'new',
      args: ['--enable-gpu'], defaultViewport: { width: 1600, height: 1000 },
    });
    const p = await b.newPage();
    p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
    await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await p.evaluate(semear, preset.id);
    await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
    await p.evaluate(() => {
      document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
    });
    const pintou = await p.waitForFunction(
      function (fn) { const m = new Function('return (' + fn + ')()')(); return !!m && m.arte > 2000; },
      { timeout: 90000, polling: 700 }, MEDIR.toString(),
    ).then(() => true).catch(() => false);
    if (!pintou) { console.log('  palco nao pintou'); await b.close(); continue; }
    console.log('  secao Camera: ' + JSON.stringify(await p.evaluate(secaoCamera)));
    if (process.env.EFEITO) console.log('  efeito       ' + await p.evaluate(adicionarEfeito, process.env.EFEITO));
    // Pausa: todas as leituras tem de sair do MESMO frame.
    await p.evaluate(async () => {
      const btn = document.querySelector('.play-btn');
      if (btn && btn.getAttribute('title') === 'Pause') { btn.click(); await new Promise((r) => setTimeout(r, 600)); }
    });
    for (const caso of CASOS) {
      for (const [rotulo, valor] of Object.entries({ ...NEUTRO, ...caso.vals })) {
        const lido = await p.evaluate(digitar, rotulo, valor);
        if (lido !== valor && !String(lido).startsWith(valor)) {
          console.log(`  ! ${rotulo} pediu ${valor}, leu ${lido}`);
        }
      }
      const m = await p.evaluate(MEDIR);
      if (!base) base = m;
      const { perfilX, perfilY, ...resumo } = m;
      // Deslocamento que melhor alinha este quadro com o neutro, em pixels.
      resumo.lagX = melhorLag(base.perfilX, perfilX);
      resumo.lagY = melhorLag(base.perfilY, perfilY);
      console.log('  ' + caso.nome.padEnd(15) + JSON.stringify(resumo));
      if (caso.vals && Object.keys(caso.vals).length) console.log('    store: ' + JSON.stringify(await p.evaluate(lerStore)));
    }
    await b.close();
  }
})();
