import type { Effect } from '@/lib/types';

// Vignette: darken toward the edges.
//
// Measured on the ELLIPSE inscribed in the canvas, not on a circle in pixel
// space. A circular falloff on a 1080x1350 portrait canvas reaches the top and
// bottom edges long before the sides, so the corners go black while the middle
// of the long edges stays lit — it reads as a dark band rather than as a lens.
// Normalizing each axis by its own half-extent makes `radius` mean the same
// fraction of the frame in every aspect the editor offers.
//
// Darkens rather than fades: an alpha vignette would let the background show
// through the cards, which reads as the cards becoming translucent at the edges
// instead of the frame falling into shadow. Same reasoning the renderers use
// for `dim` versus `alpha`.
export const vignette: Effect = {
  meta: { id: 'vignette', name: 'Vignette' },
  controls: [
    { key: 'amount', label: 'Amount', type: 'slider', min: 0, max: 100, step: 1, default: 45, unit: '%' },
    { key: 'radius', label: 'Radius', type: 'slider', min: 10, max: 100, step: 1, default: 70, unit: '%' },
    { key: 'softness', label: 'Softness', type: 'slider', min: 1, max: 100, step: 1, default: 45, unit: '%' },
  ],
  shader: {
    uniformTypes: { uAmount: 'float', uRadius: 'float', uSoftness: 'float' },
    uniforms: (v) => ({
      uAmount: Math.max(0, Math.min(100, Number(v.amount ?? 45))) / 100,
      uRadius: Math.max(10, Math.min(100, Number(v.radius ?? 70))) / 100,
      // Floored above zero: a softness of exactly 0 makes the smoothstep edges
      // equal, which is undefined and shows up as a hard ring on some drivers
      // and as nothing at all on others.
      uSoftness: Math.max(0.01, Math.min(100, Number(v.softness ?? 45)) / 100),
    }),
    fragment: `
vec4 fxMain(vec2 p) {
  vec4 col = fxSample(p);
  // Each axis by its own half-extent: distance 1.0 is the edge of the inscribed
  // ellipse regardless of the canvas aspect.
  vec2 d = (p - uResolution * 0.5) / (uResolution * 0.5);
  float r = length(d);
  // Fully lit inside uRadius, falling to uAmount over uSoftness beyond it.
  float shade = 1.0 - uAmount * smoothstep(uRadius, uRadius + uSoftness, r);
  return vec4(col.rgb * shade, col.a);
}`,
  },
};
