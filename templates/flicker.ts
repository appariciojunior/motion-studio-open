import type { Template } from '@/lib/types';
import { loopCycles } from '@/lib/motion';
import type { EasingSpec } from '@/lib/easing';
import { variant } from './variant';

const BASE = 340;

// Flicker — cards take turns at centre, cross-fading on a cycle. Effect adds
// a scale pop or a directional drift to the outgoing card (per the reference
// tool's Pacing / Effect / Drift controls).
const flicker: Template = {
  meta: { id: 'flicker-01', name: 'Pulse 01', group: 'Pulse', defaultEasing: { id: 'linear' } },

  controls: [
    { key: 'pacing',       label: 'Pacing',        type: 'toggle', options: ['equal','eased'], default: 'equal' },
    { key: 'effect',       label: 'Effect',        type: 'pills',  options: ['off','scale','drift'], default: 'off' },
    { key: 'driftDir',     label: 'Drift Dir',     type: 'pills',  options: ['up','down','left','right'], default: 'up' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 12, step: 1,   default: 6 },
    // The reference runs this family full-bleed: its planeSize 100 measured as a
    // 1080x1440 card on a 1080x1440 stage. `card` keeps this family's own centred
    // look and stays the default so nothing that shipped moves.
    { key: 'fit',          label: 'Fit',           type: 'pills',  options: ['card','frame'], default: 'card', section: 'Layout' },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 800, step: 1, default: 420, visibleWhen: { key: 'fit', equals: 'card' } },
    { key: 'frameSize',    label: 'Frame Size',    type: 'slider', min: 20, max: 160, step: 1, default: 100, unit: '%', visibleWhen: { key: 'fit', equals: 'frame' }, description: '100% exactly covers the canvas.' },
    { key: 'driftAmount',  label: 'Drift Amount',  type: 'slider', min: 0, max: 200, step: 1,  default: 40 },
    { key: 'scaleAmount',  label: 'Scale Amount',  type: 'slider', min: 0, max: 60, step: 1,   default: 12, unit: '%', visibleWhen: { key: 'effect', equals: 'scale' } },
    { key: 'scaleDir',     label: 'Scale Dir',     type: 'pills',  options: ['forward','reverse'], default: 'forward', visibleWhen: { key: 'effect', equals: 'scale' }, description: 'forward grows the outgoing card, reverse shrinks it away.' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 10 },
    { key: 'speed',        label: 'Cycles',        type: 'slider', min: 0.2, max: 6, step: 0.1, default: 1.5 }, // cards/sec
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count));

    // lifecycle w ∈ [0, count): 0 = this card just became active
    const w = (((phase - index) % count) + count) % count;

    // visibility: full at w=0, crossfades out over one slot; the incoming
    // neighbour fades in over the same window
    let vis = Math.max(0, 1 - w) + Math.max(0, 1 - (count - w));
    vis = Math.min(1, vis);
    if (v.pacing === 'eased') vis = vis * vis * (3 - 2 * vis); // smoothstep hold

    // outgoing progress 0→1 during the fade window
    const out = w < 1 ? w : 0;

    let dx = 0, dy = 0, scl = 1;
    if (v.effect === 'drift') {
      const d = out * v.driftAmount;
      if (v.driftDir === 'up') dy = -d;
      else if (v.driftDir === 'down') dy = d;
      else if (v.driftDir === 'left') dx = -d;
      else dx = d;
    } else if (v.effect === 'scale') {
      // At the default 12% forward this is exactly the `1 + out * 0.12` this
      // family shipped with, so the existing presets are untouched.
      const amt = (v.scaleAmount ?? 12) / 100;
      scl = v.scaleDir === 'reverse' ? 1 - out * amt : 1 + out * amt;
    }

    // `frame` covers the canvas: the renderer normalizes a sprite's LONG edge, so
    // matching the canvas means matching its long edge, not its height — the same
    // trap that left Bloom and Takeover short on a landscape canvas.
    const base = v.fit === 'frame'
      ? (Math.max(ctx.width, ctx.height) / BASE) * ((v.frameSize ?? 100) / 100)
      : v.cardSize / BASE;

    return {
      x: v.offset.x + dx,
      y: v.offset.y + dy,
      scale: base * scl,
      rotation: 0,
      alpha: vis,
      depth: vis, // active card on top
    };
  },
};

export const flickerVariants: Template[] = [
  flicker, // Flicker 01 — clean crossfade
  variant(flicker, 'flicker-02', 'Pulse 02', {
    effect: 'drift', driftDir: 'up', driftAmount: 60, pacing: 'eased', speed: 1,
  }),
];

