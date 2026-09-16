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
    assert.equal(Number(vals.sizeVary ?? 0), 0,
      `${t.meta.id}: um preset consolidado nao pode nascer com Size Variation ligada`);
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
  const escalas = (v) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(t.transform(0, i, n, { ...vals, sizeVary: v }, ctx).scale);
    return out;
  };
  const off = escalas(0), on = escalas(40);
  assert.ok(new Set(off.map((x) => x.toFixed(6))).size === 1, 'desligado, toda impressao tem o mesmo tamanho');
  assert.ok(new Set(on.map((x) => x.toFixed(6))).size > 3, 'ligado, a parede passa a ter tamanhos diferentes');
  assert.ok(Math.max(...on) <= Math.max(...off) + 1e-9, 'e nenhuma impressao cresce alem da propria celula');
  assert.ok(Math.min(...on) >= Math.max(...off) * 0.6 - 1e-9, 'nem encolhe mais do que o controle pede');
  // Deterministico: a mesma celula tem sempre o mesmo tamanho, senao o loop
  // mostraria o cartao mudando de tamanho ao dar a volta.
  assert.deepEqual(escalas(40), on, 'o mesmo cenario produz a mesma parede');
  casos += 5;
}

console.log(`Frames: ${cartoes} cartoes conferidos contra a linha de base em ${casos} casos; Size Variation no padrao nao move nada, e ligada varia o tamanho sem sair da celula.`);
