import type { Effect } from '@/lib/types';

// Halftone: the image rebuilt as a grid of dots whose SIZE carries the tone.
//
// The grid is rotated, and that is the whole craft of it. An unrotated dot grid
// lines up with the card edges and with the pixel grid itself, which reads as a
// screen-door artefact rather than as print; real halftone screens sit at an
// angle for exactly that reason. 45 degrees is the default because it is the
// angle a single-colour screen is traditionally cut at — the eye resolves a
// diagonal lattice as texture and an axis-aligned one as a defect.
//
// The dot is measured with a smoothstep against the cell's radius rather than a
// hard step. A hard threshold gives every dot a stair-stepped edge at these
// sizes, and the stair pattern itself becomes the visible texture. The ramp is
// one pixel wide, converted from cell units, so it is a constant softness on
// screen no matter how big the cell is.
//
// `mono` is a real switch, not a saturation slider: print halftone of a colour
// image screens each channel separately (which is what the colour path does
// here, one dot size per channel), while a single-colour screen measures
// luminance once. Those are different pictures, not two ends of one scale.
export const halftone: Effect = {
  meta: { id: 'halftone', name: 'Halftone' },
  controls: [
    { key: 'dotSize', label: 'Dot Size', type: 'slider', min: 2, max: 40, step: 1, default: 8, unit: 'px' },
    { key: 'angle', label: 'Screen Angle', type: 'slider', min: 0, max: 90, step: 1, default: 45, unit: '°' },
    { key: 'mono', label: 'Colour', type: 'toggle', options: ['Mono', 'CMY'], default: 'Mono' },
  ],
  shader: {
    uniformTypes: { uCell: 'float', uRot: 'vec2', uMono: 'float' },
    uniforms: (v) => {
      const rad = (Number(v.angle ?? 45) * Math.PI) / 180;
      // Rotation baked to a vector: same value for the whole frame, so there is
      // no reason to pay sin/cos per pixel.
      return {
        uCell: Math.max(2, Number(v.dotSize ?? 8)),
        uRot: [Math.cos(rad), Math.sin(rad)],
        uMono: (v.mono ?? 'Mono') === 'Mono' ? 1 : 0,
      };
    },
    fragment: `
// Coverage of one dot: 1 at the cell centre, 0 past its radius.
// A tone of 0 wants a full dot and 1 wants none, so the radius follows (1 - tone).
float fx_dot(vec2 gridPos, float tone) {
  vec2 cellCentre = floor(gridPos) + 0.5;
  float d = length(gridPos - cellCentre);
  // sqrt(0.5) is the half-diagonal of the cell: the radius at which a dot just
  // touches its neighbours diagonally, which is full coverage.
  float r = (1.0 - tone) * 0.7071;
  // One pixel of ramp, in cell units — constant softness on screen.
  float soft = 1.0 / uCell;
  return 1.0 - smoothstep(r - soft, r + soft, d);
}

vec4 fxMain(vec2 p) {
  vec4 col = fxSample(p);
  // Into the rotated screen's own grid, in cells.
  vec2 rot = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  vec2 gridPos = rot / uCell;

  if (uMono > 0.5) {
    // Rec.709 luma: a green-heavy image screened on a flat average comes out
    // far darker than the eye expects.
    float tone = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
    float ink = fx_dot(gridPos, tone);
    return vec4(vec3(1.0 - ink), col.a);
  }

  // Colour: each channel gets its own screen, offset in angle the way process
  // printing separates them so the dots interleave instead of stacking.
  float c = fx_dot(gridPos, col.r);
  float m = fx_dot(gridPos + vec2(0.33, 0.66), col.g);
  float y = fx_dot(gridPos + vec2(0.66, 0.33), col.b);
  return vec4(1.0 - c, 1.0 - m, 1.0 - y, col.a);
}`,
  },
};
