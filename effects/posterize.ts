import type { Effect } from '@/lib/types';

// Posterize: collapse each channel to a fixed number of levels.
//
// The quantizer is floor(v * (n-1) + 0.5) / (n-1), and the two details in it
// are the ones that matter. Dividing by n-1 rather than n is what keeps pure
// white reachable: with n levels there are n-1 STEPS between black and white,
// and dividing by n leaves the top level short of 1.0, so a white card comes
// out grey. The +0.5 rounds to the nearest level instead of always down, which
// otherwise darkens the whole image by half a step.
//
// At `levels` 2 this is a threshold, and that is deliberate rather than a
// separate effect: two levels per channel IS the threshold case, and giving it
// its own control would be the same shader with a different label.
//
// Quantizes each channel independently, not the luminance. Per-channel is what
// produces the colour banding a posterized print has; quantizing luma would
// give a grey staircase with the original hue laid back over it, which is a
// different look entirely.
export const posterize: Effect = {
  meta: { id: 'posterize', name: 'Posterize' },
  controls: [
    { key: 'levels', label: 'Levels', type: 'slider', min: 2, max: 16, step: 1, default: 5 },
  ],
  shader: {
    uniformTypes: { uSteps: 'float' },
    // n-1 computed here, on the CPU, so the shader never risks dividing by zero
    // if the slider floor ever moves down to 1.
    uniforms: (v) => ({ uSteps: Math.max(1, Math.round(Number(v.levels ?? 5)) - 1) }),
    fragment: `
vec4 fxMain(vec2 p) {
  vec4 col = fxSample(p);
  // +0.5 rounds to the nearest level; without it every pixel falls to the level
  // below and the image darkens by half a step.
  vec3 q = floor(col.rgb * uSteps + 0.5) / uSteps;
  return vec4(q, col.a);
}`,
  },
};
