#!/usr/bin/env node
// ============================================================
//  _shot_thumb_vs_stage — a miniatura contra o palco, mesmo preset, mesmo frame
//
//  A prova numerica de verify-thumb3d compara o CENTRO de cada card. Isso deixa
//  passar tudo que nao e translacao: rotacao, tamanho aparente, qual face esta
//  virada, e as deformacoes de malha (curl, bend, cornerPeel, sticker peel) que
//  o CSS simplesmente nao tem. Para saber se a miniatura "parece com a cena" o
//  unico juiz e por a imagem ao lado da outra.
//
//  Semeia o preset no localStorage, deixa o palco pintar de verdade (Chrome com
//  GPU, headless novo), fotografa o canvas, depois fotografa a miniatura do
//  MESMO preset com o MESMO frame que ela usa, e grava as duas.
//
//  Uso: node scripts/_shot_thumb_vs_stage.cjs <porta> <id-do-preset> [...ids]
// ============================================================

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = process.argv[2] || '54498';
const IDS = process.argv.slice(3);
if (!IDS.length) { console.error('passe pelo menos um id de preset'); process.exit(1); }
const URL = `http://localhost:${PORT}`;
const OUT = path.resolve(__dirname, '..', '..', '_thumb-vs-stage');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

// O frame que a miniatura usa, lido da fonte para os dois lados baterem.
const thumbSrc = fs.readFileSync(path.resolve(__dirname, '..', 'components/TemplateThumb.tsx'), 'utf8');
const THUMB_FRAME = +(thumbSrc.match(/const THUMB_FRAME = (\d+)/)?.[1] ?? 40);

(async () => {
  if (!CHROME) { console.error('Chrome nao encontrado'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-gpu', '--use-angle=gl', '--window-size=1500,1100'],
    defaultViewport: { width: 1500, height: 1100, deviceScaleFactor: 2 },
  });

  for (const id of IDS) {
    const page = await browser.newPage();
    await page.goto(URL + '/library', { waitUntil: 'domcontentloaded', timeout: 90_000 });

    // O palco no MESMO frame da miniatura, e com o preset pedido.
    await page.evaluate((tpl, frame) => {
      localStorage.setItem('motion-welcome-seen', '1');
      localStorage.setItem('motion-tour-seen', '1');
      localStorage.setItem('motion-mockup-tour-seen', '1');
      const scene = {
        activeTemplateId: tpl,
        tracks: [{ id: 't0', templateId: tpl }],
        width: 810, height: 1080, fps: 30, duration: 8, frame,
        background: { source: 'color', color: '#101010', gradient: false, color2: '#101010', imageUrl: null, blur: 28 },
        effects: [],
      };
      localStorage.setItem('motion-scene-v1', JSON.stringify(scene));
      localStorage.setItem(`motion-project-cmp`, JSON.stringify(scene));
      localStorage.setItem('motion-projects-v1', JSON.stringify({
        activeId: 'cmp',
        projects: [{ id: 'cmp', name: 'comparacao', createdAt: 1, updatedAt: 2, mode: '2d' }],
      }));
    }, id, THUMB_FRAME);

    await page.goto(URL + '/library', { waitUntil: 'networkidle2', timeout: 90_000 });

    // Espera o palco ter conteudo de verdade, medindo pixel — nao um sleep.
    const stagePainted = await page.waitForFunction(() => {
      const c = document.querySelector('canvas.stage-canvas, canvas.three3d-stage');
      if (!c || !c.width) return false;
      const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
      const g = o.getContext('2d'); g.drawImage(c, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const cores = new Set();
      for (let i = 0; i < d.length; i += 4 * 131) cores.add(`${d[i]},${d[i+1]},${d[i+2]}`);
      return cores.size > 6 ? cores.size : false;
    }, { timeout: 45_000, polling: 500 }).then((h) => h.jsonValue()).catch(() => null);

    // Trava o frame no mesmo que a miniatura mostra.
    await page.evaluate((frame) => {
      const inputs = [...document.querySelectorAll('input[type=range]')];
      const scrub = inputs.find((i) => +i.max >= 100);
      if (scrub) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(scrub, String(frame));
        scrub.dispatchEvent(new Event('input', { bubbles: true }));
        scrub.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, THUMB_FRAME);
    await new Promise((r) => setTimeout(r, 1200));

    const canvas = await page.$('canvas.stage-canvas, canvas.three3d-stage');
    if (canvas) await canvas.screenshot({ path: path.join(OUT, `${id}-1-palco.png`) });

    // Agora a miniatura do mesmo preset: buscar por ele e fotografar a caixa.
    await page.evaluate((tpl) => {
      const input = document.querySelector('.tpl-head input, input[placeholder]');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      // busca pelo nome, que e o id sem o sufixo numerico
      setter.call(input, tpl.replace(/-\d+$/, '').replace(/-/g, ' '));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, id);
    await new Promise((r) => setTimeout(r, 2000));

    const info = await page.evaluate((tpl) => {
      const cards = [...document.querySelectorAll('.tpl-card')];
      // o card ativo e o do preset semeado
      const target = cards.find((c) => c.classList.contains('active')) ?? cards[0];
      if (!target) return null;
      const thumb = target.querySelector('.tpl-thumb');
      if (!thumb) return null;
      const els = [...thumb.querySelectorAll('.tpl-thumb-el')];
      const box = thumb.getBoundingClientRect();
      target.setAttribute('data-cmp', '1');
      return {
        nome: (target.querySelector('.tpl-card-label')?.textContent || '').trim(),
        cards: els.length,
        matrix3d: els.filter((e) => getComputedStyle(e).transform.startsWith('matrix3d')).length,
        perspectiva: getComputedStyle(thumb).perspective,
        caixa: `${Math.round(box.width)}x${Math.round(box.height)}`,
        // fracao da caixa que os cards cobrem, como sinal grosseiro de "cheio"
        cobertura: +(els.reduce((n, e) => {
          const r = e.getBoundingClientRect();
          const w = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left));
          const h = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
          return n + w * h;
        }, 0) / (box.width * box.height)).toFixed(3),
      };
    }, id);

    const thumbEl = await page.$('.tpl-card[data-cmp="1"] .tpl-thumb');
    if (thumbEl) await thumbEl.screenshot({ path: path.join(OUT, `${id}-2-miniatura.png`) });

    console.log(`${id}: palco ${stagePainted ? `pintado (${stagePainted} cores)` : 'VAZIO'} | miniatura ${JSON.stringify(info)}`);
    await page.close();
  }

  await browser.close();
  console.log('\nsaida em ' + OUT);
})();
