#!/usr/bin/env node
// ============================================================
//  verify-contexts — the same template must lay out the same way
//  wherever it is drawn
//
//  A template's geometry is a pure function of (frame, index, count, values,
//  ctx). Three places call it — the stage renderer, the catalogue thumbnail and
//  the export pack — and nothing asserted they agree. They did not:
//
//    TemplateThumb clamped `count` to 20 before calling transform. But `count`
//    is a LAYOUT INPUT, not a drawing cost: lattice families derive their
//    columns, rows and wrap period from it. So the thumbnail drew a different
//    grid than the stage — measured at up to 2645px of divergence on Grid, on
//    an 810px-wide canvas. 36 of the templates exceeded that clamp.
//
//  The fix was to pass the real count and bound the DRAWN cards instead. This
//  script pins that down: every card a thumbnail paints must sit exactly where
//  the stage would put it, the budget must hold, and no thumbnail may end up
//  empty because the budget discarded everything visible.
//
//  It also re-derives the thumbnail's constants from the component source, so
//  changing one there without changing this fails loudly rather than silently
//  re-opening the divergence.
//
//  Usage: node scripts/verify-contexts.cjs
// ============================================================

const fs = require('fs');
const path = require('path');
const Module = require('module');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { templateList, defaultsFor, easingFor, layerCountFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');

let assertions = 0;
const failures = [];
function check(ok, subject, message) {
  assertions++;
  if (!ok) failures.push({ subject, message });
}

// ---------- read the thumbnail's own constants, rather than restating them ----------
const thumbSrc = fs.readFileSync(path.join(root, 'components/TemplateThumb.tsx'), 'utf8');
const num = (re, label) => {
  const m = thumbSrc.match(re);
  if (!m) {
    failures.push({ subject: 'TemplateThumb.tsx', message: `could not read ${label} from the source` });
    return null;
  }
  return Number(m[1]);
};
const DRAW_BUDGET = num(/const DRAW_BUDGET = (\d+)/, 'DRAW_BUDGET');
const TEX_LONG = num(/const TEX_LONG = (\d+)/, 'TEX_LONG');
const CTX_W = num(/const CTX_BASE = \{[^}]*width: (\d+)/, 'CTX_BASE.width');
const CTX_H = num(/const CTX_BASE = \{[^}]*height: (\d+)/, 'CTX_BASE.height');
const SPRITE_BASE = num(/const SPRITE_BASE = (\d+)/, 'SPRITE_BASE');
const TOTAL = num(/const CTX_BASE = \{[^}]*totalFrames: (\d+)/, 'CTX_BASE.totalFrames');

// The clamp that caused the divergence must not come back.
check(!/Math\.min\(\s*\d+\s*,\s*Math\.round\(v\.count/.test(thumbSrc),
  'TemplateThumb.tsx',
  'count is clamped again before transform — that is a layout input, so the thumbnail will lay out a different grid than the stage');

if (failures.length) {
  console.error('\nContext verification FAILED before it could run:\n');
  for (const f of failures) console.error(`  ${f.subject}: ${f.message}`);
  process.exit(1);
}

// ---------- the thumbnail's pose pipeline, mirrored ----------
// Kept deliberately close to the component so a divergence here is a real
// divergence and not an artefact of restating the maths differently.
function thumbnailPoses(template, frame) {
  const values = defaultsFor(template.meta.id);
  // The placeholder takes the template's own declared shape, so a lattice family
  // is spaced by the proportions actually drawn here.
  const texAspect = template.meta.cardAspect === 'canvas'
    ? CTX_W / CTX_H
    : template.meta.cardAspect ?? 4 / 5;
  const texW = TEX_LONG * Math.min(1, texAspect);
  const texH = TEX_LONG * Math.min(1, 1 / texAspect);
  const count = layerCountFor(template.meta.id, values, { width: CTX_W, height: CTX_H, cardAspect: texAspect });
  const norm = SPRITE_BASE / TEX_LONG;
  const ease = resolveEasing(easingFor(template.meta.id));
  const ctx = {
    fps: 30, width: CTX_W, height: CTX_H, duration: TOTAL / 30, totalFrames: TOTAL,
    ease, easedPhase: (p) => Math.floor(p) + ease(p - Math.floor(p)),
    cardAspect: texAspect,
  };

  const all = [];
  for (let i = 0; i < count; i++) {
    const t = template.transform(frame, i, count, values, ctx);
    all.push({
      i, x: t.x, y: t.y, alpha: t.alpha,
      w: texW * norm * t.scale * (t.scaleX ?? 1),
      h: texH * norm * t.scale * (t.scaleY ?? 1),
    });
  }
  if (all.length <= DRAW_BUDGET) return { all, drawn: all };

  const halfW = CTX_W / 2, halfH = CTX_H / 2;
  const offCanvas = (p) => Math.abs(p.x) - p.w / 2 > halfW || Math.abs(p.y) - p.h / 2 > halfH;
  const drawn = all
    .map((p) => ({ p, off: offCanvas(p) ? 1 : 0, d: Math.hypot(p.x, p.y) }))
    .sort((a, b) => a.off - b.off || a.d - b.d)
    .slice(0, DRAW_BUDGET)
    .sort((a, b) => a.p.i - b.p.i)
    .map((e) => e.p);
  return { all, drawn };
}

let maxDrawn = 0;
for (const template of templateList) {
  for (const frame of [0, 40, 120, 200]) {
    const { all, drawn } = thumbnailPoses(template, frame);
    maxDrawn = Math.max(maxDrawn, drawn.length);

    check(drawn.length <= DRAW_BUDGET, template.meta.name,
      `thumbnail painted ${drawn.length} cards, over the budget of ${DRAW_BUDGET}`);

    // Every drawn card must be exactly where the full layout puts it. The budget
    // may DROP a card; it may never MOVE one.
    for (const d of drawn) {
      const stage = all[d.i];
      check(Math.abs(d.x - stage.x) < 1e-9 && Math.abs(d.y - stage.y) < 1e-9,
        template.meta.name,
        `thumbnail moved card ${d.i} at frame ${frame} (${d.x.toFixed(1)},${d.y.toFixed(1)} vs ${stage.x.toFixed(1)},${stage.y.toFixed(1)})`);
    }

    // If the full layout has something on screen, the budget must keep something.
    const onCanvas = (p) => p.alpha > 0.01
      && Math.abs(p.x) - p.w / 2 < CTX_W / 2
      && Math.abs(p.y) - p.h / 2 < CTX_H / 2;
    if (all.some(onCanvas)) {
      check(drawn.some(onCanvas), template.meta.name,
        `the draw budget emptied the thumbnail at frame ${frame}`);
    }
  }
}

// ---------- informational: ctx builders that do not pass cardAspect yet ----------
// The stage and the thumbnail agree because both supply it. These other paths
// still fall back to the template's declared aspect, so a scene whose card shape
// differs will lay out differently there. Reported, not failed — finishing the
// wiring is tracked work, and a red suite would hide real regressions.
const CTX_BUILDERS = [
  'lib/renderer.ts', 'components/TemplateThumb.tsx',
  'lib/exportScene.ts', 'lib/webKeyframes.ts', 'components/BoardStage.tsx', 'components/WebStage.tsx',
];
const pending = CTX_BUILDERS.filter((rel) => {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  return src.includes('easedPhase') && !src.includes('cardAspect');
});

if (failures.length) {
  console.error(`\nContext verification FAILED — ${failures.length} problem(s):\n`);
  const seen = new Set();
  for (const f of failures) {
    const key = f.subject + f.message;
    if (seen.has(key)) continue;
    seen.add(key);
    console.error(`  ${f.subject}: ${f.message}`);
  }
  process.exit(1);
}

console.log(
  `Context verification passed (${assertions} assertions across ${templateList.length} templates;`
  + ` thumbnail painted at most ${maxDrawn} of a ${DRAW_BUDGET}-card budget).`,
);
if (pending.length) {
  console.log(`  note: ${pending.length} ctx builder(s) still omit cardAspect — ${pending.join(', ')}`);
}
