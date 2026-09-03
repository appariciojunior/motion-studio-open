#!/usr/bin/env node
// O contexto das miniaturas sobrevive, e as miniaturas voltam a pintar?
//
// Duas perguntas, porque a correcao troca destruir por limpar e as duas podem
// quebrar em direcoes opostas:
//
//   1. a pagina NUNCA pode causar perda de contexto por conta propria — e a
//      soma dessas perdas que faz o Chrome recusar criacao com "Web page caused
//      context loss and was blocked"
//   2. depois da carencia (que solta o canvas e joga fora o cache de geometria)
//      as miniaturas tem de voltar a pintar, senao a correcao trocou um bug por
//      outro
//
// A prova de (2) e CONTEUDO de imagem, nao presenca de <img>: um still vazio
// tem src e nao mostra nada.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';
const ESPERA_MS = Number(process.argv[3] || 13000); // > CARENCIA_MS

const INSTRUMENTAR = function () {
  const w = window;
  w.__ctx = { criados: 0, recusados: 0, perdidosDeProposito: 0, porCanvas: {} };
  w.__ctxRefs = [];
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (tipo, opts) {
    const r = orig.call(this, tipo, opts);
    if (/webgl/.test(String(tipo))) {
      if (r) {
        w.__ctx.criados++;
        const quem = (this.className || this.id || '(sem classe)') + '';
        w.__ctx.porCanvas[quem] = (w.__ctx.porCanvas[quem] || 0) + 1;
        w.__ctxRefs.push({ gl: r, canvas: this });
        const ext = r.getExtension('WEBGL_lose_context');
        if (ext && !ext.__hooked) {
          const lose = ext.loseContext.bind(ext);
          ext.loseContext = function () { w.__ctx.perdidosDeProposito++; return lose(); };
          ext.__hooked = true;
        }
      } else { w.__ctx.recusados++; }
    }
    return r;
  };
};

// Quantas miniaturas realmente PINTARAM: o still e lido num canvas 2D e so
// conta se tiver variacao de pixel.
const MINIATURAS = async function () {
  const imgs = Array.from(document.querySelectorAll('.tpl-thumb img'))
    .filter((im) => im.src && im.naturalWidth > 0);
  let pintadas = 0;
  for (const im of imgs.slice(0, 24)) {
    const c = document.createElement('canvas');
    c.width = Math.min(60, im.naturalWidth); c.height = Math.min(80, im.naturalHeight);
    const g = c.getContext('2d');
    try { g.drawImage(im, 0, 0, c.width, c.height); } catch { continue; }
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let m = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { m += d[i]; n++; }
    m /= n;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) { const v = d[i] - m; s += v * v; }
    if (Math.sqrt(s / n) > 3) pintadas++;
  }
  return { comImg: imgs.length, pintadas, esqueletos: document.querySelectorAll('.tpl-thumb-skeleton').length };
};

const IR = async function (rotulo) {
  document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
  const item = Array.from(document.querySelectorAll('.rail-item, .rail-action, a'))
    .find((el) => (el.textContent || '').trim() === rotulo);
  if (!item) return 'sem item ' + rotulo;
  item.click();
  await new Promise((r) => setTimeout(r, 2500));
  return location.pathname;
};

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: process.env.HEADED ? false : 'new',
    args: ['--enable-gpu'], defaultViewport: { width: 1600, height: 1000 },
  });
  const p = await b.newPage();
  const erros = [];
  p.on('console', (m) => {
    const t = m.text();
    if (/could not be created|blocked|CONTEXT_LOST/i.test(t)) erros.push(t.slice(0, 150));
  });
  p.on('pageerror', (e) => erros.push('[pageerror] ' + String(e).slice(0, 150)));
  await p.evaluateOnNewDocument(INSTRUMENTAR);
  await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.evaluate(() => {
    localStorage.setItem('motion-welcome-seen', '1');
    localStorage.setItem('motion-tour-seen', '1');
  });
  await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
  await new Promise((r) => setTimeout(r, 6000));

  const ler = () => p.evaluate(() => {
    const o = window.__ctx;
    return { criados: o.criados, perdidos: o.perdidosDeProposito, recusados: o.recusados,
      vivos: window.__ctxRefs.filter((e) => !e.gl.isContextLost()).length, porCanvas: o.porCanvas };
  });

  console.log('inicio      ', JSON.stringify(await ler()));
  console.log('  miniaturas', JSON.stringify(await p.evaluate(MINIATURAS)));

  // Sai da biblioteca, fica MAIS que a carencia, e volta. E o caso que a
  // carencia existe para cobrir — e o unico em que a limpeza roda de verdade.
  console.log('sai         ', await p.evaluate(IR, 'Projects'));
  await new Promise((r) => setTimeout(r, ESPERA_MS));
  console.log('  apos ' + ESPERA_MS + 'ms fora', JSON.stringify(await ler()));
  console.log('volta       ', await p.evaluate(IR, 'Library'));
  await new Promise((r) => setTimeout(r, 6000));
  console.log('  ', JSON.stringify(await ler()));
  console.log('  miniaturas', JSON.stringify(await p.evaluate(MINIATURAS)));

  console.log('');
  console.log('mensagens (' + erros.length + '):');
  for (const e of erros.slice(0, 6)) console.log('  ' + e);
  await b.close();
})();
