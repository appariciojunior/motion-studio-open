// Shared video helpers for both renderers. A card asset can be backed by a
// <video> element uploaded to the GPU as a LIVE texture (Pixi VideoSource /
// three VideoTexture) instead of a still image. Centralizing detection and
// element creation here keeps the Pixi (2D) and three (3D) backends identical.

const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v)(?:[?#]|$)/i;

// A card is a video when it was ingested as one (kind) or its URL carries a
// known video extension. Blob uploads have no extension, so the explicit
// `kind` flag is the reliable signal for uploaded files.
export function isVideoSource(url: string, kind?: string): boolean {
  return kind === 'video' || VIDEO_EXT.test(url);
}

// A muted, looping, inline <video> that can autoplay without a user gesture
// (muted autoplay is always permitted). Detached from the DOM — both renderers
// read its frames straight into a GPU texture. Resolves once the first frame is
// decodable so the cover-crop can read real videoWidth/videoHeight.
export function createCardVideo(url: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous';
  v.loop = true;
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.preload = 'auto';
  v.src = url;
  return v;
}

// Consecutive seeks whose presented-frame callback never arrived, per element.
const presentMisses = new WeakMap<HTMLVideoElement, number>();

// Seek a video to `t` seconds (wrapped into its duration) and resolve once the
// exact frame is decoded — the way Remotion waits before capturing each export
// frame. A missing 'seeked' event is covered by requestVideoFrameCallback and a
// hard timeout, so a single frame can never hang the whole render.
export function seekVideoToTime(
  v: HTMLVideoElement,
  t: number,
  mode: 'loop' | 'hold' = 'loop',
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!v.duration || !isFinite(v.duration) || v.duration <= 0) { resolve(); return; }
    v.pause();
    // loop: wrap into the video's duration · hold: clamp just before the end so
    // a short video freezes on its final frame instead of restarting mid-clip
    const target = mode === 'hold'
      ? Math.min(t, Math.max(0, v.duration - 0.034))
      : t % v.duration;
    if (Math.abs(v.currentTime - target) < 1e-3 && v.readyState >= 2) { resolve(); return; }

    const frameApi = v as unknown as {
      requestVideoFrameCallback?: (
        cb: (now: number, metadata: { mediaTime: number }) => void,
      ) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };

    let done = false;
    let seekComplete = false;
    let framePresented = false;
    let frameCallbackId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener('seeked', onSeeked);
      if (frameCallbackId !== undefined) {
        frameApi.cancelVideoFrameCallback?.(frameCallbackId);
        frameCallbackId = undefined;
      }
      if (timer) clearTimeout(timer);
      if (grace) clearTimeout(grace);
      resolve();
    };
    // Prefer to capture after the callback registered for this seek reports a
    // presented frame: registering it after `seeked` can miss that presentation
    // and leave the previous GPU frame live. But presentation is the
    // compositor's job, and a tab that is hidden, minimised or simply busy
    // stops compositing — measured at 590-780 ms per frame in a non-compositing
    // page, which is what turned an export into an apparent hang. Decoding is
    // what the export actually depends on (both renderers snapshot the frame
    // with drawImage, which reads the decoded picture, not the composited one),
    // and `seeked` already guarantees that. So presentation is awaited only for
    // a short grace period after the seek completes, then capture proceeds.
    const PRESENT_GRACE_MS = 40;
    const maybeFinish = () => {
      if (!seekComplete) return;
      if (framePresented) { presentMisses.set(v, 0); finish(); return; }
      // A page that has stopped compositing never presents, and paying the
      // grace on every frame of a long export adds up. Three misses in a row
      // is enough to conclude this element is not being presented at all.
      if ((presentMisses.get(v) ?? 0) >= 3) { finish(); return; }
      if (grace === undefined) {
        grace = setTimeout(() => {
          presentMisses.set(v, (presentMisses.get(v) ?? 0) + 1);
          finish();
        }, PRESENT_GRACE_MS);
      }
    };
    const onVideoFrame = () => {
      frameCallbackId = undefined;
      framePresented = true;
      maybeFinish();
    };
    const onSeeked = () => {
      seekComplete = true;
      if (frameApi.requestVideoFrameCallback) maybeFinish();
      else setTimeout(finish, 0);
    };
    v.addEventListener('seeked', onSeeked, { once: true });
    timer = setTimeout(finish, 3000); // safety cap — never hang an export frame
    try {
      const fastSeek = (v as HTMLVideoElement & { fastSeek?: (time: number) => void }).fastSeek;
      if (v.dataset.motionIntraProxy === '1' && fastSeek) fastSeek.call(v, target);
      else v.currentTime = target;
      if (frameApi.requestVideoFrameCallback) {
        frameCallbackId = frameApi.requestVideoFrameCallback.call(v, onVideoFrame);
      }
    } catch { finish(); }
  });
}

const sequentialExportTime = new WeakMap<HTMLVideoElement, number>();

function rewindVideoForExport(v: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve) => {
    const frameApi = v as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (_now: number, metadata: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    v.pause();
    v.loop = false;
    try { v.currentTime = 0; } catch { resolve(); return; }
    if (!frameApi.requestVideoFrameCallback) {
      seekVideoToTime(v, 0).then(resolve);
      return;
    }
    let callbackId: number | undefined;
    let done = false;
    let presentedFrames = 0;
    const timer = setTimeout(finish, 1500);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (callbackId !== undefined) frameApi.cancelVideoFrameCallback?.(callbackId);
      v.pause();
      resolve();
    }
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      callbackId = undefined;
      presentedFrames++;
      // Ignore a stale callback still carrying the final pre-rewind frame.
      if (presentedFrames >= 2 && metadata.mediaTime <= Math.min(0.25, v.duration / 4)) finish();
      else callbackId = frameApi.requestVideoFrameCallback!(onFrame);
    };
    callbackId = frameApi.requestVideoFrameCallback(onFrame);
    v.play().catch(finish);
  });
}

