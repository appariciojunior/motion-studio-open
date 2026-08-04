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
    title: 'Lights',
    controls: [
      { key: 'keyLight', label: 'Key Light', type: 'slider', min: 0, max: 6, step: 0.1, default: 3 },
      { key: 'fillLight', label: 'Fill Light', type: 'slider', min: 0, max: 4, step: 0.1, default: 1.2 },
      { key: 'ambient', label: 'Ambient', type: 'slider', min: 0, max: 3, step: 0.1, default: 0.6 },
      { key: 'envIntensity', label: 'Reflections', type: 'slider', min: 0, max: 3, step: 0.05, default: 1 },
      // Renderer tonemap exposure — same knob Arqé's device-lab exposes.
      { key: 'exposure', label: 'Exposure', type: 'slider', min: 0.2, max: 2, step: 0.05, default: 0.7 },
    ],
  },
  {
    title: 'Ground',
    controls: [
      { key: 'shadowOpacity', label: 'Shadow', type: 'slider', min: 0, max: 100, step: 1, default: 35 },
    ],
  },
];
