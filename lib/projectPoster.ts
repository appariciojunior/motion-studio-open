import { idbDelete, idbGet, idbPut } from './assetDb';
import { getRendererInstance } from './rendererInstance';
import { useSceneStore } from '@/store/useSceneStore';

// ============================================================
//  PROJECT POSTERS — the picture on a project card
//
//  The Projects tab is a launcher, so a card has to show the project rather
//  than name it. There is no way to RENDER another project's scene on demand:
//  both renderers read the live useSceneStore singleton (see lib/renderer.ts),
//  so drawing project B's scene would mean swapping the open document. What is
//  available instead is the stage that is already on screen — so a poster is
//  grabbed from the live canvas and cached per project.
//
//  Bytes go to IndexedDB, not localStorage: the project index and every scene
//  share that ~5MB quota, and a poster per project would be the biggest thing
//  in it.
//
//  Engine-agnostic on purpose — whichever stage is mounted (Pixi 2D, Three
//  mockup/3D) has registered itself as the renderer instance, so the poster
//  shows the tab the user was actually working in.
// ============================================================

const POSTER_W = 480;          // long edge of the cached image
const POSTER_QUALITY = 0.72;

export const posterKey = (projectId: string) => `poster:${projectId}`;

// Cards render from IndexedDB, which they read once. A capture has to tell them
// to read again — hence a version counter rather than a store: posters are not
// document state, and nothing but a card ever reads them.
let version = 0;
const listeners = new Set<() => void>();

export function posterVersion(): number {
  return version;
}

export function subscribePosters(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function bump(): void {
  version += 1;
  for (const fn of listeners) fn();
}

/**
 * Grab the live stage into `projectId`'s poster.
 *
 * The pixel read is SYNCHRONOUS (renderFrame + drawImage in this same task) for
 * two reasons: a WebGL drawing buffer without `preserveDrawingBuffer` is only
 * readable before the browser composites it, and callers capture *while
 * switching away* — one tick later the canvas already shows a different
 * project. Only the JPEG encode and the write are deferred.
 */
export function capturePoster(projectId: string | null | undefined): void {
  if (!projectId || typeof document === 'undefined') return;
  const renderer = getRendererInstance();
  if (!renderer) return;

  let src: HTMLCanvasElement | null = null;
  try {
    renderer.renderFrame(useSceneStore.getState().frame);
    src = renderer.extractCanvas();
  } catch {
    return; // stage mid-teardown — a stale poster beats a broken one
  }
  if (!src?.width || !src.height) return;

  const k = Math.min(1, POSTER_W / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k));
  const h = Math.max(1, Math.round(src.height * k));
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const g = off.getContext('2d');
  if (!g) return;
  try {
    g.drawImage(src, 0, 0, w, h);
  } catch {
    return; // tainted or zero-sized source
  }

  off.toBlob(
    (blob) => {
      if (!blob) return;
      idbPut(posterKey(projectId), blob).then(bump).catch(() => { /* quota — card falls back to its sketch */ });
    },
    'image/jpeg',
    POSTER_QUALITY,
  );
}

export function loadPoster(projectId: string): Promise<Blob | undefined> {
  return idbGet(posterKey(projectId)).catch(() => undefined);
}

export function deletePoster(projectId: string): void {
  idbDelete(posterKey(projectId)).then(bump).catch(() => { /* non-fatal */ });
}

/** Copy a poster across on duplicate, so the copy isn't a blank card. */
export function copyPoster(fromId: string, toId: string): void {
  loadPoster(fromId)
    .then((blob) => (blob ? idbPut(posterKey(toId), blob).then(bump) : undefined))
    .catch(() => { /* non-fatal */ });
}
