#!/usr/bin/env node
// ============================================================
//  verify-thumb3d — a miniatura de um preset webgl tem de projetar como o palco
//
//  119 dos 271 presets do catalogo posam por `transform3d`, e a miniatura
//  chamava `transform` — o fallback 2D — para todos eles. 44% do catalogo
//  anunciava uma geometria que o palco nunca desenha. Isso nao e perda de
//  fidelidade: e a miniatura mostrando outro preset.
//
//  A correcao projeta a pose 3D real com `perspective` + `matrix3d` do CSS. Este
//  script prova que a projecao resultante e a MESMA que a do palco, sem GPU:
//
//    · lado do palco: replica renderer3d — camera em (0,0,P), lookAt na origem,
//      fov -> D = (h/2)/tan(fov/2), e a divisao perspectiva de three.
//    · lado da miniatura: aplica a matriz que lib/thumbPose3d emite e a divisao
//      que o CSS faz com `perspective`.
//
//  Onde as duas discordam, o numero aparece — em pixels do espaco de preview.
//
//  Uso: node scripts/verify-thumb3d.cjs
// ============================================================

const path = require('path');
const Module = require('module');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { catalogTemplateList, defaultsFor, easingFor, layerCountFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');
const { pose3dMatrix, thumbPerspective } = require('../lib/thumbPose3d');

// Mirrors TemplateThumb's own constants. Read from the source so the two cannot
// drift apart silently.
const fs = require('fs');
const thumbSrc = fs.readFileSync(path.join(root, 'components/TemplateThumb.tsx'), 'utf8');
const ctxMatch = thumbSrc.match(/const CTX_BASE = \{ fps: (\d+), width: (\d+), height: (\d+), duration: (\d+), totalFrames: (\d+) \}/);
if (!ctxMatch) { console.error('nao consegui ler CTX_BASE de TemplateThumb.tsx'); process.exit(2); }
const CTX_BASE = {
  fps: +ctxMatch[1], width: +ctxMatch[2], height: +ctxMatch[3],
  duration: +ctxMatch[4], totalFrames: +ctxMatch[5],
};
if (!/template\.transform3d\(/.test(thumbSrc)) {
  console.error('\nverify-thumb3d FALHOU: TemplateThumb nao chama transform3d — os presets webgl');
  console.error('voltariam a desenhar o fallback 2D.\n');
  process.exit(1);
}

const FRAMES = [0, 17, 40, 91, 150];
const TOL = 0.75; // px no espaco de preview

// ---------- lado do palco: a projecao que renderer3d faz ----------
// camera.position = (0,0,P), lookAt(0,0,0), fov, aspect = w/h.
// Um ponto no mundo three (X,Y,Z) cai na tela em:
//   x_px = X * D / (P - Z)      y_px_para_baixo = -Y * D / (P - Z)
// com D = (h/2)/tan(fov/2). Deriva direto da altura visivel a distancia d ser
// 2*d*tan(fov/2): em Z=0 e distance=1 isso da exatamente `height`, que e a
// convencao "1:1 preview pixels" que o proprio renderer3d documenta.
function stageProject(t, P, D) {
  const denom = P - t.z;
  if (denom <= 1e-6) return null; // atras do olho: o palco corta
  const mag = D / denom;
  return { x: t.x * mag, y: t.y * mag }; // t.y ja em convencao canvas (baixo +)
}

// ---------- lado da miniatura: matrix3d + perspective do CSS ----------
// A matriz vem do modulo de verdade. O CSS entao divide por (1 - z/P), tudo em
// px da miniatura; dividir por k devolve ao espaco de preview para comparar.
function thumbProject(t, P, k, gain) {
  const m = pose3dMatrix(t, k, gain);
  // Coluna de translacao de uma 4x4 column-major.
  const tx = m[12], ty = m[13], tz = m[14];
  const Pk = P * k;
  const denom = Pk - tz;
  if (denom <= 1e-6) return null;
  const mag = Pk / denom;
  return { x: (tx * mag) / k, y: (ty * mag) / k };
}

let assertions = 0;
const failures = [];
let webglSeen = 0, offAxis = 0;
let worst = { delta: 0, id: null, frame: null, card: null };

for (const template of catalogTemplateList) {
  if (template.meta.engine !== 'webgl' || typeof template.transform3d !== 'function') continue;
  webglSeen++;

  const v = defaultsFor(template.meta.id);
  const texAspect = template.meta.cardAspect === 'canvas'
    ? CTX_BASE.width / CTX_BASE.height
    : template.meta.cardAspect ?? 4 / 5;
  const ease = resolveEasing(easingFor(template.meta.id));
  const ctx = {
    ...CTX_BASE,
    ease,
    easedPhase: (p) => { const b = Math.floor(p); return b + ease(p - b); },
    cardAspect: texAspect,
  };
  const count = layerCountFor(template.meta.id, v,
    { width: CTX_BASE.width, height: CTX_BASE.height, cardAspect: texAspect });

  const { perspective: P, gain, exact } = thumbPerspective(template, v, ctx);
  if (!exact) { offAxis++; continue; } // camera fora do eixo: CSS nao expressa

  // D reconstruido da mesma forma que o palco, para o lado do palco da conta.
  let pose;
  try { pose = template.camera?.(v, ctx); } catch { pose = undefined; }
  const control = Math.max(0, Math.min(200, Number(v.perspective ?? 100)));
  const fov = pose?.fov ?? (15 + (95 - 15) * (control / 200));
  const D = (CTX_BASE.height / 2) / Math.tan((fov * Math.PI) / 360);

  const k = 0.3; // qualquer k serve: e uma escala uniforme, e a conta a desfaz

  for (const frame of FRAMES) {
    for (let i = 0; i < Math.min(count, 12); i++) {
      let t;
      try { t = template.transform3d(frame, i, count, v, ctx); }
      catch (e) { failures.push(`${template.meta.id}: transform3d lancou no frame ${frame}: ${e.message}`); continue; }
      if (!t) continue;

      const a = stageProject(t, P, D);
      const b = thumbProject(t, P, k, gain);
      assertions++;

      // Os dois lados tem de concordar em cortar ou desenhar.
      if ((a === null) !== (b === null)) {
        failures.push(`${template.meta.id}: palco e miniatura discordam sobre cortar o card ${i} no frame ${frame} (z=${t.z.toFixed(1)}, P=${P.toFixed(1)})`);
        continue;
      }
      if (a === null) continue;

      const delta = Math.hypot(a.x - b.x, a.y - b.y);
      if (!Number.isFinite(delta)) {
        failures.push(`${template.meta.id}: projecao nao finita no card ${i}, frame ${frame}`);
        continue;
      }
      if (delta > worst.delta) worst = { delta, id: template.meta.id, frame, card: i };
      if (delta > TOL) {
        failures.push(`${template.meta.id}: card ${i} no frame ${frame} cai ${delta.toFixed(2)}px longe de onde o palco o poe `
          + `(palco ${a.x.toFixed(1)},${a.y.toFixed(1)} vs miniatura ${b.x.toFixed(1)},${b.y.toFixed(1)})`);
      }
    }
  }
}

if (failures.length) {
  console.error(`\nverify-thumb3d FALHOU — ${failures.length} problema(s):\n`);
  for (const f of failures.slice(0, 25)) console.error('  · ' + f);
  if (failures.length > 25) console.error(`  ... e mais ${failures.length - 25}`);
  process.exit(1);
}
console.log(`Thumb 3D verification passed (${assertions} assertions across ${webglSeen} webgl presets; `
  + `pior divergencia ${worst.delta.toFixed(4)}px em ${worst.id ?? 'n/a'}`
  + `${offAxis ? `; ${offAxis} preset(s) com camera fora do eixo ignorados` : ''}).`);
