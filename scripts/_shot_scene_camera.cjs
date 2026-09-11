#!/usr/bin/env node
// Fotografa o palco em cada caso da camera de cena, para olhar lado a lado.
// Sai um PNG por caso no diretorio passado em argv[3].
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3123';
const OUT = process.argv[3] || '.';
const TPL = process.argv[4] || 'spinner-01';

const CASOS = [
  { arq: '1-neutro', vals: {} },
  { arq: '2-zoom-200', vals: { Zoom: '200' } },
  { arq: '3-zoom-50', vals: { Zoom: '50' } },
  { arq: '4-pan-x-30', vals: { 'Pan X': '30' } },
  { arq: '5-orbit-y-45', vals: { 'Orbit Y': '45' } },
  { arq: '6-orbit-x-40', vals: { 'Orbit X': '40' } },
];
const NEUTRO = { Zoom: '100', 'Pan X': '0', 'Pan Y': '0', 'Orbit Y': '0', 'Orbit X': '0' };

// SWEEP="Orbit X:0,20,40,60,80" varre UM controle, para decidir se ele tem
// alcance suficiente para ler como movimento de camera e nao como ajuste.
if (process.env.SWEEP) {
  const [rotulo, lista] = process.env.SWEEP.split(':');
  CASOS.length = 0;
  for (const v of lista.split(',')) {
    CASOS.push({ arq: rotulo.replace(/[^A-Za-z0-9]/g, '') + '-' + v, vals: { [rotulo]: v } });
  }
}

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
  localStorage.setItem('motion-project-shot', JSON.stringify(scene));
  localStorage.setItem('motion-projects-v1', JSON.stringify({
    activeId: 'shot', projects: [{ id: 'shot', name: 'Shot', createdAt: 1, updatedAt: 2, mode: '2d' }],
  }));
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

// O palco e um canvas WebGL: `toDataURL` no proprio canvas e o unico jeito de
// pegar o pixel que ele pintou — screenshot da pagina fotografa o painel todo.
const pegarPng = function () {
  const c = document.querySelector('canvas.stage-canvas');
  if (!c || !c.width) return null;
  const o = document.createElement('canvas');
  o.width = c.width; o.height = c.height;
  o.getContext('2d').drawImage(c, 0, 0);
  return o.toDataURL('image/png');
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
  const pronto = await p.waitForFunction(function (fn) {
    const url = new Function('return (' + fn + ')()')();
    return typeof url === 'string' && url.length > 20000;
  }, { timeout: 90000, polling: 700 }, pegarPng.toString()).then(() => true).catch(() => false);
  if (!pronto) { console.log('palco nao pintou'); await b.close(); return; }
  // Pausa: as fotos tem de sair todas do MESMO frame do movimento.
  await p.evaluate(async () => {
    const btn = document.querySelector('.play-btn');
    if (btn && btn.getAttribute('title') === 'Pause') { btn.click(); await new Promise((r) => setTimeout(r, 600)); }
  });
  for (const caso of CASOS) {
    for (const [rotulo, valor] of Object.entries({ ...NEUTRO, ...caso.vals })) {
      await p.evaluate(digitar, rotulo, valor);
    }
    const url = await p.evaluate(pegarPng);
    const arquivo = path.join(OUT, caso.arq + '.png');
    fs.writeFileSync(arquivo, Buffer.from(url.split(',')[1], 'base64'));
    console.log(arquivo + '  ' + fs.statSync(arquivo).size + ' bytes');
  }
  await b.close();
})();
