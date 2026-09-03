#!/usr/bin/env node
// A/B honesto do Posterize: MESMO frame, efeito desligado e ligado.
//
// As duas fotos anteriores estavam em frames diferentes — o palco continua
// tocando — e diferenca de pose se confunde com diferenca de efeito. Aqui a
// linha de tempo e PAUSADA antes das duas capturas, e o que muda entre elas e
// so o olho do card do efeito.
const fs = require('fs'), path = require('path');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';
const NIVEIS = Number(process.argv[3] || 5);
const OUT = path.resolve(__dirname, '..', '..', '_fx-shots');
fs.mkdirSync(OUT, { recursive: true });

const CASOS = [
  { nome: '2d', preset: null },                                   // preset padrao (2D)
  { nome: 'webgl', preset: { rotulo: 'Ring Stream', grupo: 'Orbit 3D' } },
];

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
    activeId: 'fx', projects: [{ id: 'fx', name: 'AB posterize', createdAt: 1, updatedAt: 2, mode: '2d' }],
  }));
};

const CONTEUDO = function () {
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
  let conteudo = 0;
  const set = new Set();
  for (let i = 0; i < d.length; i += 4) {
    set.add(d[i]);
    const dist = Math.abs(d[i] - fundo[0]) + Math.abs(d[i + 1] - fundo[1]) + Math.abs(d[i + 2] - fundo[2]);
    if (dist >= 24) conteudo++;
  }
  return { conteudo, fundo, niveis: set.size };
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
    await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await p.evaluate(semear);
    await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
    await p.evaluate(() => {
      document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
    });
    if (caso.preset) {
      await p.evaluate(async (rotulo, grupo) => {
        const achar = () => Array.from(document.querySelectorAll('.tpl-card'))
          .find((el) => { const l = el.querySelector('.tpl-card-label'); return l && l.textContent.trim() === rotulo; });
        if (!achar()) {
          const linha = Array.from(document.querySelectorAll('.tpl-item'))
            .find((el) => (el.textContent || '').trim().startsWith(grupo));
          if (linha) { linha.click(); await new Promise((r) => setTimeout(r, 900)); }
        }
        const card = achar();
        if (card) { (card.querySelector('.tpl-card-label') || card).click(); await new Promise((r) => setTimeout(r, 3000)); }
      }, caso.preset.rotulo, caso.preset.grupo);
    }
    await p.waitForFunction(
      function (fn) { const m = new Function('return (' + fn + ')()')(); return !!m && m.conteudo > 20000; },
      { timeout: 60000, polling: 700 }, CONTEUDO.toString(),
    );

    // adiciona o efeito, ajusta os niveis, e SO DEPOIS pausa
    await p.evaluate(async () => {
      const sel = Array.from(document.querySelectorAll('select'))
        .find((s) => Array.from(s.options).some((o) => o.textContent.trim() === 'Posterize'));
      sel.value = Array.from(sel.options).find((o) => o.textContent.trim() === 'Posterize').value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
      Array.from(document.querySelectorAll('button')).find((btn) => btn.textContent.trim() === 'Add').click();
      await new Promise((r) => setTimeout(r, 1200));
    });
    const caixa = await p.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.effect-card'))
        .find((c) => { const t = c.querySelector('.effect-title'); return t && t.textContent.trim() === 'Posterize'; });
      card.scrollIntoView({ block: 'center' });
      const st = card.querySelector('.strack');
      const r = st.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const t = (NIVEIS - 2) / 14;
    const x = caixa.x + 6 + t * (caixa.w - 12), y = caixa.y + caixa.h / 2;
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.up();
    await new Promise((r) => setTimeout(r, 700));

    // pausa: sem isso as duas capturas caem em frames diferentes
    const pausou = await p.evaluate(async () => {
      const btn = document.querySelector('.play-btn');
      if (!btn) return 'sem botao de play';
      const antes = btn.getAttribute('title');
      if (antes === 'Pause') { btn.click(); await new Promise((r) => setTimeout(r, 600)); }
      return 'title agora: ' + document.querySelector('.play-btn').getAttribute('title');
    });
    console.log('  pausa  ', pausou);

    const clip = await p.evaluate(() => {
      const r = document.querySelector('canvas.stage-canvas').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    });

    const olho = () => p.evaluate(async () => {
      const card = Array.from(document.querySelectorAll('.effect-card'))
        .find((c) => { const t2 = c.querySelector('.effect-title'); return t2 && t2.textContent.trim() === 'Posterize'; });
      card.querySelector('.icon-btn').click();
      await new Promise((r) => setTimeout(r, 700));
      return card.className;
    });

    console.log('  ligado ', JSON.stringify(await p.evaluate(CONTEUDO)));
    await p.screenshot({ path: path.join(OUT, 'ab-' + caso.nome + '-ligado.png'), clip });
    console.log('  olho   ', await olho());
    console.log('  deslig ', JSON.stringify(await p.evaluate(CONTEUDO)));
    await p.screenshot({ path: path.join(OUT, 'ab-' + caso.nome + '-desligado.png'), clip });
    await b.close();
  }
  console.log('');
  console.log('fotos em ' + OUT);
})();
