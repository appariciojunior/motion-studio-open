import type { Template } from '@/lib/types';
import { TAU, clamp, frac, loopCycles } from '@/lib/motion';
import { variant } from './variant';

// Reference size (px) shared with the renderer's sprite normalization, so that
// `cardSize` reads directly in on-screen pixels.
const BASE = 340;

// ============================================================
//  SPIRAL — a vortex. Cards ride an Archimedean spiral from the outer
//  rim into the centre, turning to follow the curve as they go.
//  Port of Originkit's "Spiral Images".
//
//  Two things make this more than polar coordinates with a moving angle:
//
//  · ARC-LENGTH SPACING. The path is r = R(1-n), θ = n·turns·2π. Stepping `n`
//    uniformly bunches the cards toward the centre, because a lap near the
//    middle is a fraction of the length of a lap at the rim — the stream comes
//    out sparse outside and clotted inside. The source fixes this by walking a
//    2000-sample cumulative-length table; the same curve has a CLOSED-FORM
//    length, so here the mapping is analytic (see `radiusForArc`).
//
//  · TANGENT ALIGNMENT. Cards rotate onto the curve, which is what makes the
//    stream read as one ribbon rather than a scatter of tilted rectangles.
//
//  With the shipped defaults the spacing (total arc / count) lands at ~195px
//  against a 200px card, i.e. the cards just touch at the rim and pull apart as
//  the taper shrinks them toward the drain. That relationship is the look, and
//  it is why Count, Plane Size and Spread are worth moving together.
//
//  The source is a Canvas2D component with its own RAF clock and a free-running
//  progress counter; a template here is a pure function of the frame, so that
//  progress becomes a loop-quantized phase and its painter's-algorithm sort
//  becomes `depth`.
// ============================================================

// Arc length from the CENTRE out to normalized radius u ∈ [0,1], in units of
// the outer radius R. With r = R·u and θ = (1-u)·k, ds = R·√(1 + k²u²) du,
// which integrates in closed form. Derivative is exactly √(1 + k²u²).
const arcFromCentre = (u: number, k: number) =>
  (k * u * Math.sqrt(1 + k * k * u * u) + Math.asinh(k * u)) / (2 * k);

// Inverse: the radius whose arc-from-centre is fraction `f` of the whole path.
// `arcFromCentre` is increasing and convex in u, so Newton is unconditionally
// safe here — from below, one step lands at or above the root and the rest
// descend monotonically. The large-k form (arc ≈ k·u²/2) gives a first guess
// that is usually within a single step, so eight iterations is generous.
function radiusForArc(f: number, k: number): number {
  const target = clamp(f, 0, 1) * arcFromCentre(1, k);
  let u = clamp(Math.sqrt((2 * target) / k), 0, 1);
  for (let i = 0; i < 8; i++) {
    u = clamp(u - (arcFromCentre(u, k) - target) / Math.sqrt(1 + k * k * u * u), 0, 1);
  }
  return u;
}

