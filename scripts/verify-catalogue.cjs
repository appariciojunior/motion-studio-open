#!/usr/bin/env node
// ============================================================
//  verify-catalogue — invariants that must hold for EVERY template,
//  in every canvas aspect and every card shape
//
//  scripts/verify-tilt.cjs proves geometry is well-formed: coplanar, finite,
//  seam-closed. It runs each template once, in one 3:4 canvas, at the declared
//  card shape. That left a whole class of defect unmeasured, because the scene
//  has two dimensions the template does not control:
//
//    · the canvas aspect (6 of them), which decides which edge is the long one
//    · the card shape (7, counting 'auto'), which OVERRIDES a template's own
//      declared cardAspect — see lib/crop cardAspectFor
//
//  Real bugs this sweep caught, none of which verify-tilt could see:
//    · Bloom and Takeover scaled by canvas HEIGHT, so they only covered a
//      portrait canvas — 16:9 left a 472px band of bare background
//    · Frames and Grid computed lattice pitch from the DECLARED 3:4 card, so at
//      the 4:5 card shape a nominal 60px gutter came out 60 down and 25 across
//
//  Usage: node scripts/verify-catalogue.cjs
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

const { templateList, catalogTemplateList, templateGroups, defaultsFor, easingFor, layerCountFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');
const { ASPECTS, dimsFor } = require('../store/useSceneStore');
const { CARD_SHAPES, cardAspectFor } = require('../lib/crop');

// Matches the renderer: a sprite's LONG edge is normalized to this, so the other
// dimension follows the card's resolved aspect (lib/renderer SPRITE_BASE).
const SPRITE_BASE = 340;
const FPS = 30;
const DURATION = 8;
const TOTAL = DURATION * FPS;
const SHAPES = ['auto', ...Object.keys(CARD_SHAPES)];
// Frame 0 and TOTAL are loop boundaries and get treated specially below.
const FRAMES = [0, 48, 96, 144, 192, TOTAL];

let assertions = 0;
const failures = [];
function check(ok, subject, message, where) {
  assertions++;
  if (ok) return;
  const entry = failures.find((f) => f.subject === subject && f.message === message);
  if (entry) { if (entry.where.length < 3) entry.where.push(where); return; }
  failures.push({ subject, message, where: [where] });
}

// ---------- catalogue integrity ----------
{
  const ids = templateList.map((t) => t.meta.id);
  check(new Set(ids).size === ids.length, 'catalogue', 'duplicate template id', 'registry');
  const grouped = templateGroups.flatMap((g) => g.items);
  check(grouped.length === catalogTemplateList.length, 'catalogue', 'grouping dropped or duplicated a template', 'registry');
  for (const t of templateList) {
    check(typeof t.meta.name === 'string' && t.meta.name.length > 0, t.meta.id, 'missing name', 'registry');
    check(typeof t.transform === 'function', t.meta.id, 'missing transform', 'registry');
  }
}

// ---------- the sweep ----------
let combos = 0;
for (const template of templateList) {
  const values = defaultsFor(template.meta.id);
  const ease = resolveEasing(easingFor(template.meta.id));
  const easedPhase = (p) => Math.floor(p) + ease(p - Math.floor(p));

  for (const aspectKey of Object.keys(ASPECTS)) {
    const { width, height } = dimsFor(aspectKey);

    for (const shape of SHAPES) {
      combos++;
      const cardAspect = cardAspectFor(template.meta, width, height, shape === 'auto' ? undefined : shape);
      const ctx = { fps: FPS, width, height, duration: DURATION, totalFrames: TOTAL, ease, easedPhase, cardAspect };
      // Asked of the template and derived INSIDE the canvas loop: a lattice
      // family's cell total is a function of the frame, so a per-template count
      // hoisted out of here would test a wall the renderer never builds. Capped
      // because a few families run to 140 cards and the sweep is already 42
      // canvases per template.
      const count = Math.min(60, layerCountFor(template.meta.id, values, { width, height, cardAspect }));
      const where = `${aspectKey}/${shape}`;
      const name = template.meta.name;

      let everVisible = false;
      let everCovers = false;

      for (const frame of FRAMES) {
        for (let i = 0; i < count; i++) {
          let pose;
          try {
            pose = template.transform(frame, i, count, values, ctx);
          } catch (error) {
            check(false, name, `transform threw: ${error.message.slice(0, 50)}`, where);
            continue;
          }

          check(
            [pose.x, pose.y, pose.scale, pose.alpha, pose.rotation, pose.depth].every(Number.isFinite),
            name, 'non-finite pose', where,
          );
          // A negative scale mirrors the sprite, which no template intends.
          check(pose.scale >= 0, name, 'negative scale mirrors the sprite', where);
          // Scale exactly 0 is legitimate at a loop boundary — that is what a
          // build-in/out envelope does (Dock 06) and where a recede finishes
          // (Bloom 02). Mid-clip, a visible card with no size is a bug.
          const atBoundary = frame === 0 || frame === TOTAL;
          check(!(pose.scale === 0 && pose.alpha > 0.02 && !atBoundary),
            name, 'scale 0 mid-clip while still visible', where);

          const long = SPRITE_BASE * pose.scale;
          const cardW = cardAspect < 1 ? long * cardAspect : long;
          const cardH = cardAspect < 1 ? long : long / cardAspect;
          check(long <= Math.max(width, height) * 8, name, 'card is more than 8x the canvas', where);

          if (pose.alpha > 0.02
            && Math.abs(pose.x) - cardW / 2 < width / 2
            && Math.abs(pose.y) - cardH / 2 < height / 2) everVisible = true;
          if (pose.alpha > 0.99 && cardW >= width - 1 && cardH >= height - 1) everCovers = true;
        }
      }

      check(everVisible, name, 'nothing is ever visible on the canvas', where);

      // A full-bleed template owes coverage only when its own size control asks
      // for the whole frame. Several reference presets deliberately sit at
      // 63-73% of it, with background showing around the card.
      const wantsWholeFrame = (values.frameSize ?? values.planeSize ?? 100) >= 100;
      if (template.meta.cardAspect === 'canvas' && wantsWholeFrame) {
        check(everCovers, name, 'full-bleed template leaves a gap', where);
      }
    }
  }
}

// ---------- lattice gutters ----------
// A family that lays out a grid derives its pitch from the card's size. If it
// uses the DECLARED aspect instead of the resolved one, the two gutters come out
// unequal the moment the scene's card shape differs from the declaration.
for (const template of templateList.filter((t) => ['Frames', 'Grid'].includes(t.meta.group))) {
  const values = defaultsFor(template.meta.id);
  const ease = resolveEasing(easingFor(template.meta.id));
  const easedPhase = (p) => Math.floor(p) + ease(p - Math.floor(p));

  for (const [shapeName, cardAspect] of [['auto', 3 / 4], ...Object.entries(CARD_SHAPES)]) {
    const ctx = { fps: FPS, width: 1080, height: 810, duration: DURATION, totalFrames: TOTAL, ease, easedPhase, cardAspect };
    const count = layerCountFor(template.meta.id, values, { width: 1080, height: 810, cardAspect });
    const long = values.cardSize;
    const cardW = cardAspect < 1 ? long * cardAspect : long;
    const cardH = cardAspect < 1 ? long : long / cardAspect;

    const poses = [];
    for (let i = 0; i < count; i++) poses.push(template.transform(0, i, count, values, ctx));

    // Across: nearest neighbour that shares a row. Down: smallest positive dy
    // over all pairs — brick rows never share an x, so a same-column search
    // would jump two rows and read double the real pitch.
    let pitchAcross = Infinity;
    for (const a of poses) for (const b of poses) {
      if (a === b || Math.abs(a.y - b.y) > 0.5) continue;
      const d = Math.abs(a.x - b.x);
      if (d > 0.5 && d < pitchAcross) pitchAcross = d;
    }
    let pitchDown = Infinity;
    for (const a of poses) for (const b of poses) {
      const d = Math.abs(a.y - b.y);
      if (d > 0.5 && d < pitchDown) pitchDown = d;
    }
    if (!Number.isFinite(pitchAcross) || !Number.isFinite(pitchDown)) continue;

    const gutterAcross = pitchAcross - cardW;
    const gutterDown = pitchDown - cardH;
    check(Math.abs(gutterAcross - gutterDown) < 1,
      template.meta.name,
      `gutters unequal: ${gutterAcross.toFixed(0)}px across vs ${gutterDown.toFixed(0)}px down`,
      `card shape ${shapeName}`);
  }
}

// ---------- lattice coverage across the CONTROL RANGES ----------
// Everything above runs each template at its preset defaults, which is what let
// a real defect ship: Grid's wall wraps as a torus over one lattice period and
// only covers the frame while that period is at least as big as the frame. At
// the defaults it was; dragging Plane Size down to 60 made the lattice span
// 630x720 inside an 810x1080 canvas and left a 360px band of dead background.
// A user reaches that state with one slider, so the sweep has to go there too.
for (const template of templateList.filter((t) => ['Frames', 'Grid'].includes(t.meta.group))) {
  const base = defaultsFor(template.meta.id);
  const ease = resolveEasing(easingFor(template.meta.id));
  const easedPhase = (p) => Math.floor(p) + ease(p - Math.floor(p));
  const ctrl = (key) => template.controls.find((c) => c.key === key);
  const spread = (key) => {
    const c = ctrl(key);
    if (!c) return [base[key]];
    return [...new Set([c.min, Math.round((c.min + c.max) / 2), c.max, base[key]])];
  };

  for (const aspectKey of ['3:4', '16:9']) {
    const { width, height } = dimsFor(aspectKey);
    const ctx = { fps: FPS, width, height, duration: DURATION, totalFrames: TOTAL, ease, easedPhase, cardAspect: 3 / 4 };

    for (const cardSize of spread('cardSize')) {
      for (const gap of spread('gap')) {
        {
          // No count in this sweep any more: these families derive their cell
          // total from Plane Size, Gap and the canvas, so the pair above IS the
          // whole input space. Feeding an arbitrary count would test a wall the
          // renderer cannot produce.
          const values = { ...base, cardSize, gap };
          const count = layerCountFor(template.meta.id, values, { width, height, cardAspect: 3 / 4 });
          const poses = [];
          for (let i = 0; i < count; i++) poses.push(template.transform(0, i, count, values, ctx));

          // Derive the pitch from the OUTPUT rather than restating the formula,
          // so this measures the behaviour and not the intent.
          const pitchOf = (axis, other) => {
            let best = Infinity;
            for (const a of poses) for (const b of poses) {
              if (a === b || Math.abs(a[other] - b[other]) > 0.5) continue;
              const d = Math.abs(a[axis] - b[axis]);
              if (d > 0.5 && d < best) best = d;
            }
            return best;
          };
          const px = pitchOf('x', 'y');
          const py = (() => { let b = Infinity; for (const a of poses) for (const c of poses) { const d = Math.abs(a.y - c.y); if (d > 0.5 && d < b) b = d; } return b; })();
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;

          const spanX = (Math.max(...poses.map((p) => p.x)) - Math.min(...poses.map((p) => p.x))) + px;
          const spanY = (Math.max(...poses.map((p) => p.y)) - Math.min(...poses.map((p) => p.y))) + py;
          const where = `${aspectKey} cardSize ${cardSize} gap ${gap} (${count} cells)`;
          check(spanX >= width - 1, template.meta.name,
            `lattice spans only ${spanX.toFixed(0)}px across a ${width}px canvas — dead background at the sides`, where);
          check(spanY >= height - 1, template.meta.name,
            `lattice spans only ${spanY.toFixed(0)}px down a ${height}px canvas — dead background top and bottom`, where);
        }
      }
    }
  }
}

// No two templates may share a display name.
//
// Not a tidiness rule — things key off the name. verify-reference fits presets
// against measured geometry BY NAME, so a second "Bloom 01" silently stole the
// fixtures belonging to the first and the suite failed with ten wrong-width
// errors pointing at a template that had not been touched. A duplicate is also
// simply unusable in the picker, where the group is the only thing telling two
// identically named entries apart.
{
  const byName = new Map();
  for (const template of templateList) {
    const list = byName.get(template.meta.name) || [];
    list.push(template.meta.id);
    byName.set(template.meta.name, list);
  }
  for (const [name, ids] of byName) {
    check(ids.length === 1, name, `duplicate template name, shared by ${ids.join(' and ')}`, 'catalogue');
  }
}

// ---------- the exported scene pack knows about every template ----------
// lib/exportSources.ts is a GENERATED snapshot of the template sources the
// export ZIP ships. Nothing errors when it falls behind: `fileForId` resolves an
// unknown id by family prefix, so a template missing from the snapshot silently
// exports a DIFFERENT template's code. That is how five files (flip, lattice,
// spinner, stickers, wipeReveal) came to be absent from it for weeks while the
// editor showed them fine. These two checks are structural, so they cost nothing
// and cannot pass while an id has nowhere real to resolve to.
//
// They do NOT prove the snapshot is up to DATE — only that nothing is missing.
// A freshness check means comparing the snapshot against the files on disk,
// which needs the generator's own transforms (trimTypes, the @/ rewrite), so it
// would have to export them first rather than run top to bottom.
{
  const fs = require('fs');
  const { SCENE_SOURCES, TEMPLATE_MANIFEST } = require('../lib/exportSources');
  const files = fs.readdirSync(path.join(root, 'templates'))
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts');
  for (const f of files) {
    check(Object.prototype.hasOwnProperty.call(SCENE_SOURCES, f), f,
      'template file is missing from lib/exportSources.ts — run node scripts/genExportSources.mjs',
      'export snapshot');
  }
  const manifestIds = new Set(Object.values(TEMPLATE_MANIFEST).flatMap((m) => m.ids));
  for (const t of templateList) {
    check(manifestIds.has(t.meta.id), t.meta.id,
      'template id is absent from TEMPLATE_MANIFEST, so the export would resolve it to another file'
      + ' — run node scripts/genExportSources.mjs',
      'export snapshot');
  }
}

// ---------- report ----------
if (failures.length) {
  console.error(`\nCatalogue verification FAILED — ${failures.length} distinct problem(s):\n`);
  for (const f of failures) {
    console.error(`  ${f.subject}: ${f.message}`);
    console.error(`      at ${f.where.join(', ')}${f.where.length >= 3 ? ' ...' : ''}`);
  }
  process.exit(1);
}

console.log(
  `Catalogue verification passed (${assertions} assertions across ${templateList.length} templates`
  + ` x ${Object.keys(ASPECTS).length} canvas aspects x ${SHAPES.length} card shapes = ${combos} combinations).`,
);
