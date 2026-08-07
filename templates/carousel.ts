import type { Template } from '@/lib/types';
import { clamp, loopCycles, smooth } from '@/lib/motion';
import { cardPath } from '@/lib/cardPath';
import type { EasingSpec } from '@/lib/easing';
import { variant } from './variant';

// Reference size (px) shared with the renderer's sprite normalization, so that
// `cardSize` reads directly in on-screen pixels.
const BASE = 340;

export const carousel: Template = {
  meta: { id: 'carousel', name: 'Runway', group: 'Runway', engine: 'webgl', defaultEasing: { id: 'glide' } },

  controls: [
    // Four-way direction (as in the reference tool): left/right run the strip
    // horizontally, up/down run it vertically. Axis + travel sign in one control.
    { key: 'direction',    label: 'Direction',     type: 'pills', options: ['left','right','up','down'], default: 'left' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 1, max: 12, step: 1,   default: 6 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 800, step: 1, default: 340 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 12 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0, max: 600, step: 1,  default: 360 }, // px between card centres (at base size)
    { key: 'bigScale',     label: 'Big Scale',     type: 'slider', min: 100, max: 200, step: 1, default: 120 }, // featured card size %
    { key: 'scaleFocus',   label: 'Scale Focus',   type: 'pills', options: ['center','start','end'], default: 'center' }, // where the featured card sits
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 0, max: 200, step: 1,  default: 0 },
    { key: 'tiltStyle',    label: 'Tilt Style',    type: 'pills', options: ['off','fan','uniform','alternate'], default: 'off' },
    { key: 'tiltAmount',   label: 'Tilt Amount',   type: 'slider', min: 0, max: 30, step: 1,   default: 8, section: 'Depth', unit: '°', visibleWhen: { key: 'tiltStyle', not: 'off' }, description: 'Tilts cards in real 3D while their runway path stays unchanged.' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1,  default: 0 },   // centre-distance fade %
    { key: 'outerFade',    label: 'Outer Fade',    type: 'slider', min: 0, max: 100, step: 1,  default: 100 }, // fade out while leaving the frame %
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 4, step: 0.1,  default: 0.6 }, // cards/sec
  ],

  transform: (frame, index, count, v, ctx) => {
    const horiz = v.direction === 'left' || v.direction === 'right';
    const dir = (v.direction === 'left' || v.direction === 'up') ? 1 : -1;
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir); // ← Speed + Direction + Easing

    // Cards recycle seamlessly (wrap). Featuredness peaks at centre.
    const p = cardPath({ kind: 'line', index, count, phase, gap: 1, wrap: true });
    const offset = p.x;                                          // gap:1 → x carries the raw signed offset
    const sizeFactor = v.cardSize / BASE;

    // pos = offset * Gap * (cardSize/BASE) → spacing grows with the card        ← Gap
    const pos = offset * v.gap * sizeFactor;
    const x = (horiz ? pos : 0) + v.offset.x;                    // ← Offset X
    const y = (horiz ? 0 : pos) + v.offset.y;                    // ← Offset Y

    // Scale Focus: shift the featuredness peak toward the entry (start) or
    // exit (end) side of travel. dir=+1 means cards enter on the positive side.
    const shift = Math.max(0, count / 2 - 1.5);
    const focusOff =
      v.scaleFocus === 'start' ? dir * shift :
      v.scaleFocus === 'end'   ? -dir * shift : 0;
    const featured = Math.max(0, 1 - Math.abs(offset - focusOff));

    // Featured card grows toward Big Scale; others sit at 1.0                    ← Big Scale
    let scale = sizeFactor * (1 + (v.bigScale / 100 - 1) * featured);            // ← Plane Size

    // Tilt Style: fan = tilt ∝ signed centre distance; uniform = constant;
    // alternate = ±tilt by card parity.                                          ← Tilt
    const tiltRad = (v.tiltAmount * Math.PI) / 180;
    // tanh gives the fan a continuous slope through the centre and a soft
    // saturation toward the edges. The old clamp had visible velocity kinks
    // when a card crossed ±3 slots.
    const fan = Math.tanh(offset * 0.72);
    const rotation =
      v.tiltStyle === 'fan'       ? fan * tiltRad :
      v.tiltStyle === 'uniform'   ? tiltRad :
      v.tiltStyle === 'alternate' ? (index % 2 ? -tiltRad : tiltRad) : 0;

    // Perspective: off-centre cards shrink and skew away from centre, along
    // the travel axis (skewX for horizontal strips, skewY for vertical).       ← Perspective
    const persp = v.perspective / 100;
    scale *= 1 - (1 - p.depthNorm) * 0.35 * persp;
    const skew = -Math.sign(offset) * (1 - p.depthNorm) * 0.18 * persp;

    // Edge fade                                                                  ← Fade
    let alpha = 1 - (v.fade / 100) * (1 - p.depthNorm);

    // A wrapped card teleports from one end of the strip to the other. Make
    // that hand-off fully transparent even when a small gap keeps the final
    // slot inside the canvas; otherwise the recycle reads as a pop.
    if (count > 1) {
      const wrapFade = smooth(clamp((count / 2 - Math.abs(offset)) / 0.7, 0, 1));
      alpha *= wrapFade;
    }

    // Outer fade: as the card starts leaving the frame, fade it out — fully     ← Outer Fade
    // transparent by the time it has fully exited. Axis-aware.
    const half = (horiz ? ctx.width : ctx.height) / 2;
    const cardHalf = (v.cardSize * (scale / sizeFactor)) / 2;
    const axisPos = horiz ? x : y;
    const leaving = Math.abs(axisPos) - (half - cardHalf);       // >0 once the edge is crossed
    if (leaving > 0) {
      const t = Math.min(1, leaving / Math.max(1, cardHalf * 2)); // 1 = fully outside
      alpha *= 1 - (v.outerFade / 100) * (t * t * (3 - 2 * t));   // smooth falloff
    }

    return {
      x,
      y,
      scale,
      rotation,
      alpha,
      skewX: horiz ? skew : 0,
      skewY: horiz ? 0 : skew,
      depth: p.depthNorm + featured,                             // featured card always wins the draw order
    };
    // cornerRadius is applied where the sprite mask is built, not here.          ← Corner Radius
  },
  transform3d: (frame, index, count, v, ctx) => {
    const flat = carousel.transform(frame, index, count, v, ctx);
    const horiz = v.direction === 'left' || v.direction === 'right';
    const dir = (v.direction === 'left' || v.direction === 'up') ? 1 : -1;
    const phase = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir);
    const path = cardPath({ kind: 'line', index, count, phase, gap: 1, wrap: true });
    const fan = Math.tanh(path.x * 0.72);
    const signed = v.tiltStyle === 'fan' ? fan
      : v.tiltStyle === 'alternate' ? (index % 2 ? -1 : 1)
      : v.tiltStyle === 'uniform' ? 1 : 0;
    const angle = signed * v.tiltAmount * Math.PI / 180;
    const depth = -(1 - path.depthNorm) * (v.perspective / 100) * v.cardSize * 0.65;
    return {
      x: flat.x,
      y: flat.y,
      z: depth,
      rotationX: horiz ? 0 : -angle,
      rotationY: horiz ? angle : 0,
      rotationZ: 0,
      scale: flat.scale,
      alpha: flat.alpha,
    };
  },
};

