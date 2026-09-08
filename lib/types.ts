import type { EasingSpec } from './easing';

// ----- Control vocabulary. Templates may ONLY use these types. -----
export type ControlType =
  | 'slider'   // numeric, inline editable value.  needs min,max,step
  | 'toggle'   // two-state segmented (Forward/Reverse, On/Off)
  | 'pills'    // single-select option row.         needs options[]
  | 'select'   // dropdown.                         needs options[]
  | 'direction' // visual 3x3 edge/corner picker
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
  section?: 'Layout' | 'Motion' | 'Depth' | 'Finish';
  unit?: '°' | '%' | 'px' | '×' | 's' | '';
  description?: string;
  precision?: number;
  visibleWhen?: { key: string; equals?: any; not?: any };
  advanced?: boolean;
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
  // Darken the card toward black, 0 = untouched .. 1 = fully black. This is
  // how a card RECEDES: dropping its alpha instead makes it see-through, so
  // whatever it overlaps ghosts through it and the field reads as broken
  // glass rather than as depth. Reach for `alpha` when a card is genuinely
  // appearing or leaving, and `dim` when it is merely far away.
  dim?: number;
  // Show only part of the card, as fractions of its own box (0,0 = top-left,
  // 1,1 = bottom-right). The card does NOT move or squash — it stays exactly
  // where it is and a straight edge uncovers it, which is the only way to
  // build a real wipe: translating a full-frame card slides it, and scaling
  // one distorts it. Omitted means the whole card.
  clip?: { x0: number; y0: number; x1: number; y1: number };
  // Narrow one edge of the card against its opposite one. This is the
  // PROJECTIVE half of a 3D fold: the edge that has turned away from the camera
  // reads shorter, and no affine transform can say so — scale, skew and
  // rotation all keep opposite edges parallel and equal in length. A pose that
  // sets this is drawn through a perspective mesh instead of a plain sprite, so
  // reach for it only when a card is genuinely tilting out of the plane;
  // everything else stays on the cheaper sprite path.
  //
  // `edge` is the edge that shrinks, named in the card's OWN space (before
  // rotation). `ratio` is its length as a fraction of the opposite edge: 1 is
  // untapered, 0.75 is a quarter narrower. `clip` is ignored while tapered.
  taper?: { edge: 'top' | 'bottom' | 'left' | 'right'; ratio: number };
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
  quaternion?: { x: number; y: number; z: number; w: number };
  thickness?: number;        // px before the card's uniform pose scale
  shadowStrength?: number;   // 0..1, per-card cast/receive contribution
  materialExposure?: number; // linear multiplier, 1 = neutral
  bend?: number;             // centre sag in normalized card-width units; 0 = flat
  // Darken the card toward black, 0 = untouched .. 1 = black — the 3D twin of
  // LayerTransform.dim, and for the same reason: a card that is merely FAR
  // must not go see-through, or whatever sits behind it shows through and the
  // scene reads as glass. Distinct from `materialExposure`, which is lighting
  // and is ignored entirely for cards without thickness.
  dim?: number;
  curl?: number;             // signed cylindrical page curl in radians
  cornerPeel?: number;       // 0..1 directional sheet peel
  peelAngle?: number;        // radians rotated around the moving fold
  peelDirection?: number;    // degrees: 0 right, 90 top, 180 left, 270 bottom
  peelSoftness?: number;     // 0 sharp crease .. 1 progressively curved fold
  // Exact rolling-sheet deformation used by the Sticker presets. `front` and
  // `radius` are expressed in normalized card-width units; vertices beyond
  // the moving front wrap around a cylinder and eventually expose the back.
  stickerPeelFront?: number;
  stickerCurlRadius?: number;
  backfaceColor?: string;    // optional solid reverse side (used by rolling stickers)
  velocity?: { x: number; y: number; z: number }; // px/s, used by finish passes
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
  // The card's RESOLVED width/height, after the scene's card shape has had its
  // say over the template's declared `cardAspect` (see lib/crop cardAspectFor).
  // Templates that lay out a lattice need this: the renderer normalizes a
  // sprite's LONG edge, so a card's other dimension — and therefore the gap left
  // between neighbours — moves with the shape the user picked. Assuming the
  // declared aspect instead leaves the horizontal and vertical gutters unequal.
  // Optional so older ctx builders keep compiling; fall back to the declared one.
  cardAspect?: number;
}

export interface CameraPose {
  fov?: number;
  // Multiplier on the fov-derived "default fit distance" D — the z at which
  // the z=0 plane renders at exact 1:1 preview-pixel scale for that fov
  // (D = (height/2)/tan(fov/2), same quantity the three3d/ mockup rig calls
  // camDistance, 1.0 = default). This is what a "move the camera closer"
  // control should drive — it makes the subject fill more of the frame at
  // the SAME fov, which is a different move than widening the lens: fov
  // alone also changes how much keystone/perspective distortion appears,
  // distance alone does not. Ignored if `position` is also set (position
  // wins, matching Box's own explicit-position camera).
  distance?: number;
  position?: { x: number; y: number; z: number };
  target?: { x: number; y: number; z: number };
  near?: number;
  far?: number;
}

