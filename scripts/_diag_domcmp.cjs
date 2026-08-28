const path = require('path'); const Module = require('module'); const fs = require('fs');
require('sucrase/register');
const root = path.resolve(__dirname, '..');
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, p, i, o) { if (r.startsWith('@/')) r = path.join(root, r.slice(2)); return orig.call(this, r, p, i, o); };
const { templateList, defaultsFor, easingFor, layerCountFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');
const CTX = { fps: 30, width: 810, height: 1080, duration: 8, totalFrames: 240 };
const TEX_LONG = 600, SPRITE_BASE = 340, BUDGET = 28, FRAME = 40;
const dom = JSON.parse(fs.readFileSync('.shots/thumb-dom.json', 'utf8'));

console.log('preset          cartoes  | maior diferenca DOM vs pose previsto');
console.log('                         |   matriz      caixa (px de preview)');
for (const row of dom) {
  const tpl = templateList.find((t) => t.meta.name === row.name);
  if (!tpl) { console.log('  ' + row.name + ': ausente do catalogo'); continue; }
  const v = defaultsFor(tpl.meta.id);
  const ta = tpl.meta.cardAspect === 'canvas' ? CTX.width / CTX.height : tpl.meta.cardAspect ?? 4 / 5;
  const texW = TEX_LONG * Math.min(1, ta), texH = TEX_LONG * Math.min(1, 1 / ta), norm = SPRITE_BASE / TEX_LONG;
  const count = layerCountFor(tpl.meta.id, v, { width: CTX.width, height: CTX.height, cardAspect: ta });
  const ease = resolveEasing(easingFor(tpl.meta.id));
  const ctx = { ...CTX, ease, easedPhase: (p) => { const b = Math.floor(p); return b + ease(p - b); }, cardAspect: ta };
  const all = [];
  for (let i = 0; i < count; i++) {
    const t = tpl.transform(FRAME, i, count, v, ctx);
    const w = texW * norm * t.scale, h = texH * norm * t.scale;
    const sx = t.scaleX ?? 1, sy = t.scaleY ?? 1;
    const rs = t.rotation + (t.skewY ?? 0), rk = t.rotation - (t.skewX ?? 0);
    const a = Math.cos(rs) * sx, b = Math.sin(rs) * sx, c = -Math.sin(rk) * sy, d = Math.cos(rk) * sy;
    all.push({ i, x: t.x, y: t.y, w, h, a, b, c, d, alpha: t.alpha,
      ex: (Math.abs(a) * w + Math.abs(c) * h) / 2, ey: (Math.abs(b) * w + Math.abs(d) * h) / 2 });
  }
  // same draw budget the component applies
  let keep = all;
  if (all.length > BUDGET) {
    const halfW = CTX.width / 2, halfH = CTX.height / 2;
    keep = all.map((p) => ({ p, invisible: p.alpha < 0.02 ? 1 : 0,
        off: (Math.abs(p.x) - p.ex > halfW || Math.abs(p.y) - p.ey > halfH) ? 1 : 0, dd: Math.hypot(p.x, p.y) }))
      .sort((a, b) => a.invisible - b.invisible || a.off - b.off || a.dd - b.dd)
      .slice(0, BUDGET).sort((a, b) => a.p.i - b.p.i).map((e) => e.p);
  }
  if (keep.length !== row.cards.length) { console.log('  ' + row.name.padEnd(14), 'CONTAGEM DIVERGE: DOM', row.cards.length, 'previsto', keep.length); continue; }
  let mM = 0, mB = 0;
  for (let j = 0; j < keep.length; j++) {
    const p = keep[j], q = row.cards[j];
    mM = Math.max(mM, Math.abs(p.a - q.a), Math.abs(p.b - q.b), Math.abs(p.c - q.c), Math.abs(p.d - q.d));
    mB = Math.max(mB, Math.abs(p.w - q.w), Math.abs(p.h - q.h));
  }
  console.log('  ' + row.name.padEnd(14), String(keep.length).padStart(4), '   |', mM.toExponential(2).padStart(10), mB.toFixed(2).padStart(12), 'px');
}
