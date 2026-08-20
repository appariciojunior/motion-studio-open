// Confronts templates/flip.ts against the numbers measured off app.arqe.ai's
// own canvas on 2026-08-19 (see the header of templates/flip.ts). Run offline:
// the Browser pane starves rAF on this app, so a screenshot proves nothing.
const path = require('path');
const Module = require('module');
require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { getTemplate, defaultsFor } = require('../templates');
const { resolveEasing } = require('../lib/easing');

let checks = 0, failed = 0;
function near(got, want, tol, label) {
  checks++;
  const ok = Math.abs(got - want) <= tol;
  if (!ok) { failed++; console.log(`  FAIL ${label}: got ${got.toFixed(2)}, want ${want.toFixed(2)} (+-${tol})`); }
  return ok;
}
function ok(cond, label) {
  checks++;
  if (!cond) { failed++; console.log(`  FAIL ${label}`); }
}

// arqé runs 30fps / 12s. Feed the template the reference's own px so the poses
// come out directly comparable to what was measured on its 1080x1440 stage.
const FPS = 30, DUR = 12, TOTAL = FPS * DUR;
const ease = resolveEasing({ id: 'ease' });
const ctx = {
  fps: FPS, width: 1080, height: 1440, duration: DUR, totalFrames: TOTAL,
  ease,
  easedPhase: (p) => { const b = Math.floor(p); return b + ease(p - b); },
  cardAspect: 3 / 4,
};

const tpl = getTemplate('flip-01');
const v = { ...defaultsFor('flip-01'), cardSize: 450, gap: 24, visible: 3, count: 6, stepTime: 2 };
const N = 6;

const poseAt = (frame) => {
  const out = [];
  for (let i = 0; i < N; i++) {
    const p = tpl.transform(frame, i, N, v, ctx);
    if (p.alpha > 0) out.push({ i, y: p.y, h: 450 * (p.scaleY ?? 1) });
  }
  return out.sort((a, b) => a.y - b.y);
};

// ---- 1. layout at rest: three slots, centred, one pitch apart -------------
console.log('layout at rest (arqe centres 246/720/1194 on a 1440 stage => -474/0/+474)');
{
  const p = poseAt(0);
  ok(p.length === 3, 'three cards drawn at rest');
  near(p[0].y, -474, 0.01, 'top slot');
  near(p[1].y, 0, 0.01, 'middle slot');
  near(p[2].y, 474, 0.01, 'bottom slot');
  for (const c of p) near(c.h, 450, 0.01, `card ${c.i} unfolded at rest`);
}

// ---- 2. the strip advances exactly one pitch per step ---------------------
console.log('one pitch per step, and the pool wraps');
{
  const a = poseAt(0), b = poseAt(FPS * 2); // one step = stepTime 2s
  near(b[1].y - a[1].y, 0, 0.01, 'slots are stationary');
  ok(a[0].i !== b[0].i, 'a different card occupies the top slot');
  ok(b[0].i === (a[0].i + 1) % N, 'the pool advanced by exactly one card');
}

// ---- 3. the measured fold: height of the outgoing card -------------------
// Column 4 is what the reference's mesh hull reported, less the ~3.2px the
// overlapping triangles add. Tolerance 1% of the card.
console.log('outgoing fold height vs arqe (t within the step -> visible height)');
const MEASURED = [
  [0.2, 668.9 - 3.2, 450 / 670], // Flip 03 rows are in 670-units; scaled below
];
// Flip 01's own table, straight off its canvas, already in 450-units:
const FLIP01 = [
  [6.2, 450.5 - 3.2], [6.3, 445.8 - 3.2], [6.4, 438.1 - 3.2], [6.5, 426.1 - 3.2],
  [6.6, 407.7 - 3.2], [6.7, 379.0 - 3.2], [6.8, 331.7 - 3.2], [6.9, 242.6 - 3.2],
];
{
  for (const [t, wantH] of FLIP01) {
    const frame = Math.round((t - 6) * FPS) + FPS * 6 * 3; // any step; use t-6 offset
    const step = ((t - 6) % 2 + 2) % 2;
    const f = Math.round((6 * 2 + step) * FPS); // a step boundary at 12s? use frame math below
    void frame; void f;
    const fr = Math.round((step) * FPS) + FPS * 2 * 2; // start of the 3rd step + offset
    const poses = [];
    for (let i = 0; i < N; i++) {
      const p = tpl.transform(fr, i, N, v, ctx);
      if (p.alpha > 0) poses.push({ i, y: p.y, h: 450 * (p.scaleY ?? 1) });
    }
    poses.sort((a, b) => a.y - b.y);
    const top = poses[0];
    const d = top.h - wantH;
    console.log(`   u=${(step / 2).toFixed(2)}  ours ${top.h.toFixed(1)}  arqe ${wantH.toFixed(1)}  delta ${d >= 0 ? '+' : ''}${d.toFixed(1)}px (${(100 * d / 450).toFixed(2)}%)`);
    near(top.h, wantH, 4.5, `fold height at step+${step.toFixed(1)}s`);
  }
}

