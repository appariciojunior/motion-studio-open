#!/usr/bin/env node
// A familia Frames nao muda.
//
// scripts/fixtures/frames-baseline.json e a saida do transform de Frames: 7
// presets x 3 cenas x 5 quadros, cada cartao com x, y, escala, rotacao, alfa e
// profundidade, 17075 deles. Esta suite exige igualdade exata.
//
// A razao de existir e uma licao cara. Lendo o clipe de referencia eu conclui
// duas vezes que a parede dele tinha cartoes de tamanhos diferentes, e duas
// vezes construi um controle no Frames para imitar isso -- primeiro encolhendo
// impressoes dentro da celula, depois pendurando paisagens sobre duas celulas.
// A parede da referencia e de UM tamanho so: a variedade e o que a camera faz
// com ela. Os dois controles saíram, e o que fica e esta linha de base, que
// prova que a familia voltou exatamente ao lugar onde estava.
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

console.log(`Frames: ${cartoes} cartoes conferidos contra a linha de base em ${casos} casos; a familia esta exatamente onde estava.`);
