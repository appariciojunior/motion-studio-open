import type { Template } from '@/lib/types';
import { clamp, loopCycles, smooth } from '@/lib/motion';
import { cardPath } from '@/lib/cardPath';

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