// ============================================================
//  Reference-catalogue presets (Carousel 01–18)
//
//  The reference ships nine looks, each as a vertical/horizontal pair. Its sizing
//  was measured off two presets with `stagger: 0` and no centre scaling, so the
//  cards sit at base size and neighbours are unambiguous:
//
//    planeSize 730, gap 80  -> card 548x730, pitch 810
//    planeSize 850, gap 500 -> card 638x850, pitch 1350
//
//  So a card is 3:4 with `height = planeSize`, and `pitch = planeSize + gap`.
//  This family's `gap` is a centre distance AT BASE SIZE, so converting divides
//  the 0.75 canvas factor straight out and leaves no measured constant behind:
//
//    cardSize = 0.75 * planeSize
//    gap      = BASE * (1 + gapRef / planeSize)
//
//  Cross-check: Carousel 01 is planeSize 600 / gap 40, giving 340 * (1 + 40/600)
//  = 363 — and Runway 01 already shipped with gap 360. The formula lands on a
//  value that was arrived at independently, which is the best evidence it is right.
// ============================================================

interface RefCarousel {
  planeSize: number;
  gap: number;
  axis?: 'vertical' | 'horizontal';
  reverse?: boolean;
  /** Reference `centerScale`, applied only when its `scaleCenter` is on. */
  centerScale?: number;
  focus?: 'center' | 'start' | 'end';
  tilt?: number;
  fade?: number;
  /** Seconds a card takes to advance, plus any hold — the reference's duration + delay. */
  seconds: number;
}

