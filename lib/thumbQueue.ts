// One cooperative queue for every catalogue still. Both thumbnail engines move
// a shared canvas between cards, so concurrent snapshots are both wasteful and
// unsafe: one card can read the canvas after another card has already drawn.

type Job = {
  key: string;
  priority: number;
  task: () => string | null | Promise<string | null>;
  resolve: (value: string | null) => void;
  reject: (reason: unknown) => void;
  cancelled: boolean;
};

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
const jobs: Job[] = [];
let draining = false;
let pauseDepth = 0;
let resumeWaiters: Array<() => void> = [];

/**
 * Keep queued still captures away from the shared renderers while a live
 * preview owns their canvas. Captures resume as soon as the last preview lets
 * go. The release function is idempotent so effect cleanup is safe.
 */
export function pauseThumbQueue(): () => void {
  pauseDepth++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pauseDepth = Math.max(0, pauseDepth - 1);
    if (pauseDepth === 0) {
      const waiters = resumeWaiters;
      resumeWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  };
}

export async function waitForThumbQueue(): Promise<void> {
  // A preview can move from one card to another in the same pointer event. In
  // that case the old owner resumes the queue and the new owner pauses it again
  // before this continuation runs, so re-check after every wake-up.
  while (pauseDepth > 0) {
    await new Promise<void>((resolve) => resumeWaiters.push(resolve));
  }
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 120 });
    } else {
      globalThis.setTimeout(resolve, 0);
    }
  });
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (jobs.length) {
      jobs.sort((a, b) => b.priority - a.priority);
      const job = jobs.shift()!;
      if (job.cancelled) continue;
      await idle();
      await waitForThumbQueue();
      if (job.cancelled) continue;
      try {
        const value = await job.task();
        if (value) cache.set(job.key, value);
        job.resolve(value);
      } catch (error) {
        job.reject(error);
      } finally {
        pending.delete(job.key);
      }
    }
  } finally {
    draining = false;
  }
}

export function cachedThumb(key: string): string | null {
  return cache.get(key) ?? null;
}

export function scheduleThumb(
  key: string,
  task: () => string | null | Promise<string | null>,
  priority = 0,
): { promise: Promise<string | null>; cancel: () => void } {
  const hit = cache.get(key);
  if (hit) return { promise: Promise.resolve(hit), cancel: () => {} };

  const existing = pending.get(key);
  if (existing) return { promise: existing, cancel: () => {} };

  let job!: Job;
  const promise = new Promise<string | null>((resolve, reject) => {
    job = { key, priority, task, resolve, reject, cancelled: false };
    jobs.push(job);
  });
  pending.set(key, promise);
  void drain();
  return {
    promise,
    cancel: () => {
      job.cancelled = true;
      pending.delete(key);
      job.resolve(null);
    },
  };
}

export function clearThumbCache() {
  cache.clear();
}
