#!/usr/bin/env node
// Escolher um movimento pelo nome escreve paradas de verdade? E o pad
// redesenhado desenha quadros em vez de pontos?
//
// Clica como um usuario: um movimento, depois "Edit the path", e le a camera
// gravada na chave do PROJETO (motion-scene-v1 e so a semente).
const fs = require('fs'), path = require('path'), puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const U = process.argv[2] || 'http://localhost:3123';
const OUT = process.argv[3] || '.';
const MOVIMENTO = process.argv[4] || 'Survey';

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-gpu'], defaultViewport: { width: 1600, height: 1100 } });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log('  [error]', m.text().slice(0, 200)); });
  await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.evaluate(() => {
    const s = {
      activeTemplateId: 'wall-01',
      tracks: [{ id: 't0', templateId: 'wall-01', values: { speed: 0.2 }, visible: true }],
      width: 810, height: 1080, fps: 30, duration: 8,
      background: { source: 'color', color: '#1a1a1a', gradient: false, color2: '#1a1a1a', imageUrl: null, blur: 0 },
      effects: [], sceneCamera: { _camOn: 1 },
    };
    localStorage.setItem('motion-welcome-seen', '1');
    localStorage.setItem('motion-tour-seen', '1');
    localStorage.setItem('motion-scene-v1', JSON.stringify(s));
    localStorage.setItem('motion-project-mv', JSON.stringify(s));
    localStorage.setItem('motion-projects-v1', JSON.stringify({ activeId: 'mv', projects: [{ id: 'mv', name: 'MV', createdAt: 1, updatedAt: 2, mode: '2d' }] }));
  });
  await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
  await p.evaluate(() => { document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; }); });
  await new Promise((r) => setTimeout(r, 2500));
  await p.evaluate(() => { const t = [...document.querySelectorAll('button,[role=tab],a')].find((e) => e.textContent.trim() === 'Adjust'); t && t.click(); });
  await new Promise((r) => setTimeout(r, 2000));

  const camera = () => p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('motion-project-mv') || '{}');
    const c = raw.sceneCamera || {};
    return {
      movimento: c._camMove, quantidade: c._camMoveAmount, direcao: c._camMoveDir,
      zoomInicial: c._camZoom, panInicial: [c._camPanX, c._camPanY],
      paradas: Object.keys(c).filter((k) => /^_camStop\d+$/.test(k)).length,
      zoomsDasParadas: Object.keys(c).filter((k) => /Zoom$/.test(k) && k.startsWith('_camStop')).map((k) => c[k]),
    };
  });

  console.log('antes de escolher:', JSON.stringify(await camera()));
  const clicou = await p.evaluate((nome) => {
    const b = [...document.querySelectorAll('.cam-move')].find((e) => e.textContent.trim() === nome);
    if (!b) return 'botao "' + nome + '" nao existe; ha: ' + [...document.querySelectorAll('.cam-move')].map((e) => e.textContent.trim()).join(', ');
    b.click(); return 'ok';
  }, MOVIMENTO);
  console.log('clique em', MOVIMENTO + ':', clicou);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('depois de escolher:', JSON.stringify(await camera()));

  // abre o pad e conta os QUADROS desenhados
  await p.evaluate(() => { const d = document.querySelector('.cam-disclose'); d && d.click(); });
  await new Promise((r) => setTimeout(r, 1200));
  // escolhe uma parada do meio, para ver o fantasma e a perna
  const chip = process.env.MS_CHIP || '3';
  const escolheu = await p.evaluate((c) => {
    const b = [...document.querySelectorAll('.campath-chip')].find((e) => e.textContent.trim() === c);
    if (!b) return 'chip ' + c + ' nao existe';
    b.click(); return 'ok';
  }, chip);
  console.log('chip', chip + ':', escolheu);
  await new Promise((r) => setTimeout(r, 800));
  const pad = await p.evaluate(() => ({
    quadros: document.querySelectorAll('.camframe').length,
    rotulos: [...document.querySelectorAll('.camframe-num')].map((e) => e.textContent.trim()),
    zoomsNoPad: [...document.querySelectorAll('.camframe-zoom')].map((e) => e.textContent.trim()),
    temAlca: document.querySelectorAll('.camframe-grip').length,
    pontosVelhos: document.querySelectorAll('.campath-dot').length,
    fantasma: document.querySelectorAll('.camframe.is-ghost').length,
    chips: [...document.querySelectorAll('.campath-chip')].map(e=>e.textContent.trim()),
  }));
  console.log('pad:', JSON.stringify(pad));

  const rect = await p.evaluate(() => {
    const cab = [...document.querySelectorAll('.section-head')].find((el) => el.querySelector('.eyebrow')?.textContent.trim() === 'Camera');
    cab.scrollIntoView({ block: 'start' });
    return null;
  });
  await new Promise((r) => setTimeout(r, 500));
  const r2 = await p.evaluate(() => {
    const cab = [...document.querySelectorAll('.section-head')].find((el) => el.querySelector('.eyebrow')?.textContent.trim() === 'Camera');
    let n = cab, ultimo = cab;
    while (n && !(n !== cab && n.classList.contains('hairline'))) { ultimo = n; n = n.nextElementSibling; }
    const a = cab.getBoundingClientRect(), z = ultimo.getBoundingClientRect();
    return { x: a.left + scrollX - 10, y: a.top + scrollY - 10, width: a.width + 20, height: (z.bottom - a.top) + 20 };
  });
  fs.mkdirSync(OUT, { recursive: true });
  const arq = path.join(OUT, 'moves.png');
  await p.screenshot({ path: arq, clip: r2 });
  console.log(arq);
  await b.close();
})();
