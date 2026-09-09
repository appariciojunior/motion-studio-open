import type { Template } from '@/lib/types';
import { smooth, clamp, loopCycles } from '@/lib/motion';
import { variant } from './variant';
import { canvasScale } from './lattice';

const BASE = 340;

// Scale Zoom — an infinite zoom through nested images. Each layer's scale is
// an exponential of its wrapped stack position, so layers continuously grow
// past the camera (bloom) or shrink inward (recede) and recycle, giving a
// seamless endless zoom. Layers fade at their extreme scales.
const zoom: Template = {
  meta: {
    id: 'scale-05', name: 'Dive Zoom', group: 'Dive',
    defaultEasing: { id: 'linear' }, repeatAssets: true, cardAspect: 'canvas',
  },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 3, max: 10, step: 1,     default: 6 },
    { key: 'zoomBase',     label: 'Zoom Ratio',    type: 'slider', min: 1.2, max: 3, step: 0.05, default: 1.6 }, // scale ratio between adjacent layers
    { key: 'mode',         label: 'Mode',          type: 'toggle', options: ['bloom','recede'],  default: 'bloom' },
    { key: 'growFrom',     label: 'Grow From',     type: 'pills', options: ['center','top','bottom','left','right'], default: 'center' },
    { key: 'fade',         label: 'Edge Fade',     type: 'slider', min: 0, max: 100, step: 1,    default: 70 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 100, max: 800, step: 1,  default: 520 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,    default: 12 },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0.1, max: 2, step: 0.1,  default: 0.35 }, // layers/sec
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const dir = v.mode === 'recede' ? -1 : 1;
    // q advances in layer units; period = count so each layer returns to its
    // exact nesting depth at the loop point.
    const q = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count)) * dir;

    // wrapped exponent e ∈ [-count/2, count/2): this layer's depth in the stack
    let e = (((index - q) % count) + count) % count - count / 2;

    // exponential nesting; cap so a nearly-faded layer never becomes GPU-huge
    const s = Math.min(64, Math.pow(v.zoomBase, -e));

    // alpha: fade layers approaching either extreme of the stack
    const edge = Math.abs(e) / (count / 2);
    const edgeAlpha = 1 - (v.fade / 100) * smooth(clamp((edge - 0.6) / 0.4, 0, 1));
    // Edge Fade is stylistic; recycling must still be invisible when it is 0.
    const handoff = smooth(clamp((count / 2 - Math.abs(e)) / 0.25, 0, 1));
    const alpha = edgeAlpha * handoff;

    // Actual on-screen scale factor — must match `scale` below.
    const renderScale = (v.cardSize * canvasScale(ctx) / BASE) * s;

    // The card's own rendered footprint at this scale (mirrors how the
    // renderer sizes the sprite: SPRITE_BASE * scale, split by the resolved
    // card aspect — see lib/renderer.ts and lib/crop cardAspectFor).
    const aspect = ctx.cardAspect ?? ctx.width / ctx.height;
    const long = BASE * renderScale;
    const cardW = long * Math.min(1, aspect);
    const cardH = long * Math.min(1, 1 / aspect);

    // growFrom pins the corresponding edge of the card to that edge of the
    // canvas — the card grows/shrinks from the frame's boundary inward rather
    // than around an arbitrary fixed point. A fixed-point anchor (the previous
    // approach) scaled its offset at a different rate than the card's own
    // edge grows, so for every off-centre option the offset eventually (in
    // fact, always) outran the card and left a background gap on every frame,
    // not just at the extremes. Pinning the edge directly makes full coverage
    // on that edge exact by construction, at any scale.
    const pinX =
      v.growFrom === 'left'  ? -ctx.width / 2 + cardW / 2 :
      v.growFrom === 'right' ? ctx.width / 2 - cardW / 2 : 0;
    const pinY =
      v.growFrom === 'top'    ? -ctx.height / 2 + cardH / 2 :
      v.growFrom === 'bottom' ? ctx.height / 2 - cardH / 2 : 0;
    const x = pinX + v.offset.x * canvasScale(ctx);
    const y = pinY + v.offset.y * canvasScale(ctx);

    return {
      x,
      y,
      scale: renderScale,
      rotation: 0,
      alpha,
      depth: s, // bigger (nearer) layers draw on top
    };
  },
};

export const zoomVariants: Template[] = [
  zoom,
  variant(zoom, 'scale-06', 'Dive Recede', {
    mode: 'recede', growFrom: 'top', zoomBase: 1.8, fade: 85, speed: 0.3,
  }),
];
