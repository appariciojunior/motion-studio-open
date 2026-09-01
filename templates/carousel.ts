import type { Template, LayerTransform, TransformCtx } from '@/lib/types';
import { clamp, frac, loopCycles, smooth } from '@/lib/motion';
import { cardPath } from '@/lib/cardPath';
import type { EasingSpec } from '@/lib/easing';
import { variant } from './variant';

// Reference size (px) shared with the renderer's sprite normalization, so that
// `cardSize` reads directly in on-screen pixels.
const BASE = 340;

// ============================================================
//  Runway — the reference's Carousel, transcribed from its own scene
//
//  Everything below stated as "the reference does X" was read out of its
//  renderer rather than inferred from screenshots: its bundle ships the whole
//  carousel branch in the clear, and the preset numbers come from its own
//  `paramsPerModeBaseline`.
//
//  Three things make this family what it is, and this port used to have only
//  the first: a strip that STEPS one slot at a time (moving for part of the
//  beat and resting for the rest), a per-card STAGGER that turns that step into
//  a wave running down the strip, and a size that either bulges at the middle
//  (scaleFocus center) or ramps across the whole strip (start / end).
// ============================================================

/** Card width and height in px, honouring whichever edge the renderer normalized. */
function cardBox(cardSize: number, aspect: number) {
  return aspect >= 1
    ? { w: cardSize, h: cardSize / aspect }
    : { w: cardSize * aspect, h: cardSize };
}

interface RunwayPose {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  alpha: number;
  skew: number;
  axisPos: number;    // signed distance from the middle along the travel axis, px
  horiz: boolean;
  depth: number;
}