// ============================================================
//  Reference-catalogue presets (Flicker 01–10)
//
//  Measured, not assumed: its planeSize 100 renders a 1080x1440 card on a
//  1080x1440 stage, and 118 renders 1179x1572. So planeSize is a PERCENTAGE of
//  the frame here — a third convention for that name, after Carousel's 'card
//  height in px' and Marquee's '2 * planeSize * 2.155'. Hence the `frame` fit.
//
//  Rate is the whole set passing `cycles` times over the clip, so
//  cards/sec = count * cycles / duration. Flicker 01 is 6 cards, 1 cycle, 6s = 1;
//  Flicker 02 is 12 cards, 2 cycles, 4s = 6.
//
//  Drift is in reference px, so it carries the 0.75 canvas factor: its 7 / 40 /
//  80 / 100 become 5 / 30 / 60 / 75 here.
// ============================================================

interface RefFlicker {
  planeSize: number;
  count?: number;
  cycles?: number;
  seconds: number;
  pacing?: 'equal' | 'eased';
  effect?: 'off' | 'scale' | 'drift';
  driftDir?: 'up' | 'down' | 'left' | 'right';
  /** Reference drift in its own px; converted here. */
  drift?: number;
  scaleAmount?: number;
  scaleDir?: 'forward' | 'reverse';
}

function refFlicker(r: RefFlicker): Record<string, any> {
  const count = r.count ?? 6;
  return {
    fit: 'frame',
    frameSize: r.planeSize,
    count,
    pacing: r.pacing ?? 'equal',
    effect: r.effect ?? 'off',
    driftDir: r.driftDir ?? 'up',
    driftAmount: Math.round((r.drift ?? 40) * 0.75),
    scaleAmount: r.scaleAmount ?? 12,
    scaleDir: r.scaleDir ?? 'forward',
    cornerRadius: 0,
    speed: Math.round((count * (r.cycles ?? 1) / r.seconds) * 100) / 100,
  };
}

function refPreset(id: string, name: string, r: RefFlicker, easing: EasingSpec): Template {
  const t = variant(flicker, id, name, refFlicker(r));
  return { ...t, meta: { ...t.meta, defaultEasing: easing, cardAspect: 'canvas' } };
}

const LINEAR: EasingSpec = { id: 'linear' };
const FLOW: EasingSpec = { id: 'flow' };

export const flickerRefVariants: Template[] = [
  // Clean full-frame crossfade, one image per second.
  refPreset('flicker-r01', 'Pulse 03', { planeSize: 100, seconds: 6 }, LINEAR),
  // Twelve images, two passes, eased hold — a fast strobe.
  refPreset('flicker-r02', 'Pulse 04', { planeSize: 73, count: 12, cycles: 2, seconds: 4, pacing: 'eased' },
    { id: 'custom', bezier: [0.7, 0.101, 0.3, 0.899] }),
  // Scale pop on the outgoing card.
  refPreset('flicker-r03', 'Pulse 05', { planeSize: 118, seconds: 6, effect: 'scale', scaleAmount: 15 }, FLOW),
  // Barely-there drift: the frame breathes rather than moves.
  refPreset('flicker-r04', 'Pulse 06', { planeSize: 107, seconds: 6, effect: 'drift', drift: 7 }, FLOW),
  refPreset('flicker-r05', 'Pulse 07', { planeSize: 107, seconds: 6, effect: 'drift', drift: 7, driftDir: 'left' }, FLOW),
  // Long, slow, far-travelling drift.
  refPreset('flicker-r06', 'Pulse 08', { planeSize: 63, seconds: 8, effect: 'drift', drift: 80 }, FLOW),
  refPreset('flicker-r07', 'Pulse 09', { planeSize: 63, seconds: 8, effect: 'drift', drift: 100, driftDir: 'left' }, FLOW),
  // Shrink away vs grow out, same timing — the pair reads as push and pull.
  refPreset('flicker-r08', 'Pulse 10', { planeSize: 63, seconds: 8, effect: 'scale', drift: 40, driftDir: 'left', scaleAmount: 40, scaleDir: 'reverse' }, FLOW),
  refPreset('flicker-r09', 'Pulse 11', { planeSize: 63, seconds: 8, effect: 'scale', drift: 40, driftDir: 'left', scaleAmount: 40 }, FLOW),
  // Fast and almost flat: a two-per-second cut with the faintest shrink.
  refPreset('flicker-r10', 'Pulse 12', { planeSize: 63, seconds: 3, effect: 'scale', drift: 40, driftDir: 'left', scaleAmount: 5, scaleDir: 'reverse' }, FLOW),
];

