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

  // dynamic so mediabunny stays out of the initial bundle, like mp4-muxer
  const { Output, WebMOutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedPacket } =
    await import('mediabunny');

  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const source = new EncodedVideoPacketSource('vp9');
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  let encodeError: Error | null = null;
  // mediabunny's add() is async (it applies writer backpressure), while the
  // encoder's output callback is sync — so the adds are chained onto a promise
  // and awaited once at the end rather than dropped on the floor.
  let pending: Promise<void> = Promise.resolve();
  const encoder = new wc.VideoEncoder({
    output: (chunk, meta) => {
      pending = pending.then(() => source.add(
        EncodedPacket.fromEncodedChunk(chunk as EncodedVideoChunk),
        meta as EncodedVideoChunkMetadata,
      )).catch((e: Error) => { encodeError = e; });
    },
    error: (e) => { encodeError = e; },
  });
  encoder.configure(config);

  // Only used when the renderer's canvas differs from the exact even output.
  const staging = document.createElement('canvas');
  staging.width = width;
  staging.height = height;
  const stagingCtx = staging.getContext('2d')!;

  const frameUs = Math.round(1_000_000 / fps);
  const keyInt = Math.max(1, Math.round(fps * 2)); // keyframe every ~2s

  try {
    for (let f = 0; f < totalFrames; f++) {
      if (encodeError) throw encodeError;
      const src = await renderFrame(f);
      let frameSource: CanvasImageSource = src;
      if (src.width !== width || src.height !== height) {
        stagingCtx.drawImage(src, 0, 0, width, height);
        frameSource = staging;
      }
      const frame = new wc.VideoFrame(frameSource, { timestamp: f * frameUs, duration: frameUs });
      encoder.encode(frame, { keyFrame: f % keyInt === 0 });
      frame.close();
      if (f === totalFrames - 1 || f % Math.max(1, Math.round(fps / 6)) === 0) onProgress?.(f + 1);
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      if (f % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    await encoder.flush();
    await pending; // every chunk actually reached the muxer
    if (encodeError) throw encodeError;
  } finally {
    try { encoder.close(); } catch { /* already closed on error */ }
  }

  await output.finalize();
  const buffer = (output.target as { buffer: ArrayBuffer | null }).buffer;
  if (!buffer) throw new Error('WebM muxer produced no output');
  return new Blob([buffer], { type: 'video/webm' });
}
