#!/usr/bin/env node
// O canvas do palco respeita a invariante de alpha PRE-MULTIPLICADO?
//
// O navegador compoe um canvas com alpha assumindo pre-multiplicado: cada canal
// de cor ja tem de vir multiplicado pelo alpha, o que torna `rgb <= alpha` uma
// invariante do formato. Um pixel com rgb 255 e alpha 128 e impossivel — e
// quando aparece, o compositor clareia aquele pixel, porque trata 255 como "luz
// que ja passou pelo alpha".
//
// Isto importa aqui porque o passe de saida do renderer 3D e um ShaderMaterial
// com `transparent: true` que escreve `texture2D(map, uv)` direto: se o alvo
// guarda alpha DIRETO, a saida sai fora da invariante.
//
// A cena e semeada com o FUNDO em alpha 40, que e o que faz o canvas ter alpha
// parcial em area grande — sem isso o quadro e todo opaco e a invariante nao
// tem como ser violada.
//
// Mede os dois engines de proposito: se um respeita e o outro nao, o defeito
// esta no renderer e nao na cena. Foi essa assimetria que denunciou a textura
// de alvo MSAA nao resolvida.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';

const CASOS = [
  { nome: '2D (Pixi)', preset: null },
  { nome: 'webgl (three)', preset: { rotulo: 'Ring Stream', grupo: 'Orbit 3D' } },
];

const MEDIR = function () {
  const c = document.querySelector('canvas.stage-canvas');
  if (!c || !c.width) return null;
  const o = document.createElement('canvas');
  o.width = c.width; o.height = c.height;
  const g = o.getContext('2d');
  // `alpha: true` e sem fundo pintado: o que se le e o alpha do proprio palco.
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let parciais = 0, fora = 0, piorExcesso = 0, opacos = 0, vazios = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a >= 250) { opacos++; continue; }
    if (a <= 4) { vazios++; continue; }
    parciais++;
    const rgbMax = Math.max(d[i], d[i + 1], d[i + 2]);
    const excesso = rgbMax - a;
    if (excesso > 8) { fora++; if (excesso > piorExcesso) piorExcesso = excesso; }
  }
  return { opacos, vazios, parciais, fora, piorExcesso };
};

const semear = function () {
  const scene = {
    activeTemplateId: 'arc-01',
    tracks: [{ id: 't0', templateId: 'arc-01' }],
    width: 810, height: 1080, fps: 30, duration: 8,
    // alpha 40: o quadro passa a ter alpha parcial em area grande
    background: { source: 'color', color: '#1a1a1a', alpha: 40, gradient: false, color2: '#1a1a1a', imageUrl: null, blur: 28 },
    effects: [],
  };
  localStorage.setItem('motion-welcome-seen', '1');
  localStorage.setItem('motion-tour-seen', '1');
  localStorage.setItem('motion-scene-v1', JSON.stringify(scene));
  localStorage.setItem('motion-project-fx', JSON.stringify(scene));
  localStorage.setItem('motion-projects-v1', JSON.stringify({
    activeId: 'fx', projects: [{ id: 'fx', name: 'Premultiplied', createdAt: 1, updatedAt: 2, mode: '2d' }],
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

(async () => {
  for (const caso of CASOS) {
    console.log('');
    console.log('=== ' + caso.nome + ' ===');
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
    const ok = await p.waitForFunction(
      function (fn) { const m = new Function('return (' + fn + ')()')(); return !!m && (m.parciais + m.opacos) > 20000; },
      { timeout: 60000, polling: 700 }, MEDIR.toString(),
    ).then(() => true).catch(() => false);
    const m = await p.evaluate(MEDIR);
    await b.close();
    if (!ok) { console.log('  palco nao pintou:', JSON.stringify(m)); continue; }
    console.log('  ' + JSON.stringify(m));
    if (!m.parciais) {
      console.log('  sem pixel de alpha parcial — a invariante nao pode ser testada nesta cena');
      continue;
    }
    const pct = (m.fora / m.parciais) * 100;
    console.log('  fora da invariante  ' + pct.toFixed(1) + '% dos parciais, pior excesso ' + m.piorExcesso + '/255');
    if (pct > 5) {
      console.log('  FALHOU: rgb > alpha em ' + pct.toFixed(1) + '% dos pixels parciais — o compositor clareia esses pixels');
      process.exitCode = 1;
    }
  }
})();
