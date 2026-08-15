// In-browser GIF export. Companion to webcodecsExport.ts: same capture loop,
// same renderFrame contract, no server round trip.
//
// WebCodecs is deliberately NOT used here, and cannot be: VideoEncoder only
// speaks video codecs (AVC/HEVC/VP8/VP9/AV1). GIF appears in the WebCodecs
// registry solely through ImageDecoder, on the reading side. So the frames are
// captured exactly like the MP4 path does and quantised to a 256-colour indexed
// image per frame by gifenc, which is what the ffmpeg palettegen/paletteuse
// pair was doing on the server.
//
// Per-frame palettes rather than one global palette: a global one would need a
// first pass over the clip just to sample colours, doubling the render cost,
// and motion graphics drift in hue across a clip far more than a photo does.
// A local colour table costs at most 768 bytes per frame — noise next to the
// pixel data — and keeps this to a single pass.

// Floyd–Steinberg error diffusion. gifenc ships no dithering ("there is
// currently no dithering support" — its own README), and without it a 256-entry
// palette bands badly on the gradients this app renders. ffmpeg's paletteuse
// dithers by default, which is the whole of the quality gap people notice.
//
// Speed comes from the same trick gifenc's applyPalette uses: the nearest-colour
// search is memoised per rgb565 bucket, so it runs at most 65536 times per frame
// instead of once per pixel. Serpentine traversal keeps the diffusion from
// building the diagonal worming that left-to-right-only scanning produces.
export function applyPaletteDithered(
  rgba: Uint8ClampedArray,
  palette: number[][],
  width: number,
  height: number,
  nearest: (colors: number[][], pixel: number[]) => number,
  strength: number,
): Uint8Array {
  const index = new Uint8Array(width * height);
  const cache = new Int32Array(65536).fill(-1);
  // Two rows of carried error (RGB interleaved), swapped at each scanline.
  let errCur = new Float32Array(width * 3);
  let errNext = new Float32Array(width * 3);

  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

  for (let y = 0; y < height; y++) {
    const leftToRight = (y & 1) === 0;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const step = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += step) {
      const p = (y * width + x) * 4;
      const e = x * 3;
      const r = clamp(rgba[p] + errCur[e] * strength);
      const g = clamp(rgba[p + 1] + errCur[e + 1] * strength);
      const b = clamp(rgba[p + 2] + errCur[e + 2] * strength);

      // rgb565 bucket — the same key space applyPalette caches on
      const key = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
      let idx = cache[key];
      if (idx < 0) idx = cache[key] = nearest(palette, [r, g, b]);
      index[y * width + x] = idx;

      const chosen = palette[idx];
      const er = r - chosen[0];
      const eg = g - chosen[1];
      const eb = b - chosen[2];

      // 7/16 ahead on this row, 3/16 · 5/16 · 1/16 on the next
      const ahead = x + step;
      if (ahead >= 0 && ahead < width) {
        const a = ahead * 3;
        errCur[a] += er * 0.4375; errCur[a + 1] += eg * 0.4375; errCur[a + 2] += eb * 0.4375;
      }
      const back = x - step;
      if (back >= 0 && back < width) {
        const bk = back * 3;
        errNext[bk] += er * 0.1875; errNext[bk + 1] += eg * 0.1875; errNext[bk + 2] += eb * 0.1875;
      }
      errNext[e] += er * 0.3125; errNext[e + 1] += eg * 0.3125; errNext[e + 2] += eb * 0.3125;
      if (ahead >= 0 && ahead < width) {
        const a = ahead * 3;
        errNext[a] += er * 0.0625; errNext[a + 1] += eg * 0.0625; errNext[a + 2] += eb * 0.0625;
      }
    }

    const swap = errCur;
    errCur = errNext;
    errNext = swap;
    errNext.fill(0);
  }

  return index;
}

export interface GifExportOpts {
  width: number;          // final output px (from targetFor)
  height: number;
  fps: number;
  totalFrames: number;
  // Realize + draw frame f and hand back the live canvas to copy from.
  renderFrame: (f: number) => Promise<HTMLCanvasElement>;
  onProgress?: (done: number) => void;
  /** Error-diffusion amount, 0 = off. 1 matches a full Floyd–Steinberg pass. */
  dither?: number;
}

// GIF stores frame delay in hundredths of a second, so the timebase is a 100Hz
// grid no matter what the scene's fps is. Report the delay the file will really
// carry rather than the requested one, so the caller can warn about the drift.
export function gifDelayMs(fps: number): number {
  return Math.max(20, Math.round(100 / fps) * 10); // clamp: <2cs is throttled by viewers
}

export function gifEffectiveFps(fps: number): number {
  return 1000 / gifDelayMs(fps);
}

export async function encodeGifInBrowser(opts: GifExportOpts): Promise<Blob> {
  const { width, height, fps, totalFrames, renderFrame, onProgress, dither = 1 } = opts;

  // dynamic so gifenc stays out of the initial bundle, like mp4-muxer
  const { GIFEncoder, quantize, applyPalette, nearestColorIndex } = await import('gifenc');

  // The renderer's canvas is WebGL and its size follows the capture scale, so
  // read pixels through a 2D canvas sized to the exact even output.
  const staging = document.createElement('canvas');
  staging.width = width;
  staging.height = height;
  // willReadFrequently: every frame is a getImageData, which is the whole point
  const ctx = staging.getContext('2d', { willReadFrequently: true })!;

  const gif = GIFEncoder();
  const delay = gifDelayMs(fps);

  for (let f = 0; f < totalFrames; f++) {
    const src = await renderFrame(f);
    ctx.drawImage(src, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);

    // rgb565 is gifenc's default and the finer bucket: 65536 candidate colours
    // feeding the quantiser instead of rgb444's 4096.
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = dither > 0
      ? applyPaletteDithered(data, palette, width, height, nearestColorIndex, dither)
      : applyPalette(data, palette, 'rgb565');
    gif.writeFrame(index, width, height, { palette, delay, repeat: 0 });

    onProgress?.(f + 1);
    // Quantising a 1080p frame is heavy synchronous work; yield every frame so
    // the progress bar and the cancel affordance stay alive.
    await new Promise((r) => setTimeout(r, 0));
  }

  gif.finish();
  // bytes() hands back a copy already detached from the encoder's buffer
  const bytes = gif.bytes();
  return new Blob([bytes as unknown as BlobPart], { type: 'image/gif' });
}
