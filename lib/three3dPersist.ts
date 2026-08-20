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

// Which project the autosave writes into. While null it holds its writes rather
// than stamping 3D state onto whichever project happens to be open next.
let target: string | null = null;
let lastSig = '';

export function setThreeDAutosaveTarget(projectId: string | null, seed?: ThreeDPartial | null): void {
  target = projectId;
  // Seed with what was just loaded, so opening a project doesn't immediately
  // rewrite it.
  lastSig = seed ? JSON.stringify(seed) : '';
}

/** Write now, bypassing the throttle. Call before switching projects. */
export function flushThreeD(): void {
  if (!target) return;
  try {
    const partial = buildThreeDPartial(use3DStore.getState());
    const sig = JSON.stringify(partial);
    if (sig === lastSig) return;
    lastSig = sig;
    writeProjectThreeD(target, partial);
  } catch {
    /* serialize error — skip this write */
  }
}

export function startThreeDAutosave(): () => void {
  let scheduled = false;
  const flush = () => { scheduled = false; flushThreeD(); };
  return use3DStore.subscribe(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(flush, 500);
  });
}
