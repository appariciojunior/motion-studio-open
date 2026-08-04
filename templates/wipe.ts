import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { clamp, loopCycles } from '@/lib/motion';
import { variant } from './variant';

// Wipe — full-frame images revealed by a directional push. The incoming
// full-bleed image slides in from an edge, hard-covering the previous one;
// the just-arrived image holds at centre until the next one pushes over it.
//
// The reference catalogue's Wipe family splits into two looks. Its 01/02 are
// this full-bleed push. Its 03/04 push a CARD instead — the image fitted inside
// the frame at 68% and parked at centre for a beat between pushes — which needs
// two things this family did not have: a hold, and a non-full-bleed fit.
const BASE = 340;

const wipe: Template = {
  meta: { id: 'wipe-01', name: 'Takeover 01', group: 'Takeover', defaultEasing: { id: 'linear' }, cardAspect: 'canvas' },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 8, step: 1,     default: 4 },
    { key: 'direction',    label: 'Direction',     type: 'pills',  options: ['left','right','up','down'], default: 'left' },
    { key: 'fit',          label: 'Fit',           type: 'pills',  options: ['fill','fit'],     default: 'fill', section: 'Layout', description: 'fill covers the frame; fit pushes a card sized by Plane Size.' },
    { key: 'zoom',         label: 'Zoom',          type: 'slider', min: 80, max: 160, step: 1,  default: 110, visibleWhen: { key: 'fit', equals: 'fill' } },
    { key: 'planeSize',    label: 'Plane Size',    type: 'slider', min: 20, max: 120, step: 1,  default: 68, unit: '%', visibleWhen: { key: 'fit', equals: 'fit' }, description: 'Card height as a share of the frame.' },
    { key: 'hold',         label: 'Hold',          type: 'slider', min: 0, max: 80, step: 1,    default: 0, section: 'Motion', unit: '%', description: 'Share of each image’s turn spent parked at centre before the next push.' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,   default: 0 },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0.2, max: 3, step: 0.1, default: 0.7 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                               default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    // `fill` is the original full-bleed cover scale, kept as the literal same
    // expression so the shipped Takeover presets cannot drift. `fit` sizes the
    // card by its height as a share of the frame, which is what Plane Size means
    // once the image is fitted rather than cropped to the canvas.
    // `fit` cards are 3:4 portrait, so their long edge IS the height. `fill`
    // cards are cropped to the canvas, so covering the frame means matching the
    // canvas's long edge — on a landscape canvas that is the width, and reading
    // the height instead left a band down the sides (55px on 4:3, 311px on 16:9).
    const scale = v.fit === 'fit'
      ? (ctx.height / BASE) * (v.planeSize / 100)
      : (Math.max(ctx.width, ctx.height) / BASE) * 1.15 * (v.zoom / 100);

    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count));
    // lifecycle w ∈ [0, count): 0 = this image just fully arrived at centre
    const w = (((phase - index) % count) + count) % count;

    let ox = 0;
    let oy = 0;
    let depth = -w; // most-recent (small w) drawn on top

    // A hold shortens the slide window inside the same turn, so the image lands
    // early and parks. At hold 0 `push` is 1 and `e` collapses to `arriving` —
    // the original expression exactly, which is why the shipped presets are
    // untouched.
    const push = 1 - clamp(v.hold / 100, 0, 0.8);
    const arriving = count - w; // small positive → arriving soon
    if (arriving < push) {
      const e = arriving / push; // 1 (off-screen) → 0 (centred)
      const horizontal = v.direction === 'left' || v.direction === 'right';
      const span = horizontal ? ctx.width : ctx.height;
      const sgn = v.direction === 'left' || v.direction === 'up' ? 1 : -1;
      if (horizontal) ox = sgn * e * span;
      else oy = sgn * e * span;
      depth = 10; // ride on top while sliding in
    }

    return {
      x: ox + v.offset.x,
      y: oy + v.offset.y,
      scale,
      rotation: 0,
      alpha: 1,
      depth,
    };
  },
};

// A preset that also ships its own curve — or its own card shape — needs `meta`
// patched, which `variant` deliberately does not do.
function preset(
  id: string,
  name: string,
  patch: Record<string, any>,
  easing: EasingSpec,
  cardAspect?: number
): Template {
  const t = variant(wipe, id, name, patch);
  return {
    ...t,
    meta: {
      ...t.meta,
      defaultEasing: easing,
      ...(cardAspect === undefined ? {} : { cardAspect }),
    },
  };
}

export const wipeVariants: Template[] = [
  wipe, // Wipe 01 — push from the left
  variant(wipe, 'wipe-02', 'Takeover 02', {
    direction: 'up', zoom: 120, speed: 0.9,
  }),
  variant(wipe, 'wipe-03', 'Takeover 03', {
    count: 6, direction: 'right', zoom: 100, speed: 0.5,
  }),

  // Reference Wipe 01/02 — full-bleed push, one image every 1.67s (0.6/s).
  // Their `scale: 4` had no unit I could pin down, so Zoom stays at this
  // family's own default rather than being invented from it.
  preset('wipe-04', 'Takeover 04', { count: 5, direction: 'up', speed: 0.6 }, { id: 'flow' }),
  preset('wipe-05', 'Takeover 05', { count: 5, direction: 'right', speed: 0.6 }, { id: 'flow' }),

  // Reference Wipe 03/04 — a fitted card at 68% that parks between pushes.
  // Its clip arithmetic pins the timing exactly: 401 frames at 30fps for
  // count 5 with duration 1.67 and delay 1 is 5 * (1.67 + 1), so a turn is
  // 2.67s of which 1s is the park — 37% hold, 0.375 turns/sec.
  preset('wipe-06', 'Takeover 06', {
    count: 5, direction: 'down', fit: 'fit', planeSize: 68, hold: 37, speed: 0.375,
  }, { id: 'glide' }, 3 / 4),
  preset('wipe-07', 'Takeover 07', {
    count: 5, direction: 'left', fit: 'fit', planeSize: 68, hold: 37, speed: 0.375,
  }, { id: 'glide' }, 3 / 4),
];
