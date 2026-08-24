// ============================================================
//  SAVE STATUS — one signal for "is my work in the project yet?"
//
//  Both autosaves (lib/scenePersist for the 2D document, lib/three3dPersist for
//  the Mockup/3D studio) write straight to localStorage without going through
//  any store, which is exactly why the editor could never say whether anything
//  had been saved. The Mockup panel's button was the only save the UI ever
//  admitted to, and it looked like the ONLY save there was.
//
//  So the writers report here, and the editor's project chip (components/
//  ProjectDock) reads it. Deliberately not a zustand store: this is a signal
//  about persistence, not part of any document, and the writers must be able to
//  report from module scope without importing a store that imports them back.
// ============================================================

export interface SaveStatus {
  /** Edits are queued but not written yet (the throttle window). */
  pending: boolean;
  /** When the last write landed, or null if nothing has been written yet. */
  savedAt: number | null;
}

// One object identity per state, so useSyncExternalStore can compare snapshots.
let status: SaveStatus = { pending: false, savedAt: null };
// A counter, not a boolean: the 2D and 3D autosaves each schedule their own
// flush, and one finishing must not clear the other's pending state.
let queued = 0;

const subscribers = new Set<() => void>();

function set(next: SaveStatus): void {
  if (next.pending === status.pending && next.savedAt === status.savedAt) return;
  status = next;
  for (const fn of subscribers) fn();
}

export function getSaveStatus(): SaveStatus {
  return status;
}

export function subscribeSaveStatus(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/** An edit landed and a write is scheduled. */
export function markPending(): void {
  queued += 1;
  set({ ...status, pending: true });
}

/** A write landed. */
export function markSaved(at = Date.now()): void {
  queued = Math.max(0, queued - 1);
  set({ pending: queued > 0, savedAt: at });
}

/** The scheduled write ran and found nothing to write (unchanged slice). */
export function markSettled(): void {
  queued = Math.max(0, queued - 1);
  set({ ...status, pending: queued > 0 });
}

/**
 * Switching projects: the "saved 2 min ago" of the project being left says
 * nothing about the one being opened. Queued flushes from before the switch are
 * dropped too — they belong to a target that has already moved.
 */
export function resetSaveStatus(savedAt: number | null = null): void {
  queued = 0;
  set({ pending: false, savedAt });
}