// ----- A motion template (SEAM 1) -----
export interface Template {
  meta: {
    id: string; name: string; group: string; thumbnail?: string;
    defaultEasing?: EasingSpec;               // curve the template ships with
    isNew?: boolean;                          // shows a NEW badge on the template card
    repeatAssets?: boolean;                   // slot i shows asset i % assets.length (high-count fields)
    engine?: 'pixi' | 'webgl';                // renderer backend; default 'pixi'
    catalog3d?: boolean;                      // visual family is genuinely spatial; display as "<group> 3D"
    catalogHidden?: boolean;                  // keep loading old scenes while hiding an unfinished preset from pickers
    cardAspect?: number | 'canvas';           // cover-crop shape: w/h ratio (default 4/5) or the canvas aspect (full-bleed)
  };
  controls: ControlDef[];                     // its FULL own set
  // How many layers this template wants, when that is a consequence of the
  // canvas rather than a choice. A lattice family is the case: its wall has to
  // hold enough cells to cover the frame, so shrinking the card must ADD cells —
  // the reference tool derives them the same way and ships no count control at
  // all. Templates that leave this out keep taking the layer count from their
  // own `count` control, which is still the right model for everything whose
  // card total is a design decision.
  layerCount?: (
    values: Record<string, any>,
    ctx: Pick<TransformCtx, 'width' | 'height' | 'cardAspect'>,
  ) => number;
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
  camera?: (values: Record<string, any>, ctx: TransformCtx) => CameraPose;
}

// ----- An effect (SEAM 2) -----
// ----- Effects: one shader, both engines -----
// An effect is a fragment shader plus its controls — deliberately NOT a
// PIXI.Filter. Returning a Filter tied this whole seam to Pixi, and the webgl
// path could not consume it: renderer3d looked the pixelate up BY ID and folded
// it into its output pass by hand. So an effect written once reached 143 of the
// 223 catalogue presets and never the other 80.
//
// The shader is written against ONE canonical space and each renderer wraps it:
//
//   vec4 fxMain(vec2 p)      p is in PIXELS, origin top-left, inside the
//                            effect's own area — not normalized, because most
//                            effects (grain size, pixel size, split distance)
//                            are authored in pixels and would otherwise have to
//                            undo an aspect ratio by hand.
//   fxSample(vec2 p)         reads the scene at a pixel coordinate. Each engine
//                            supplies its own body: Pixi has to unmap through
//                            uInputSize (its filter texture can be padded),
//                            three just divides by the resolution.
//   uResolution (vec2)       the area's size in pixels.
//   uTime (float)            seconds, DERIVED FROM THE FRAME, never the wall
//                            clock — or an animated effect would sample a
//                            different phase on every export and the same clip
//                            would never render twice the same.
export interface EffectContext {
  width: number;
  height: number;
  time: number; // seconds = frame / fps
}

export interface EffectShader {
  // The body: must define `vec4 fxMain(vec2 p)`. Helpers and uniforms above are
  // injected by the adapter, so declaring them here is a redefinition error.
  fragment: string;
  // Uniforms this effect owns, as name -> GLSL type ('float', 'vec2', ...).
  uniformTypes?: Record<string, 'float' | 'vec2' | 'vec3' | 'vec4'>;
  // Control values -> uniform values, once per frame.
  uniforms: (values: Record<string, any>, ctx: EffectContext) => Record<string, number | number[]>;
}

// Onde um efeito age. Guardado como string na cena para sobreviver a
// serializacao; ausente significa 'scene', que e como toda cena salva antes
// deste campo se comporta.
//
//   'scene'       o quadro composto inteiro, FUNDO INCLUIDO
//   'artwork'     so os cards; o fundo da cena passa intacto
//   'track:<id>'  so uma camada
export type EffectScope = 'scene' | 'artwork' | `track:${string}`;

export interface Effect {
  meta: {
    id: string;
    name: string;
    // Onde este efeito entra ao ser adicionado. Grao, vinheta e scanlines sao
    // efeitos de CAMERA e pertencem ao quadro todo. O Wave desloca geometria: no
    // quadro todo ele arrasta o fundo junto e abre borda vazia, sem ganhar nada,
    // entao nasce em 'artwork'. E so o ponto de partida — o usuario troca depois.
    defaultScope?: EffectScope;
  };
  controls: ControlDef[];
  shader: EffectShader;
  // Passes ADICIONAIS, rodados em ordem depois de `shader`, cada um lendo a
  // saida do anterior. Existe para o blur gaussiano, que so e linear se for
  // SEPARAVEL: um passe horizontal e um vertical. Um blur de raio r feito num
  // passe unico custa (2r+1)^2 amostras; separado custa 2*(2r+1) — a 20px de
  // raio, 1681 contra 82.
  //
  // `shader` continua sendo o primeiro passe, entao todo efeito de passe unico
  // segue valendo sem mudar nada.
  passes?: EffectShader[];
}
