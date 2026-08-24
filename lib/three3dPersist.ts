import { use3DStore, type ThreeDState } from '@/store/use3DStore';
import { useSceneStore } from '@/store/useSceneStore';
import { projectMode, touchProject } from './projects';
import { markPending, markSaved, markSettled } from './saveStatus';

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
  const canvas = useSceneStore.getState();
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
    // Mockup owns its canvas/timeline settings too. They live in useSceneStore
    // at runtime because both renderers consume them, but are persisted inside
    // the Mockup document — never in a parallel 2D scene key.
    canvas: {
      fps: canvas.fps,
      duration: canvas.duration,
      aspect: canvas.aspect,
      width: canvas.width,
      height: canvas.height,
      customW: canvas.customW,
      customH: canvas.customH,
      safeArea: canvas.safeArea,
    },
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
  // Defence in depth: a 2D project may never acquire a Mockup document.
  if (projectMode(projectId) !== 'mockup') return;
  try { localStorage.setItem(keyFor(projectId), JSON.stringify(partial)); } catch { /* quota — non-fatal */ }
}

export function deleteProjectThreeD(projectId: string): void {
  try { localStorage.removeItem(keyFor(projectId)); } catch { /* non-fatal */ }
}

// Which project a save writes into. While null a save is a no-op rather than
// stamping 3D state onto whichever project happens to be open next.
//
// This USED to be explicit-only — a button in MockupPanel and nothing else —
// on the reasoning that a mockup is arranged and then kept, so an autosave on
// every store tick would let a stray drag of the model become the saved state.
// In practice that made the studio read as not saving at all: arrange a device,
// switch section or project (or just reload without noticing the button) and the
// arrangement was gone, because leaving deliberately did NOT write. So the 3D
// slice now autosaves on the same terms as the 2D scene — throttled, and only
// when the serialised slice actually changed — and `saveThreeD` stays as the
// explicit "save now" the button calls.
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
    // The projects list sorts and dates itself by updatedAt, which only the 2D
    // scene writer stamps. Without this a session spent entirely in Mockup left
    // its project reading "edited 3 days ago" and sinking down the list.
    touchProject(target);
    markSaved();
    return true;
  } catch {
    return false; // serialize or quota error
  }
}

/**
 * Write now if the studio differs from what was last saved. Same contract as
 * scenePersist's flushScene: call it before switching projects, or the last
 * arrangement lands in the wrong one (or nowhere).
 */
export function flushThreeD(): boolean {
  if (!target || !isThreeDDirty()) return false;
  return saveThreeD();
}

/**
 * Throttled autosave of the 3D/Mockup slice into the open project. Returns an
 * unsubscribe. Mirrors startSceneAutosave, including why it is hand-rolled: the
 * store churns during playback (mockup animation reads the clock, not the store,
 * but model nudges arrive in bursts), and the dirty check means a burst costs one
 * write instead of one per tick.
 */
export function startThreeDAutosave(): () => void {
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (!flushThreeD()) markSettled();
  };
  return use3DStore.subscribe(() => {
    if (scheduled) return;
    scheduled = true;
    markPending();
    setTimeout(flush, 600);
  });
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
