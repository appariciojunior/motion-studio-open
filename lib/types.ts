import type * as PIXI from 'pixi.js';
import type { EasingSpec } from './easing';

// ----- Control vocabulary. Templates may ONLY use these types. -----
export type ControlType =
  | 'slider'   // numeric, inline editable value.  needs min,max,step
  | 'toggle'   // two-state segmented (Forward/Reverse, On/Off)
  | 'pills'    // single-select option row.         needs options[]
  | 'select'   // dropdown.                         needs options[]
  | 'color'    // hex string
  | 'xypad'    // {x,y}
  | 'upload'   // file/url
  | 'text';    // string

export interface ControlDef {
  key: string;                 // unique within the template
  label: string;               // shown in panel
  type: ControlType;
  min?: number; max?: number; step?: number;  // slider
  options?: string[];          // pills / select / toggle
  default: number | string | boolean | { x: number; y: number };
}

// ----- What a template's transform returns for ONE layer at ONE frame -----
export interface LayerTransform {
  x: number;         // px, canvas centre = 0,0
  y: number;
  scale: number;     // 1 = native
  rotation: number;  // radians
  alpha: number;     // 0..1
  skewX?: number;    // optional, for fake-3D tilt
  skewY?: number;
  scaleX?: number;   // optional non-uniform squash (default 1) — flips/page turns
  scaleY?: number;   // optional non-uniform squash (default 1) — split-flap
  depth: number;     // sort order; higher = drawn on top / nearer
}

// ----- What a webgl template's transform3d returns for ONE layer -----
// World units: 1 unit = 1 preview px on the z=0 plane; +z is toward the
// camera; y follows canvas convention (down = positive), the renderer flips.
export interface LayerTransform3D {
  x: number;
  y: number;
  z: number;
  rotationX?: number;  // radians
  rotationY?: number;
  rotationZ?: number;
  scale: number;
  alpha: number;
}

// ----- The transform context handed to every template each frame -----
export interface TransformCtx {
  fps: number;
  width: number;
  height: number;
  duration: number;     // clip length in seconds
  totalFrames: number;  // max(1, round(duration * fps)) — the loop length
  // The scene's active easing curve, t∈[0,1] → y (see lib/easing).
  ease: (t: number) => number;
  // Remap a cyclic phase so each unit step is shaped by `ease`, keeping the
  // loop seamless: floor(p) + ease(frac(p)). Templates route their raw
  // (time·speed) phase through this to inherit the scene easing.
  easedPhase: (phase: number) => number;
}

// ----- A motion template (SEAM 1) -----
export interface Template {
  meta: {
    id: string; name: string; group: string; thumbnail?: string;
    defaultEasing?: EasingSpec;               // curve the template ships with
    isNew?: boolean;                          // shows a NEW badge on the template card
    repeatAssets?: boolean;                   // slot i shows asset i % assets.length (high-count fields)
    engine?: 'pixi' | 'webgl';                // renderer backend; default 'pixi'
    cardAspect?: number | 'canvas';           // cover-crop shape: w/h ratio (default 4/5) or the canvas aspect (full-bleed)
  };
  controls: ControlDef[];                     // its FULL own set
  transform: (
    frame: number,                            // absolute frame index
    index: number,                            // this layer's slot 0..count-1
    count: number,                            // total active layers
    values: Record<string, any>,              // current control values
    ctx: TransformCtx                          // canvas ctx + easing
  ) => LayerTransform;                         // PURE. no side effects.
  // webgl templates additionally provide real-3D poses; the 2D transform
  // stays as the thumbnail/fallback projection.
  transform3d?: (
    frame: number,
    index: number,
    count: number,
    values: Record<string, any>,
    ctx: TransformCtx
  ) => LayerTransform3D;                       // PURE. no side effects.
}

// ----- An effect (SEAM 2) -----
export interface Effect {
  meta: { id: string; name: string };
  controls: ControlDef[];
  createFilter: (values: Record<string, any>) => PIXI.Filter;
}