const spiralImages: Template = {
  meta: {
    id: 'spiral-images-01', name: 'Spiral 01', group: 'Spiral',
    isNew: true, repeatAssets: true, defaultEasing: { id: 'linear' },
  },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 6, max: 60, step: 1,      default: 42, section: 'Layout' },
    { key: 'turns',        label: 'Turns',         type: 'slider', min: 0.5, max: 8, step: 0.1,   default: 3.5, section: 'Layout', precision: 1 },
    { key: 'spread',       label: 'Spread',        type: 'slider', min: 20, max: 160, step: 1,    default: 90, section: 'Layout', unit: '%',
      description: 'Outer radius, as a share of the canvas short edge. Above ~55% the outermost arm sweeps off frame, which is where the default sits.' },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 40, max: 400, step: 1,    default: 200, section: 'Layout' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                 default: { x: 0, y: 0 }, section: 'Layout' },
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['inward','outward'], default: 'inward', section: 'Motion' },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 1.5, step: 0.05,  default: 0.15, section: 'Motion', unit: '×', precision: 2,
      description: 'Full trips along the spiral per second, quantized to a whole number per clip so the loop closes.' },
    { key: 'fadeIn',       label: 'Fade In',       type: 'slider', min: 0, max: 60, step: 1,      default: 20, section: 'Motion', unit: '%',
      description: 'Share of the path a card spends fading up after it enters. The entry end follows Direction.' },
    { key: 'fadeOut',      label: 'Fade Out',      type: 'slider', min: 0, max: 60, step: 1,      default: 0, section: 'Motion', unit: '%' },
    { key: 'taper',        label: 'Taper',         type: 'slider', min: 0, max: 4, step: 0.1,     default: 2, section: 'Depth', precision: 1,
      description: 'How hard the cards shrink toward the centre. 0 keeps every card the same size the whole way.' },
    { key: 'align',        label: 'Alignment',     type: 'toggle', options: ['flow','upright'],   default: 'flow', section: 'Finish' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,     default: 5, section: 'Finish' },
  ],

  transform: (frame, index, count, v, ctx) => {
    const k = Math.max(1e-3, v.turns * TAU);   // total sweep in radians
    const outward = v.direction === 'outward';

    // One phase unit = one card's FULL trip along the spiral, so quantizing to
    // whole units returns every card to its own start at the seam. That is also
    // why routing through `easedPhase` is safe here: the curve shapes one whole
    // traversal, not one card-step, so it cannot lurch per card the way it does
    // on a ring whose period is `count`.
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration));

    // s ∈ [0,1): 0 = outer rim, 1 = centre — measured along the ARC, so slots
    // one even step apart stay evenly spaced the whole way in.
    const s = frac(index / count + (outward ? -phase : phase));

    const R = (v.spread / 100) * Math.min(ctx.width, ctx.height);
    const u = radiusForArc(1 - s, k);          // normalized radius: 1 = rim, 0 = centre
    const ang = (1 - u) * k;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);

    // Tangent of the same curve, pointing toward the centre (the source takes a
    // finite difference; this is the derivative it approximates). The common
    // factor R drops out of atan2, so only the bracketed terms are needed.
    const rotation = v.align === 'upright'
      ? 0
      : Math.atan2(sin - u * k * cos, -cos - u * k * sin);

    // Fades sit at the ENDS OF TRAVEL rather than at fixed ends of the curve,
    // so reversing Direction does not turn the entry ramp into an exit pop.
    const e = outward ? 1 - s : s;
    const fadeIn = v.fadeIn / 100;
    const fadeOut = v.fadeOut / 100;
    let alpha = 1;
    if (fadeIn > 0 && e < fadeIn) alpha = e / fadeIn;
    else if (fadeOut > 0 && e > 1 - fadeOut) alpha = (1 - e) / fadeOut;

    return {
      x: R * u * cos + v.offset.x,
      y: -R * u * sin + v.offset.y,
      // Taper 0 leaves pow(u, 0) = 1, i.e. a constant-size ribbon.
      scale: Math.max(0.001, (v.cardSize / BASE) * Math.pow(u, v.taper * 0.5)),
      rotation,
      alpha: clamp(alpha, 0, 1),
      // The leading end of travel draws on top: the drain for an inward vortex,
      // the rim for an outward one — which is also the end where the cards are
      // largest, so the stream never layers a distant card over a near one.
      depth: e,
    };
  },
};

export const spiralImagesVariants: Template[] = [
  spiralImages, // Spiral 01 — the component defaults: a dense ribbon down the drain
  // Tighter and faster, with the whole coil inside the frame. Turns and Count
  // move together for a reason: the radial gap between laps is Spread/Turns,
  // and it has to clear the card's SHORT edge or the coils grow into each other
  // and the spiral stops reading as one. At 4 turns that leaves ~44px.
  variant(spiralImages, 'spiral-images-02', 'Spiral 02', {
    turns: 4, count: 50, cardSize: 135, spread: 75, speed: 0.35, fadeIn: 12,
  }),
  // Reversed — cards bloom out of the centre and fade off at the rim.
  variant(spiralImages, 'spiral-images-03', 'Spiral 03', {
    direction: 'outward', turns: 2.5, count: 22, cardSize: 240, spread: 75,
    fadeIn: 25, fadeOut: 25, taper: 1.4,
  }),
  // Flat ribbon: no taper, upright cards — a coiled contact sheet. With every
  // card the same size there is no depth cue left to separate the laps, so this
  // one buys its clearance with a wide, shallow coil instead.
  variant(spiralImages, 'spiral-images-04', 'Spiral 04', {
    align: 'upright', taper: 0, turns: 3.5, count: 46, cardSize: 110,
    spread: 70, speed: 0.2, fadeIn: 10, fadeOut: 10,
  }),
];
