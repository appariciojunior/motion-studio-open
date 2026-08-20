// gifenc ships no type declarations (v1.0.3). These mirror its documented API
// surface — only the parts lib/gifExport.ts actually calls.
declare module 'gifenc' {
  /** Colour table: one [r, g, b] (or [r, g, b, a]) entry per palette slot. */
  export type GifPalette = number[][];

  export type GifPixelFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface QuantizeOptions {
    format?: GifPixelFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifPixelFormat,
  ): Uint8Array;

  /** Index of the closest palette entry to `pixel` ([r, g, b] or [r, g, b, a]). */
  export function nearestColorIndex(
    colors: GifPalette,
    pixel: number[],
    distanceFn?: (a: number[], b: number[]) => number,
  ): number;

  export interface WriteFrameOptions {
    /** Required on the first frame; later frames get a local colour table. */
    palette?: GifPalette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** Milliseconds. GIF stores hundredths, so this lands on a 100Hz grid. */
    delay?: number;
    /** 0 = loop forever, -1 = play once. */
    repeat?: number;
    dispose?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, options?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;
}
