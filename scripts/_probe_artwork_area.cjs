#!/usr/bin/env node
// Em escopo 'artwork', o efeito respeita o FUNDO e a AREA ao mesmo tempo?
//
// Duas perguntas que se cruzam, e por isso vale medir juntas:
//
//   1. o fundo da cena tem de sair intacto — e o que 'artwork' promete
//   2. a faixa de borda tem de cair na borda do CANVAS
//
// A segunda nao e obvia. Em 'scene' o filtro do Pixi vive em `content`, que
// cobre o quadro; em 'artwork' ele vive em `motion`, com `filterArea` propria, e
// as coordenadas que o shader recebe passam pelo `uInputSize` daquela area. Se a
// origem nao casar com a origem do canvas, a mascara de area anda junto e a
// moldura aparece deslocada — sem que nada quebre nem apareca no console.
//
// A medida: pixels que MUDARAM em relacao a cena sem efeito, separados em
// "estao na moldura externa" e "estao no miolo", mais quantos deles caem em cima
// da cor do fundo.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';
const EFEITO = process.argv[3] || 'Blur';

const CASOS = [
  { nome: '2D (Pixi)', preset: null },
  { nome: 'webgl (three)', preset: { rotulo: 'Ring Stream', grupo: 'Orbit 3D' } },
];