function runwayPose(
  frame: number, index: number, count: number,
  v: Record<string, any>, ctx: TransformCtx,
): RunwayPose {
  const horiz = v.direction === 'left' || v.direction === 'right';
  // The reference's `up` and `left` are its two forward directions; both run the
  // strip toward the negative side of their axis.
  const dir = (v.direction === 'left' || v.direction === 'up') ? 1 : -1;

  const sizeFactor = v.cardSize / BASE;
  const pitch = v.gap * sizeFactor;                               // centre-to-centre px
  const aspect = ctx.cardAspect ?? 3 / 4;
  const box = cardBox(v.cardSize, aspect);
  const axisExtent = horiz ? box.w : box.h;                       // the reference's `planeSize`

  // ---- Stepped, staggered phase -------------------------------------------
  // The reference advances a card by exactly one slot per beat: it eases across
  // the first `duration` seconds of the beat and then stands still for the rest,
  // and it shifts each card's clock by `stagger`, so the step runs down the
  // strip as a wave instead of a block. `loopCycles` pins the beat to a whole
  // number of slots per clip, which is what keeps the wave seamless at the loop.
  //
  // Two periods, and conflating them is what made this port run a quarter fast.
  // A SLOT advance — the strip moving on by one place — takes `T`. A CARD step
  // takes `T - stagger`, because each card starts one stagger after the card
  // ahead of it and the strip only settles once the last one lands. `T` is what
  // the eye reads as the beat; the card period is what the maths runs on.
  const stagger = Math.max(0, v.stagger ?? 0);
  // A staggered strip only repeats once the WHOLE SET has gone by: the wave is
  // keyed to a card's place along the strip, so a single slot advance leaves
  // every clock offset by one stagger. Unstaggered, one slot is enough. Getting
  // this wrong does not look like a phase error, it looks like a jump cut at the
  // loop point.
  const steps = loopCycles(v.speed, ctx.duration, count);
  const laps = Math.abs(steps);
  const slotSeconds = laps > 0 ? ctx.duration / laps : 0;               // T
  const cardSeconds = Math.max(1e-4, slotSeconds - stagger);
  // `laps` is quantized to a complete card set. Advancing directly through it
  // makes frame totalFrames identical to frame 0 for every individual asset;
  // the recovered WIP divided by cardSeconds here and ended one slot late.
  const base = laps > 0 ? frac(frame / ctx.totalFrames) * laps : 0;
  const staggerPhase = stagger / cardSeconds;

  // The reference lays the strip out as repeating COPIES and keys the stagger to
  // a card's place along that unrolled strip, not to its slot number — which is
  // the whole point, since the wave has to keep running as cards recycle. This
  // port draws each card once and wraps it instead, so it has to pick the copy
  // the card is currently standing in and stagger by THAT. Keying it to `index`
  // freezes the wave to the slot list and every staggered preset drifts.
  const march = dir * base;
  const slot = index + count * Math.round((march - index) / Math.max(1, count));
  // ...and the reference centres the strip by an integer number of slots, which
  // shifts which copy sits in the middle and therefore where the wave is.
  const visible = pitch > 0 ? clamp(Math.round((horiz ? ctx.width : ctx.height) / pitch), 1, count) : count;
  const middle = Math.floor(visible / 2);
  const lag = dir > 0 ? slot + middle : (count - 1 - slot + middle);

  const pc = base - lag * staggerPhase;
  const move = 1 - clamp((v.hold ?? 0) / 100, 0, 0.95);
  // Move first, then rest — the reference's own order. f(n) = n at every integer
  // either way, so the loop still closes.
  const advance = Math.floor(pc) + (move <= 0 ? 1 : ctx.ease(clamp(frac(pc) / move, 0, 1)));

  // gap:1 → the path carries the raw signed slot offset, folded into a window
  // centred on the middle of the frame.
  const path = cardPath({ kind: 'line', index: slot, count, phase: dir * advance, gap: 1, wrap: true });
  const offset = path.x;
  const raw = offset * pitch;                                     // px, before the focus push

  // ---- Featuredness --------------------------------------------------------
  // Two different shapes, and the reference picks between them on `scaleFocus`.
  // `center` is a BULGE: a card is only bigger while it is within one pitch of
  // the middle. `start` / `end` is a RAMP that runs monotonically across the
  // whole strip, so the far end comes out SMALLER than base rather than equal
  // to it — which is why porting it as a shifted bulge read wrong.
  const big = Math.max(1, v.bigScale / 100);
  const featured = v.bigScale > 100;
  const ramped = featured && v.scaleFocus !== 'center';
  const towards = v.scaleFocus === 'start' ? -1 : 1;
  const reach = pitch * Math.max(1, (count - 1) / 2);
  let grow: number;
  if (ramped) {
    grow = Math.max(0.1, 1 + (big - 1) * clamp(towards * raw / reach, -1, 1));
  } else {
    const k = featured && pitch > 0 ? Math.max(0, 1 - Math.abs(raw) / pitch) : 0;
    grow = 1 + (big - 1) * k;
  }

  // A ramp makes one end of the strip bigger than the other, so an even pitch
  // would let the big end collide. The reference opens the spacing out with a
  // quadratic push away from the middle, capped so it can never fold the strip.
  const push = ramped && pitch > 0
    ? clamp(axisExtent * (big - 1) * towards / pitch, -0.9, 0.9)
    : 0;
  const spread = (q: number) => {
    const a = Math.abs(q);
    return a <= reach ? (q * q) / (2 * reach) : a - reach / 2;
  };
  const axisPos = raw + push * spread(raw);

  // ---- Tilt ----------------------------------------------------------------
  // The reference's tilt is a ROLL IN THE PLANE — its scene calls ctx.rotate —
  // and it scales with how far across the FRAME the card has travelled, not with
  // its slot index. Its own slider is 0-100 over 60 degrees; this one is in
  // degrees, so the ports convert on the way in.
  const halfAxis = Math.max(1, (horiz ? ctx.width : ctx.height) / 2);
  const across = clamp(axisPos / halfAxis, -1, 1);
  const lean = (v.tiltAmount * Math.PI) / 180;
  const rotation =
    v.tiltStyle === 'fan' ? lean * across :
    v.tiltStyle === 'uniform' ? lean * Math.abs(across) :
    v.tiltStyle === 'alternate' ? lean * across * (index % 2 === 0 ? 1 : -1) : 0;

  // ---- Perspective (ours, not the reference's — every port runs it at 0) ----
  const persp = v.perspective / 100;
  const scale = sizeFactor * grow * (1 - (1 - path.depthNorm) * 0.35 * persp);
  const skew = -Math.sign(offset) * (1 - path.depthNorm) * 0.18 * persp;

  // ---- Fade ----------------------------------------------------------------
  // Distance is measured against HALF THE FRAME, not against the slot count, and
  // it is shaped by the scene curve — both straight out of the reference. It
  // stays on alpha rather than `dim`: the reference paints the background colour
  // under the card and blends the image into that, which for a card overlapping
  // nothing is the same picture alpha gives, while `dim` can only go to black.
  let alpha = v.fade > 0 ? Math.max(0, 1 - ctx.ease(Math.abs(across)) * (v.fade / 100)) : 1;

  // A wrapped card teleports from one end of the strip to the other. Make that
  // hand-off transparent even when a small gap keeps the final slot inside the
  // canvas; otherwise the recycle reads as a pop. (The reference draws repeating
  // copies instead, so its strip has no seam to hide; in every ported preset the
  // seam sits well outside the frame and this costs nothing.)
  if (count > 1) alpha *= smooth(clamp((count / 2 - Math.abs(offset)) / 0.7, 0, 1));

  // Outer fade: as the card starts leaving the frame, fade it out — fully
  // transparent by the time it has fully exited. Ours; the reference simply
  // culls at the edge, so every port runs this at 0.
  const cardHalf = (horiz ? box.w : box.h) * grow / 2;
  const leaving = Math.abs(axisPos + (horiz ? v.offset.x : v.offset.y)) - (halfAxis - cardHalf);
  if (leaving > 0 && v.outerFade > 0) {
    const t = Math.min(1, leaving / Math.max(1, cardHalf * 2));
    alpha *= 1 - (v.outerFade / 100) * (t * t * (3 - 2 * t));
  }

  return {
    x: (horiz ? axisPos : 0) + v.offset.x,
    y: (horiz ? 0 : axisPos) + v.offset.y,
    scale, rotation, alpha, skew, axisPos, horiz,
    // Nearest the middle draws on top, which is what lets a featured card
    // overlap its neighbours instead of being buried by them.
    depth: 1 - Math.min(1, Math.abs(axisPos) / halfAxis),
  };
}

