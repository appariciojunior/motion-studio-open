import type { Effect } from '@/lib/types';

// CRT: dark scanlines, plus optional barrel curvature.
//
// The lines are drawn from a cosine of the pixel's y, not from a modulo test.
// A modulo gives a hard on/off line whose width cannot follow the spacing, and
// which aliases into moire the moment the canvas is scaled for export — the
// beat between the line period and the pixel grid. A cosine has the period
// built in and lands soft at every spacing.
//
// `curvature` deforms the SAMPLE coordinate, not the geometry: a real tube
// bends the image, so the whole frame including the background has to bow. It
// is applied around the centre in normalized space, then taken back to pixels,
// which is what keeps the bow symmetric on a portrait canvas.
//
// A coordenada chama-se `src` e nao `sample`: `sample` e palavra RESERVADA em
// GLSL ES 3.00 (qualificador de sampler), e usa-la da "Illegal use of reserved
// word" no compilador. A suite estrutural nao pega isso — passou verde com este
// shader sem compilar; quem pegou foi verify-effects-gl.
//
// Anything the curve pushes outside the frame is returned black rather than
// clamped. Clamping smears the edge pixel into a streak along the border, which
// reads as a rendering fault; a tube simply has nothing out there.
export const scanlines: Effect = {
  meta: { id: 'scanlines', name: 'Scanlines' },
  controls: [
    { key: 'spacing', label: 'Spacing', type: 'slider', min: 2, max: 24, step: 1, default: 3, unit: 'px' },
    { key: 'strength', label: 'Strength', type: 'slider', min: 0, max: 100, step: 1, default: 40, unit: '%' },
    { key: 'curvature', label: 'Curvature', type: 'slider', min: 0, max: 100, step: 1, default: 0, unit: '%' },
  ],
  shader: {
    uniformTypes: { uSpacing: 'float', uStrength: 'float', uCurve: 'float' },
    uniforms: (v) => ({
      uSpacing: Math.max(2, Number(v.spacing ?? 3)),
      uStrength: Math.max(0, Math.min(100, Number(v.strength ?? 40))) / 100,
      // Scaled down hard: at 1.0 a barrel term of this shape folds the corners
      // back over themselves. 0.35 is the most bow that still reads as a tube.
      uCurve: (Math.max(0, Math.min(100, Number(v.curvature ?? 0))) / 100) * 0.35,
    }),
    fragment: `
vec4 fxMain(vec2 p) {
  vec2 src = p;

  if (uCurve > 0.0001) {
    // Centred, normalized to -1..1 on both axes so the bow is symmetric
    // regardless of the canvas aspect.
    vec2 c = (p / uResolution) * 2.0 - 1.0;
    float r2 = dot(c, c);
    c *= 1.0 + uCurve * r2;
    // Outside the tube there is nothing, so do not clamp — clamping smears the
    // edge pixel into a border streak.
    if (abs(c.x) > 1.0 || abs(c.y) > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
    src = (c * 0.5 + 0.5) * uResolution;
  }

  vec4 col = fxSample(src);
  // Cosine rather than a modulo: the period is intrinsic, so the line stays
  // soft at every spacing instead of beating against the pixel grid.
  float line = 0.5 + 0.5 * cos(src.y * 6.28318 / uSpacing);
  return vec4(col.rgb * (1.0 - uStrength * line), col.a);
}`,
  },
};
