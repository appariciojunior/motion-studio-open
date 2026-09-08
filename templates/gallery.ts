import type { Template } from '@/lib/types';
import { TAU, clamp, frac, lerp, smooth, hash2 } from '@/lib/motion';
import { variant } from './variant';
import { canvasScale } from './lattice';

const BASE = 340;

// Gallery — port of Originkit's "Image Gallery": tiles continuously spawn,
// settle on a ring (Blank Area % of the half-diagonal), drift, then vanish.
// Appear/Disappear pick the travel sense: in-out grows from the rest point
// and flies outward; out-in flies in from beyond the canvas and shrinks into
// the centre. Spiral mode replaces the straight radial run with a continuous
// spiral through the same rest radius. The source spawns DOM tiles on a GSAP
// clock; here each layer is a respawning slot on a seeded, evenly-staggered
// lifecycle — same look, but pure, deterministic, and loop-exact.
const gallery: Template = {
  meta: {
    id: 'canvas-gallery-01', name: 'Gallery 01', group: 'Canvas',
    defaultEasing: { id: 'linear' }, repeatAssets: true, cardAspect: 1,
  },

  controls: [
    { key: 'count',        label: 'Crowd',         type: 'slider', min: 3, max: 30, step: 1,    default: 10 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 500, step: 1,  default: 190 },
    { key: 'blankArea',    label: 'Blank Area',    type: 'slider', min: 1, max: 100, step: 1,   default: 45 },
    { key: 'path',         label: 'Path',          type: 'toggle', options: ['straight','spiral'], default: 'straight' },
    { key: 'spin',         label: 'Spin',          type: 'pills',  options: ['clockwise','anticlockwise','both'], default: 'both' },
    { key: 'appear',       label: 'Appear',        type: 'toggle', options: ['in-out','out-in'], default: 'out-in' },
    { key: 'vanish',       label: 'Disappear',     type: 'toggle', options: ['in-out','out-in'], default: 'out-in' },
    { key: 'appearT',      label: 'Appear Time',   type: 'slider', min: 0.2, max: 4, step: 0.1, default: 2 },
    { key: 'holdT',        label: 'Hold Time',     type: 'slider', min: 0, max: 4, step: 0.1,   default: 2 },
    { key: 'exitT',        label: 'Exit Time',     type: 'slider', min: 0.2, max: 4, step: 0.1, default: 1 },
    { key: 'seed',         label: 'Seed',          type: 'slider', min: 1, max: 999, step: 1,   default: 1 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,   default: 0 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                               default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    // Lifetime from the three time sliders; whole lifecycles per clip so the
    // loop is exact, layers evenly staggered like the source's spawn pacing.
    const T = Math.max(0.4, v.appearT + v.holdT + v.exitT);
    const laps = Math.max(1, Math.round(ctx.duration / T));
    const p = ctx.easedPhase((frame / ctx.totalFrames) * laps + index / count);
    const u = frac(p);
    // Cycle key wraps every `laps` respawns → frame totalFrames ≡ frame 0.
    const cyc = ((Math.floor(p) % laps) + laps) % laps;
    const h = (k: number) => hash2(index * 7.31 + cyc * 13.17, v.seed * k);

    const fA = v.appearT / T;
    const fH = v.holdT / T;
    const fE = Math.max(0.001, v.exitT / T);

    const halfDiag = Math.hypot(ctx.width, ctx.height) / 2;
    const grow = v.appear === 'in-out';   // grow from rest point vs fly in
    const away = v.vanish === 'in-out';   // fly outward vs shrink back in

    // Seeded per-spawn shape: the source's s0/s2/s3 ranges and tile variety.
    const s0 = lerp(0.1, 0.4, h(2.3));
    const s2 = lerp(0.7, 1.1, h(3.7));
    const s3 = lerp(3.0, 4.5, h(4.9));
    const sizeJ = lerp(0.8, 1.15, h(11.3));
    const resolution = canvasScale(ctx);
    const k = (v.cardSize * resolution / BASE) * sizeJ;

    let x: number, y: number, sc: number, al: number;

    if (v.path === 'spiral') {
      // Continuous spiral through the rest radius; fast-slow-fast progression.
      const R = halfDiag * 1.1;
      const startA = h(1.1) * TAU;
      const spin = v.spin === 'clockwise' ? 1
        : v.spin === 'anticlockwise' ? -1
        : h(5.3) < 0.5 ? -1 : 1;
      const turns = lerp(1.2, 2.0, h(9.7));
      const startR = grow ? 0 : R;
      const endR = away ? R : 0;
      const midR = R * (v.blankArea / 100);
      const mid = [0.45, 0.5, 0.55][Math.min(2, Math.floor(h(7.9) * 3))];

      const uw = clamp(u + Math.sin(u * TAU) * 0.12, 0, 1);
      const r = uw <= mid
        ? lerp(startR, midR, uw / mid)
        : lerp(midR, endR, (uw - mid) / (1 - mid));
      const a = startA + spin * uw * turns * TAU;

      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
      sc = k * (grow ? s2 * uw : s2 * (1 - uw));
      al = u < fA ? u / fA : u < fA + fH ? 1 : 1 - (u - fA - fH) / fE;
    } else {
      // Straight radial run through an anchor on the Blank Area ring.
      const A = h(1.1) * TAU;
      const R0 = (v.blankArea / 100) * halfDiag;
      const entryD = lerp(80, 140, h(6.1)) * resolution;
      const exitD = lerp(160, 260, h(8.3)) * resolution;
      const oRest = grow ? entryD : 0;
      const oExit = oRest + (away ? exitD : -exitD);
      const exitScale = away ? s3 : 0.08;

      let o: number;
      if (u < fA) {
        const t = smooth(u / fA);
        o = grow ? t * entryD : (1 - t) * entryD * 2.5;
        sc = grow ? lerp(s0, s2, t) : lerp(s3, s2, t);
        al = t; // a newly seeded card always enters from zero opacity
      } else if (u < fA + fH) {
        // Drift: creep 15% of the way toward the exit target while holding.
        const t = fH > 0 ? (u - fA) / fH : 1;
        o = lerp(oRest, oExit, 0.15 * t);
        sc = lerp(s2, exitScale, 0.15 * t);
        al = 1;
      } else {
        const t = smooth((u - fA - fH) / fE);
        o = lerp(oRest + (oExit - oRest) * (fH > 0 ? 0.15 : 0), oExit, t);
        sc = lerp(s2 + (exitScale - s2) * (fH > 0 ? 0.15 : 0), exitScale, t);
        al = 1 - t;
      }
      sc *= k;
      x = Math.cos(A) * (R0 + o);
      y = Math.sin(A) * (R0 + o);
    }

    return {
      x: x + v.offset.x * resolution,
      y: y + v.offset.y * resolution,
      scale: Math.max(0, sc),
      rotation: 0,
      alpha: clamp(al, 0, 1),
      depth: 1 - u, // newest tile sits on top, like the source's z counter
    };
  },
};

export const galleryVariants: Template[] = [
  gallery, // Gallery 01 — the component defaults: fly in, hold, shrink away
  variant(gallery, 'canvas-gallery-02', 'Gallery 02', {
    path: 'spiral', appear: 'in-out', appearT: 1.6, holdT: 1, exitT: 1.4, blankArea: 40,
  }),
  variant(gallery, 'canvas-gallery-03', 'Gallery 03', {
    appear: 'in-out', vanish: 'in-out', blankArea: 12, appearT: 0.5, holdT: 0.8,
    exitT: 0.9, count: 14, cardSize: 150,
  }),
];