/**
 * The reference's `solo`: instead of a strip it keeps only the card currently
 * closest to the middle, so one image slides through the frame at a time. That
 * is a different read from a strip rather than a variation on one, and two of
 * its eighteen presets are built on it.
 */
function nearestSlot(
  frame: number, count: number, v: Record<string, any>, ctx: TransformCtx,
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let j = 0; j < count; j++) {
    const d = Math.abs(runwayPose(frame, j, count, v, ctx).axisPos);
    if (d < bestDist) { bestDist = d; best = j; }
  }
  return best;
}

export const carousel: Template = {
  meta: {
    id: 'carousel', name: 'Runway', group: 'Runway',
    // Deliberately NOT `engine: 'webgl'`. This family spent a while on the 3D
    // path, which cost every card 30% of its black (a lit material carrying an
    // emissive term) in exchange for a depth it never uses: its tilt is a roll
    // IN the plane, which the sprite path does natively, and all eighteen ports
    // run Perspective at 0. Flat art, colour 1:1.
    defaultEasing: { id: 'glide' },
  },

  controls: [
    // Four-way direction (as in the reference tool): left/right run the strip
    // horizontally, up/down run it vertically. Axis + travel sign in one control.
    { key: 'direction',    label: 'Direction',     type: 'pills', options: ['left','right','up','down'], default: 'left' },
    { key: 'display',      label: 'Show',          type: 'pills', options: ['strip','single'], default: 'strip',
      description: 'single keeps only the card nearest the middle — one image slides through the frame at a time.' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 1, max: 12, step: 1,   default: 6 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 800, step: 1, default: 340 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 12 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0, max: 600, step: 1,  default: 360 }, // px between card centres (at base size)
    { key: 'bigScale',     label: 'Big Scale',     type: 'slider', min: 100, max: 200, step: 1, default: 120 }, // featured card size %
    { key: 'scaleFocus',   label: 'Scale Focus',   type: 'pills', options: ['center','start','end'], default: 'center',
      description: 'center bulges the middle card; start and end ramp the size across the whole strip.' },
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 0, max: 200, step: 1,  default: 0 },
    { key: 'tiltStyle',    label: 'Tilt Style',    type: 'pills', options: ['off','fan','uniform','alternate'], default: 'off' },
    { key: 'tiltAmount',   label: 'Tilt Amount',   type: 'slider', min: -60, max: 60, step: 1,  default: 8, section: 'Depth', unit: '°', visibleWhen: { key: 'tiltStyle', not: 'off' }, description: 'Rolls the card in the plane, by how far across the frame it has travelled. Signed: the sign is which way it leans.' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,  default: 0 },   // fade with distance from the middle %
    { key: 'outerFade',    label: 'Outer Fade',    type: 'slider', min: 0, max: 100, step: 1,  default: 100 }, // fade out while leaving the frame %
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 4, step: 0.01, default: 0.6, precision: 2 }, // slots/sec
    { key: 'stagger',      label: 'Stagger',       type: 'slider', min: 0, max: 0.5, step: 1 / 60, default: 0, unit: 's', precision: 2, section: 'Motion',
      description: 'Delay between one slot starting its step and the next — turns the step into a wave down the strip.' },
    { key: 'hold',         label: 'Hold',          type: 'slider', min: 0, max: 90, step: 1,   default: 0, unit: '%', section: 'Motion',
      description: 'Share of each step spent standing still after arriving.' },
  ],

  transform: (frame, index, count, v, ctx): LayerTransform => {
    const p = runwayPose(frame, index, count, v, ctx);
    // In `single` the reference draws that one card plain: no fade, no roll.
    if (v.display === 'single') {
      const keep = nearestSlot(frame, count, v, ctx) === index;
      return {
        x: p.x, y: p.y, scale: p.scale, rotation: 0,
        alpha: keep ? 1 : 0, skewX: 0, skewY: 0, depth: 1,
      };
    }
    return {
      x: p.x,
      y: p.y,
      scale: p.scale,
      rotation: p.rotation,
      alpha: p.alpha,
      skewX: p.horiz ? p.skew : 0,
      skewY: p.horiz ? 0 : p.skew,
      depth: p.depth,
    };
    // cornerRadius is applied where the sprite mask is built, not here.
  },
};