// Lê o palco e guarda os bytes, para comparar dois estados do MESMO frame.
const LER = function () {
  const c = document.querySelector('canvas.stage-canvas');
  if (!c || !c.width) return null;
  const o = document.createElement('canvas');
  o.width = c.width; o.height = c.height;
  const g = o.getContext('2d'); g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  return { w: c.width, h: c.height, px: Array.from(d) };
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
    activeId: 'fx', projects: [{ id: 'fx', name: 'Artwork area', createdAt: 1, updatedAt: 2, mode: '2d' }],
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

const pausar = async function () {
  const btn = document.querySelector('.play-btn');
  if (btn && btn.getAttribute('title') === 'Pause') {
    btn.click();
    await new Promise((r) => setTimeout(r, 700));
  }
  return document.querySelector('.play-btn').getAttribute('title');
};

const adicionar = async function (nome) {
  const sel = Array.from(document.querySelectorAll('select'))
    .find((s) => Array.from(s.options).some((o) => o.textContent.trim() === nome));
  if (!sel) return 'sem select';
  sel.value = Array.from(sel.options).find((o) => o.textContent.trim() === nome).value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Add').click();
  await new Promise((r) => setTimeout(r, 1600));
  const card = Array.from(document.querySelectorAll('.effect-card'))
    .find((c) => { const t = c.querySelector('.effect-title'); return t && t.textContent.trim() === nome; });
  if (!card) return 'card nao apareceu';
  const esc = card.querySelector('.effect-scope-row select');
  return 'escopo=' + (esc ? esc.value : 'SEM SELETOR');
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
    const vistos = new Set();
    p.on('console', (m) => { const t = m.text(); if ((t.includes('[DIAG]') || t.includes('[ALPHA]')) && !vistos.has(t)) { vistos.add(t); console.log('  ' + t.slice(0, 200)); } });
    await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await p.evaluate(semear);
    await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
    await p.evaluate(() => {
      document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
    });
    if (caso.preset) console.log('  preset ', await p.evaluate(escolher, caso.preset.rotulo, caso.preset.grupo));
    const pintou = await p.waitForFunction(
      function (fn) { const m = new Function('return (' + fn + ')()')(); return !!m && m.w > 0; },
      { timeout: 60000, polling: 700 }, LER.toString(),
    ).then(() => true).catch(() => false);
    if (!pintou) { console.log('  palco nao pintou'); await b.close(); continue; }

    // PAUSA antes das duas leituras: sem isso a diferenca mistura pose com efeito.
    console.log('  pausa  ', await p.evaluate(pausar));
    const antes = await p.evaluate(LER);
    console.log('  add    ', await p.evaluate(adicionar, EFEITO));
    const depois = await p.evaluate(LER);
    await b.close();

    if (!antes || !depois || antes.w !== depois.w) { console.log('  leituras incompativeis'); continue; }
    const { w, h } = antes;
    // a cor do fundo, tirada de um canto do quadro SEM efeito
    const fundo = [antes.px[0], antes.px[1], antes.px[2]];
    const faixa = Math.round(Math.min(w, h) * 0.5 * 0.35); // o Reach default
    let mudouMoldura = 0, mudouMiolo = 0, mudouSobreFundo = 0, totalFundo = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dif = Math.abs(antes.px[i] - depois.px[i])
          + Math.abs(antes.px[i + 1] - depois.px[i + 1])
          + Math.abs(antes.px[i + 2] - depois.px[i + 2]);
        const eraFundo = Math.abs(antes.px[i] - fundo[0]) + Math.abs(antes.px[i + 1] - fundo[1]) + Math.abs(antes.px[i + 2] - fundo[2]) < 10;
        if (eraFundo) totalFundo++;
        if (dif < 8) continue;
        const naMoldura = x < faixa || y < faixa || x >= w - faixa || y >= h - faixa;
        if (naMoldura) mudouMoldura++; else mudouMiolo++;
        if (eraFundo) mudouSobreFundo++;
      }
    }
    const total = mudouMoldura + mudouMiolo;
    console.log('  pixels mudados      ' + total
      + '  (moldura ' + mudouMoldura + ', miolo ' + mudouMiolo + ')');
    console.log('  na moldura          ' + (total ? ((mudouMoldura / total) * 100).toFixed(1) : '0') + '%');
    console.log('  sobre o FUNDO       ' + mudouSobreFundo + ' de ' + totalFundo
      + ' (' + (totalFundo ? ((mudouSobreFundo / totalFundo) * 100).toFixed(2) : '0') + '% do fundo)');

    // A COR da contaminacao diz qual termo a causou, e "mudou" sozinho nao diz.
    // Luz somada sai mais clara e puxada para a cor do anel; refracao sai com a
    // cor de um card arrastado para ali, sem tendencia de brilho.
    let dr = 0, dg = 0, db = 0, n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const eraFundo = Math.abs(antes.px[i] - fundo[0]) + Math.abs(antes.px[i + 1] - fundo[1]) + Math.abs(antes.px[i + 2] - fundo[2]) < 10;
        if (!eraFundo) continue;
        const dif = Math.abs(antes.px[i] - depois.px[i])
          + Math.abs(antes.px[i + 1] - depois.px[i + 1])
          + Math.abs(antes.px[i + 2] - depois.px[i + 2]);
        if (dif < 8) continue;
        dr += depois.px[i] - antes.px[i];
        dg += depois.px[i + 1] - antes.px[i + 1];
        db += depois.px[i + 2] - antes.px[i + 2];
        n++;
      }
    }
    if (n) {
      console.log('  delta medio no fundo  R ' + (dr / n).toFixed(1)
        + '  G ' + (dg / n).toFixed(1) + '  B ' + (db / n).toFixed(1)
        + '   (positivo e claro = luz somada; misto = refracao)');
    }

    // PORTAO, nao so relatorio.
    //
    // 5% e o teto: o efeito age nos cards, e a borda macia de um card
    // inevitavelmente sangra alguns pixels para o fundo — medido entre 0,4% e
    // 3% nos quatro efeitos. Acima disso o efeito esta pintando o FUNDO, que e
    // exatamente o que o escopo de arte promete nao fazer.
    //
    // O teto pegou um bug de verdade: no caminho webgl a luz do Liquid Glass
    // vazava para 14% do fundo contra 1,2% no Pixi, com o MESMO shader — e foi
    // a assimetria entre os engines que apontou a causa (textura de alvo MSAA
    // nao resolvida; ver `baseEmpty` em lib/renderer3d.ts).
    const pctFundo = totalFundo ? (mudouSobreFundo / totalFundo) * 100 : 0;
    if (pctFundo > 5) {
      console.log('  FALHOU: ' + pctFundo.toFixed(2) + '% do fundo mudou; em escopo de arte o teto e 5%');
      process.exitCode = 1;
    }
    // E a area tem de valer tambem: um efeito que muda o quadro todo passaria
    // no teste do fundo se o fundo fosse pequeno.
    if (total && (mudouMoldura / total) * 100 < 85) {
      console.log('  FALHOU: so ' + ((mudouMoldura / total) * 100).toFixed(1) + '% das mudancas caem na moldura');
      process.exitCode = 1;
    }
  }
})();
