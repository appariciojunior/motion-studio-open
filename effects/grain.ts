import type { Effect } from '@/lib/types';

// Film grain: per-pixel noise added over the scene.
//
// The noise is a hash of the pixel coordinate, not a texture — a texture would
// tile visibly at 4K export and cost a sampler for something a few ALU ops
// produce. The hash is the standard fract/sin construction, which is stable
// across drivers in a way `fract(sin(dot(...)) * huge)` alone is not: the seed
// is quantized to the grain cell first, so neighbouring pixels inside one cell
// share a value and the grain has a SIZE instead of being per-pixel always.
//
// `animate` decides whether the seed advances with uTime. Off, the grain is a
// fixed pattern — which is what you want for a still frame or a poster, and
// what keeps a paused preview from shimmering. On, it advances by whole steps,
// not continuously: real film grain replaces itself every frame, it does not
// slide, and a continuous drift reads as a moving texture rather than as grain.
//
// uTime comes from the FRAME (see the adapters), so an exported clip has the
// same grain on frame 47 every single time it is rendered.
export const grain: Effect = {
  meta: { id: 'grain', name: 'Grain' },
  controls: [
    { key: 'amount', label: 'Amount', type: 'slider', min: 0, max: 100, step: 1, default: 35, unit: '%' },
    { key: 'size', label: 'Grain Size', type: 'slider', min: 1, max: 12, step: 1, default: 2, unit: 'px' },
    { key: 'animate', label: 'Animate', type: 'toggle', options: ['Off', 'On'], default: 'On' },
  ],
  shader: {
    uniformTypes: { uAmount: 'float', uSize: 'float', uSeed: 'float' },
    uniforms: (v, ctx) => {
      const animate = v.animate === 'On' || v.animate === true;
      // Quantized to 24 steps a second: grain that advanced on every rendered
      // frame would flicker differently at a 60fps preview than at a 30fps
      // export. A fixed step rate makes the two look the same.
      //
      // Static grain gets its own seed (-1) rather than seed 0. Zero is what the
      // animated path produces at time 0, so the toggle did nothing on the first
      // frame — the suite caught exactly that, reporting `animate` as a dead
      // control. A negative seed can never collide with an animated step.
      return {
        uAmount: Math.max(0, Math.min(100, Number(v.amount ?? 35))) / 100,
        uSize: Math.max(1, Number(v.size ?? 2)),
        uSeed: animate ? Math.floor((ctx.time ?? 0) * 24) : -1,
      };
    },
    fragment: `
float fx_hash(vec2 c) {
  return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 fxMain(vec2 p) {
  vec4 col = fxSample(p);
  // Quantize to the grain cell so the noise has a size, then offset the seed by
  // a large stride per step — a small stride correlates consecutive frames and
  // the grain appears to crawl.
  vec2 cell = floor(p / uSize);
  float n = fx_hash(cell + uSeed * 37.13);
  // Signed and centred, so grain lightens as often as it darkens instead of
  // dragging the whole image one way.
  float g = (n - 0.5) * uAmount;
  return vec4(clamp(col.rgb + g, 0.0, 1.0), col.a);
}`,
  },
};