// ============================================================
//  Reference-catalogue presets (Carousel 01–18)
//
//  SIZING, verified by running the reference's own carousel scene against its
//  own preset table and reading the card rects back out:
//
//    `planeSize` is the card's extent ALONG THE TRAVEL AXIS, not its long edge.
//      vertical    600 -> 450 x 600   (planeSize is the height)
//      horizontal  546 -> 546 x 728   (planeSize is the WIDTH; the card is taller)
//
//  This project's `cardSize` is the LONG edge and its canvas is the reference's
//  scaled by 0.75, so the two axes convert differently — which is why every
//  horizontal preset here used to ship a quarter too small:
//
//    vertical    cardSize = 0.75 * planeSize   gap = BASE        * (1 + gapRef/planeSize)
//    horizontal  cardSize =        planeSize   gap = BASE * 0.75 * (1 + gapRef/planeSize)
//
//  Both land the same pitch, 0.75 * (planeSize + gapRef) — which is what the
//  reference's own rects give: 600+40 comes out 640 apart, 546+40 comes out 586.
//
//  CADENCE. The reference's beat is NOT its `duration`; that is only the moving
//  part. One slot advance takes `duration + count*stagger + delay`, and its clip
//  is `(that + stagger) * cycles * count`, so the beat over a whole clip is
//  clip/count. Twelve of the eighteen carry a stagger, and therefore a rest,
//  that this port used to drop — which left them running a quarter too fast and
//  as a rigid block instead of a wave.
// ============================================================

interface RefCarousel {
  planeSize: number;
  gap: number;
  axis?: 'vertical' | 'horizontal';
  reverse?: boolean;
  /** Reference `centerScale`, applied only when its `scaleCenter` is on. */
  centerScale?: number;
  focus?: 'center' | 'start' | 'end';
  /** Reference `tilt`, 0-100 over 60 degrees. */
  tilt?: number;
  /** Reference `depthFade`, %. */
  fade?: number;
  /** Reference `duration` — the MOVING part of one slot advance, in seconds. */
  move: number;
  /** Reference `stagger`, seconds between one slot starting and the next. */
  stagger?: number;
  /** Reference `delay`, seconds of rest on top of the move. */
  delay?: number;
  /** Reference `solo`: one card in frame at a time instead of a strip. */
  single?: boolean;
}

const REF_COUNT = 6;      // every one of the eighteen ships count 6
const REF_SCALE = 0.75;   // the reference stages 1080x1440; this project 810x1080

/** The clip length the reference computes for one of these presets, in seconds. */
export function refCarouselSeconds(r: RefCarousel): number {
  const stagger = r.stagger ?? 0;
  const beat = r.move + REF_COUNT * stagger + (r.delay ?? 0);
  return (beat + stagger) * REF_COUNT;
}

