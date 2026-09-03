#!/usr/bin/env node
// Prova o Posterize NO APP, nos DOIS engines, esperando a CONDICAO (nao tempo).
//
// A prova de GPU (verify-effects-gl) compila o shader isolado; ela nao ve a
// fiacao painel -> store -> renderer nem o espaco de cor que cada engine
// entrega. Este mede o palco: quantos NIVEIS distintos por canal existem nos
// pixels do conteudo, e com que ESPACAMENTO. Posterize com n niveis tem de dar
// no maximo n valores por canal, igualmente espacados entre 0 e 255.
//
// Espera por condicao com limite de tentativas, que e o que faltava no
// _probe_effects_ui.cjs (marcado instavel por esperar tempo fixo).
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const U = process.argv[2] || 'http://localhost:3100';
const LEVELS = Number(process.argv[3] || 4);
const OUT = path.resolve(__dirname, '..', '..', '_fx-shots');
fs.mkdirSync(OUT, { recursive: true });

const CASOS = [
  { nome: '2D (Pixi)', templateId: 'arc-01', rotulo: 'Arc Fan', grupo: 'Arc' },
  // Semear o webgl pelo localStorage nao acorda o engine 3D: o palco fica
  // vazio. O preset e escolhido pelo trilho, que e o caminho que troca o
  // renderer de verdade.
  { nome: 'webgl (three)', templateId: 'orbit-3d-01', rotulo: 'Ring Stream', grupo: 'Orbit 3D' },
];

// medicao: niveis distintos por canal nos pixels de CONTEUDO (fundo excluido)
const MEDIR = function () {
  const c = document.querySelector('canvas.stage-canvas');
  if (!c || !c.width) return null;
  const o = document.createElement('canvas');
  o.width = c.width; o.height = c.height;
  const g = o.getContext('2d');
  g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  // o fundo e chapado: a cor mais frequente e ele, e sai da conta
  const hist = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  let fundo = [0, 0, 0], max = 0;
  for (const [k, n] of hist) if (n > max) { max = n; fundo = k.split(',').map(Number); }
  const setR = new Set(), setG = new Set(), setB = new Set();
  let conteudo = 0;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.abs(d[i] - fundo[0]) + Math.abs(d[i + 1] - fundo[1]) + Math.abs(d[i + 2] - fundo[2]);
    if (dist < 24) continue;
    conteudo++;
    setR.add(d[i]); setG.add(d[i + 1]); setB.add(d[i + 2]);
  }
  const listaR = Array.from(setR).sort((a, b) => a - b);
  const passos = [];
  for (let i = 1; i < listaR.length; i++) passos.push(listaR[i] - listaR[i - 1]);
  return {
    conteudo, fundo,
    niveisR: setR.size, niveisG: setG.size, niveisB: setB.size,
    listaR: listaR.length <= 24 ? listaR : null,
    passos: passos.length <= 23 ? passos : null,
  };
};

