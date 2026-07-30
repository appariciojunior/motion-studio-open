import type { Template } from '@/lib/types';
import { variant } from './variant';

const BASE = 340;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
// Deterministic hash for per-card variety (no Math.random — transform is pure).
const h = (k: number) => { const s = Math.sin(k * 127.1 + 1.7) * 43758.5453; return s - Math.floor(s); };

// Closed-form bouncing-ball height ABOVE the floor at elapsed time `tau`, for a
// drop of height H under gravity g with restitution e. Purely analytic (no
// per-frame integration): walk successive parabolic arcs until we find the one
// containing `tau`. Guards keep it finite when g≈0 or e≈0.
//   t0 = sqrt(2H/g)             time to first impact
//   v0 = sqrt(2gH) = g·t0       impact speed
//   arc k (k≥1) takeoff speed u_k = v0·e^k, flight time T_k = 2·u_k/g
//   settles at t_total = t0 + (2v0/g)·e/(1-e)  → height 0 thereafter
function bounceHeight(tau: number, H: number, g: number, e: number): number {
  if (tau <= 0) return H;                 // still parked at the drop point
  if (H <= 0 || g <= 1e-6) return 0;      // degenerate: treat as settled
  const t0 = Math.sqrt((2 * H) / g);
  if (tau < t0) return H - 0.5 * g * tau * tau;   // initial free fall
  const v0 = g * t0;
  const rest = clamp(e, 0, 0.999);        // e<1 guarantees the series converges
  let rem = tau - t0;
  let u = v0 * rest;                       // takeoff speed of the first bounce
  for (let k = 0; k < 40; k++) {
    const T = (2 * u) / g;                 // flight time of this arc
    if (T < 1e-4) break;                   // arcs collapsed → settled
    if (rem < T) return u * rem - 0.5 * g * rem * rem;
    rem -= T;
    u *= rest;                             // next arc peaks lower
  }
  return 0;                                // energy spent → resting on floor
}

