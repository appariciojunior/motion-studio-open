import { create } from 'zustand';

// Model transform — cross-effect (applies to the 3D object itself, not the
// ASCII look). The effect reads this live and drives a pivot around the model.
export interface ModelState {
  scale: number;        // user multiplier over the auto-fit scale
  rotX: number;         // extra rotation (radians)
  rotY: number;
  offsetX: number;      // manual world-space nudge (align the model by hand)
  offsetY: number;
  url: string | null;   // custom .glb object-URL (null = bundled default)
  name: string | null;  // uploaded file name (for the UI)
  centerNonce: number;  // bump → effect recentres the camera
}

// 3D-mode state: active effect + its live params + the model transform.
export interface ThreeDState {
  effectId: string;
  params: Record<string, Record<string, any>>;
  model: ModelState;
  // per-part colouring — generic across any GLB
  parts: string[];                        // detected colourable group keys
  partFills: Record<string, FillSpec>;    // key → fill (absent = original)
  selectedPart: string | null;            // click-to-pick selection
  bgFill: FillSpec;                        // stage background — same FillSpec pattern
  bgTexAmount: number;                     // paint-stroke texture on the background (0..100)
  bgTexScale: number;                      // background texture tiling
  sunIntensity: number;                    // warm midday sun overlay on top of everything (0..100)
  sunShadow: number;                       // directional sun that casts model shadow on the wall (0..100)
  sunMask: string | null;                  // alpha mask (e.g. window) — sun shows only inside it
  sunMaskScale: number;                     // window gobo size (0..100)
  sunMaskOffsetX: number;                   // window gobo offset (-100..100)
  sunMaskOffsetY: number;
  setEffect: (id: string) => void;
  setParam: (effectId: string, key: string, value: any) => void;
  setModelScale: (v: number) => void;
  nudgeRot: (dx: number, dy: number) => void;
  setModelOffset: (x: number, y: number) => void;
  // offsetX/offsetY default to the bundled daisy model's hand-tuned centring;
  // callers with a different model (e.g. a device mockup, which is already
  // bbox-centred by fitAndCenter) pass (0, 0) explicitly.
  centerModel: (offsetX?: number, offsetY?: number) => void;
  setModelUrl: (url: string | null, name: string | null) => void;
  setParts: (keys: string[]) => void;             // reported by the effect on load
  setPartFill: (key: string, patch: Partial<FillSpec>) => void;
  clearPartFill: (key: string) => void;
  selectPart: (key: string | null) => void;
  setBgFill: (patch: Partial<FillSpec>) => void;
  setBgTexAmount: (v: number) => void;
  setBgTexScale: (v: number) => void;
  setSunIntensity: (v: number) => void;
  setSunShadow: (v: number) => void;
  setSunMask: (url: string | null) => void;
  setSunMaskScale: (v: number) => void;
  setSunMaskOffset: (x: number, y: number) => void;
  // Mockup mode only — the image/video composited onto a device's "Screen"
  // mesh. null = the device's own bundled screen material (wallpaper/UI shot).
  screenMedia: ScreenMedia | null;
  setScreenMedia: (m: ScreenMedia | null) => void;
}

export interface ScreenMedia { url: string; kind: 'image' | 'video'; }

// A part's fill: solid, or a two-colour gradient (linear along Y bottom→top,
// or radial centre→edge). c1 = start/centre, c2 = end/edge.
export interface FillSpec { type: 'solid' | 'linear' | 'radial'; c1: string; c2: string; }

const DEF_FILL: FillSpec = { type: 'solid', c1: '#cccccc', c2: '#ffffff' };

// Nice out-of-the-box fills for the bundled dayse groups (generic keys, still
// applied only when those groups are present — other models fall back to none).
const DEFAULT_FILLS: Record<string, FillSpec> = {
  Cube:     { type: 'radial', c1: '#f4d21c', c2: '#e88a2a' }, // centres: yellow → orange edge
  Cylinder: { type: 'linear', c1: '#1c5622', c2: '#63c24c' }, // stems: dark bottom → light tip
  Plane:    { type: 'linear', c1: '#ffffff', c2: '#9a9a9a' }, // petals: white → grey
};

