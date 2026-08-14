import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { clamp } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// ============================================================
//  WIPE — the image never moves; a straight edge uncovers it
//
//  This is NOT the Takeover family (templates/wipe.ts), which pushes a card in
//  from an edge. Measured on the reference, every card sits dead centre at
//  full frame for the entire clip — reading its own card rects at 17 points
//  across the loop returned (540, 720) at 1080x1440 every single time, with
//  only the slot indices advancing. Nothing translates and nothing scales.
//  What moves is the REVEAL EDGE, which is why the family is called Wipe and
//  why it needs real clipping rather than a transform.
//
//  Timing, measured from the slot indices flipping: one transition every
//  1.67s, and the timeline reads 8.4s — so `duration` here is the PER-CARD
//  time and the clip is duration x count (1.67 x 5 = 8.35). That differs from
//  Parallax, where `duration` is the whole clip; the reference is not
//  consistent about it between families, so it has to be measured each time.
//
//  The edge sweeps the full frame within one card's turn, strongly eased.
//  Tracking the strongest horizontal gradient through one turn (t measured
//  from the transition, progress = how much of the frame the new image holds):
//
//      t/turn     0.00  0.16  0.31  0.47  0.63  0.78  0.94
//      progress   0.005 0.042 0.136 0.494 0.861 0.950 0.994
//
//  — a hard S, which is the preset's own authored bezier [0.86, 0.14, 0.14,
//  0.86] (Wipe 01/02) and [0.33, 0, 0, 1] (Wipe 03/04), read from the store's
//  bezPerModeBaseline. The scene easing drives it, so changing the curve
//  changes the wipe the way it does over there.
//
//  Reference presets, from paramsPerModeBaseline:
//    Wipe 01: count 5, direction up,    imageFit fill, planeSize 100, scale 4, delay 0
//    Wipe 02: count 5, direction right, imageFit fill, planeSize 100, scale 4, delay 0
//    Wipe 03: count 5, direction down,  imageFit fit,  planeSize 68,  scale 0, delay 1
//    Wipe 04: count 5, direction left,  imageFit fit,  planeSize 68,  scale 0, delay 1
//
//  `feather` (soft edge) is 0 on all four, so it is not modelled — a soft
//  wipe edge needs a gradient mask the renderer has no field for, and adding
//  one for a value no shipped preset uses would be speculative. `scale` [0,25]
//  is modelled as a slow push on the revealed image, which is the reading its
//  name and range support; it could not be isolated by measurement, because
//  this environment never re-renders after a parameter change.
// ============================================================

const wipeReveal: Template = {
  meta: {
    id: 'wipe-r01', name: 'Wipe 01', group: 'Wipe', isNew: true,
    cardAspect: 'canvas',
    defaultEasing: { id: 'custom', bezier: [0.86, 0.14, 0.14, 0.86] },
  },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 20, step: 1,   default: 5 },
    { key: 'direction',    label: 'Direction',     type: 'pills',  options: ['up','down','left','right'], default: 'up' },
    { key: 'fit',          label: 'Fit',           type: 'pills',  options: ['fill','fit'],    default: 'fill', section: 'Layout' },
    { key: 'planeSize',    label: 'Plane Size',    type: 'slider', min: 10, max: 200, step: 1, default: 100, unit: '%', description: '100% exactly covers the frame.' },
    { key: 'scale',        label: 'Scale',         type: 'slider', min: 0, max: 25, step: 1,   default: 4, unit: '%', section: 'Motion', description: 'A slow push on the image while it is revealed.' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 0 },
    { key: 'seconds',      label: 'Seconds',       type: 'slider', min: 0.2, max: 6, step: 0.01, default: 1.67, section: 'Motion', description: 'How long one image holds the frame.' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const n = Math.max(1, Math.round(count));
    // The reference's clip is duration x count, so its `seconds` is per-image.
    // Quantized to whole turns across OUR clip so the loop closes exactly
    // however long the scene is.
    const turns = Math.max(1, Math.round(ctx.duration / Math.max(0.05, v.seconds)));
    const pointer = (frame / ctx.totalFrames) * turns;      // images elapsed
    const active = Math.floor(pointer) % n;                 // whose turn it is
    const progress = ctx.ease(pointer - Math.floor(pointer)); // its reveal, eased

    // Where this card sits in the cycle: 0 = revealing now, 1 = the one being
    // covered, higher = already buried.
    const age = ((active - index) % n + n) % n;

    const fill = v.fit !== 'fit';
    const size = fill
      ? (Math.max(ctx.width, ctx.height) / BASE) * 1.0
      : (Math.max(ctx.width, ctx.height) / BASE) * (clamp(v.planeSize, 1, 400) / 100);

    // `scale` pushes the image slowly while it holds the frame, easing out as
    // the next one takes over.
    const push = 1 + (clamp(v.scale, 0, 100) / 100) * (age === 0 ? progress : 1);

    const base = {
      x: v.offset.x,
      y: v.offset.y,
      scale: size * push,
      rotation: 0,
      alpha: 1,
      depth: -age,          // the revealing card sits on top
    };

    if (age === 0) {
      // Being revealed: a straight edge uncovers it over its own card box.
      const p = clamp(progress, 0, 1);
      const clip = v.direction === 'up' ? { x0: 0, y0: 1 - p, x1: 1, y1: 1 }
        : v.direction === 'down' ? { x0: 0, y0: 0, x1: 1, y1: p }
        : v.direction === 'left' ? { x0: 1 - p, y0: 0, x1: 1, y1: 1 }
        : { x0: 0, y0: 0, x1: p, y1: 1 };
      return { ...base, clip };
    }
    // Everyone else is whole; only the top two are ever visible, and the rest
    // sit behind them costing nothing but a draw.
    return { ...base, alpha: age <= 1 ? 1 : 0 };
  },
};

function preset(id: string, name: string, patch: Record<string, any>, easing: EasingSpec): Template {
  const t = variant(wipeReveal, id, name, patch);
  return { ...t, meta: { ...t.meta, defaultEasing: easing } };
}

const EASE_12: EasingSpec = { id: 'custom', bezier: [0.86, 0.14, 0.14, 0.86] };
const EASE_34: EasingSpec = { id: 'custom', bezier: [0.33, 0, 0, 1] };

export const wipeRevealVariants: Template[] = [
  wipeReveal, // Wipe 01 — up, full bleed
  preset('wipe-r02', 'Wipe 02', { direction: 'right' }, EASE_12),
  preset('wipe-r03', 'Wipe 03', { direction: 'down', fit: 'fit', planeSize: 68, scale: 0 }, EASE_34),
  preset('wipe-r04', 'Wipe 04', { direction: 'left', fit: 'fit', planeSize: 68, scale: 0 }, EASE_34),
];
