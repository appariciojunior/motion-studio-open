import { create } from 'zustand';
import { useSceneStore, type SceneState } from './useSceneStore';

// ============================================================
//  UNDO / REDO
//
//  Every control in this app writes to the store on every pointer move, so a
//  naive "one entry per store change" history would put hundreds of entries in
//  a single slider drag and make undo useless. Entries are therefore COALESCED:
//  changes are collected and committed as one entry once the user stops for
//  COALESCE_MS. One gesture — a drag, a typed number, a template pick — becomes
//  one undo step.
//
//  Snapshots hold REFERENCES, not deep clones. Every action in useSceneStore
//  builds new objects rather than mutating (verified: no push/splice on state),
//  so a shallow capture is both safe and cheap — and a shallow reference
//  comparison detects any change exactly.
//
//  This deliberately does NOT reuse buildScenePartial from lib/scenePersist:
//  that blanks the url of uploaded assets (correct for disk, where a blob: URL
//  would be dead on reload) and reusing it here would make undo wipe uploaded
//  images. History lives in memory for one session, so it keeps live urls.
// ============================================================

const COALESCE_MS = 450;
// Bounded so a long session can't grow memory without limit. Snapshots are
// shallow, so each one is a handful of references.
const MAX_ENTRIES = 60;

// The undoable slice: everything describing the scene, minus the transient clock
// (frame / playing) and minus customPresets, which is a user-wide library rather
// than part of any one scene.
const KEYS = [
  'tracks', 'activeTrackId',
  'fps', 'duration',
  'aspect', 'width', 'height', 'customW', 'customH',
  'safeArea', 'background', 'logo', 'audioUrl',
  'assets', 'cardShape', 'videoEnd', 'effects',
] as const;

type Snapshot = Pick<SceneState, (typeof KEYS)[number]>;

function snapshot(s: SceneState): Snapshot {
  const out = {} as Record<string, unknown>;
  for (const k of KEYS) out[k] = s[k];
  return out as Snapshot;
}

// Shallow reference comparison — exact for an immutably-updated store.
function same(a: Snapshot, b: Snapshot): boolean {
  for (const k of KEYS) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Apply a snapshot. Routes through `hydrate` rather than setState so the
 * active-track projection and the per-track value merge stay in one place —
 * writing the motion fields directly would leave the track stale.
 *
 * `hydrate` forces frame 0 ("always start at the clip head"), which is right on
 * load but jarring on undo, so the playhead is put back afterwards.
 */
function apply(snap: Snapshot) {
  const scene = useSceneStore.getState();
  const frame = scene.frame;
  scene.hydrate(snap);
  useSceneStore.setState({ frame });
}

interface HistoryState {
  past: Snapshot[];
  future: Snapshot[];
  canUndo: boolean;
  canRedo: boolean;

  undo: () => void;
  redo: () => void;
  /** Drop all history — called when the open project changes. */
  reset: () => void;
  /** Subscribe to the scene store. Returns an unsubscribe. */
  start: () => () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => {
  // `baseline` is the snapshot the scene currently sits on. Undo walks backwards
  // from it; redo walks forwards. It is not React state — nothing renders from
  // it, and it changes on every commit.
  let baseline: Snapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Set while apply() runs, so restoring a snapshot can't be recorded as a new
  // edit and trap the user in a loop.
  let applying = false;

  const commit = () => {
    timer = null;
    if (applying) return;
    const current = snapshot(useSceneStore.getState());
    if (!baseline) { baseline = current; return; }
    if (same(baseline, current)) return;

    const past = [...get().past, baseline];
    if (past.length > MAX_ENTRIES) past.shift();
    baseline = current;
    // A fresh edit invalidates the redo branch.
    set({ past, future: [], canUndo: past.length > 0, canRedo: false });
  };

  return {
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,

    undo: () => {
      // Flush any in-flight gesture first, or the edit being undone would still
      // be pending and would land on top afterwards.
      if (timer) { clearTimeout(timer); commit(); }
      const { past, future } = get();
      if (past.length === 0 || !baseline) return;
      const prev = past[past.length - 1];
      const restored = baseline;
      applying = true;
      apply(prev);
      applying = false;
      baseline = prev;
      const nextPast = past.slice(0, -1);
      const nextFuture = [restored, ...future];
      set({
        past: nextPast,
        future: nextFuture,
        canUndo: nextPast.length > 0,
        canRedo: true,
      });
    },

    redo: () => {
      if (timer) { clearTimeout(timer); commit(); }
      const { past, future } = get();
      if (future.length === 0 || !baseline) return;
      const next = future[0];
      const left = baseline;
      applying = true;
      apply(next);
      applying = false;
      baseline = next;
      const nextPast = [...past, left];
      const nextFuture = future.slice(1);
      set({
        past: nextPast,
        future: nextFuture,
        canUndo: true,
        canRedo: nextFuture.length > 0,
      });
    },

    // Switching projects must clear history: undoing across the switch would
    // write one project's scene into another.
    reset: () => {
      if (timer) { clearTimeout(timer); timer = null; }
      baseline = snapshot(useSceneStore.getState());
      set({ past: [], future: [], canUndo: false, canRedo: false });
    },

    start: () => {
      baseline = snapshot(useSceneStore.getState());
      return useSceneStore.subscribe(() => {
        if (applying) return;
        // Playback moves `frame` every animation frame; it is not in the
        // snapshot, so restart the debounce only when something undoable moved.
        if (baseline && same(baseline, snapshot(useSceneStore.getState()))) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(commit, COALESCE_MS);
      });
    },
  };
});
