#!/usr/bin/env node
// Sair e voltar da biblioteca derruba contexto a cada volta?
//
// Trocar de grupo no acordeao nem sempre zera a contagem de referencias das
// miniaturas — alguma lista pode manter uma montada. Sair da ROTA zera com
// certeza: nenhuma miniatura sobrevive a /projects. Este e, portanto, o teste
// que mede o ciclo destruir/recriar de verdade.
//
// Sem carencia, cada ida e volta custa um `forceContextLoss()` (three) e um
// `app.destroy(true)` (Pixi), e sao essas perdas que o Chrome soma contra a
// pagina ate recusar criacao com "Web page caused context loss and was
// blocked". Com carencia de 10s, uma ida e volta rapida nao pode derrubar nada.
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';
const VOLTAS = Number(process.argv[3] || 10);

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

// Navegacao pelo trilho, nao por goto: um goto recarrega a pagina e zera a
// instrumentacao junto com o modulo, medindo outra coisa.
const IR = async function (rotulo) {
  document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; });
  const item = Array.from(document.querySelectorAll('.rail-item, .rail-action, a'))
    .find((el) => (el.textContent || '').trim() === rotulo);
  if (!item) return 'sem item ' + rotulo;
  item.click();
  await new Promise((r) => setTimeout(r, 2200));
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
    if (/context could not be created|blocked|CONTEXT_LOST/i.test(t)) erros.push(t.slice(0, 160));
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
  const ler = () => p.evaluate(() => {
    const o = window.__ctx;
    const vivos = window.__ctxRefs.filter((e) => !e.gl.isContextLost());
    return { criados: o.criados, perdidos: o.perdidosDeProposito, recusados: o.recusados,
      vivos: vivos.length, porCanvas: o.porCanvas };
  });
  console.log('inicio ', JSON.stringify(await ler()));

  for (let i = 0; i < VOLTAS; i++) {
    const fora = await p.evaluate(IR, 'Projects');
    const volta = await p.evaluate(IR, 'Library');
    const c = await ler();
    console.log('volta ' + String(i + 1).padStart(2)
      + '  ' + String(fora).padEnd(10) + ' -> ' + String(volta).padEnd(10)
      + '  criados=' + String(c.criados).padStart(3)
      + '  perdidos=' + String(c.perdidos).padStart(3)
      + '  recusados=' + String(c.recusados).padStart(3)
      + '  vivos=' + String(c.vivos).padStart(3));
    if (c.recusados > 0) { console.log('  >>> o Chrome RECUSOU contexto nesta volta'); break; }
  }
  console.log('');
  console.log('por canvas:', JSON.stringify((await ler()).porCanvas));
  console.log('mensagens (' + erros.length + '):');
  for (const e of erros.slice(0, 6)) console.log('  ' + e);
  await b.close();
})();
