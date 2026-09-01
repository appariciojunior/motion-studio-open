// In-browser WebM export. Third sibling of webcodecsExport.ts (MP4) and
// gifExport.ts (GIF), sharing the same renderFrame contract so all three ride
// the one capture loop in ExportDialog.
//
// Unlike GIF, this one IS a WebCodecs job: VP9 is a video codec the encoder
// speaks natively. What WebCodecs does not do is containerise, so mediabunny
// muxes the compressed chunks into a .webm — the same division of labour that
// mp4-muxer performs for the H.264 path.
//
// VP9 over VP8: better quality per bit at the same bitrate, and universally
// available wherever WebM plays. AV1 is better still but encodes far slower in
// software, which is what most machines fall back to.

interface WCVideoFrame { close(): void }
interface WCEncoder {
  encode(frame: WCVideoFrame, opts?: { keyFrame?: boolean }): void;
  configure(config: Record<string, unknown>): void;
  flush(): Promise<void>;
  close(): void;
  encodeQueueSize: number;
}
interface WCEncoderCtor {
  new (init: { output: (chunk: unknown, meta: unknown) => void; error: (e: Error) => void }): WCEncoder;
  isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean }>;
}
interface WCFrameCtor {
  new (source: CanvasImageSource, init: { timestamp: number; duration?: number }): WCVideoFrame;
}

const getWC = () => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { VideoEncoder?: WCEncoderCtor; VideoFrame?: WCFrameCtor };
  return w.VideoEncoder && w.VideoFrame ? { VideoEncoder: w.VideoEncoder, VideoFrame: w.VideoFrame } : null;
};

// Profile 0, 8-bit 4:2:0 — the VP9 flavour every WebM player handles. Levels are
// advisory in the codec string, so the encoder is asked at a couple of them
// rather than assuming one is accepted.
async function pickConfig(VideoEncoder: WCEncoderCtor, width: number, height: number, fps: number) {
  // Same bits-per-pixel budget as the H.264 path, deliberately: giving the two
  // formats different targets would make any size comparison between them a
  // measure of this constant rather than of the codecs.
  const bitrate = Math.min(40_000_000, Math.max(4_000_000, Math.round(width * height * fps * 0.15)));
  for (const codec of ['vp09.00.41.08', 'vp09.00.10.08']) {
    for (const hw of ['prefer-hardware', 'no-preference']) {
      const config = { codec, width, height, framerate: fps, bitrate, hardwareAcceleration: hw };
      try {
        const res = await VideoEncoder.isConfigSupported(config);
        if (res.supported) return config;
      } catch { /* try next */ }
    }
  }
  return null;
}

export async function supportsWebm(width = 1080, height = 1920, fps = 30): Promise<boolean> {
  const wc = getWC();
  if (!wc) return false;
  return (await pickConfig(wc.VideoEncoder, width, height, fps)) !== null;
}

export interface WebmExportOpts {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  renderFrame: (f: number) => Promise<HTMLCanvasElement>;
  onProgress?: (done: number) => void;
}

export async function encodeWebmWebCodecs(opts: WebmExportOpts): Promise<Blob> {
  const wc = getWC();
  if (!wc) throw new Error('WebCodecs unavailable');
  const { width, height, fps, totalFrames, renderFrame, onProgress } = opts;

  const config = await pickConfig(wc.VideoEncoder, width, height, fps);
  if (!config) throw new Error('No supported VP9 encoder config');

  // Dynamic so mediabunny stays out of the initial bundle. CanvasSource owns
  // the VP9 colour + alpha encoders and writes the alpha packets as WebM side
  // data; a bare VideoEncoder defaults to discarding alpha.
  const { Output, WebMOutputFormat, BufferTarget, CanvasSource } =
    await import('mediabunny');

  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const staging = document.createElement('canvas');
  staging.width = width;
  staging.height = height;
  const stagingCtx = staging.getContext('2d', { alpha: true })!;
  const source = new CanvasSource(staging, {
    codec: 'vp9',
    bitrate: Number(config.bitrate),
    keyFrameInterval: 2,
    alpha: 'keep',
    hardwareAcceleration: 'no-preference',
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const frameDuration = 1 / fps;
  for (let f = 0; f < totalFrames; f++) {
    const src = await renderFrame(f);
    // clearRect is essential: drawImage composites onto the destination, so
    // without clearing, transparent pixels would retain the previous frame.
    stagingCtx.clearRect(0, 0, width, height);
    stagingCtx.drawImage(src, 0, 0, width, height);
    await source.add(f * frameDuration, frameDuration, { keyFrame: f % Math.max(1, Math.round(fps * 2)) === 0 });
    if (f === totalFrames - 1 || f % Math.max(1, Math.round(fps / 6)) === 0) onProgress?.(f + 1);
    if (f % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  await output.finalize();
  const buffer = (output.target as { buffer: ArrayBuffer | null }).buffer;
  if (!buffer) throw new Error('WebM muxer produced no output');
  return new Blob([buffer], { type: 'video/webm' });
}
