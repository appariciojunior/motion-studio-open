#!/usr/bin/env node
// Linha de base de equivalencia para a familia Frames: a saida do codigo de
// HOJE, gravada antes de mexer nele. Depois da mudanca, o mesmo dump tem de
// bater exatamente enquanto o controle novo estiver no padrao.
const fs=require('fs'), path=require('path');
require('sucrase/register');
const M=require('module'); const _r=M._resolveFilename;
M._resolveFilename=function(q,...a){ return _r.call(this, q.startsWith('@/')?path.join(__dirname,'..',q.slice(2)):q, ...a); };
const { templateList, layerCountFor, defaultsFor } = require('../templates/index.ts');

const paredes = templateList.filter((t) => t.meta.group === 'Frames');
const CENAS = [
  { width: 810, height: 1080, cardAspect: 0.75 },
  { width: 1080, height: 1080, cardAspect: 1 },
  { width: 1920, height: 1080, cardAspect: 16 / 9 },
];
const QUADROS = [0, 37, 96, 155, 239];
const saida = {};
for (const t of paredes) {
  for (const cena of CENAS) {
    const vals = { ...defaultsFor(t.meta.id) };
    const n = layerCountFor(t.meta.id, vals, cena);
    const ctx = { fps: 30, ...cena, duration: 8, totalFrames: 240,
      ease: (x) => x, easedPhase: (p) => p };
    for (const f of QUADROS) {
      const linhas = [];
      for (let i = 0; i < n; i++) {
        const r = t.transform(f, i, n, vals, ctx);
        linhas.push([+r.x.toFixed(4), +r.y.toFixed(4), +r.scale.toFixed(6),
          +(r.rotation || 0).toFixed(6), +(r.alpha ?? 1).toFixed(4), +(r.depth ?? 0).toFixed(4)]);
      }
      saida[`${t.meta.id}|${cena.width}x${cena.height}|f${f}`] = { n, linhas };
    }
  }
}
const arq = path.join(__dirname, 'fixtures', 'frames-baseline.json');
fs.writeFileSync(arq, JSON.stringify(saida));
const total = Object.values(saida).reduce((a, v) => a + v.linhas.length, 0);
console.log(`${paredes.length} presets de Frames x ${CENAS.length} cenas x ${QUADROS.length} quadros`);
console.log(`${Object.keys(saida).length} casos, ${total} cartoes gravados em ${path.relative(process.cwd(), arq)}`);
