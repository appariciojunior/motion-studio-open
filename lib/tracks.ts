// ============================================================
//  MOTION TRACKS — stacked motion layers on one shared timeline
//
//  A track is a self-contained mini-clip: its own template, its own control
//  values, its own easing curve, its own slice of the asset list, and its own
//  window on the scene timeline. The renderer draws one Pixi container per
//  track, in array order, so tracks composite over each other.
//
//  The scene clock stays single (principle 1: ONE clock for preview AND
//  export). Tracks never keep their own time — `resolveTrackTime` maps the
//  scene frame to a track-local frame, purely, every frame.
//
//  LOOP GUARANTEE. Templates quantize their speed with `loopCycles()` against
//  `ctx.totalFrames`, which is what makes frame 0 ≡ frame totalFrames. A track
//  therefore receives its WINDOW length as `totalFrames`, not the clip length:
//  each track loops seamlessly inside its own window. A track spanning the full
//  clip at timeScale 1 / offset 0 gets localFrame === frame and
//  localTotal === totalFrames, so it is bit-identical to the single-template
//  behaviour that predates tracks.
// ============================================================

import type { EasingSpec } from './easing';
import { clamp } from './motion';

// Only the blend modes PixiJS v8 supports natively. The advanced set (overlay,
// hard-light, hue…) needs the separate 'pixi.js/advanced-blend-modes' import
// and a render-group per layer, which isn't worth the cost here.
export const BLEND_MODES = ['normal', 'add', 'screen', 'multiply'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export interface TrackTransform {
  x: number;         // px offset applied on top of the template's pose
  y: number;
  scale: number;     // multiplies the template scale (1 = untouched)
  rotation: number;  // degrees, added to the template rotation
}

export interface MotionTrack {
  id: string;
  name: string;
  templateId: string;
  values: Record<string, any>;
  easing: EasingSpec;

  // Which assets feed this track's slots. Empty = the whole asset list (the
  // pre-track behaviour). Ids rather than indices so reordering assets in the
  // panel doesn't silently repoint a track at different images.
  assetIds: string[];

  visible: boolean;
  opacity: number;      // 0..1, multiplies every layer's alpha
  blend: BlendMode;

  // Window on the scene timeline, in scene frames. outFrame is exclusive.
  inFrame: number;
  outFrame: number;
  // Phase slip as a percentage of the window (0..100). Two tracks on the same
  // template at different offsets read as an echo/trail rather than a copy.
  offset: number;
  timeScale: number;    // 0.25..4 — how fast the track runs inside its window
  fade: number;         // frames of auto in/out fade at the window edges

  transform: TrackTransform;
}

export const DEFAULT_TRACK_TRANSFORM: TrackTransform = { x: 0, y: 0, scale: 1, rotation: 0 };

// `outFrame: TRACK_END` means "to the end of the clip", whatever the clip length
// becomes. A real frame number lands there the moment the user trims the bar.
// Storing the sentinel (rather than the resolved length) keeps an untrimmed
// track spanning the full clip after the duration changes — and unlike
// Infinity it survives JSON.stringify for persistence.
export const TRACK_END = 1e9;

// What the renderer needs to draw one track at one scene frame.
export interface TrackTime {
  active: boolean;      // the window contains this frame
  localFrame: number;   // the frame to hand the template
  localTotal: number;   // the window length — becomes ctx.totalFrames
  envelope: number;     // 0..1 fade envelope from the window edges
}

const INACTIVE: TrackTime = { active: false, localFrame: 0, localTotal: 1, envelope: 0 };

// Positive modulo — `%` keeps the sign of the dividend, which would send a
// negative offset outside the window.
const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Clamp a track's window to the clip and return it in whole frames. Exported
 * because the timeline UI has to draw exactly the window the renderer uses —
 * one source of truth for the geometry, or bars drift from behaviour.
 */
export function trackWindow(track: MotionTrack, totalFrames: number): { inFrame: number; outFrame: number; length: number } {
  const total = Math.max(1, Math.round(totalFrames));
  const inFrame = clamp(Math.round(track.inFrame), 0, total - 1);
  const outFrame = clamp(Math.round(track.outFrame), inFrame + 1, total);
  return { inFrame, outFrame, length: outFrame - inFrame };
}

/**
 * Map a scene frame to this track's local time. PURE — same inputs, same
 * output, every call. Both the live preview and the export capture go through
 * it, so a track's retiming is WYSIWYG.
 */
export function resolveTrackTime(track: MotionTrack, frame: number, totalFrames: number): TrackTime {
  if (!track.visible || track.opacity <= 0) return INACTIVE;

  const { inFrame, outFrame, length } = trackWindow(track, totalFrames);
  if (frame < inFrame || frame >= outFrame) return INACTIVE;

  const rel = frame - inFrame;

  // Slip the phase, then wrap into the window. The wrap is seam-free because
  // the template's own pose at local frame 0 equals its pose at `length`.
  const slip = (clamp(track.offset, 0, 100) / 100) * length;
  const scale = clamp(track.timeScale, 0.05, 8);
  const localFrame = mod(rel * scale + slip, length);

  // Symmetric edge fade, capped at half the window so in and out can't cross.
  const fadeFrames = clamp(Math.round(track.fade), 0, Math.floor(length / 2));
  let envelope = 1;
  if (fadeFrames > 0) {
    const rise = rel / fadeFrames;
    const fall = (length - rel) / fadeFrames;
    envelope = clamp(Math.min(rise, fall), 0, 1);
  }

  return { active: true, localFrame, localTotal: length, envelope };
}

/**
 * The assets a track draws, as indices into the scene asset list. An empty
 * `assetIds` means "all of them" — that keeps a freshly added track showing
 * real images instead of placeholders.
 */
export function trackAssetIndices(track: MotionTrack, assets: { id: string }[]): number[] {
  if (track.assetIds.length === 0) return assets.map((_, i) => i);
  const picked: number[] = [];
  for (const id of track.assetIds) {
    const idx = assets.findIndex((a) => a.id === id);
    if (idx >= 0) picked.push(idx);
  }
  // Every id is stale (assets deleted) → fall back to the full list rather
  // than rendering an empty track the user can't explain.
  return picked.length > 0 ? picked : assets.map((_, i) => i);
}
