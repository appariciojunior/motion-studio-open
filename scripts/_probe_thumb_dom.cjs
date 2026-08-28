#!/usr/bin/env node
// ============================================================
//  _probe_thumb_dom — o que o DOM realmente desenha contra o que o palco poria
//
//  verify-thumb3d prova a MATEMATICA e nada mais. Foi assim que passou verde
//  enquanto o componente aplicava a posicao duas vezes — uma na matriz e outra
//  em left/top — e cada card saia ao dobro da distancia do centro. A licao e
//  que a projecao certa num modulo nao diz nada sobre o CSS emitido.
//
//  Este mede o DOM: le a caixa real de cada card da miniatura no navegador,
//  normaliza pela caixa da miniatura, e compara com a projecao que o palco
//  faria do mesmo card no mesmo frame. Reporta em fracao da miniatura, entao
//  0.02 = 2% da largura fora de lugar.
//
//  Uso: node scripts/_probe_thumb_dom.cjs <porta> [quantos-presets]
// ============================================================

const fs = require('fs');
const path = require('path');
const Module = require('module');
const puppeteer = require('puppeteer-core');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { catalogTemplateList, defaultsFor, easingFor, layerCountFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');
const { thumbPerspective } = require('../lib/thumbPose3d');

const PORT = process.argv[2] || '54498';
const LIMIT = +(process.argv[3] || 8);
const URL = `http://localhost:${PORT}`;

const thumbSrc = fs.readFileSync(path.join(root, 'components/TemplateThumb.tsx'), 'utf8');
const THUMB_FRAME = +(thumbSrc.match(/const THUMB_FRAME = (\d+)/)?.[1] ?? 40);
const m = thumbSrc.match(/const CTX_BASE = \{ fps: (\d+), width: (\d+), height: (\d+), duration: (\d+), totalFrames: (\d+) \}/);
const CTX_BASE = { fps: +m[1], width: +m[2], height: +m[3], duration: +m[4], totalFrames: +m[5] };
const TEX_LONG = +(thumbSrc.match(/const TEX_LONG = (\d+)/)?.[1] ?? 600);
const SPRITE_BASE = +(thumbSrc.match(/const SPRITE_BASE = (\d+)/)?.[1] ?? 340);

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

// O que o PALCO faria: centro e tamanho projetados, em fracao do canvas.
function stageExpectation(template) {
  const v = defaultsFor(template.meta.id);
  const texAspect = template.meta.cardAspect === 'canvas'
    ? CTX_BASE.width / CTX_BASE.height
    : template.meta.cardAspect ?? 4 / 5;
  const texW = TEX_LONG * Math.min(1, texAspect);
  const texH = TEX_LONG * Math.min(1, 1 / texAspect);
  const norm = SPRITE_BASE / TEX_LONG;
  const ease = resolveEasing(easingFor(template.meta.id));
  const ctx = {
    ...CTX_BASE, ease,
    easedPhase: (p) => { const b = Math.floor(p); return b + ease(p - b); },
    cardAspect: texAspect,
  };
  const count = layerCountFor(template.meta.id, v,
    { width: CTX_BASE.width, height: CTX_BASE.height, cardAspect: texAspect });

  const { perspective: P, gain, exact } = thumbPerspective(template, v, ctx);
  let pose; try { pose = template.camera?.(v, ctx); } catch { pose = undefined; }
  const control = Math.max(0, Math.min(200, Number(v.perspective ?? 100)));
  const fov = pose?.fov ?? (15 + (95 - 15) * (control / 200));
  const D = (CTX_BASE.height / 2) / Math.tan((fov * Math.PI) / 360);

  const cards = [];
  for (let i = 0; i < count; i++) {
    const t = template.transform3d(THUMB_FRAME, i, count, v, ctx);
    if (!t) continue;
    const denom = P - t.z;
    if (denom <= 1e-6) continue;
    const mag = D / denom;
    // fracao do canvas: centro (0.5,0.5 = meio) e largura projetada
    cards.push({
      cx: 0.5 + (t.x * mag) / CTX_BASE.width,
      cy: 0.5 + (t.y * mag) / CTX_BASE.height,
      w: (texW * norm * t.scale * mag) / CTX_BASE.width,
      alpha: t.alpha,
    });
  }
  return { cards, exact, P, gain, D };
}

(async () => {
  if (!CHROME) { console.error('Chrome nao encontrado'); process.exit(1); }
  const alvos = catalogTemplateList
    .filter((t) => t.meta.engine === 'webgl' && typeof t.transform3d === 'function')
    .filter((t) => stageExpectation(t).exact)
    .slice(0, LIMIT);

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-gpu', '--use-angle=gl'],
    defaultViewport: { width: 1500, height: 1100, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.goto(URL + '/library', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.evaluate(() => {
    localStorage.setItem('motion-welcome-seen', '1');
    localStorage.setItem('motion-tour-seen', '1');
  });
  await page.goto(URL + '/library', { waitUntil: 'networkidle2', timeout: 90_000 });

  console.log(`preset                       cards  erro_centro  erro_largura`);
  console.log(`---------------------------- -----  -----------  ------------`);

  for (const template of alvos) {
    const esperado = stageExpectation(template);

    // Abre o preset por busca e le a miniatura do card correspondente.
    const medido = await page.evaluate(async (nome) => {
      const input = document.querySelector('.tpl-head input, input[placeholder]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, nome);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
      const card = [...document.querySelectorAll('.tpl-card')]
        .find((c) => (c.querySelector('.tpl-card-label')?.textContent || '').trim().toLowerCase() === nome.toLowerCase());
      if (!card) return null;
      const thumb = card.querySelector('.tpl-thumb');
      const box = thumb.getBoundingClientRect();
      if (box.width < 8) return null;
      return [...thumb.querySelectorAll('.tpl-thumb-el')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          cx: (r.left + r.width / 2 - box.left) / box.width,
          cy: (r.top + r.height / 2 - box.top) / box.height,
          w: r.width / box.width,
        };
      });
    }, template.meta.name);

    if (!medido || !medido.length) { console.log(`${template.meta.name.padEnd(28)} — nao encontrado`); continue; }

    // Emparelha pelo indice de desenho: o componente preserva a ordem original.
    const visiveis = esperado.cards.filter((c) => c.alpha > 0.02);
    const n = Math.min(medido.length, visiveis.length);
    let dc = 0, dw = 0;
    for (let i = 0; i < n; i++) {
      dc += Math.hypot(medido[i].cx - visiveis[i].cx, medido[i].cy - visiveis[i].cy);
      dw += Math.abs(medido[i].w - visiveis[i].w);
    }
    const erroCentro = n ? dc / n : NaN;
    const erroLargura = n ? dw / n : NaN;
    const flag = erroCentro > 0.03 || erroLargura > 0.03 ? '  <== FORA' : '';
    console.log(`${template.meta.name.padEnd(28)} ${String(n).padStart(5)}  ${erroCentro.toFixed(4).padStart(11)}  ${erroLargura.toFixed(4).padStart(12)}${flag}`);
  }

  await browser.close();
})();