// Gravity — cards drop from above, tumble as they fall, bounce with restitution
// and settle into a pile of columns at the bottom. Everything is a pure function
// of `frame` via a closed-form bounce (no iterative sim reading prior frames).
const gravity: Template = {
  meta: { id: 'gravity-01', name: 'Bounce 01', group: 'Bounce', defaultEasing: { id: 'linear' } },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 14, step: 1,     default: 8 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 400, step: 1,   default: 200 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,    default: 12 },
    { key: 'gravity',      label: 'Gravity',       type: 'slider', min: 0.2, max: 3, step: 0.1,  default: 1 },
    { key: 'bounce',       label: 'Bounce',        type: 'slider', min: 0, max: 0.9, step: 0.05, default: 0.2 },
    { key: 'friction',     label: 'Friction',      type: 'slider', min: 0, max: 1, step: 0.05,   default: 0.4 },
    { key: 'stagger',      label: 'Stagger',       type: 'slider', min: 0, max: 0.6, step: 0.02, default: 0.18 },
    { key: 'spread',       label: 'Spread',        type: 'slider', min: 100, max: 800, step: 1,  default: 500 },
    { key: 'spin',         label: 'Spin',          type: 'slider', min: 0, max: 3, step: 0.1,    default: 1 },
    // A drop settles in a couple of seconds, so on a default 8s clip the pile
    // sat frozen for most of it and then teleported back to the top. `drops`
    // fits whole drops into the clip instead, and `recycleFade` dissolves each
    // pile before the next one falls so the recycle isn't a hard cut.
    { key: 'drops',        label: 'Drops',         type: 'slider', min: 1, max: 6, step: 1,      default: 2 },
    { key: 'recycleFade',  label: 'Recycle Fade',  type: 'slider', min: 0, max: 90, step: 1,     default: 30 }, // % of each drop spent fading out
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    // Physics runs on real seconds, not a normalized phase. Splitting the clip
    // into whole drops makes frame totalFrames land exactly on frame 0, so this
    // family now honours the same seamless-loop guarantee as the others — it
    // used to be the one exception. drops = 1 restores the original single drop.
    const cycles = Math.max(1, Math.round(v.drops));
    const cycleFrames = ctx.totalFrames / cycles;
    const fLocal = ((frame % cycleFrames) + cycleFrames) % cycleFrames;
    const T = fLocal / ctx.fps;
    const sizeFactor = v.cardSize / BASE;
    const cardPx = v.cardSize * sizeFactor;     // scaled footprint used for spacing

    // ---- Pile geometry: hash each card into a column, stack shared columns ----
    const numCols = Math.max(1, Math.min(6, Math.round(v.spread / Math.max(1, cardPx))));
    const colOf = (i: number) => Math.min(numCols - 1, Math.floor(h(i + 3) * numCols));
    const col = colOf(index);
    const columnX = -v.spread / 2 + (col + 0.5) * (v.spread / numCols);

    // How many earlier cards already occupy this column → this card rests on top.
    let pileRow = 0;
    for (let j = 0; j < index; j++) if (colOf(j) === col) pileRow++;

    const floorY = ctx.height / 2 - cardPx * 0.5;      // bottom resting band
    const restY = floorY - pileRow * (cardPx * 0.35);  // stack upward per row

    // ---- Spawn point (above the top edge) and drop height ----
    const margin = cardPx;
    const spawnY = -ctx.height / 2 - margin;
    const spawnX = columnX + (h(index + 7) - 0.5) * v.spread * 0.3;
    const H = restY - spawnY;                            // > 0 by construction

    // ---- Timeline: per-card stagger, then analytic bounce ----
    const start = index * v.stagger;
    const tau = T - start;

    if (tau < 0) {
      // Not yet released: park just above the top, hidden.
      return { x: spawnX + v.offset.x, y: spawnY + v.offset.y, scale: sizeFactor, rotation: 0, alpha: 0, depth: index };
    }

    const g = v.gravity * 2000;                          // px/s^2
    const e = v.bounce;
    // Total flight time until the card is at rest (see bounceHeight for series).
    const t0 = g > 1e-6 && H > 0 ? Math.sqrt((2 * H) / g) : 0;
    const v0 = g * t0;
    const eC = clamp(e, 0, 0.999);
    const tTotal = t0 + (g > 1e-6 ? (2 * v0) / g * (eC / (1 - eC)) : 0);

    const above = bounceHeight(tau, H, g, e);
    const y = restY - above;                             // up is negative y

    // ---- Horizontal: drift while airborne, damped by friction, then settle ----
    const driftVx = (h(index + 11) - 0.5) * 500 * (1 - v.friction);
    const airX = spawnX + driftVx * Math.min(tau, tTotal);
    const settle = tTotal > 1e-6 ? clamp(tau / tTotal, 0, 1) : 1;
    const settle2 = settle * settle;                     // ease toward the column
    const x = clamp(lerp(airX, columnX, settle2), -ctx.width / 2, ctx.width / 2);

    // ---- Rotation: tumble in the air, relax to a slight resting tilt ----
    const spinDir = h(index + 17) < 0.5 ? -1 : 1;
    const spinSpeed = v.spin * 4;                        // rad/s at spin=1
    const airRot = spinDir * spinSpeed * Math.min(tau, tTotal);
    const restTilt = (h(index + 13) - 0.5) * 0.25;       // small ±0.125 rad
    const rotation = lerp(airRot, restTilt, settle2);

    // Dissolve the settled pile over the tail of the drop, so the recycle reads
    // as a fade rather than the pile snapping back to the top. Cards re-enter
    // from above the frame, which is already off-canvas, so there is no matching
    // pop on the way in.
    let alpha = 1;
    const fadeSpan = (v.recycleFade / 100) * cycleFrames;
    if (fadeSpan > 0.5) {
      const left = cycleFrames - fLocal;
      if (left < fadeSpan) {
        const u = clamp(left / fadeSpan, 0, 1);
        alpha = u * u * (3 - 2 * u);                      // smooth falloff
      }
    }

    return {
      x: x + v.offset.x,
      y: y + v.offset.y,
      scale: sizeFactor,
      rotation,
      alpha,
      depth: index,                                      // later cards land on top
    };
    // cornerRadius is applied where the sprite mask is built, not here.
  },
};

export const gravityVariants: Template[] = [
  gravity, // Gravity 01 — a measured drop with a soft bounce
  variant(gravity, 'gravity-02', 'Bounce 02', {
    // Bouncy: springy restitution, little friction, tight fast stagger.
    bounce: 0.7, friction: 0.1, spin: 1.6, stagger: 0.1, spread: 600,
  }),
  variant(gravity, 'gravity-03', 'Bounce 03', {
    // Slow-mo: low gravity, gentle spin, wide lazy scatter.
    gravity: 0.35, bounce: 0.3, friction: 0.5, spin: 0.5, stagger: 0.3, cardSize: 160,
  }),
];
