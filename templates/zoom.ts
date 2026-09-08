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

    // growFrom origin: scaling about an anchor point O — layers emerge at O
    // when tiny and expand past the canvas centre as they grow
    const O =
      v.growFrom === 'top'    ? [0, -ctx.height * 0.4] :
      v.growFrom === 'bottom' ? [0, ctx.height * 0.4] :
      v.growFrom === 'left'   ? [-ctx.width * 0.4, 0] :
      v.growFrom === 'right'  ? [ctx.width * 0.4, 0] : [0, 0];
    const x = O[0] * (1 - s) + v.offset.x * canvasScale(ctx);
    const y = O[1] * (1 - s) + v.offset.y * canvasScale(ctx);

    return {
      x,
      y,
      scale: (v.cardSize * canvasScale(ctx) / BASE) * s,
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
