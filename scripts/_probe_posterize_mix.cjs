#!/usr/bin/env node
// O controle Mix do Posterize devolve o fundo e a silhueta dos cards?
//
// A medida nao e "parece melhor": e a COR DO FUNDO (a mais frequente do quadro)
// e a contagem de pixels ainda distinguiveis dela. Com Mix em 100 o fundo
// #1a1a1a (26) cai para 0 e os pretos do card colapsam nele; conforme o Mix
// desce, o fundo tem de voltar na direcao de 26 e a contagem de conteudo tem de
// subir. Mix em 0 tem de ser identidade: fundo 26 e ~256 niveis.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';
const PONTOS = [100, 75, 50, 25, 0];

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
  const set = new Set();
  let conteudo = 0;
  for (let i = 0; i < d.length; i += 4) {
    set.add(d[i]);
    const dist = Math.abs(d[i] - fundo[0]) + Math.abs(d[i + 1] - fundo[1]) + Math.abs(d[i + 2] - fundo[2]);
    if (dist >= 24) conteudo++;
  }
  return { fundo: fundo[0], conteudo, niveis: set.size };
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
    activeId: 'fx', projects: [{ id: 'fx', name: 'Mix posterize', createdAt: 1, updatedAt: 2, mode: '2d' }],
  }));
};

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: process.env.HEADED ? false : 'new',
    args: ['--enable-gpu'], defaultViewport: { width: 1600, height: 1000 },
  });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.evaluate(semear);
  await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
  await p.evaluate(() => {
    document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
  });
  await p.waitForFunction(
    function (fn) { const m = new Function('return (' + fn + ')()')(); return !!m && m.conteudo > 20000; },
    { timeout: 60000, polling: 700 }, MEDIR.toString(),
  );
  console.log('sem efeito  ', JSON.stringify(await p.evaluate(MEDIR)));

  const rotulos = await p.evaluate(async () => {
    const sel = Array.from(document.querySelectorAll('select'))
      .find((s) => Array.from(s.options).some((o) => o.textContent.trim() === 'Posterize'));
    sel.value = Array.from(sel.options).find((o) => o.textContent.trim() === 'Posterize').value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    Array.from(document.querySelectorAll('button')).find((btn) => btn.textContent.trim() === 'Add').click();
    await new Promise((r) => setTimeout(r, 1400));
    const card = Array.from(document.querySelectorAll('.effect-card'))
      .find((c) => { const t = c.querySelector('.effect-title'); return t && t.textContent.trim() === 'Posterize'; });
    if (!card) return null;
    card.scrollIntoView({ block: 'center' });
    return Array.from(card.querySelectorAll('.ctl-row, .control-row, label'))
      .map((el) => el.textContent.trim().slice(0, 20));
  });
  console.log('controles   ', JSON.stringify(rotulos));

  // pausa: as leituras tem de sair do mesmo frame
  console.log('pausa       ', await p.evaluate(async () => {
    const btn = document.querySelector('.play-btn');
    if (btn && btn.getAttribute('title') === 'Pause') { btn.click(); await new Promise((r) => setTimeout(r, 600)); }
    return document.querySelector('.play-btn').getAttribute('title');
  }));

  // o SEGUNDO .strack do card e o Mix (o primeiro e Levels)
  const caixa = await p.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.effect-card'))
      .find((c) => { const t = c.querySelector('.effect-title'); return t && t.textContent.trim() === 'Posterize'; });
    const st = card.querySelectorAll('.strack');
    if (st.length < 2) return { erro: 'o card tem ' + st.length + ' slider(s); Mix nao apareceu' };
    const r = st[1].getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, texto: st[1].textContent.trim() };
  });
  console.log('slider Mix  ', JSON.stringify(caixa));
  if (caixa.erro) { await b.close(); return; }

  for (const alvo of PONTOS) {
    const x = caixa.x + 6 + (alvo / 100) * (caixa.w - 12);
    const y = caixa.y + caixa.h / 2;
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x, y); await p.mouse.up();
    await new Promise((r) => setTimeout(r, 800));
    const painel = await p.evaluate(() => {
      const card = Array.from(document.querySelectorAll('.effect-card'))
        .find((c) => { const t = c.querySelector('.effect-title'); return t && t.textContent.trim() === 'Posterize'; });
      return card.querySelectorAll('.strack')[1].textContent.trim().replace(/\s+/g, ' ');
    });
    console.log('mix=' + String(alvo).padStart(3) + '  painel="' + painel + '"  ' + JSON.stringify(await p.evaluate(MEDIR)));
  }
  await b.close();
})();
