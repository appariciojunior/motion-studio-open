import type { Effect } from '@/lib/types';

// Chromatic aberration: the three channels sampled at three offsets.
//
// Red and blue move in OPPOSITE directions and green stays put. That is what a
// lens actually does — the middle of the visible spectrum focuses where it
// should and the ends fall short and long — and it is also why the effect reads
// as a lens rather than as a glitch: moving all three the same way would just
// shift the image.
//
// The offset is in pixels, which is the whole reason the contract hands `p` in
// pixels: a normalized offset would come out as a different visible distance in
// a 1080x1350 canvas than in a 1920x1080 one, and the same slider value would
// mean two different looks depending on the aspect the user picked.
export const rgbSplit: Effect = {
  meta: { id: 'rgb-split', name: 'RGB Split' },
  controls: [
    { key: 'offset', label: 'Offset', type: 'slider', min: 0, max: 40, step: 0.5, default: 4, unit: 'px' },
    { key: 'angle', label: 'Angle', type: 'slider', min: 0, max: 360, step: 1, default: 0, unit: '°' },
  ],
  shader: {
    uniformTypes: { uShift: 'vec2' },
    uniforms: (v) => {
      const offset = Math.max(0, Number(v.offset ?? 4));
      const rad = (Number(v.angle ?? 0) * Math.PI) / 180;
      // Baked into a vector here rather than passing the angle and doing
      // sin/cos per pixel — it is the same value for the whole frame.
      return { uShift: [Math.cos(rad) * offset, Math.sin(rad) * offset] };
    },
    fragment: `
vec4 fxMain(vec2 p) {
  vec4 r = fxSample(p + uShift);
  vec4 g = fxSample(p);
  vec4 b = fxSample(p - uShift);
  // Alpha follows the unshifted sample: taking it from a shifted channel would
  // drag the card's edge sideways and leave a fringe outside its own silhouette.
  return vec4(r.r, g.g, b.b, g.a);
}`,
  },
};
