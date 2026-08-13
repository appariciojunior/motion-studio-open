import type { Template } from '@/lib/types';
import { clamp, hash2, lerp } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// ============================================================
//  PARALLAX — a scattered photo field with depth
//
//  Measured on the reference tool (its store's paramsPerModeBaseline; the
//  panel confirms these are the live controls — Count, Min Size, Max Size,
//  Corner Radius, Spread, Travel, Depth, Fade, Seed):
//
//      Parallax 01: count 133, minSize 238, maxSize 442, spread 300,
//                   travel 300, depth 60,  fade 0,  seed 10
//      Parallax 02: count 200, spread 300, travel 150, depth 100, fade 78
//      Parallax 03: count 140, spread 180, travel 100, depth 60,  fade 80
//
//  (`direction`/`planeSize`/`scaleCenter` also sit in that baseline dict but
//  are NOT in the schema and NOT on the panel — dead keys the UI never
//  reads, left over from an earlier version of the scene. Confirmed by
//  reading the panel's own rendered labels, not by inference.)
//
//  Every card gets an independent depth in [0,1) from a seeded hash — this
//  is a scatter, not a layered wall, and it needed catching by eye: reading
//  two frames 13.5s apart on Parallax 01 (playhead paused, canvas rasterized
//  directly — this scene never populates the reference's own card-rect
//  helper, unlike Frames/Grid/Stack/Wheel) showed a small, bright, sharp card
//  drift about 2.5x farther than a smaller one nearby over the same span —
//  nearer cards outrun farther ones, the classic parallax tell. No size
//  change was visible over that span, so it is pure translation, not a
//  dolly. This is close to what this family (then "Drift") already modelled
//  — per-layer speed and scale both rising with depth — just laid out as an
//  ordered comb (index -> x by gap, y by a fixed band) where the reference is
//  a true independent scatter, which is the part that could not stretch to
//  Parallax 02's count of 200 without the comb reading as a fine-toothed grid
//  instead of a photo wall.
//
//  `depth` is a single Scene-level knob, not a per-card value: it is how much
//  the scatter's speed and size spread WIDEN with depth — 0 flattens every
//  card to the same rate (no parallax at all), 100 is the full spread. `fade`
//  dims far cards toward the background by up to that percent, the field's
//  depth cue on top of the size/speed one.
// ============================================================

const parallax: Template = {
  meta: { id: 'parallax-01', name: 'Drift 01', group: 'Drift', repeatAssets: true, defaultEasing: { id: 'smooth' } },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 3, max: 250, step: 1,   default: 100 },
    { key: 'minSize',      label: 'Min Size',      type: 'slider', min: 10, max: 900, step: 5,  default: 110 },
    { key: 'maxSize',      label: 'Max Size',      type: 'slider', min: 10, max: 900, step: 5,  default: 300 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 150, step: 1,   default: 0 },
    { key: 'spread',       label: 'Spread',        type: 'slider', min: 20, max: 350, step: 5,  default: 260, description: 'Radius of the scatter around centre.' },
    { key: 'travel',       label: 'Travel',        type: 'slider', min: 20, max: 350, step: 5,  default: 110, description: 'Distance the nearest cards cover over one loop.' },
    { key: 'depth',        label: 'Depth',         type: 'slider', min: 0, max: 100, step: 1,   default: 60, description: '0 flattens every card to the same rate and size; 100 is the full spread.' },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,   default: 45, description: 'Dims far cards toward the background.' },
    { key: 'seed',         label: 'Seed',          type: 'slider', min: 1, max: 999, step: 1,   default: 1 },
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const seed = v.seed ?? 1;
    // Per-card depth, 0 = far (small, slow) .. 1 = near (big, fast). Seeded so
    // the SAME index always draws the same card, and a Seed change reshuffles
    // the whole field deterministically rather than at random.
    const d = hash2(index, seed * 91.7);
    const size = lerp(v.minSize, v.maxSize, d);
    const sizeFactor = size / BASE;

    // At depth=0 every card shares the far card's rate (no parallax); at 100,
    // rate spans the full 0..1 range by `d`.
    const strength = clamp(v.depth, 0, 100) / 100;
    const rate = lerp(1 - strength, 1, d);

    const dir = v.direction === 'reverse' ? -1 : 1;

    // Each card wraps its own vertical span once it clears `spread` off centre
    // — this is what makes an endless field read as one continuous scatter
    // instead of a fixed cluster. Laps are rounded to the nearest INTEGER per
    // card, which is what keeps every card's own wrap exact at the loop point
    // regardless of how its rate compares to its neighbours' — the same
    // per-lane independence Frames' row drift and Ticker's lanes rely on.
    const span = v.spread * 2;
    const baseLaps = Math.max(1, (v.travel * ctx.duration) / span);
    const laps = Math.max(1, Math.round(baseLaps * rate));
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * laps) * dir;

    // Scatter start position, seeded per card, wrapped over its own span.
    const startY = (hash2(index, seed * 53.1) - 0.5) * span;
    const rawY = startY - phase * span;
    const y = (((rawY % span) + span) % span) - span / 2;
    const x = (hash2(index, seed * 17.3) - 0.5) * v.spread * 2 + v.offset.x;

    const alpha = 1 - (v.fade / 100) * (1 - d);

    return {
      x,
      y: y + v.offset.y,
      scale: sizeFactor,
      rotation: 0,
      alpha,
      depth: d,
    };
  },
};

export const parallaxVariants: Template[] = [
  parallax, // Drift 01
  variant(parallax, 'parallax-02', 'Drift 02', { count: 140, spread: 380, travel: 180, seed: 2 }),
  variant(parallax, 'parallax-03', 'Drift 03', { count: 40, spread: 140, travel: 70, seed: 3 }),
  variant(parallax, 'parallax-04', 'Drift 04', { count: 200, spread: 460, travel: 240, seed: 4 }),
  // Reference-measured presets (Parallax 01-03). `minSize`/`maxSize`/`spread`/
  // `travel`/`cornerRadius` are literal reference px, canvas-scaled by 0.75
  // (its stage is 1080x1440, this one's long edge is 1080). `depth`, `fade`
  // and `seed` are dimensionless and carried over unconverted.
  variant(parallax, 'parallax-r01', 'Parallax 01', {
    count: 133, minSize: 179, maxSize: 332, spread: 225, travel: 225, depth: 60, fade: 0, seed: 10,
  }),
  variant(parallax, 'parallax-r02', 'Parallax 02', {
    count: 200, minSize: 179, maxSize: 332, spread: 225, travel: 113, depth: 100, fade: 78, seed: 10,
  }),
  variant(parallax, 'parallax-r03', 'Parallax 03', {
    count: 140, minSize: 179, maxSize: 332, spread: 135, travel: 75, depth: 60, fade: 80, seed: 10,
  }),
];
