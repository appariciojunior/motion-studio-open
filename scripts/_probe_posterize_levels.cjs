#!/usr/bin/env node
// O controle Levels do Posterize move o palco?
//
// O slider do app nao e <input type=range>: e um `.strack` proprio, que le
// pointerdown/pointermove. So mouse de verdade prova que ele funciona — e a
// prova e a CONTAGEM DE NIVEIS no palco, nao o numero escrito na tela.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';
const ALVOS = [2, 3, 8, 16];

const MEDIR = function () {
  const c = document.querySelector('canvas.stage-canvas');
  if (!c || !c.width) return null;
  const o = document.createElement('canvas');
  o.width = c.width; o.height = c.height;
  const g = o.getContext('2d');
  g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const hist = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  let fundo = [0, 0, 0], max = 0;
  for (const [k, n] of hist) if (n > max) { max = n; fundo = k.split(',').map(Number); }
  const setR = new Set();
  let conteudo = 0;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.abs(d[i] - fundo[0]) + Math.abs(d[i + 1] - fundo[1]) + Math.abs(d[i + 2] - fundo[2]);
    if (dist < 24) continue;
    conteudo++;
    setR.add(d[i]);
  }
  const lista = Array.from(setR).sort((a, b) => a - b);
  return { conteudo, fundo, niveis: lista.length, lista: lista.length <= 20 ? lista : null };
};

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: process.env.HEADED ? false : 'new',
    args: ['--enable-gpu'], defaultViewport: { width: 1600, height: 1000 },
  });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
  // Mesma semeadura do _probe_posterize.cjs: sem um projeto ativo o palco fica
  // vazio e nao ha o que medir.
  await p.evaluate(() => {
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
      activeId: 'fx',
      projects: [{ id: 'fx', name: 'Teste posterize', createdAt: 1, updatedAt: 2, mode: '2d' }],
    }));
  });
  await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
  await p.evaluate(() => {
    document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
  });
  await p.waitForFunction(
    function (fn) { const m = new Function('return (' + fn + ')()')(); return !!m && m.conteudo > 20000; },
    { timeout: 60000, polling: 700 }, MEDIR.toString(),
  );
  console.log('baseline', JSON.stringify(await p.evaluate(MEDIR)));

  console.log('add    ', await p.evaluate(async () => {
    const sel = Array.from(document.querySelectorAll('select'))
      .find((s) => Array.from(s.options).some((o) => o.textContent.trim() === 'Posterize'));
    if (!sel) return 'sem select';
    sel.value = Array.from(sel.options).find((o) => o.textContent.trim() === 'Posterize').value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const add = Array.from(document.querySelectorAll('button')).find((btn) => btn.textContent.trim() === 'Add');
    add.click();
    await new Promise((r) => setTimeout(r, 1200));
    const card = Array.from(document.querySelectorAll('.effect-card'))
      .find((c) => { const t = c.querySelector('.effect-title'); return t && t.textContent.trim() === 'Posterize'; });
    if (!card) return 'sem card';
    card.scrollIntoView({ block: 'center' });
    return 'ok, controles: ' + card.querySelectorAll('.strack').length;
  }));
  await new Promise((r) => setTimeout(r, 800));
  console.log('default', JSON.stringify(await p.evaluate(MEDIR)));

  // o retangulo do slider Levels, em coordenadas de viewport
  const caixa = await p.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.effect-card'))
      .find((c) => { const t = c.querySelector('.effect-title'); return t && t.textContent.trim() === 'Posterize'; });
    const st = card && card.querySelector('.strack');
    if (!st) return null;
    const r = st.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, texto: st.textContent.trim().slice(0, 40) };
  });
  console.log('slider ', JSON.stringify(caixa));
  if (!caixa) { await b.close(); return; }

  const MIN = 2, MAX = 16;
  for (const alvo of ALVOS) {
    const t = (alvo - MIN) / (MAX - MIN);
    // a borda do trilho nao aceita clique (clamp de 6px), entao vem de dentro
    const x = caixa.x + 6 + t * (caixa.w - 12);
    const y = caixa.y + caixa.h / 2;
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x, y);
    await p.mouse.up();
    await new Promise((r) => setTimeout(r, 900));
    const lido = await p.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.effect-card'))
        .find((c) => { const t2 = c.querySelector('.effect-title'); return t2 && t2.textContent.trim() === 'Posterize'; });
      const st = card.querySelector('.strack');
      return st.textContent.trim().replace(/\s+/g, ' ');
    });
    const m = await p.evaluate(MEDIR);
    console.log('levels=' + String(alvo).padStart(2) + '  painel="' + lido + '"  palco=' + JSON.stringify(m));
  }
  await b.close();
})();
