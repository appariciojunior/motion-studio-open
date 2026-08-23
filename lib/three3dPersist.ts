import { use3DStore, type ThreeDState } from '@/store/use3DStore';

// Per-project persistence for 3D and Mockup state.
//
// lib/scenePersist covers useSceneStore, which is the 2D document: tracks,
// canvas, assets, clock. None of the Mockup work lived there, so a project
// remembered its timeline and forgot which device was on stage, its finish, the
// artwork on its screen, the camera preset and the lighting. Reopening a mockup
// project rebuilt an empty studio.
//
// Kept in its own localStorage key rather than folded into ScenePartial. A
// project saved before this existed simply has no 3D blob and falls back to
// store defaults, so nothing needs migrating — and the two stores stay
// independently serialisable, which is what lets the autosaves be separate.
//
// Same throttle reasoning as scenePersist: writes are debounced and skipped when
// the serialised slice is unchanged.

const KEY_PREFIX = 'motion-3d-v1:';
const keyFor = (projectId: string) => `${KEY_PREFIX}${projectId}`;

// The persisted slice.
//
// `parts` and `selectedPart` are excluded: the effect reports its colourable
// groups when the model loads, and a click-selection is session state.
//
// blob: urls are stripped, never saved — they are dead on the next load. Screen
// media keeps its `id` so rehydrateScreenMedia can rebuild the url from
// IndexedDB; an uploaded .glb and a sun mask have no byte store behind them, so
// they fall back to the bundled default rather than to a broken reference.
export function buildThreeDPartial(s: ThreeDState) {
  const models: ThreeDState['models'] = {};
  for (const [effectId, m] of Object.entries(s.models)) {
    models[effectId] = m.url?.startsWith('blob:') ? { ...m, url: null, name: null } : m;
  }

  const screenMedia: ThreeDState['screenMedia'] = {};
  for (const [slot, m] of Object.entries(s.screenMedia)) {
    screenMedia[slot] = m ? { ...m, url: '' } : null;
  }

  return {
    effectId: s.effectId,
    params: s.params,
    models,
    partFills: s.partFills,
    bgFill: s.bgFill,
    bgTexAmount: s.bgTexAmount,
    bgTexScale: s.bgTexScale,
    sunIntensity: s.sunIntensity,
    sunShadow: s.sunShadow,
    sunMask: s.sunMask?.startsWith('blob:') ? null : s.sunMask,
    sunMaskScale: s.sunMaskScale,
    sunMaskOffsetX: s.sunMaskOffsetX,
    sunMaskOffsetY: s.sunMaskOffsetY,
    mockupAnimation: s.mockupAnimation,
    mockupSpeed: s.mockupSpeed,
    mockupEasing: s.mockupEasing,
    mockupMotionStrength: s.mockupMotionStrength,
    screenMedia,
    screenFit: s.screenFit,
    screenZoom: s.screenZoom,
    screenOffsetX: s.screenOffsetX,
    screenOffsetY: s.screenOffsetY,
    statusBarMode: s.statusBarMode,
    statusBarTime: s.statusBarTime,
    statusBarBattery: s.statusBarBattery,
    statusBarSignal: s.statusBarSignal,
  };
}

export type ThreeDPartial = ReturnType<typeof buildThreeDPartial>;

export function readProjectThreeD(projectId: string): ThreeDPartial | null {
  try {
    const raw = localStorage.getItem(keyFor(projectId));
    return raw ? (JSON.parse(raw) as ThreeDPartial) : null;
  } catch {
    return null;
  }
}

export function writeProjectThreeD(projectId: string, partial: ThreeDPartial): void {
  try { localStorage.setItem(keyFor(projectId), JSON.stringify(partial)); } catch { /* quota — non-fatal */ }
}

export function deleteProjectThreeD(projectId: string): void {
  try { localStorage.removeItem(keyFor(projectId)); } catch { /* non-fatal */ }
}

// Which project a save writes into. While null a save is a no-op rather than
// stamping 3D state onto whichever project happens to be open next.
//
// Saving here is EXPLICIT, unlike the 2D scene next door, which autosaves. The
// two are not inconsistent by accident: the 2D scene is the timeline the user is
// continuously editing, while a mockup is a studio they arrange and then keep,
// and an autosave on every store tick meant a stray drag of the model silently
// became the project's new saved state. So this exposes a save the UI calls from
// a button, and nothing writes on its own.
let target: string | null = null;
let lastSaved = '';

export function setThreeDSaveTarget(projectId: string | null, seed?: ThreeDPartial | null): void {
  target = projectId;
  // Seed with what was just loaded so `isThreeDDirty` starts out false: opening
  // a project is not an edit.
  lastSaved = seed ? JSON.stringify(seed) : '';
}

/** Write the current 3D state into the open project. Returns false if it could not. */
export function saveThreeD(): boolean {
  if (!target) return false;
  try {
    const partial = buildThreeDPartial(use3DStore.getState());
    lastSaved = JSON.stringify(partial);
    writeProjectThreeD(target, partial);
    return true;
  } catch {
    return false; // serialize or quota error
  }
}

/** Whether the studio differs from what was last saved (or loaded). */
export function isThreeDDirty(): boolean {
  if (!target) return false;
  try {
    return JSON.stringify(buildThreeDPartial(use3DStore.getState())) !== lastSaved;
  } catch {
    return false;
  }
}
