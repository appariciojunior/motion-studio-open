import type { Effect } from '@/lib/types';

// Snap each sample to a grid of `size`-pixel blocks.
//
// This is the same maths pixi-filters' PixelateFilter ran, transcribed rather
// than reimplemented: floor(p / size) * size, then read there. The floor is
// deliberately NOT floor(...) + 0.5 — sampling the block's top-left corner is
// what the 2D path has always done, and 143 of the 223 catalogue presets are
// drawn by it.
//
// The webgl path used to do `(floor(...) + 0.5)` in its own output pass, so the
// two engines pixelated half a block apart from each other for the same slider
// value. Moving both onto this one shader closes that gap; the webgl side shifts
// by half a block, which is it converging on the 2D behaviour rather than
// drifting from it.
export const pixelate: Effect = {
  meta: { id: 'pixelate', name: 'Pixelate' },
  controls: [
    { key: 'size', label: 'Pixel Size', type: 'slider', min: 1, max: 64, step: 1, default: 8 },
  ],
  shader: {
    uniformTypes: { uSize: 'vec2' },
    // Guarded at 1: a zero block size divides by zero and paints the card black.
    uniforms: (v) => {
      const size = Math.max(1, Number(v.size ?? 8));
      return { uSize: [size, size] };
    },
    fragment: `
vec4 fxMain(vec2 p) {
  vec2 size = max(uSize, vec2(1.0));
  return fxSample(floor(p / size) * size);
}`,
  },
};
