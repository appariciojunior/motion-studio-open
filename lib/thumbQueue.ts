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
