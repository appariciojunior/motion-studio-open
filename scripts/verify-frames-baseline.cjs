#!/usr/bin/env node
// A familia Frames nao muda por causa de um controle novo.
//
// scripts/fixtures/frames-baseline.json e a saida do transform de Frames como
// ela era ANTES de Size Variation existir: 7 presets x 3 cenas x 5 quadros,
// cada cartao com x, y, escala, rotacao, alfa e profundidade. Enquanto o
// controle estiver no padrao, esta suite exige igualdade exata.
//
// A razao de existir: "adicionei um controle, nada mais mudou" e afirmacao que
// se prova, nao que se promete — e um preset consolidado que anda um pixel e
// invisivel para qualquer teste que so olhe o controle novo.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert');
require('sucrase/register');
const M = require('module'); const _r = M._resolveFilename;
M._resolveFilename = function (q, ...a) { return _r.call(this, q.startsWith('@/') ? path.join(__dirname, '..', q.slice(2)) : q, ...a); };
const { templateList, layerCountFor, defaultsFor } = require('../templates/index.ts');

const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'frames-baseline.json'), 'utf8'));
const paredes = templateList.filter((t) => t.meta.group === 'Frames');
const CENAS = [
  { width: 810, height: 1080, cardAspect: 0.75 },
  { width: 1080, height: 1080, cardAspect: 1 },
  { width: 1920, height: 1080, cardAspect: 16 / 9 },
];
const QUADROS = [0, 37, 96, 155, 239];

let cartoes = 0, casos = 0;
for (const t of paredes) {
  for (const cena of CENAS) {
    const vals = { ...defaultsFor(t.meta.id) };
    assert.equal(Number(vals.mixSizes ?? 0), 0,
      `${t.meta.id}: um preset consolidado nao pode nascer com Mixed Sizes ligada`);
    const n = layerCountFor(t.meta.id, vals, cena);
    const ctx = { fps: 30, ...cena, duration: 8, totalFrames: 240, ease: (x) => x, easedPhase: (p) => p };
    for (const f of QUADROS) {
      const chave = `${t.meta.id}|${cena.width}x${cena.height}|f${f}`;
      const esperado = base[chave];
      assert.ok(esperado, `sem linha de base para ${chave} — a fixture ficou para tras do catalogo`);
      assert.equal(n, esperado.n, `${chave}: a parede mudou de tamanho`);
      for (let i = 0; i < n; i++) {
        const r = t.transform(f, i, n, vals, ctx);
        const lido = [+r.x.toFixed(4), +r.y.toFixed(4), +r.scale.toFixed(6),
          +(r.rotation || 0).toFixed(6), +(r.alpha ?? 1).toFixed(4), +(r.depth ?? 0).toFixed(4)];
        assert.deepEqual(lido, esperado.linhas[i], `${chave}: o cartao ${i} nao esta mais onde estava`);
        cartoes++;
      }
      casos++;
    }
  }
}

// E o controle precisa FAZER algo quando ligado, senao a igualdade acima e
// verdadeira pelo motivo errado.
{
  const t = paredes[0];
  const cena = CENAS[0];
  const ctx = { fps: 30, ...cena, duration: 8, totalFrames: 240, ease: (x) => x, easedPhase: (p) => p };
  const vals = { ...defaultsFor(t.meta.id) };
  const n = layerCountFor(t.meta.id, vals, cena);
  const poses = (v) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(t.transform(0, i, n, { ...vals, mixSizes: v }, ctx));
    return out;
  };
  const off = poses(0), on = poses(70);
  assert.ok(off.every((p) => (p.alpha ?? 1) === 1 && !p.clip), 'desligado, toda impressao e um retrato inteiro');
  const espalhados = on.filter((p) => p.clip);
  const engolidos = on.filter((p) => (p.alpha ?? 1) === 0);
  assert.ok(espalhados.length > 0, 'ligado, a parede ganha paisagens');
  assert.equal(espalhados.length, engolidos.length,
    'cada paisagem ocupa exatamente uma celula vizinha — nem sobra nem falta');
  // A paisagem e um RECORTE, nunca um esticao: a escala e a mesma nos dois eixos
  // e o que muda e a janela.
  assert.ok(espalhados.every((p) => p.scaleX === undefined && p.scaleY === undefined),
    'uma paisagem se faz recortando, nao esticando');
  assert.ok(espalhados.every((p) => p.clip.x0 === 0 && p.clip.x1 === 1 && p.clip.y0 > 0 && p.clip.y1 < 1),
    'e o recorte e uma faixa horizontal da propria impressao');
  // Deterministico, senao o cartao mudaria de forma ao dar a volta no loop.
  assert.deepEqual(poses(70).map((p) => [p.x, p.scale, p.alpha]), on.map((p) => [p.x, p.scale, p.alpha]),
    'o mesmo cenario produz a mesma parede');
  casos += 7;
}

console.log(`Frames: ${cartoes} cartoes conferidos contra a linha de base em ${casos} casos; Mixed Sizes no padrao nao move nada, e ligada troca retratos por paisagens sem abrir vao.`);
