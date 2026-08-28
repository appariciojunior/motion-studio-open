#!/usr/bin/env node
// ============================================================
//  _shot_thumbs_ab — folha de contato das miniaturas do catalogo
//
//  Fotografa a lista de presets com as miniaturas ao vivo, para comparar
//  geometria e legibilidade antes/depois a olho — que e o unico juiz de
//  "parece com a cena" e "da para distinguir os cards".
//
//  Tambem MEDE, para nao depender do olho: quantos cards cada miniatura pinta,
//  quantos caem inteiramente fora da caixa (sinal de pose errada) e quantos
//  tons distintos aparecem (sinal de mancha unica).
//
//  Uso: node scripts/_shot_thumbs_ab.cjs <porta> <rotulo>
// ============================================================

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = process.argv[2] || '54498';
const LABEL = process.argv[3] || 'depois';
const URL = `http://localhost:${PORT}`;
const OUT = path.resolve(__dirname, '..', '..', '_thumbs-ab');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

(async () => {
  if (!CHROME) { console.error('Chrome nao encontrado'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-gpu', '--use-angle=gl', '--window-size=1500,1200'],
    defaultViewport: { width: 1500, height: 1200, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();

  await page.goto(URL + '/library', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.evaluate(() => {
    localStorage.setItem('motion-welcome-seen', '1');
    localStorage.setItem('motion-tour-seen', '1');
    localStorage.setItem('motion-mockup-tour-seen', '1');
  });
  await page.goto(URL + '/library', { waitUntil: 'networkidle2', timeout: 90_000 });

  // Espera as miniaturas existirem de verdade.
  await page.waitForFunction(
    () => document.querySelectorAll('.tpl-thumb .tpl-thumb-el').length > 20,
    { timeout: 60_000, polling: 400 },
  ).catch(() => console.log('  (aviso: poucas miniaturas apareceram)'));

  // Os grupos comecam fechados e os cards so existem no DOM quando um abre. A
  // busca renderiza a grade direto, o que da controle sobre QUAIS presets entram
  // na folha — e os que interessam aqui sao os webgl, que desenhavam a geometria
  // errada.
  const TERMO = process.argv[4] || 'sticker';
  await page.evaluate((termo) => {
    const input = document.querySelector('.tpl-head input, input[type=search], input[placeholder]');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, termo);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, TERMO);
  await new Promise((r) => setTimeout(r, 2500));

  // ---- medida, por miniatura ----
  const stats = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.tpl-card').forEach((card) => {
      const thumb = card.querySelector('.tpl-thumb');
      if (!thumb) return;
      const box = thumb.getBoundingClientRect();
      if (box.width < 8) return;
      const els = [...thumb.querySelectorAll('.tpl-thumb-el')];
      if (!els.length) return;
      let fora = 0;
      const tons = new Set();
      for (const el of els) {
        const r = el.getBoundingClientRect();
        // inteiramente fora da caixa da miniatura
        if (r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) fora++;
        tons.add(getComputedStyle(el).backgroundColor);
      }
      out.push({
        nome: (card.querySelector('.tpl-name, .tpl-label')?.textContent || card.textContent || '').trim().slice(0, 26),
        cards: els.length,
        fora,
        tons: tons.size,
        temMatrix3d: els.some((el) => getComputedStyle(el).transform.startsWith('matrix3d')),
      });
    });
    return out;
  });

  const com3d = stats.filter((s) => s.temMatrix3d);
  const so2d = stats.filter((s) => !s.temMatrix3d);
  const soma = (a, k) => a.reduce((n, s) => n + s[k], 0);
  const resumo = {
    rotulo: LABEL,
    miniaturas: stats.length,
    comMatrix3d: com3d.length,
    so2d: so2d.length,
    cardsTotais: soma(stats, 'cards'),
    cardsForaDaCaixa: soma(stats, 'fora'),
    tonsMedios: stats.length ? +(soma(stats, 'tons') / stats.length).toFixed(2) : 0,
    piores: [...stats].sort((a, b) => b.fora - a.fora).slice(0, 6),
  };
  console.log(JSON.stringify(resumo, null, 1));
  fs.writeFileSync(path.join(OUT, `medidas-${LABEL}.json`), JSON.stringify({ resumo, stats }, null, 2));

  // ---- folha de contato ----
  const list = await page.$('.tpl-list');
  if (list) {
    await list.screenshot({ path: path.join(OUT, `catalogo-${LABEL}.png`) });
  } else {
    await page.screenshot({ path: path.join(OUT, `catalogo-${LABEL}.png`) });
  }

  await browser.close();
  console.log('\nsaida em ' + OUT);
})();