// ---- 4. edge-on exactly at the step midpoint -----------------------------
console.log('the flap is edge-on, and dropped, at the half step');
{
  const fr = Math.round(1.0 * FPS) + FPS * 2 * 2; // midpoint of a step
  let drawn = 0;
  for (let i = 0; i < N; i++) if (tpl.transform(fr, i, N, v, ctx).alpha > 0) drawn++;
  ok(drawn === 2, `only the two full cards remain at the midpoint (got ${drawn})`);
}

// ---- 5. the hinge stays pinned to the strip ------------------------------
console.log('the outgoing card\'s far edge stays where the strip put it');
{
  // strip offset after eased progress p is -474p; the outgoing card's far edge
  // sits at (its slot centre + 225) and must not move relative to that.
  for (const s of [0.1, 0.2, 0.3, 0.4, 0.45]) {
    const fr = Math.round(s * 2 * FPS) + FPS * 2 * 2;
    const p = ease(s);
    let top = null;
    for (let i = 0; i < N; i++) {
      const q = tpl.transform(fr, i, N, v, ctx);
      if (q.alpha > 0 && (top === null || q.y < top.y)) top = q;
    }
    const farEdge = top.y + 450 * (top.scaleY ?? 1) / 2;
    near(farEdge, -474 - 474 * p + 225, 1.0, `hinge pinned at u=${s}`);
  }
}

// ---- 6. seamless loop ----------------------------------------------------
console.log('frame totalFrames reproduces frame 0');
{
  for (let i = 0; i < N; i++) {
    const a = tpl.transform(0, i, N, v, ctx);
    const b = tpl.transform(TOTAL, i, N, v, ctx);
    near(b.y, a.y, 1e-6, `card ${i} y loops`);
    near(b.scaleY ?? 1, a.scaleY ?? 1, 1e-6, `card ${i} fold loops`);
  }
}

// ---- 7. every pose finite, in every direction and shape -----------------
console.log('no NaN across directions / visible / count');
{
  for (const direction of ['up', 'down', 'left', 'right']) {
    for (const visible of [2, 3, 4, 5, 6]) {
      for (const count of [2, 3, 6, 20]) {
        const vv = { ...v, direction, visible, count };
        for (let f = 0; f < TOTAL; f += 7) {
          for (let i = 0; i < count; i++) {
            const p = tpl.transform(f, i, count, vv, ctx);
            for (const [k, val] of Object.entries(p)) {
              if (typeof val === 'number' && !Number.isFinite(val)) {
                checks++; failed++;
                console.log(`  FAIL non-finite ${k} at ${direction}/${visible}/${count}`);
                f = TOTAL; break;
              }
            }
          }
        }
      }
    }
  }
  checks++;
}

// ---- 8. horizontal presets size along the travel axis -------------------
console.log('planeSize is the along-axis edge (arqe: 450 -> 450x600 horizontally)');
{
  const vh = { ...v, direction: 'right' };
  const p = tpl.transform(0, 0, N, vh, ctx);
  // on-screen width = BASE*scale*min(1,aspect); aspect 3/4 => 340*scale*0.75
  const w = 340 * p.scale * Math.min(1, 3 / 4);
  const h = 340 * p.scale / Math.max(1, 3 / 4);
  near(w, 450, 0.01, 'horizontal card width == planeSize');
  near(h, 600, 0.01, 'horizontal card height == 600');
}

// ---- 9. every direction actually travels the way it is named -------------
console.log('direction of travel');
{
  const AXIS = { up: ['y', -1], down: ['y', 1], left: ['x', -1], right: ['x', 1] };
  for (const [direction, [axis, want]] of Object.entries(AXIS)) {
    const vv = { ...v, direction };
    // follow one card across a whole step and unwrap nothing: within a single
    // step a mid-window card never wraps, so the raw delta is honest.
    let best = null;
    for (let i = 0; i < N; i++) {
      const a = tpl.transform(FPS * 2, i, N, vv, ctx);        // rest
      const b = tpl.transform(FPS * 2 + FPS * 2, i, N, vv, ctx); // next rest
      if (a.alpha > 0 && b.alpha > 0) { best = [a, b]; break; }
    }
    ok(best !== null, `${direction}: a card survives a whole step`);
    if (best) {
      const d = best[1][axis] - best[0][axis];
      ok(Math.sign(d) === want, `${direction} travels ${want > 0 ? '+' : '-'}${axis} (got ${d.toFixed(1)})`);
      ok(Math.abs(Math.abs(d) - (v.cardSize + v.gap)) < 0.01, `${direction} moves exactly one pitch`);
    }
  }
}
console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed ? 1 : 0);
