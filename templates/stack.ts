import type { Template } from '@/lib/types';
import { frac, clamp, smooth, loopCycles } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// Stack — a perspective deck: the front card lifts away while the ones behind
// advance forward one slot. Rebuilt from the reference model (learnings/STACK.md):
// a stepped pointer advances one card per step, and each follower moves on its
// OWN staggered, eased timeline (anticipation) — so the deck reads card-by-card
// rather than as a rigid block. The exiting card stays opaque and fades only in
// the last 10% of its travel (no fade-from-top, no hard cut).
const stack: Template = {
  meta: { id: 'stack-01', name: 'Shuffle 01', group: 'Shuffle', defaultEasing: { id: 'smooth' } },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['down','up'], default: 'down' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 20, step: 1,   default: 6 },  // pool that cycles
    { key: 'visible',      label: 'Visible',       type: 'slider', min: 2, max: 8, step: 1,    default: 3 },  // cards shown in the stack
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 800, step: 1, default: 300 },
    { key: 'zoom',         label: 'Zoom',          type: 'slider', min: 50, max: 300, step: 1, default: 100 }, // whole-deck scale %
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 12 },
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 0, max: 1000, step: 1, default: 0 }, // extra vertical gap between slots
    { key: 'stagger',      label: 'Stagger',       type: 'slider', min: 0, max: 0.5, step: 0.01, default: 0.14 }, // per-card delay
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 4, step: 0.1,  default: 0.6 }, // steps/sec
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const n = Math.max(1, Math.round(count));
    const dir = v.direction === 'up' ? -1 : 1;
    const sizeFactor = (v.cardSize / BASE) * ((v.zoom ?? 100) / 100); // zoom scales the whole deck
    const stepY = v.cardSize * 0.31 + v.perspective * 0.30;   // px gap between stacked slots
    const vis = Math.min(Math.round(v.visible), n);

    // Stepped pointer: advances one card per (1/speed) seconds. The cycle
    // repeats every `n` steps — loop-lock to whole deck rotations per clip.
    const pointer = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, n);
    const base = Math.floor(pointer);
    const s = frac(pointer);                                  // progress through the current step, 0..1

    const exitFrac = 0.35;                                    // front card leaves in the first 35% of the step
    const fadeStart = 0.9, fadeWin = 1 - fadeStart;           // fade only in the last 10% of travel
    const stag = v.stagger;

    const L = ((index - base) % n + n) % n;                   // integer slot at step start (0 = front)

    // Continuous slot `cs` (L → L-1). The front card exits fast; followers each
    // ease in on their own delayed timeline → individual, staggered motion.
    let cs: number;
    if (L === 0) {
      cs = -clamp(s / exitFrac, 0, 1);                        // 0 → -1 quickly
    } else {
      const d = (L - 1) * stag;                               // cards nearer the front move first
      const local = clamp((s - d) / Math.max(0.05, 1 - d), 0, 1);
      cs = L - ctx.ease(local);                               // eased by the scene curve
    }

    let y: number, scale: number, alpha: number, depth: number;
    if (cs < 0) {                                             // EXITING — descend opaque, fade only at the very end
      const ex = -cs;                                         // 0..1
      alpha = ex < fadeStart ? 1 : 1 - smooth((ex - fadeStart) / fadeWin);
      y = dir * (ex * stepY);
      scale = sizeFactor * (1 + ex * 0.02);
      depth = 3000;                                           // in front while leaving
    } else if (cs <= vis) {                                   // VISIBLE STACK — front larger, back smaller & higher
      scale = sizeFactor * (1 - cs * 0.07);
      y = dir * (-cs * stepY);
      alpha = 1;
      depth = 2000 - cs * 10;
    } else if (cs <= vis + 1) {                               // ENTERING from the back (mirror of the exit fade)
      const slot = Math.min(cs, vis);
      const ep = (vis + 1) - cs;                              // 0 (appearing) .. 1 (in the stack)
      scale = sizeFactor * (1 - slot * 0.07);
      y = dir * (-slot * stepY);
      alpha = ep < fadeWin ? smooth(ep / fadeWin) : 1;
      depth = 2000 - slot * 10;
    } else {                                                  // hidden
      return { x: v.offset.x, y: v.offset.y, scale: 0, rotation: 0, alpha: 0, depth: -1 };
    }

    return {
      x: v.offset.x,
      y: y + v.offset.y,
      scale,
      rotation: 0,
      alpha,
      depth,
    };
  },
};

// Stack 03/04 fill out the reference's 4-preset family (it ships exactly one
// more LOOK beyond Stack 01/02 — denser, faster, no stagger — offered in both
// directions, which is also how 01/02 pair up over there). Its own numbers
// don't convert 1:1 into ours: its `planeSize`/`zoom` are canvas-relative
// percentages (confirmed by reading its live card rect — 38%*150% zoom = the
// measured 615.6px on a 1080px stage, exactly), where ours is a literal
// on-screen px `cardSize`; and Shuffle 01/02 here were themselves never a
// pixel-measured port of the reference's Stack 01/02 (300px vs. what that same
// formula gives Stack 01, ~460px here). Rather than snap 03/04 onto a scale
// neither existing preset uses, they carry over the reference's RELATIVE move
// off its own Stack 01 — about double the visible cards, tighter zoom-in, no
// stagger, a faster step — applied on top of Shuffle 01/02's own scale.
export const stackVariants: Template[] = [
  stack, // Stack 01 — deck advance with anticipation
  variant(stack, 'stack-02', 'Shuffle 02', {
    visible: 4, stagger: 0.24, perspective: 0, speed: 0.4,
  }),
  variant(stack, 'stack-03', 'Shuffle 03', {
    visible: 6, cardSize: 220, zoom: 180, cornerRadius: 0, perspective: 90, stagger: 0, speed: 0.85,
  }),
  variant(stack, 'stack-04', 'Shuffle 04', {
    direction: 'up', visible: 6, cardSize: 220, zoom: 180, cornerRadius: 0, perspective: 90, stagger: 0, speed: 0.85,
  }),
];