function refCarousel(r: RefCarousel): Record<string, any> {
  const vertical = (r.axis ?? 'vertical') === 'vertical';
  const step = refCarouselSeconds(r) / REF_COUNT;      // seconds per SLOT advance
  // ...and per CARD step, which is the one the reference eases across.
  const card = r.move + REF_COUNT * (r.stagger ?? 0) + (r.delay ?? 0);
  return {
    // Reference `up`/`left` are its two forward directions on each axis.
    direction: vertical ? (r.reverse ? 'down' : 'up') : (r.reverse ? 'right' : 'left'),
    display: r.single ? 'single' : 'strip',
    cardSize: Math.round(vertical ? REF_SCALE * r.planeSize : r.planeSize),
    gap: Math.round(BASE * (vertical ? 1 : REF_SCALE) * (1 + r.gap / r.planeSize)),
    // `scaleCenter: off` in the reference keeps centerScale stored but inert, so
    // an absent centerScale here means a flat strip — no featured card.
    bigScale: Math.round((r.centerScale ?? 1) * 100),
    scaleFocus: r.focus ?? 'center',
    tiltStyle: r.tilt ? 'alternate' : 'off',
    // Its slider is 0-100 over 60 degrees; ours is in degrees, and SIGNED — its
    // two tilted presets both author -25, and dropping the sign leans every card
    // the wrong way, a 30 degree error where the roll is widest.
    tiltAmount: Math.round((r.tilt ?? 0) * 0.6),
    fade: r.fade ?? 0,
    // The reference culls a card at the frame edge rather than fading it out.
    outerFade: 0,
    cornerRadius: 0,
    perspective: 0,
    speed: Math.round((1 / step) * 100) / 100,
    stagger: r.stagger ?? 0,
    hold: Math.round((1 - r.move / step) * 100),
  };
}

function refPreset(id: string, name: string, r: RefCarousel, easing: EasingSpec): Template {
  const t = variant(carousel, id, name, refCarousel(r));
  return { ...t, meta: { ...t.meta, defaultEasing: easing, cardAspect: 3 / 4 } };
}

const GLIDE: EasingSpec = { id: 'glide' };
const LINEAR: EasingSpec = { id: 'linear' };
const SMOOTH: EasingSpec = { id: 'smooth' };
const FLOW: EasingSpec = { id: 'flow' };

// This family's own presets. They lived inline in templates/index.ts, which made
// Runway the only family whose presets were declared outside its own file — and
// invisible to scripts/genExportSources.mjs, since that walks templates/*.ts and
// skips index.ts. So "export scene as code" silently omitted Runway 02-05.
/** Keeps a preset addressable for saved scenes while taking it out of the pickers. */
const hidden = (t: Template): Template => ({ ...t, meta: { ...t.meta, catalogHidden: true } });

export const carouselVariants: Template[] = [
  { ...carousel, meta: { ...carousel.meta, name: 'Runway 01' } },
  // Runway 02 and 03 are WITHDRAWN from the catalogue. Both were written here
  // rather than ported, and both had a pitch narrower than the card, so their
  // strips piled up instead of travelling — 02 buried two thirds of every
  // neighbour. Neither of the three tools this family is modelled on can even
  // express that (all three add a separation TO the card, so the tightest strip
  // they can build is cards touching), and with the pitch corrected 02 landed on
  // the same look as the ported Runway 08 while 03 landed near Runway 01. So
  // there was nothing left for them to be that the ports do not already cover.
  //
  // Withdrawn, not deleted: `catalogHidden` keeps them out of every picker while
  // a scene somebody already saved on one of them still loads. Their values are
  // left corrected rather than broken for exactly that reason. Same treatment
  // globe.ts gives its own legacy pair.
  hidden(variant(carousel, 'carousel-02', 'Runway 02', {
    gap: 340, bigScale: 145, perspective: 0, fade: 45, speed: 0.4,
  })),
  hidden(variant(carousel, 'carousel-03', 'Runway 03', {
    tiltStyle: 'fan', tiltAmount: 10, gap: 440, bigScale: 130, speed: 0.5,
  })),
  variant(carousel, 'carousel-04', 'Runway 04', {
    // Same floor again: 260 buried a quarter of every card.
    scaleFocus: 'start', bigScale: 160, gap: 400, fade: 30, direction: 'right',
  }),
  variant(carousel, 'carousel-05', 'Runway 05', {
    tiltStyle: 'alternate', tiltAmount: 6, direction: 'up', gap: 420, cornerRadius: 24,
  }),
];

/**
 * The reference's own eighteen, keyed by the name they ship under here. Exported
 * because scripts/verify-reference.cjs asserts the ports against these numbers
 * and store/useSceneStore pins each preset's clip to the length the reference
 * computes for it — three copies of the same table would only drift apart.
 */
