import type { ControlGroup } from './asciiControls';

// ── Device Mockup control schema ────────────────────────────────────────────
// Realistic (non-toon) PBR render: keeps the GLB's own materials by default —
// controls here are overrides (tint, opacity, wireframe) plus studio lighting
// and reflection strength. No paint/toon-specific fields (see cartoonControls).
export const mockupGroups: ControlGroup[] = [
  {
    title: 'Material',
    controls: [
      { key: 'useModelColor', label: 'Use Model Materials', type: 'toggle', options: ['On', 'Off'], default: 'On' },
      { key: 'color', label: 'Color', type: 'color', default: '#d8d8dc' },
      { key: 'emissive', label: 'Emissive', type: 'color', default: '#000000' },
      { key: 'emissiveIntensity', label: 'Emissive Intensity', type: 'slider', min: 0, max: 5, step: 0.1, default: 1 },
      { key: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, default: 100 },
      { key: 'wireframe', label: 'Wireframe', type: 'toggle', options: ['On', 'Off'], default: 'Off' },
      { key: 'flatShading', label: 'Flat Shading', type: 'toggle', options: ['On', 'Off'], default: 'Off' },
    ],
  },
  {
    // Mirrors the reference tool's own Screen section.
    title: 'Screen',
    controls: [
      { key: 'screenBrightness', label: 'Brightness', type: 'slider', min: 0, max: 1.6, step: 0.05, default: 1 },
      // How much of the studio environment the cover glass mirrors back. 0 by
      // default: the room map bakes in rectangular panels, and a mirror-smooth
      // display returns one as a hard softbox — the CG tell the reference
      // tool's screens don't have. Raise it for a deliberate glossy look.
      { key: 'screenGlare', label: 'Glare', type: 'slider', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
  {
    title: 'Lights',
    controls: [
      // The reference tool steers its key light from a 2D "light direction"
      // pad rather than a position; these are that pad's two axes, and its
      // measured defaults (-26°, 0°). Applied as an offset on top of whatever
      // the active animation preset is doing with the key light.
      { key: 'lightAzimuth', label: 'Light Direction X', type: 'slider', min: -180, max: 180, step: 1, default: -26 },
      { key: 'lightElevation', label: 'Light Direction Y', type: 'slider', min: -90, max: 90, step: 1, default: 0 },
      // A stronger key against a lower fill/ambient floor is what actually
      // reads as "sharp" — enough contrast that the device's edges and finish
      // stay defined instead of washing into the bright backdrop.
      { key: 'keyLight', label: 'Key Light', type: 'slider', min: 0, max: 6, step: 0.1, default: 3.2 },
      { key: 'fillLight', label: 'Fill Light', type: 'slider', min: 0, max: 4, step: 0.1, default: 1 },
      { key: 'ambient', label: 'Ambient', type: 'slider', min: 0, max: 3, step: 0.1, default: 0.55 },
      { key: 'envIntensity', label: 'Reflections', type: 'slider', min: 0, max: 3, step: 0.05, default: 1.1 },
      // Range and 0.60 default both read off the reference tool's Exposure.
      { key: 'exposure', label: 'Exposure', type: 'slider', min: 0.1, max: 2, step: 0.05, default: 0.6 },
    ],
  },
  {
    // Post-grade on the rendered device (CSS filters on the canvas, applied in
    // ThreeStage3D) — the backdrop keeps its own colours.
    title: 'Adjustments',
    controls: [
      { key: 'brightness', label: 'Brightness', type: 'slider', min: 0, max: 200, step: 1, default: 100 },
      { key: 'contrast', label: 'Contrast', type: 'slider', min: 0, max: 200, step: 1, default: 100 },
      { key: 'saturation', label: 'Saturation', type: 'slider', min: 0, max: 200, step: 1, default: 100 },
    ],
  },
  {
    title: 'Ground',
    controls: [
      // Arqé's default shot has no ground contact shadow at all — the device
      // floats on a plain backdrop.
      { key: 'shadowOpacity', label: 'Shadow', type: 'slider', min: 0, max: 100, step: 1, default: 0 },
    ],
  },
];
