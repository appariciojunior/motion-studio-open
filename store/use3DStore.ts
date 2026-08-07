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
  // Per effect id, so 3D and Mockup never share a model, a pose or a scale.
  models: Record<string, ModelState>;
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
  // Mockup mode — device animation preset/speed, and the image/video composited
  // onto the active device's "Screen" mesh (three3d/mockup.ts + ScreenContent).
  mockupAnimation: string;
  mockupSpeed: number;
  // Keyed by screen SLOT ('phone' | 'laptop' | 'tablet' | 'display'), not by
  // device: one phone screenshot then serves every phone, and switching device
  // keeps the right artwork on screen instead of clearing it.
  screenMedia: Record<string, { url: string; kind: 'image' | 'video' } | null>;
  // How that media is laid into the device's screen. `width` is the one a site
  // screenshot needs — fit the full width and let the tall page overflow, then
  // scroll it with screenOffsetY — which a plain centre-crop `cover` can't do.
  screenFit: 'cover' | 'width' | 'contain';
  screenZoom: number;      // multiplier over the fitted size
  screenOffsetX: number;   // 0 = left/top edge, 50 = centred, 100 = right/bottom
  screenOffsetY: number;
  setEffect: (id: string) => void;
  setParam: (effectId: string, key: string, value: any) => void;
  setModelScale: (v: number) => void;
  nudgeRot: (dx: number, dy: number) => void;
  setModelOffset: (x: number, y: number) => void;
  // Optional (x, y) lets Mockup mode re-centre a device at the origin — its
  // meshes are already bbox-centred, unlike DEF_OFFSET which is tuned for the
  // bundled dayse model.
  centerModel: (x?: number, y?: number) => void;
  setModelUrl: (url: string | null, name: string | null) => void;
  setMockupAnimation: (key: string) => void;
  setMockupSpeed: (v: number) => void;
  setScreenMedia: (slot: string, media: { url: string; kind: 'image' | 'video' } | null) => void;
  clearScreenMedia: () => void;
  setScreenFit: (fit: 'cover' | 'width' | 'contain') => void;
  setScreenZoom: (v: number) => void;
  setScreenOffset: (x: number, y: number) => void;
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
}

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

// Mockup starts from a different baseline: device meshes are already
// bbox-centred, so they want (0, 0) and scale 1 rather than the daisy's
// hand-tuned nudge, and no bundled model at all until a device is picked.
const MOCKUP_MODEL_DEFAULT: ModelState = { scale: 1, rotX: 0, rotY: 0, offsetX: 0, offsetY: 0, url: null, name: null, centerNonce: 0 };

// The model transform is held PER EFFECT, not globally. It used to be one
// shared object, so picking a device in Mockup overwrote `url` — and the 3D
// tab, which reads the same field to decide what to load, lost the flower and
// rendered the phone instead. Posing one mode also dragged the other's model
// with it. Keyed by effect id, the two keep their own model, pose and scale.
export function defaultModelFor(effectId: string): ModelState {
  return effectId === 'mockup' ? { ...MOCKUP_MODEL_DEFAULT } : { ...MODEL_DEFAULT };
}

// The active effect's model, seeded on first touch so a newly registered
// effect never reads undefined.
function modelOf(s: { effectId: string; models: Record<string, ModelState> }): ModelState {
  return s.models[s.effectId] ?? defaultModelFor(s.effectId);
}
function patchModel(
  s: { effectId: string; models: Record<string, ModelState> },
  patch: Partial<ModelState>,
) {
  return { models: { ...s.models, [s.effectId]: { ...modelOf(s), ...patch } } };
}

export const use3DStore = create<ThreeDState>((set) => ({
  effectId: 'cartoon',
  // Only user overrides live here; schema defaults are merged at read time
  // (Effect3DControls / ThreeStage3D / the effect init). Keeps loads always
  // matching the current schema defaults — no stale one-time seed.
  params: {},
  models: { cartoon: { ...MODEL_DEFAULT }, mockup: { ...MOCKUP_MODEL_DEFAULT } },
  parts: [],
  partFills: {},
  selectedPart: null,
  bgFill: { type: 'linear', c1: '#fbfbfc', c2: '#e6e8eb' },   // near-white → soft light grey
  bgTexAmount: 32,
  bgTexScale: 4.1,
  sunIntensity: 85,
  sunShadow: 0,
  sunMask: '/3d/textures/window.png',
  sunMaskScale: 46,
  sunMaskOffsetX: 0,
  sunMaskOffsetY: -2,
  mockupAnimation: 'static',
  mockupSpeed: 1,
  screenMedia: {},
  screenFit: 'cover',
  screenZoom: 1,
  screenOffsetX: 50,
  screenOffsetY: 50,
  setEffect: (effectId) => set({ effectId }),
  setParam: (effectId, key, value) =>
    set((s) => ({
      params: { ...s.params, [effectId]: { ...(s.params[effectId] ?? {}), [key]: value } },
    })),
  setModelScale: (v) => set((s) => patchModel(s, { scale: v })),
  nudgeRot: (dx, dy) => set((s) => {
    const m = modelOf(s);
    return patchModel(s, { rotX: m.rotX + dx, rotY: m.rotY + dy });
  }),
  setModelOffset: (x, y) => set((s) => patchModel(s, { offsetX: x, offsetY: y })),
  centerModel: (x, y) => set((s) => {
    const m = modelOf(s);
    // Falls back to the ACTIVE effect's own default, so recentring in Mockup
    // goes to (0, 0) and recentring in 3D goes to the daisy's tuned nudge.
    const d = defaultModelFor(s.effectId);
    return patchModel(s, {
      rotX: 0, rotY: 0,
      offsetX: x ?? d.offsetX, offsetY: y ?? d.offsetY,
      centerNonce: m.centerNonce + 1,
    });
  }),
  setModelUrl: (url, name) => set((s) => patchModel(s, { url, name })),
  setMockupAnimation: (key) => set({ mockupAnimation: key }),
  setMockupSpeed: (v) => set({ mockupSpeed: v }),
  setScreenMedia: (slot, media) => set((s) => ({ screenMedia: { ...s.screenMedia, [slot]: media } })),
  clearScreenMedia: () => set({ screenMedia: {} }),
  // Switching to `width` also jumps to the top of the page: fitting a tall site
  // screenshot by width and then leaving it centred hides the header, which is
  // the one part that shot is usually chosen for.
  setScreenFit: (fit) => set((s) => ({ screenFit: fit, screenOffsetY: fit === 'width' ? 0 : s.screenOffsetY })),
  setScreenZoom: (v) => set({ screenZoom: v }),
  setScreenOffset: (x, y) => set({ screenOffsetX: x, screenOffsetY: y }),
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
}));