// Default nudge that centres the bundled dayse model in the stage.
const DEF_OFFSET = { x: -0.8, y: 0.7 };
const MODEL_DEFAULT: ModelState = { scale: 0.7, rotX: 0, rotY: 0, offsetX: DEF_OFFSET.x, offsetY: DEF_OFFSET.y, url: null, name: null, centerNonce: 0 };

export const use3DStore = create<ThreeDState>((set) => ({
  effectId: 'cartoon',
  // Only user overrides live here; schema defaults are merged at read time
  // (Effect3DControls / ThreeStage3D / the effect init). Keeps loads always
  // matching the current schema defaults — no stale one-time seed.
  params: {},
  model: { ...MODEL_DEFAULT },
  parts: [],
  partFills: {},
  selectedPart: null,
  bgFill: { type: 'linear', c1: '#c4cdd8', c2: '#3a3f47' },   // light bluish grey → dark grey
  bgTexAmount: 32,
  bgTexScale: 4.1,
  sunIntensity: 85,
  sunShadow: 0,
  sunMask: '/3d/textures/window.png',
  sunMaskScale: 46,
  sunMaskOffsetX: 0,
  sunMaskOffsetY: -2,
  screenMedia: null,
  setEffect: (effectId) => set({ effectId }),
  setParam: (effectId, key, value) =>
    set((s) => ({
      params: { ...s.params, [effectId]: { ...(s.params[effectId] ?? {}), [key]: value } },
    })),
  setModelScale: (v) => set((s) => ({ model: { ...s.model, scale: v } })),
  nudgeRot: (dx, dy) => set((s) => ({ model: { ...s.model, rotX: s.model.rotX + dx, rotY: s.model.rotY + dy } })),
  setModelOffset: (x, y) => set((s) => ({ model: { ...s.model, offsetX: x, offsetY: y } })),
  centerModel: (offsetX = DEF_OFFSET.x, offsetY = DEF_OFFSET.y) => set((s) => ({ model: { ...s.model, rotX: 0, rotY: 0, offsetX, offsetY, centerNonce: s.model.centerNonce + 1 } })),
  setModelUrl: (url, name) => set((s) => ({ model: { ...s.model, url, name } })),
  setParts: (keys) => set((s) => {
    const same = keys.length === s.parts.length && keys.every((k, i) => k === s.parts[i]);
    if (same) return {};                 // same model re-init → keep fills
    const fills: Record<string, FillSpec> = {};
    for (const k of keys) if (DEFAULT_FILLS[k]) fills[k] = { ...DEFAULT_FILLS[k] };
    return { parts: keys, partFills: fills, selectedPart: null };
  }),
  setPartFill: (key, patch) => set((s) => ({
    partFills: { ...s.partFills, [key]: { ...DEF_FILL, ...s.partFills[key], ...patch } },
  })),
  clearPartFill: (key) => set((s) => {
    const pf = { ...s.partFills };
    delete pf[key];
    return { partFills: pf };
  }),
  selectPart: (key) => set({ selectedPart: key }),
  setBgFill: (patch) => set((s) => ({ bgFill: { ...s.bgFill, ...patch } })),
  setBgTexAmount: (v) => set({ bgTexAmount: v }),
  setBgTexScale: (v) => set({ bgTexScale: v }),
  setSunIntensity: (v) => set({ sunIntensity: v }),
  setSunShadow: (v) => set({ sunShadow: v }),
  setSunMask: (url) => set({ sunMask: url }),
  setSunMaskScale: (v) => set({ sunMaskScale: v }),
  setSunMaskOffset: (x, y) => set({ sunMaskOffsetX: x, sunMaskOffsetY: y }),
  setScreenMedia: (m) => set({ screenMedia: m }),
}));
