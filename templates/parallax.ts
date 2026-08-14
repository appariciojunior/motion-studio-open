import type { Template } from '@/lib/types';
import { clamp, hash2, lerp } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// ============================================================
//  PARALLAX — a scattered field that flickers, not a scrolling wall
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
//  A first pass modelled this as a continuous depth-parallax SCROLL — near
//  cards translating faster than far ones, the classic parallax read. Wrong:
//  rasterizing the live canvas at 4.0s and 4.5s on Parallax 01 (playhead
//  paused each time — this scene never populates the reference's own
//  card-rect helper, unlike Frames/Grid/Stack/Wheel, so the canvas itself has
//  to be read) showed every visible card in the EXACT same position and size
//  half a second later — no drift at all on a timescale that would have
//  shown one at any plausible speed implied by `travel`. What DOES move is
//  the whole visible SET: sampled every ~2s across the clip, the cards on
//  screen turn over almost completely, with an overlap frame (3.0s) showing
//  the outgoing set still fading and the incoming set already appearing.
//  So each card holds a FIXED scattered position for its whole life and
//  simply crossfades in, holds, and crossfades out — a Flicker crossfade
//  (see templates/flicker.ts) running independently per card at a random
//  scattered spot, not one shared centre. `travel` turned out to govern how
//  many of these on/off cycles the field runs per loop, not a distance —
//  fitted against the observed ~2-2.5s turnover on Parallax 01 (six cycles
//  over its 14s clip), not measured to the same precision as its schema
//  values.
// ============================================================

const parallax: Template = {
  meta: { id: 'parallax-01', name: 'Drift 01', group: 'Drift', repeatAssets: true, defaultEasing: { id: 'smooth' } },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 3, max: 250, step: 1,   default: 100 },
    { key: 'minSize',      label: 'Min Size',      type: 'slider', min: 10, max: 900, step: 5,  default: 110 },
    { key: 'maxSize',      label: 'Max Size',      type: 'slider', min: 10, max: 900, step: 5,  default: 300 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 150, step: 1,   default: 0 },
    { key: 'spread',       label: 'Spread',        type: 'slider', min: 20, max: 350, step: 5,  default: 260, description: 'Radius of the scatter around centre.' },
    { key: 'travel',       label: 'Travel',        type: 'slider', min: 20, max: 350, step: 5,  default: 130, description: 'How often the field turns over per loop.' },
    { key: 'depth',        label: 'Depth',         type: 'slider', min: 0, max: 100, step: 1,   default: 60, description: '0 makes every card the same size and pace; 100 is the full spread.' },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,   default: 45, description: 'Dims far cards toward the background.' },
    { key: 'seed',         label: 'Seed',          type: 'slider', min: 1, max: 999, step: 1,   default: 1 },
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const seed = v.seed ?? 1;
    // How much per-card variety `depth` actually buys: at 0, every card
    // collapses to the same medium depth (uniform size, uniform pace); at
    // 100, the full seeded spread applies.
    const strength = clamp(v.depth, 0, 100) / 100;
    const raw = hash2(index, seed * 91.7);
    const d = lerp(0.5, raw, strength);

    const size = lerp(v.minSize, v.maxSize, d);
    const sizeFactor = size / BASE;

    // Fixed scattered position for the card's whole life — see header: this
    // is what a 0.5s-apart pair of frames on the reference actually showed,
    // not a drift.
    const x = (hash2(index, seed * 17.3) - 0.5) * v.spread * 2 + v.offset.x;
    const y = (hash2(index, seed * 53.1) - 0.5) * v.spread * 2 + v.offset.y;

    // One shared integer cycle count keeps the loop exact regardless of the
    // per-card stagger below (frac(N*u - stagger) lands on the same value at
    // u=0 and u=1 for any integer N). `travel` sets N; nearer/bigger cards
    // linger a little longer per cycle (`duty`), same depth cue as size.
    const cycles = Math.max(1, Math.round(v.travel / 40));
    const duty = lerp(0.1, 0.22, d);
    const dir = v.direction === 'reverse' ? -1 : 1;
    const stagger = hash2(index, seed * 233.9);
    const u = frame / ctx.totalFrames;
    const local = (((cycles * u * dir - stagger) % 1) + 1) % 1;

    // Crossfade envelope within the card's own on-window: ease in over the
    // first 30%, hold, ease out over the last 30% — the overlap that let two
    // sets of cards (one fading out, the next fading in) show up together at
    // the reference's 3.0s sample.
    let lifecycle = 0;
    if (local < duty) {
      const p = local / duty;
      const edge = 0.3;
      lifecycle = p < edge ? ctx.ease(p / edge)
        : p > 1 - edge ? ctx.ease((1 - p) / edge)
        : 1;
    }

    const alpha = lifecycle * (1 - (v.fade / 100) * (1 - d));

    return {
      x,
      y,
      scale: sizeFactor,
      rotation: 0,
      alpha,
      depth: d,
    };
  },
};

export const parallaxVariants: Template[] = [
  parallax, // Drift 01
  variant(parallax, 'parallax-02', 'Drift 02', { count: 140, spread: 380, travel: 200, seed: 2 }),
  variant(parallax, 'parallax-03', 'Drift 03', { count: 40, spread: 140, travel: 80, seed: 3 }),
  variant(parallax, 'parallax-04', 'Drift 04', { count: 200, spread: 460, travel: 280, seed: 4 }),
  // Reference-measured presets (Parallax 01-03). `minSize`/`maxSize`/`spread`/
  // `cornerRadius` are literal reference px, canvas-scaled by 0.75 (its stage
  // is 1080x1440, this one's long edge is 1080). `travel` is carried over as
  // the same NUMBER — it now drives cycle count rather than distance, and
  // that formula was fitted to the observed ~2-2.5s turnover, not measured to
  // the schema's own precision. `depth`, `fade` and `seed` are dimensionless.
  variant(parallax, 'parallax-r01', 'Parallax 01', {
    count: 133, minSize: 179, maxSize: 332, spread: 225, travel: 300, depth: 60, fade: 0, seed: 10,
  }),
  variant(parallax, 'parallax-r02', 'Parallax 02', {
    count: 200, minSize: 179, maxSize: 332, spread: 225, travel: 150, depth: 100, fade: 78, seed: 10,
  }),
  variant(parallax, 'parallax-r03', 'Parallax 03', {
    count: 140, minSize: 179, maxSize: 332, spread: 135, travel: 100, depth: 60, fade: 80, seed: 10,
  }),
];