// Export frames are requested in ascending order. Decode them in the same
// direction instead of issuing a random-access seek for every output frame.
// This turns an O(frames × GOP decode) path into a single forward decode pass.
export async function prepareVideoForSequentialExport(v: HTMLVideoElement): Promise<void> {
  sequentialExportTime.delete(v);
  await rewindVideoForExport(v);
  sequentialExportTime.set(v, 0);
}

export function advanceVideoForExport(
  v: HTMLVideoElement,
  t: number,
  fps: number,
  mode: 'loop' | 'hold' = 'loop',
): Promise<void> {
  if (!v.duration || !isFinite(v.duration) || v.duration <= 0) return Promise.resolve();
  const target = mode === 'hold'
    ? Math.min(t, Math.max(0, v.duration - 0.034))
    : t % v.duration;

  // On an all-intra proxy a seek decodes exactly one frame, so the export can
  // land on the requested time instead of approaching it. Measured at 30 fps:
  // 16.6 ms/frame and 60/60 distinct frames, against 32.8 ms/frame for the
  // forward-play path below. Sequential decoding is a workaround for expensive
  // seeks — once seeks are cheap it only costs accuracy.
  if (v.dataset.motionIntraProxy === '1') {
    sequentialExportTime.set(v, target);
    return seekVideoToTime(v, target, mode);
  }

  const previousTarget = sequentialExportTime.get(v) ?? 0;
  const frameTolerance = 0.5 / Math.max(1, fps);

  // The only random-access seek left is the intentional video loop boundary.
  if (target + frameTolerance < previousTarget) {
    sequentialExportTime.set(v, target);
    return rewindVideoForExport(v);
  }
  sequentialExportTime.set(v, target);
  v.loop = false;
  if (v.currentTime + frameTolerance >= target) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const frameApi = v as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (_now: number, metadata: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    let callbackId: number | undefined;
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (fallback = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (callbackId !== undefined) frameApi.cancelVideoFrameCallback?.(callbackId);
      v.pause();
      if (fallback) seekVideoToTime(v, target, mode).then(resolve);
      else resolve();
    };
    timer = setTimeout(() => finish(true), 1500);
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      callbackId = undefined;
      if (metadata.mediaTime + frameTolerance >= target) finish();
      else if (frameApi.requestVideoFrameCallback) {
        callbackId = frameApi.requestVideoFrameCallback(onFrame);
      } else finish(true);
    };
    if (frameApi.requestVideoFrameCallback) {
      callbackId = frameApi.requestVideoFrameCallback(onFrame);
      v.play().catch(() => finish(true));
    } else finish(true);
  });
}

// ---- export proxies ----
// Per-frame seeking during export is what makes video cards slow: normal H.264
// keeps keyframes ~2s apart, so every seek re-decodes a whole GOP. Before the
// capture loop we swap each card <video> to a server-built ALL-INTRA proxy
// (every frame a keyframe → each seek decodes exactly 1 frame), and restore the
// original source afterwards. Proxies are cached per source url for the session.

const proxyCache = new Map<string, string>(); // source url → proxy url

async function buildProxy(url: string, basePath: string): Promise<string | null> {
  const hit = proxyCache.get(url);
  if (hit) return hit;
  try {
    const blob = await (await fetch(url)).blob();
    const res = await fetch(`${basePath}/api/export`, { method: 'PUT', body: blob });
    if (!res.ok) return null;
    const { url: proxyUrl } = await res.json();
    if (typeof proxyUrl !== 'string') return null;
    proxyCache.set(url, basePath + proxyUrl);
    return basePath + proxyUrl;
  } catch {
    return null; // server/ffmpeg unavailable — export falls back to slow seeks
  }
}

// Swap every card video to its proxy; resolves when all swapped videos have a
// decodable frame again. Returns a restore() that puts the originals back.
export async function useVideoProxies(
  videos: Map<string, HTMLVideoElement>,
  basePath: string,
): Promise<() => void> {
  const swapped: { v: HTMLVideoElement; original: string }[] = [];
  await Promise.all(
    [...videos.entries()].map(async ([url, v]) => {
      const proxy = await buildProxy(url, basePath);
      if (!proxy) return;
      swapped.push({ v, original: url });
      v.pause();
      v.dataset.motionIntraProxy = '1';
      v.src = proxy;
      await whenVideoReady(v).catch(() => { /* keep going — worst case slow seeks */ });
    }),
  );
  return () => {
    for (const { v, original } of swapped) {
      delete v.dataset.motionIntraProxy;
      v.src = original;
      v.load();
    }
  };
}

// Await the first decodable frame (videoWidth/height become valid here).
export function whenVideoReady(v: HTMLVideoElement): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    if (v.readyState >= 2 /* HAVE_CURRENT_DATA */ && v.videoWidth) return resolve(v);
    const ok = () => { cleanup(); resolve(v); };
    const bad = () => { cleanup(); reject(new Error('video load failed')); };
    const cleanup = () => {
      v.removeEventListener('loadeddata', ok);
      v.removeEventListener('error', bad);
    };
    v.addEventListener('loadeddata', ok, { once: true });
    v.addEventListener('error', bad, { once: true });
  });
}
