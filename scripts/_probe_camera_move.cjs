#!/usr/bin/env node
// A camera anda durante o clipe, e o Hold e parada de verdade?
//
// O teste puro prova a curva. Isto prova o palco: a parede fica PARADA
// (`speed: 0` no Frames) para que o unico movimento no quadro seja o da camera,
// o clipe roda, e cada amostra e comparada com a primeira por correlacao de
// perfil de coluna — o mesmo instrumento que mediu o pan, porque centroide
// mente quando a arte cobre o quadro.
//
// O que se espera com Travel x=60 e Hold 60%:
//   · nada anda ate ~30% do clipe
//   · anda tudo entre ~30% e ~70%
//   · nada anda depois, parado no deslocamento final (60% do quadro)
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3123';
const TPL = process.argv[3] || 'wall-01';
const TRAVEL = Number(process.argv[4] ?? 60);
const HOLD = Number(process.argv[5] ?? 60);

const semear = function (templateId, travel, hold) {
  const scene = {
    activeTemplateId: templateId,
    tracks: [{ id: 't0', templateId, values: { speed: 0 } }],
    width: 810, height: 1080, fps: 30, duration: 8,
    background: { source: 'color', color: '#1a1a1a', gradient: false, color2: '#1a1a1a', imageUrl: null, blur: 28 },
    effects: [],
    // A camera semeada direto: prova de quebra o caminho de persistencia junto.
    sceneCamera: { _camZoom: 100, _camPanX: 0, _camPanY: 0, _camOrbitY: 0, _camOrbitX: 0,
      _camStop2: { x: travel, y: 0 }, _camStop2Zoom: 100, _camHold: hold },
  };
  localStorage.setItem('motion-welcome-seen', '1');
  localStorage.setItem('motion-tour-seen', '1');
  localStorage.setItem('motion-scene-v1', JSON.stringify(scene));
  localStorage.setItem('motion-project-mv', JSON.stringify(scene));
  localStorage.setItem('motion-projects-v1', JSON.stringify({
    activeId: 'mv', projects: [{ id: 'mv', name: 'Move', createdAt: 1, updatedAt: 2, mode: '2d' }],
  }));
};

// Perfil de coluna + o tempo que o transporte mostra, para plotar contra a
// posicao real do clipe e nao contra o relogio de parede.
const AMOSTRA = function () {
  const c = document.querySelector('canvas.stage-canvas');
  if (!c || !c.width) return null;
  const o = document.createElement('canvas');
  o.width = c.width; o.height = c.height;
  o.getContext('2d').drawImage(c, 0, 0);
  const d = o.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const perfil = new Array(c.width).fill(0);
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      perfil[x] += d[i] + d[i + 1] + d[i + 2];
    }
  }
  const m = perfil.reduce((s, v) => s + v, 0) / perfil.length;
  const rel = document.querySelector('.play-btn')?.parentElement?.textContent || '';
  return { w: c.width, perfil: perfil.map((v) => v - m), relogio: rel.replace(/\s+/g, ' ').trim().slice(0, 24) };
};

function lag(a, b, max) {
  let melhor = 0, maior = -Infinity;
  for (let L = -max; L <= max; L++) {
    let s = 0, sa = 0, sb = 0, n = 0;
    for (let i = 0; i < a.length; i++) {
      const j = i + L;
      if (j < 0 || j >= a.length) continue;
      s += a[i] * b[j]; sa += a[i] * a[i]; sb += b[j] * b[j]; n++;
    }
    if (n < a.length * 0.5) continue;
    const r = s / Math.sqrt(sa * sb || 1);
    if (r > maior) { maior = r; melhor = L; }
  }
  return { L: melhor, r: +maior.toFixed(2) };
}

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: process.env.HEADED ? false : 'new',
    args: ['--enable-gpu'], defaultViewport: { width: 1600, height: 1000 },
  });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.evaluate(semear, TPL, TRAVEL, HOLD);
  await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
  await p.evaluate(() => {
    document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
  });
  const pintou = await p.waitForFunction(
    function (fn) { const m = new Function('return (' + fn + ')()')(); return !!m && m.perfil.some((v) => Math.abs(v) > 1000); },
    { timeout: 90000, polling: 700 }, AMOSTRA.toString(),
  ).then(() => true).catch(() => false);
  if (!pintou) { console.log('  palco nao pintou'); await b.close(); return; }

  console.log('  preset ' + TPL + ' com speed 0 (parede parada), Travel x=' + TRAVEL + '%, Hold ' + HOLD + '%');
  console.log('  a camera anda ' + TRAVEL + '% de 810px = ' + Math.round(TRAVEL / 100 * 810) + 'px esperados no fim\n');
  // Espera o clipe voltar ao inicio antes da linha de base: comparar com uma
  // amostra do meio do movimento faz todo numero sair relativo e a correlacao
  // desabar.
  await p.waitForFunction(() => {
    const t = document.querySelector('.play-btn')?.parentElement?.textContent || '';
    return t.replace(/s+/g, ' ').trim().startsWith('0:00');
  }, { timeout: 30000, polling: 100 }).catch(() => {});
  const amostras = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    const a = await p.evaluate(AMOSTRA);
    if (a) amostras.push({ t: (Date.now() - t0) / 1000, ...a });
    await new Promise((r) => setTimeout(r, 300));
  }
  const base = amostras[0];
  console.log('  t(s) | relogio do app        | deslocamento medido (px) | correlacao');
  for (const a of amostras) {
    const l = lag(base.perfil, a.perfil, Math.round(base.w * 0.45));
    console.log('  ' + a.t.toFixed(1).padStart(4) + ' | ' + a.relogio.padEnd(21) + ' | ' + String(l.L).padStart(6) + '                   | ' + l.r);
  }
  await b.close();
})();