const semear = function (tid) {
  const scene = {
    activeTemplateId: tid,
    tracks: [{ id: 't0', templateId: tid }],
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
};

const aplicarPosterize = async function (lv) {
  const sel = Array.from(document.querySelectorAll('select'))
    .find((s) => Array.from(s.options).some((o) => o.textContent.trim() === 'Posterize'));
  if (!sel) return 'sem select de efeitos';
  const opt = Array.from(sel.options).find((o) => o.textContent.trim() === 'Posterize');
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  const add = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Add');
  if (!add) return 'sem botao Add';
  add.click();
  await new Promise((r) => setTimeout(r, 500));
  const card = Array.from(document.querySelectorAll('.effect-card'))
    .find((c) => {
      const t = c.querySelector('.effect-title');
      return t && t.textContent.trim() === 'Posterize';
    });
  if (!card) return 'card do Posterize nao apareceu';
  const range = card.querySelector('input[type=range]');
  if (!range) return 'ok, sem slider Levels';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(range, String(lv));
  range.dispatchEvent(new Event('input', { bubbles: true }));
  range.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  return 'ok, levels=' + range.value;
};

const clipDoPalco = function () {
  const r = document.querySelector('canvas.stage-canvas').getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
};

(async () => {
  if (!CHROME) { console.error('Chrome nao encontrado'); process.exit(2); }

  const esperado = [];
  for (let i = 0; i < LEVELS; i++) esperado.push(Math.round((i / (LEVELS - 1)) * 255));

  for (const caso of CASOS) {
    console.log('');
    console.log('=== ' + caso.nome + '  (' + caso.templateId + ') ===');
    // Um navegador POR CASO. Com um so, o segundo engine caia em
    // "THREE.WebGLRenderer: Error creating WebGL context" — o contexto do
    // primeiro engine nao volta a tempo dentro da mesma pagina.
    const b = await puppeteer.launch({
      executablePath: CHROME, headless: process.env.HEADED ? false : 'new',
      // --use-angle=gl derrubava o contexto WebGL do palco 3D (VALIDATE_STATUS
      // false e CONTEXT_LOST logo depois). Com o ANGLE padrao do Chrome pinta.
      args: ['--enable-gpu'],
      defaultViewport: { width: 1600, height: 1000 },
    });
    const p = await b.newPage();
    p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
    await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await p.evaluate(semear, caso.templateId);
    await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });

    // Escolhe o preset pelo trilho. Modal de boas-vindas escondido antes: um
    // .click() passa por tras do backdrop sem reclamar.
    const escolheu = await p.evaluate(async (rotulo, grupo) => {
      document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => {
        el.style.display = 'none';
      });
      // A lista e um acordeao de DOIS niveis: `.tpl-item` e a linha do GRUPO, e
      // o preset so existe no DOM com o grupo aberto — ai ele e um `.tpl-card`
      // com `.tpl-card-label`. Procurar o preset entre os `.tpl-item` acha
      // sempre o grupo e nunca o preset.
      const achar = () => Array.from(document.querySelectorAll('.tpl-card'))
        .find((el) => {
          const l = el.querySelector('.tpl-card-label');
          return l && l.textContent.trim() === rotulo;
        });
      if (!achar()) {
        const linha = Array.from(document.querySelectorAll('.tpl-item'))
          .find((el) => (el.textContent || '').trim().startsWith(grupo));
        if (!linha) {
          const vistos = Array.from(document.querySelectorAll('.tpl-item'))
            .map((el) => (el.textContent || '').trim().slice(0, 14));
          return 'grupo ' + grupo + ' nao achado; grupos: ' + JSON.stringify(vistos.slice(0, 8));
        }
        linha.click();
        await new Promise((r) => setTimeout(r, 900));
      }
      const card = achar();
      if (!card) return 'preset ' + rotulo + ' nao apareceu com o grupo aberto';
      card.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 250));
      // O rotulo, nao a miniatura: o canvas da miniatura fica por cima do card.
      (card.querySelector('.tpl-card-label') || card).click();
      await new Promise((r) => setTimeout(r, 3000));
      return 'clicou em ' + rotulo;
    }, caso.rotulo, caso.grupo);
    console.log('  preset ', escolheu);

    const pintou = await p.waitForFunction(
      function (fn) {
        // eslint-disable-next-line no-new-func
        const m = new Function('return (' + fn + ')()')();
        return !!m && m.conteudo > 20000 && m.niveisR > 40;
      },
      { timeout: 90000, polling: 700 }, MEDIR.toString(),
    ).then(() => true).catch(() => false);

    const base = await p.evaluate(MEDIR);
    if (!pintou) {
      console.log('  palco nao pintou conteudo suficiente:', JSON.stringify(base));
      await b.close();
      continue;
    }
    console.log('  antes  ', JSON.stringify({
      conteudo: base.conteudo, niveisR: base.niveisR, niveisG: base.niveisG, niveisB: base.niveisB,
    }));
    await p.screenshot({ path: path.join(OUT, 'post-antes-' + caso.templateId + '.png'), clip: await p.evaluate(clipDoPalco) });

    console.log('  aplicar', await p.evaluate(aplicarPosterize, LEVELS));

    const alvo = Math.max(4, Math.floor(base.niveisR / 3));
    const caiu = await p.waitForFunction(
      function (fn, alvo) {
        // eslint-disable-next-line no-new-func
        const m = new Function('return (' + fn + ')()')();
        return !!m && m.niveisR < alvo;
      },
      { timeout: 25000, polling: 500 }, MEDIR.toString(), alvo,
    ).then(() => true).catch(() => false);

    const dep = await p.evaluate(MEDIR);
    console.log('  depois ', JSON.stringify(dep));
    console.log('  niveis cairam abaixo de ' + alvo + '?', caiu ? 'SIM' : 'NAO');
    console.log('  esperado com levels=' + LEVELS + ':', JSON.stringify(esperado));
    await p.screenshot({ path: path.join(OUT, 'post-depois-' + caso.templateId + '.png'), clip: await p.evaluate(clipDoPalco) });
    await b.close();
  }

  console.log('');
  console.log('fotos em ' + OUT);
})();