export const REF_CAROUSEL: Record<string, RefCarousel> = {
  // Flat strip, no featured card, stepping on a stagger.
  'Runway 06': { planeSize: 600, gap: 40, move: 1.6, stagger: 1 / 15 },
  'Runway 07': { planeSize: 546, gap: 40, axis: 'horizontal', move: 1.6, stagger: 1 / 15 },

  // Featured card grows at the middle, neighbours fade back.
  'Runway 08': { planeSize: 568, gap: 235, centerScale: 1.45, fade: 40, move: 1.6, stagger: 1 / 15 },
  'Runway 09': { planeSize: 440, gap: 190, centerScale: 1.45, fade: 40, axis: 'horizontal', move: 1.6, stagger: 1 / 15 },

  // Slow, evenly spaced, linear, no stagger — a conveyor rather than a carousel.
  'Runway 10': { planeSize: 730, gap: 80, move: 2.3 },
  'Runway 11': { planeSize: 540, gap: 80, axis: 'horizontal', move: 2.3 },

  // Wide gutters: one card at a time with air around it.
  'Runway 12': { planeSize: 850, gap: 500, move: 1.6, stagger: 1 / 15 },
  'Runway 13': { planeSize: 642, gap: 500, axis: 'horizontal', move: 1.6, stagger: 1 / 15 },

  // `solo`: one image slides through the frame at a time, resting half a second
  // between advances. Not a strip at all — this family's other read.
  'Runway 14': { planeSize: 600, gap: 332, centerScale: 1.4, single: true, move: 1.5, delay: 0.5 },
  'Runway 15': { planeSize: 454, gap: 332, centerScale: 1.4, single: true, axis: 'horizontal', move: 1.5, delay: 0.5 },

  // Size ramped across the strip, biggest at the leading edge.
  'Runway 16': { planeSize: 568, gap: 235, centerScale: 1.65, focus: 'start', move: 1.6, stagger: 1 / 15 },
  'Runway 17': { planeSize: 466, gap: 140, centerScale: 1.75, focus: 'start', axis: 'horizontal', move: 1.6, stagger: 1 / 15 },

  // Trailing edge, running backwards, with the biggest ramp.
  'Runway 18': { planeSize: 850, gap: 500, centerScale: 2, focus: 'end', reverse: true, move: 1.6, stagger: 1 / 15 },
  'Runway 19': { planeSize: 639, gap: 500, centerScale: 2, focus: 'end', axis: 'horizontal', reverse: true, move: 1.6, stagger: 1 / 15 },

  // Gapless deck: cards touch, so the ramp reads as lifting out of a stack.
  'Runway 20': { planeSize: 614, gap: 0, centerScale: 1.8, focus: 'start', move: 1.6 },
  'Runway 21': { planeSize: 473, gap: 0, centerScale: 1.8, focus: 'start', axis: 'horizontal', move: 1.6 },

  // Alternating roll — every other card leans the other way.
  'Runway 22': { planeSize: 748, gap: 273, tilt: -25, move: 1.6 },
  'Runway 23': { planeSize: 657, gap: 273, tilt: -25, axis: 'horizontal', move: 1.6 },
};

const REF_EASING: Record<string, EasingSpec> = {
  'Runway 06': GLIDE,  'Runway 07': GLIDE,  'Runway 08': GLIDE,  'Runway 09': GLIDE,
  'Runway 10': LINEAR, 'Runway 11': LINEAR, 'Runway 12': SMOOTH, 'Runway 13': SMOOTH,
  'Runway 14': SMOOTH, 'Runway 15': SMOOTH, 'Runway 16': GLIDE,  'Runway 17': GLIDE,
  'Runway 18': SMOOTH, 'Runway 19': SMOOTH, 'Runway 20': FLOW,   'Runway 21': FLOW,
  'Runway 22': FLOW,   'Runway 23': FLOW,
};

export const carouselRefVariants: Template[] = Object.keys(REF_CAROUSEL).map((name, i) => (
  refPreset(`carousel-r${String(i + 1).padStart(2, '0')}`, name, REF_CAROUSEL[name], REF_EASING[name])
));

// The same six steps read too fast when inherited from a shorter previous
// scene. Selecting a reconstructed Runway also restores the clip length that
// the reference authored for that preset.
export const carouselReferenceDurations: Record<string, number> = Object.fromEntries(
  Object.keys(REF_CAROUSEL).map((name, i) => [
    `carousel-r${String(i + 1).padStart(2, '0')}`,
    refCarouselSeconds(REF_CAROUSEL[name]),
  ])
);
