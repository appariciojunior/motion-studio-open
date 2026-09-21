import type { ControlGroup } from './asciiControls';

// ── Cartoon (MeshToonMaterial) control schema ───────────────────────────────
// Exposes the MeshToonMaterial properties that are meaningful without uploading
// textures: colour, emissive, gradient banding (toon steps via gradientMap),
// wireframe, opacity, flat shading — plus lights and background.
export const cartoonGroups: ControlGroup[] = [
  {
    title: 'Material',
    controls: [
      { key: 'color', label: 'Color', type: 'color', default: '#e9e4d6' },
      // gradientMap is a texture — we build it from a step count (toon bands).
      { key: 'gradientSteps', label: 'Toon Steps', type: 'slider', min: 2, max: 10, step: 1, default: 3 },
      { key: 'emissive', label: 'Emissive', type: 'color', default: '#000000' },
      { key: 'emissiveIntensity', label: 'Emissive Intensity', type: 'slider', min: 0, max: 5, step: 0.1, default: 1 },
      { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, default: 100 },
      { key: 'wireframe', label: 'Wireframe', type: 'toggle', options: ['On', 'Off'], default: 'Off' },
      { key: 'flatShading', label: 'Flat Shading', type: 'toggle', options: ['On', 'Off'], default: 'Off' },
      { key: 'useModelColor', label: 'Use Model Colors', type: 'toggle', options: ['On', 'Off'], default: 'On' },
    ],
  },
  {
    title: 'Paint',
    controls: [
      // Brush-stroke normal map → toon lighting follows the strokes (paint look).
      { key: 'paintStrokes', label: 'Paint Strokes', type: 'toggle', options: ['On', 'Off'], default: 'On' },
      { key: 'normalStrength', label: 'Stroke Strength', type: 'slider', min: 0, max: 3, step: 0.05, default: 1 },
      { key: 'paintScale', label: 'Stroke Scale', type: 'slider', min: 0.5, max: 8, step: 0.1, default: 2 },
      // Rim erosion — chip the silhouette edges with the contrast brush mask.
      { key: 'rimErosion', label: 'Rim Erosion', type: 'toggle', options: ['On', 'Off'], default: 'Off' },
      { key: 'rimAmount', label: 'Rim Amount', type: 'slider', min: 0, max: 5, step: 0.1, default: 2 },
      { key: 'rimThreshold', label: 'Rim Threshold', type: 'slider', min: 0, max: 1.5, step: 0.05, default: 0.5 },
      // Per-element edges via geometric curvature (dFdx/dFdy) — erodes each
      // mesh's own creases/edges, not just the camera silhouette.
      { key: 'rimCurvature', label: 'Rim Curvature', type: 'slider', min: 0, max: 4, step: 0.1, default: 0 },
    ],
  },
  {
    title: 'Lights',
    controls: [
      { key: 'keyLight', label: 'Key Light', type: 'slider', min: 0, max: 6, step: 0.1, default: 0.3 },
      { key: 'fillLight', label: 'Fill Light', type: 'slider', min: 0, max: 4, step: 0.1, default: 1 },
      { key: 'ambient', label: 'Ambient', type: 'slider', min: 0, max: 3, step: 0.1, default: 0.1 },
    ],
  },
];