function refCarousel(r: RefCarousel): Record<string, any> {
  const vertical = (r.axis ?? 'vertical') === 'vertical';
  return {
    // Reference `up`/`left` are its two forward directions on each axis.
    direction: vertical ? (r.reverse ? 'down' : 'up') : (r.reverse ? 'right' : 'left'),
    cardSize: Math.round(0.75 * r.planeSize),
    gap: Math.round(BASE * (1 + r.gap / r.planeSize)),
    // `scaleCenter: off` in the reference keeps centerScale stored but inert, so
    // an absent centerScale here means a flat strip — no featured card.
    bigScale: Math.round((r.centerScale ?? 1) * 100),
    scaleFocus: r.focus ?? 'center',
    tiltStyle: r.tilt ? 'alternate' : 'off',
    tiltAmount: Math.abs(r.tilt ?? 0),
    fade: r.fade ?? 0,
    cornerRadius: 0,
    perspective: 0,
    speed: Math.round((1 / r.seconds) * 100) / 100,
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
export const carouselVariants: Template[] = [
  { ...carousel, meta: { ...carousel.meta, name: 'Runway 01' } },
  variant(carousel, 'carousel-02', 'Runway 02', {
    gap: 140, bigScale: 145, perspective: 0, fade: 45, speed: 0.4,
  }),
  variant(carousel, 'carousel-03', 'Runway 03', {
    tiltStyle: 'fan', tiltAmount: 10, gap: 300, bigScale: 130, speed: 0.5,
  }),
  variant(carousel, 'carousel-04', 'Runway 04', {
    scaleFocus: 'start', bigScale: 160, gap: 260, fade: 30, direction: 'right',
  }),
  variant(carousel, 'carousel-05', 'Runway 05', {
    tiltStyle: 'alternate', tiltAmount: 6, direction: 'up', gap: 420, cornerRadius: 24,
  }),
];

export const carouselRefVariants: Template[] = [
  // Flat strip, no featured card.
  refPreset('carousel-r01', 'Runway 06', { planeSize: 600, gap: 40, seconds: 1.6 }, GLIDE),
  refPreset('carousel-r02', 'Runway 07', { planeSize: 546, gap: 40, axis: 'horizontal', seconds: 1.6 }, GLIDE),

  // Featured card grows at centre, neighbours fade back.
  refPreset('carousel-r03', 'Runway 08', { planeSize: 568, gap: 235, centerScale: 1.45, fade: 40, seconds: 1.6 }, GLIDE),
  refPreset('carousel-r04', 'Runway 09', { planeSize: 440, gap: 190, centerScale: 1.45, fade: 40, axis: 'horizontal', seconds: 1.6 }, GLIDE),

  // Slow, evenly spaced, linear — a conveyor rather than a carousel.
  refPreset('carousel-r05', 'Runway 10', { planeSize: 730, gap: 80, seconds: 2.3 }, LINEAR),
  refPreset('carousel-r06', 'Runway 11', { planeSize: 540, gap: 80, axis: 'horizontal', seconds: 2.3 }, LINEAR),

  // Wide gutters: one card at a time with air around it.
  refPreset('carousel-r07', 'Runway 12', { planeSize: 850, gap: 500, seconds: 1.6 }, SMOOTH),
  refPreset('carousel-r08', 'Runway 13', { planeSize: 642, gap: 500, axis: 'horizontal', seconds: 1.6 }, SMOOTH),

  // Steps with a hold: the reference adds delay 0.5 on top of duration 1.5.
  refPreset('carousel-r09', 'Runway 14', { planeSize: 600, gap: 332, centerScale: 1.4, seconds: 2.0 }, SMOOTH),
  refPreset('carousel-r10', 'Runway 15', { planeSize: 454, gap: 332, centerScale: 1.4, axis: 'horizontal', seconds: 2.0 }, SMOOTH),

  // Featured card pinned to the leading edge instead of the middle.
  refPreset('carousel-r11', 'Runway 16', { planeSize: 568, gap: 235, centerScale: 1.65, focus: 'start', seconds: 1.6 }, GLIDE),
  refPreset('carousel-r12', 'Runway 17', { planeSize: 466, gap: 140, centerScale: 1.75, focus: 'start', axis: 'horizontal', seconds: 1.6 }, GLIDE),

  // Trailing edge, running backwards, with the biggest featured jump.
  refPreset('carousel-r13', 'Runway 18', { planeSize: 850, gap: 500, centerScale: 2, focus: 'end', reverse: true, seconds: 1.6 }, SMOOTH),
  refPreset('carousel-r14', 'Runway 19', { planeSize: 639, gap: 500, centerScale: 2, focus: 'end', axis: 'horizontal', reverse: true, seconds: 1.6 }, SMOOTH),

  // Gapless deck: cards touch, so the featured one reads as lifting out of a stack.
  refPreset('carousel-r15', 'Runway 20', { planeSize: 614, gap: 0, centerScale: 1.8, focus: 'start', seconds: 1.6 }, FLOW),
  refPreset('carousel-r16', 'Runway 21', { planeSize: 473, gap: 0, centerScale: 1.8, focus: 'start', axis: 'horizontal', seconds: 1.6 }, FLOW),

  // Alternating tilt — every other card leans the other way.
  refPreset('carousel-r17', 'Runway 22', { planeSize: 748, gap: 273, tilt: -25, seconds: 1.6 }, FLOW),
  refPreset('carousel-r18', 'Runway 23', { planeSize: 657, gap: 273, tilt: -25, axis: 'horizontal', seconds: 1.6 }, FLOW),
];
