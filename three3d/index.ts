import { type AsciiOptions } from './ascii';
import { initCartoon } from './cartoon';
import { initMockup } from './mockup';
import { type ControlGroup } from './asciiControls';
import { cartoonGroups } from './cartoonControls';
import { mockupGroups } from './mockupControls';

// ── 3D effect registry ──────────────────────────────────────────────────────
// Each 3D effect: an `init` that takes the stage container + the target canvas
// (+ live params/model) and returns a dispose(); `groups` declaring its control
// schema (right panel); and `defaultModel` (bundled .glb shown on first load).
export interface ThreeEffect {
  id: string;
  name: string;
  groups: ControlGroup[];
  defaultModel: string;
  init: (stage: HTMLElement, canvas: HTMLCanvasElement, opts?: AsciiOptions) => () => void;
}

export const threeEffects: ThreeEffect[] = [
  { id: 'cartoon', name: 'Painted Shader', groups: cartoonGroups, defaultModel: '/3d/model/dayse.glb', init: initCartoon },
  // No bundled default — this mode is for the user's OWN device model
  // (phone, laptop, ring…) uploaded via Model Control. Empty string = no
  // auto-load; initMockup shows an empty, lit stage until one is uploaded.
  { id: 'mockup', name: 'Device Mockup', groups: mockupGroups, defaultModel: '', init: initMockup },
];

export function getThreeEffect(id: string): ThreeEffect | undefined {
  return threeEffects.find((e) => e.id === id);
}

// Flat default map for an effect (merged with user overrides at read time).
export function threeDefaults(id: string): Record<string, any> {
  const def = getThreeEffect(id);
  const v: Record<string, any> = {};
  if (def) for (const g of def.groups) for (const c of g.controls) v[c.key] = c.default;
  return v;
}
