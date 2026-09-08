import type { Template } from '@/lib/types';
import { loopCycles, clamp } from '@/lib/motion';
import { variant } from './variant';
import { canvasScale } from './lattice';

// Scale — a Ken-Burns zoom slideshow. One image at a time pushes IN (or
// pulls OUT) from a chosen anchor, cross-fading to the next with a stagger,
// plus an optional slight spin. The custom expo-out curve gives an instant
// fast start and a long deceleration.
const BASE = 340;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const scale: Template = {
  meta: { id: 'scale-01', name: 'Dive 01', group: 'Dive', defaultEasing: { id: 'custom', bezier: [0, 0, 0, 0.99] }, cardAspect: 'canvas' },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 10, step: 1,    default: 5 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 600, step: 1,  default: 340 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,   default: 0 },
    { key: 'zoom',         label: 'Zoom',          type: 'slider', min: 0, max: 80, step: 1,    default: 30 },
    { key: 'direction',    label: 'Direction',     type: 'pills',  options: ['in','out'],       default: 'in' },
    { key: 'anchor',       label: 'Anchor',        type: 'pills',  options: ['center','tl','tr','bl','br'], default: 'center' },
    { key: 'spin',         label: 'Spin',          type: 'toggle', options: ['on','off'],       default: 'off' },
    { key: 'spinAmt',      label: 'Spin Amount',   type: 'slider', min: 0, max: 30, step: 1,    default: 6 },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0.2, max: 3, step: 0.1, default: 0.5 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                               default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const sizeFactor = v.cardSize / BASE;

    // lifecycle w ∈ [0, count): 0 = this card just became active.
    // Period is `count` phase units — loop-lock to whole lifecycle laps.
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count);
    const w = (((phase - index) % count) + count) % count;

    // crossfade over one slot at each end
    let vis = Math.max(0, 1 - w) + Math.max(0, 1 - (count - w));
    vis = Math.min(1, vis);

    // eased zoom progress across the active card's visible cycle
    // Unwrap the visible window through peak opacity at w=0.
    const age = clamp((w <= 1 ? w + 1 : w - count + 1) / 2, 0, 1);
    const z = ctx.ease(age);

    const zoomAmt = v.zoom / 100;
    const s = v.direction === 'out' ? lerp(1 + zoomAmt, 1, z) : lerp(1, 1 + zoomAmt, z);
    // Full-frame Ken-Burns fit. Two things had to change here: the renderer
    // normalizes a sprite's LONG edge, so a full-bleed card covers by matching
    // the canvas's long edge rather than its height — reading the height only
    // worked while the canvas was portrait, and left 351px bare on 4:3 and 533px
    // on 16:9. And the old 0.9 undershot even in portrait, so every image opened
    // with a 108px border before the zoom grew past it; at s = 1 the card should
    // exactly cover, and the zoom then overscans from there, which is what
    // Ken-Burns means.
    const scl = sizeFactor * (Math.max(ctx.width, ctx.height) / BASE) * s;

    // anchor pan: shift toward the chosen corner as it zooms
    const ax = v.anchor.includes('l') ? -1 : v.anchor.includes('r') ? 1 : 0;
    const ay = v.anchor.startsWith('t') ? -1 : v.anchor.startsWith('b') ? 1 : 0;
    const x = (-ax * (s - 1) * v.cardSize * 0.6 + v.offset.x) * canvasScale(ctx);
    const y = (-ay * (s - 1) * v.cardSize * 0.6 + v.offset.y) * canvasScale(ctx);

    const rotation = v.spin === 'on' ? (z - 0.5) * (v.spinAmt * Math.PI / 180) : 0;

    return {
      x,
      y,
      scale: scl,
      rotation,
      alpha: vis,
      depth: index / Math.max(1, count), // fixed order avoids a pop at equal-opacity crossfades
    };
  },
};

export const scaleVariants: Template[] = [
  scale,
  variant(scale, 'scale-02', 'Dive 02', { anchor: 'tl', direction: 'in', zoom: 45 }),
  variant(scale, 'scale-03', 'Dive 03', { anchor: 'br', direction: 'out', zoom: 55 }),
  variant(scale, 'scale-04', 'Dive 04', { anchor: 'center', direction: 'in', zoom: 20, spin: 'on', spinAmt: 10 }),
];
