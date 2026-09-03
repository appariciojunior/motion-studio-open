#!/usr/bin/env node
// Quantos contextos WebGL a pagina cria e PERDE ao trocar de preset?
//
// O erro que o usuario viu — THREE.WebGLRenderer: A WebGL context could not be
// created. Reason: "Web page caused context loss and was blocked" — nao e falta
// de contexto: e o Chrome BLOQUEANDO a criacao porque a propria pagina ja
// causou perdas demais. A unica coisa no repo que causa perda de proposito e o
// `forceContextLoss()` de `disposeShared3d()`, chamado quando a contagem de
// referencias das miniaturas 3D chega a zero.
//
// Este probe instrumenta `getContext` e o `loseContext` da extensao, troca de
// grupo no acordeao N vezes (o que desmonta todas as miniaturas do grupo antigo,
// levando refs a zero) e conta: criados, perdidos de proposito e RECUSADOS.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';
const VOLTAS = Number(process.argv[3] || 8);
// Um grupo webgl e um 2D: alternar entre eles desmonta as miniaturas do outro.
// Orbit 3D e webgl e Runway e 2D: alternar entre eles troca de ENGINE, que e o
// que destroi e recria o renderer do palco. Stickers, que estava aqui antes,
// tambem e webgl — a alternancia nao trocava de engine e o palco nem era
// recriado, entao o probe media so as miniaturas.
const GRUPOS = ['Orbit 3D', 'Runway'];

const INSTRUMENTAR = function () {
  const w = window;
  w.__ctx = { criados: 0, recusados: 0, perdidosDeProposito: 0, erros: [], porCanvas: {}, vivos: 0 };
  // Cada contexto criado entra num registro fraco para se saber quantos ainda
  // estao VIVOS (nao perdidos) — criados sozinho nao distingue vazamento de
  // reuso.
  w.__ctxRefs = [];
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (tipo, opts) {
    const r = orig.call(this, tipo, opts);
    if (/webgl/.test(String(tipo))) {
      if (r) {
        w.__ctx.criados++;
        // quem pediu: a classe do canvas separa palco de miniatura
        const quem = (this.className || this.id || '(sem classe)') + '';
        w.__ctx.porCanvas[quem] = (w.__ctx.porCanvas[quem] || 0) + 1;
        w.__ctxRefs.push({ gl: r, canvas: this, quem });
        const ext = r.getExtension('WEBGL_lose_context');
        if (ext && !ext.__hooked) {
          const lose = ext.loseContext.bind(ext);
          ext.loseContext = function () { w.__ctx.perdidosDeProposito++; return lose(); };
          ext.__hooked = true;
        }
      } else {
        w.__ctx.recusados++;
      }
    }
    return r;
  };
};

const TROCAR = async function (grupo) {
  document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
  const linha = Array.from(document.querySelectorAll('.tpl-item'))
    .find((el) => (el.textContent || '').trim().startsWith(grupo));
  if (!linha) return 'grupo ' + grupo + ' nao achado';
  linha.click();
  await new Promise((r) => setTimeout(r, 1400));
  const card = document.querySelector('.tpl-grid-accordion .tpl-card');
  if (card) {
    (card.querySelector('.tpl-card-label') || card).click();
    await new Promise((r) => setTimeout(r, 2200));
  }
  return 'ok';
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
    if (/context could not be created|context loss|CONTEXT_LOST|blocked/i.test(t)) erros.push(t.slice(0, 160));
  });
  p.on('pageerror', (e) => erros.push('[pageerror] ' + String(e).slice(0, 160)));
  await p.evaluateOnNewDocument(INSTRUMENTAR);
  await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.evaluate(() => {
    localStorage.setItem('motion-welcome-seen', '1');
    localStorage.setItem('motion-tour-seen', '1');
  });
  await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
  await new Promise((r) => setTimeout(r, 4000));
  console.log('inicio ', JSON.stringify(await p.evaluate(() => window.__ctx)));

  for (let i = 0; i < VOLTAS; i++) {
    const g = GRUPOS[i % GRUPOS.length];
    const r = await p.evaluate(TROCAR, g);
    const c = await p.evaluate(() => {
      const o = window.__ctx;
      const vivos = window.__ctxRefs.filter((e) => !e.gl.isContextLost());
      o.vivos = vivos.length;
      // Vivo mas fora do documento = vazado: ninguem mais pode usar aquele
      // contexto e ele segue contando contra o limite da pagina.
      o.vazados = vivos.filter((e) => !document.contains(e.canvas)).length;
      return o;
    });
    console.log(
      'volta ' + String(i + 1).padStart(2) + '  ' + g.padEnd(9) + ' ' + r.padEnd(4)
      + '  criados=' + String(c.criados).padStart(3)
      + '  perdidosDeProposito=' + String(c.perdidosDeProposito).padStart(3)
      + '  recusados=' + String(c.recusados).padStart(3)
      + '  vivos=' + String(c.vivos).padStart(3)
      + '  vazados=' + String(c.vazados).padStart(3),
    );
    if (c.recusados > 0) { console.log('  >>> o Chrome comecou a RECUSAR contexto nesta volta'); break; }
  }

  console.log('');
  console.log('por canvas:', JSON.stringify((await p.evaluate(() => window.__ctx)).porCanvas));
  console.log('mensagens de contexto (' + erros.length + '):');
  for (const e of erros.slice(0, 8)) console.log('  ' + e);
  await b.close();
})();
