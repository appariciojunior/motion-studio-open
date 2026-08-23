import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { clamp, lerp, loopCycles } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// ============================================================
//  BLOOM — full-frame images that take the frame by SCALE
//
//  Takeover pushes the incoming image in from an edge. Dive holds one image and
//  Ken-Burns-zooms it with a cross-fade. Bloom is the third case: the image
//  arrives by growing, dead centre, and hard-covers what was there — no travel,
//  no dissolve. The whole family is one axis: size.
//
//  Measured on the reference tool, which is what pins the two styles down. Every
//  card sits at the canvas centre (540,720 on its 1080x1440 stage) and only its
//  size changes:
//
//  · bloom  — the newest card enters at 719/1080 = 66% and grows to full, so it
//    swallows the frame. Older cards sit behind, already at full size.
//  · recede — the newest enters AT full size and shrinks away, measured down
//    through 1052, 983, 848, 586, 174 before it leaves.
//
//  Cadence is two separate numbers, and conflating them is the easy mistake:
//  `stagger` is the gap between entries and `duration` is how long one card
//  takes to finish growing. On the reference base they are 0.4s and 2s, so five
//  cards are mid-growth at any moment and ten enter over the 4s clip — exactly
//  its `count`. Here that is `speed` (entries/sec) and `grow` (turns to finish).
//
//  Seamless loop: `loopCycles` locks the clip to a whole number of `count`-long
//  lifecycles, the same guarantee Dive and Shuffle make, so the card that owns
//  the frame at frame 0 owns it again at frame totalFrames.
// ============================================================

const bloom: Template = {
  meta: {
    id: 'bloom-01',
    name: 'Bloom 01',
    group: 'Bloom',
    // The reference curve: an instant start and a very long settle.
    defaultEasing: { id: 'custom', bezier: [0, 0, 0, 0.99] },
    cardAspect: 'canvas',
    repeatAssets: true,
  },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 20, step: 1,     default: 10 },
    { key: 'style',        label: 'Style',         type: 'pills',  options: ['bloom','recede'],  default: 'bloom', section: 'Motion', description: 'bloom grows in to cover; recede starts full and shrinks away.' },
    { key: 'growFrom',     label: 'Grow From',     type: 'pills',  options: ['center','bottom'], default: 'center', section: 'Layout' },
    { key: 'planeSize',    label: 'Plane Size',    type: 'slider', min: 20, max: 120, step: 1,   default: 100, unit: '%', description: 'Full size as a share of the frame.' },
    { key: 'startScale',   label: 'Start Scale',   type: 'slider', min: 0, max: 100, step: 1,    default: 12, unit: '%', visibleWhen: { key: 'style', equals: 'bloom' }, description: 'Size an image enters at before it grows.' },
    { key: 'grow',         label: 'Grow Turns',    type: 'slider', min: 1, max: 10, step: 0.1,   default: 5, section: 'Motion', description: 'Turns an image takes to finish. Above 1, images overlap.' },
    { key: 'spin',         label: 'Spin',          type: 'slider', min: -90, max: 90, step: 1,   default: 0, section: 'Motion', unit: '°', description: 'Rotation unwound over the growth.' },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,    default: 0, section: 'Finish', unit: '%' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,    default: 0 },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0.2, max: 6, step: 0.05, default: 2.5 }, // entries/sec
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    // Lifecycle w ∈ [0, count): 0 = this image just entered. Period is `count`
    // so the clip covers whole lifecycles and the loop closes.
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count);
    const w = (((phase - index) % count) + count) % count;

    // `grow` turns to finish, so age runs 0 → 1 over that many turns and then
    // clamps: a bloomed card parks at full size instead of overshooting.
    const span = Math.max(0.001, v.grow);
    const age = clamp(w / span, 0, 1);

    // Fitted to the reference's measured card widths, not guessed. Its curve is
    // bezier [0,0,0,0.99], i.e. y = 2.97t² - 1.97t³ over x = t³, and bloom is
    // that curve run FORWARD from `startScale`:
    //     progress 0.4 → 913px predicted vs 915 measured
    //     progress 0.6 → 1014 vs 1018
    //     progress 0.8 → 1064 vs 1067
    // Recede is the same curve run BACKWARD — not one minus it. That distinction
    // is the whole character: one minus it puts a card at 38% a fifth of the way
    // through its life, where the reference measured 97%. Recede barely moves at
    // first and then drops away fast; inverting the wrong way makes it collapse
    // instantly and then crawl.
    const full = v.planeSize / 100;
    const start = v.startScale / 100;
    const recede = v.style === 'recede';

    // `settle` runs 0 → 1 across a card's life in whichever direction its style
    // means, so spin and fade read the same for both and only `s` differs.
    const settle = recede ? 1 - ctx.ease(1 - age) : ctx.ease(age);
    const s = recede ? full * (1 - settle) : full * lerp(start, 1, settle);

    // A card is done once it has left its growth window. Bloom parks at full
    // size and keeps covering; recede has scaled to nothing and is spent.
    const spent = recede && age >= 1;

    // `bottom` pins the card's bottom edge to the frame's, so growth reads as
    // rising out of the floor rather than opening from the middle.
    const cardH = ctx.height * s;
    const y = v.growFrom === 'bottom' ? (ctx.height - cardH) / 2 : 0;

    const alpha = spent ? 0 : 1 - (v.fade / 100) * (1 - settle);
    const rotation = ((v.spin * (1 - settle)) * Math.PI) / 180;

    // The renderer normalizes a sprite's LONG edge, and a full-bleed card is
    // cropped to the canvas — so covering the frame means matching the canvas's
    // long edge, not its height. Using the height works only while the canvas is
    // portrait; on 4:3 it left a 270px band and on 16:9 a 472px one.
    const longEdge = Math.max(ctx.width, ctx.height);

    return {
      x: v.offset.x,
      y: y + v.offset.y,
      scale: (longEdge / BASE) * s,
      rotation,
      alpha,
      // Newest in front: bloom must cover as it grows, and recede must be the
      // thing that shrinks away rather than something hidden behind.
      depth: -w,
    };
  },
};

// `variant` only patches control defaults; a preset with its own curve needs
// `meta` patched too.
function preset(id: string, name: string, patch: Record<string, any>, easing: EasingSpec): Template {
  const t = variant(bloom, id, name, patch);
  return { ...t, meta: { ...t.meta, defaultEasing: easing } };
}

export const bloomVariants: Template[] = [
  bloom,
  // Recede's window is measurably shorter than bloom's. Solving the mirrored
  // curve against its measured widths pins the span at 1.88s rather than 2.0s,
  // which at 2.5 entries/sec is 4.7 turns — that one number takes the worst
  // deviation from 85px down to 12px on a 1080px frame.
  preset('bloom-02', 'Bloom 02', { style: 'recede', grow: 4.7 }, { id: 'custom', bezier: [0, 0, 0, 0.99] }),
  preset('bloom-03', 'Bloom 03', { spin: -45 }, { id: 'expoOut' }),
  // The reference preset behind this one runs a 4s clip at 0.6s between
  // entries, so it holds ~6.7 turns of growth rather than 5.
  preset('bloom-04', 'Bloom 04', { growFrom: 'bottom', grow: 6.5, speed: 1.67 }, { id: 'ease' }),
];
