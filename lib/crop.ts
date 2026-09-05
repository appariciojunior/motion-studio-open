import type { Template } from '@/lib/types';

// Focal point for cover-fit cropping, both axes 0..1 (0.5/0.5 = centre).
export interface CropFocus { x: number; y: number; zoom?: number }

export const DEFAULT_FOCUS: CropFocus = { x: 0.5, y: 0.5 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const MAX_CROP_ZOOM = 5;
export function normalizeCrop(focus?: CropFocus | null): Required<CropFocus> {
  return {
    x: Number.isFinite(focus?.x) ? clamp01(focus!.x) : 0.5,
    y: Number.isFinite(focus?.y) ? clamp01(focus!.y) : 0.5,
    zoom: Number.isFinite(focus?.zoom) ? Math.max(1, Math.min(MAX_CROP_ZOOM, focus!.zoom!)) : 1,
  };
}

// User-selectable card shapes (the scene-level crop aspect). 'auto' defers to
// the template's declared cardAspect (or the 4:5 default).
export const CARD_SHAPES: Record<string, number> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '3:4': 3 / 4,
  '4:3': 4 / 3,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
};

// A shape the user typed, carried in the SAME string field the preset keys
// use — "3:7" sits where "4:5" would. Nothing downstream learns a new shape of
// data: persistence, history, both renderers, the export path and the
// thumbnails all keep passing one string through cardAspectFor.
//
// The bounds are not taste. This ratio reaches coverCrop as a divisor, so a
// zero, a negative or a NaN would take the crop with it; and past 10:1 the
// card is a hairline that reads as a rendering fault rather than as a choice.
// Out of range parses as "not a shape", which falls through to the template's
// own aspect — the same place an unknown string has always landed.
export const CUSTOM_SHAPE_MIN = 0.1;
export const CUSTOM_SHAPE_MAX = 10;

const SHAPE_PATTERN = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;

export function parseCardShape(shape?: string): number | null {
  if (!shape) return null;
  const parts = SHAPE_PATTERN.exec(shape.trim());
  if (!parts) return null;
  const w = Number(parts[1]);
  const h = Number(parts[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const ratio = w / h;
  if (ratio < CUSTOM_SHAPE_MIN || ratio > CUSTOM_SHAPE_MAX) return null;
  return ratio;
}

// The card shape a template lays out. Full-bleed templates ('canvas') always
// crop to the canvas aspect — a part-screen card there would leave gaps. For
// everything else the user's scene-level shape wins; 'auto' falls back to the
// template's declared cardAspect, then the 4:5 portrait default.
export function cardAspectFor(
  meta: Template['meta'],
  width: number,
  height: number,
  shape?: string,
): number {
  if (meta.cardAspect === 'canvas') return width / Math.max(1, height);
  // Presets are looked up before parsing so their exact stored numbers win:
  // "16:9" as a key is 16/9 to full precision, and re-deriving it from the
  // label would be the same number by luck rather than by definition.
  if (shape && CARD_SHAPES[shape]) return CARD_SHAPES[shape];
  const custom = parseCardShape(shape);
  if (custom !== null) return custom;
  return typeof meta.cardAspect === 'number' ? meta.cardAspect : 4 / 5;
}

// Cover-fit: the largest sub-rect of a (tw × th) image with `aspect`,
// anchored by the focal point — like CSS object-fit: cover + object-position.
// Images never stretch; the excess on the longer axis is cropped away.
export function coverCrop(tw: number, th: number, aspect: number, focus?: CropFocus | null) {
  const f = normalizeCrop(focus);
  let fw = tw;
  let fh = tw / aspect;
  if (fh > th) { fh = th; fw = th * aspect; }
  fw /= f.zoom;
  fh /= f.zoom;
  return {
    fx: (tw - fw) * clamp01(f.x),
    fy: (th - fh) * clamp01(f.y),
    fw,
    fh,
  };
}

// Cache key for a cropped texture (shared by both renderers).
export function cropKey(url: string, aspect: number, focus?: CropFocus | null) {
  const f = normalizeCrop(focus);
  return `${url}|${aspect.toFixed(4)}|${f.x}|${f.y}|${f.zoom}`;
}

// Source-pixel selection shared by direct manipulation and the renderers.
export function cropFromRect(tw: number, th: number, aspect: number, fx: number, fy: number, width: number): Required<CropFocus> {
  const base = coverCrop(tw, th, aspect);
  const zoom = Math.max(1, Math.min(MAX_CROP_ZOOM, base.fw / Math.max(Number.EPSILON, width)));
  const fw = base.fw / zoom, fh = base.fh / zoom;
  return normalizeCrop({ x: tw > fw ? fx / (tw - fw) : 0.5, y: th > fh ? fy / (th - fh) : 0.5, zoom });
}
