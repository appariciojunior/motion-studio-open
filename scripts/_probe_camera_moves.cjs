#!/usr/bin/env node
// Escolher um movimento pelo nome escreve paradas de verdade? E o pad
// redesenhado desenha quadros em vez de pontos?
//
// Clica como um usuario: um movimento, depois "Edit the path", e le a camera
// gravada na chave do PROJETO (motion-scene-v1 e so a semente).
const fs = require('fs'), path = require('path'), puppeteer = require('puppeteer-core');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const U = process.argv[2] || 'http://localhost:3123';
const OUT = process.argv[3] || '.';
const MOVIMENTO = process.argv[4] || 'Survey';

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-gpu'], defaultViewport: { width: 1600, height: 1100 } });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log('  [error]', m.text().slice(0, 200)); });
  await p.goto(U + '/library', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await p.evaluate(() => {
    const s = {
      activeTemplateId: 'wall-01',
      tracks: [{ id: 't0', templateId: 'wall-01', values: { speed: 0.2 }, visible: true }],
      width: 810, height: 1080, fps: 30, duration: 8,
      background: { source: 'color', color: '#1a1a1a', gradient: false, color2: '#1a1a1a', imageUrl: null, blur: 0 },
      effects: [], sceneCamera: { _camOn: 1 },
    };
    localStorage.setItem('motion-welcome-seen', '1');
    localStorage.setItem('motion-tour-seen', '1');
    localStorage.setItem('motion-scene-v1', JSON.stringify(s));
    localStorage.setItem('motion-project-mv', JSON.stringify(s));
    localStorage.setItem('motion-projects-v1', JSON.stringify({ activeId: 'mv', projects: [{ id: 'mv', name: 'MV', createdAt: 1, updatedAt: 2, mode: '2d' }] }));
  });
  await p.goto(U + '/library', { waitUntil: 'networkidle2', timeout: 180000 });
  await p.evaluate(() => { document.querySelectorAll('[role=dialog], .modal-backdrop').forEach((el) => { el.style.display = 'none'; }); });
  await new Promise((r) => setTimeout(r, 2500));
  await p.evaluate(() => { const t = [...document.querySelectorAll('button,[role=tab],a')].find((e) => e.textContent.trim() === 'Adjust'); t && t.click(); });
  await new Promise((r) => setTimeout(r, 2000));

  const camera = () => p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('motion-project-mv') || '{}');
    const c = raw.sceneCamera || {};
    return {
      movimento: c._camMove, quantidade: c._camMoveAmount, direcao: c._camMoveDir,
      zoomInicial: c._camZoom, panInicial: [c._camPanX, c._camPanY],
      paradas: Object.keys(c).filter((k) => /^_camStop\d+$/.test(k)).length,
      zoomsDasParadas: Object.keys(c).filter((k) => /Zoom$/.test(k) && k.startsWith('_camStop')).map((k) => c[k]),
    };
  });

  console.log('antes de escolher:', JSON.stringify(await camera()));
  const clicou = await p.evaluate((nome) => {
    const sel = [...document.querySelectorAll('select.field')].find((e)=>[...e.options].some(o=>o.value===nome));
    if (sel) { const d=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value'); d.set.call(sel,nome); sel.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; }
    const b = [...document.querySelectorAll('.pill')].find((e) => e.textContent.trim() === nome);
    if (!b) return 'pill "' + nome + '" nao existe; ha: ' + [...document.querySelectorAll('.pill')].map((e) => e.textContent.trim()).join(', ');
    b.click(); return 'ok';
  }, MOVIMENTO);
  if (process.env.MS_DIR) {
    await new Promise((r) => setTimeout(r, 800));
    await p.evaluate((d) => {
      const rot = [...document.querySelectorAll('.ctl-label')].find((e) => e.textContent.trim() === 'Towards' || e.textContent.trim() === 'Direction');
      const b = [...(rot?.closest('.ctl-row')?.querySelectorAll('.pill') ?? [])].find((e) => e.textContent.trim() === d);
      b && b.click();
    }, process.env.MS_DIR);
  }
  console.log('clique em', MOVIMENTO + ':', clicou);
  await new Promise((r) => setTimeout(r, 1500));
  console.log('depois de escolher:', JSON.stringify(await camera()));

  // MS_STOPS: sobe o controle de paradas do movimento escolhido, que e o
  // ponto de "varias cameras numa parte so".
  // MS_STOPS: sobe o controle de paradas do movimento escolhido, que e o
  // ponto de "varias cameras numa parte so". O slider do app e uma trilha de
  // arrasto com tabindex, nao um input[type=range] — entao vai pelo teclado.
  if (process.env.MS_STOPS) {
    const achou = await p.evaluate(() => {
      const rot = [...document.querySelectorAll('.ctl-label')].find((e) => e.textContent.trim() === 'Stops');
      const tr = rot?.closest('.ctl-row')?.querySelector('.strack');
      if (!tr) return false;
      tr.scrollIntoView({ block: 'center' });
      tr.focus();
      return true;
    });
    console.log('trilha de Stops:', achou ? 'encontrada' : 'NAO ENCONTRADA');
    if (achou) {
      for (let i = 1; i < Number(process.env.MS_STOPS); i++) {
        await p.keyboard.press('ArrowRight');
        await new Promise((x) => setTimeout(x, 220));
      }
      await new Promise((x) => setTimeout(x, 1000));
      console.log('camera depois:', JSON.stringify(await camera()));
    }
  }
  // abre o pad e conta os QUADROS desenhados
  for (const el of await p.$$('.ctl-advanced-toggle')) {
    const t = await p.evaluate((e) => e.textContent, el);
    if (!t.includes('Edit the path')) continue;
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await new Promise((r) => setTimeout(r, 300));
    await el.click();
  }
  await new Promise((r) => setTimeout(r, 1200));
  // escolhe uma parada do meio, para ver o fantasma e a perna
  const chip = process.env.MS_CHIP || '3';
  const escolheu = await p.evaluate((c) => {
    const b = [...document.querySelectorAll('.cpg-pin')].find((e) => e.textContent.trim() === c);
    if (!b) return 'chip ' + c + ' nao existe';
    b.click(); return 'ok';
  }, chip);
  console.log('chip', chip + ':', escolheu);
  await new Promise((r) => setTimeout(r, 800));
  const pad = await p.evaluate(() => ({
    celulas: document.querySelectorAll('.cpg-cell').length,
    pinos: [...document.querySelectorAll('.cpg-pin')].map(e=>e.textContent.trim()),
    faixa: document.querySelector('.cpg-range')?.textContent.trim(),
    celulasComPino: [...document.querySelectorAll('.cpg-cell')].filter(c=>c.querySelector('.cpg-pin')).length,
    rotulos: [...document.querySelectorAll('.ctl-label')].map((e) => e.textContent.trim()).slice(-6),
    pills: [...document.querySelectorAll('.pill')].map(e=>e.textContent.trim()),
    bespoke: document.querySelectorAll('.cam-move, .campath-chip, .cam-disclose, .camframe').length,
    pontosVelhos: document.querySelectorAll('.campath-dot').length,

  }));
  console.log('pad:', JSON.stringify(pad));

  // Fotografa o ELEMENTO, nao um retangulo. O clip do puppeteer e espaco do
  // DOCUMENTO: com o painel dentro de um container que rola, o recorte cai
  // noutro lugar da pagina e a foto mente calada — foi o que aconteceu aqui,
  // com celulas de 35px medidas e celulas gigantes na imagem.
  fs.mkdirSync(OUT, { recursive: true });
  const arq = path.join(OUT, 'moves.png');
  const alvo = await p.evaluateHandle(() => {
    const cab = [...document.querySelectorAll('.section-head')]
      .find((el) => el.querySelector('.eyebrow')?.textContent.trim() === 'Camera');
    return cab?.parentElement ?? document.body;
  });
  await alvo.asElement().screenshot({ path: arq });
  console.log(arq);
  await b.close();
})();
