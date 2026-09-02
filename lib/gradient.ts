// Shared gradient document + renderer used by the 2D canvas, WebGL scenes and
// 3D fills. The document is deliberately renderer-agnostic: old two-colour
// fields remain valid, while every new editor writes this richer v2 shape.

export const GRADIENT_VERSION = 2 as const;
export const MIN_GRADIENT_STOPS = 2;
export const MAX_GRADIENT_STOPS = 8;

export type GradientMode = 'basic' | 'advanced';
export type GradientShape = 'linear' | 'radial' | 'conic' | 'mesh' | 'warped-field' | 'twin-radial';
export type GradientMapping3D = 'uv' | 'object' | 'screen';

export interface GradientStop {
  id: string;
  color: string;
  position: number; // normalized 0..1
  opacity?: number;
}

export interface GradientAdvanced {
  warp: number;     // 0..2
  flow: number;     // 0..1
  scale: number;    // 0.4..4
  detail: number;   // 0..6
  contrast: number; // 0.5..3
}

export interface GradientSpec {
  version: typeof GRADIENT_VERSION;
  mode: GradientMode;
  shape: GradientShape;
  stops: GradientStop[];
  softness: number; // 0..1; spatially blurs rendered fields (point samples use a 1-D approximation)
  angle: number; // 0deg = left to right; clockwise in screen space
  center: { x: number; y: number };
  radius: number;
  advanced: GradientAdvanced;
  mapping3d: GradientMapping3D;
}

export const DEFAULT_GRADIENT_ADVANCED: GradientAdvanced = {
  warp: 0.3,
  flow: 0,
  scale: 1.3,
  detail: 1,
  contrast: 1.1,
};

const SHAPES: GradientShape[] = ['linear', 'radial', 'conic', 'mesh', 'warped-field', 'twin-radial'];
const MODES: GradientMode[] = ['basic', 'advanced'];
const MAPPINGS: GradientMapping3D[] = ['uv', 'object', 'screen'];

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const finite = (v: unknown, fallback: number) => Number.isFinite(Number(v)) ? Number(v) : fallback;

function cleanHex(value: unknown, fallback = '#000000'): string {
  const raw = String(value ?? '').trim();
  const short = /^#?([0-9a-f]{3})$/i.exec(raw);
  if (short) return `#${short[1].split('').map((c) => c + c).join('')}`.toLowerCase();
  const full = /^#?([0-9a-f]{6})$/i.exec(raw);
  return full ? `#${full[1].toLowerCase()}` : fallback;
}

export function createGradientSpec(
  c1 = '#2b1055',
  c2 = '#7597de',
  shape: GradientShape = 'linear',
): GradientSpec {
  return {
    version: GRADIENT_VERSION,
    mode: 'basic',
    shape,
    stops: [
      { id: 'stop-0', color: cleanHex(c1, '#2b1055'), position: 0, opacity: 1 },
      { id: 'stop-1', color: cleanHex(c2, '#7597de'), position: 1, opacity: 1 },
    ],
    softness: 0,
    angle: 90,
    center: { x: 0.5, y: 0.5 },
    radius: 0.72,
    advanced: { ...DEFAULT_GRADIENT_ADVANCED },
    mapping3d: 'uv',
  };
}

export function normalizeGradientSpec(
  input: Partial<GradientSpec> | null | undefined,
  c1 = '#2b1055',
  c2 = '#7597de',
  legacyShape: GradientShape = 'linear',
): GradientSpec {
  const base = createGradientSpec(c1, c2, legacyShape);
  const rawStops = Array.isArray(input?.stops) ? input!.stops : base.stops;
  const stops = rawStops
    .slice(0, MAX_GRADIENT_STOPS)
    .map((stop, i) => ({
      id: typeof stop?.id === 'string' && stop.id ? stop.id : `stop-${i}`,
      color: cleanHex(stop?.color, i ? cleanHex(c2) : cleanHex(c1)),
      position: clamp(finite(stop?.position, i / Math.max(1, rawStops.length - 1))),
      opacity: clamp(finite(stop?.opacity, 1)),
    }))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  while (stops.length < MIN_GRADIENT_STOPS) {
    const i = stops.length;
    stops.push({ id: `stop-${i}`, color: i ? cleanHex(c2) : cleanHex(c1), position: i, opacity: 1 });
  }

  const adv = input?.advanced;
  return {
    version: GRADIENT_VERSION,
    mode: MODES.includes(input?.mode as GradientMode) ? input!.mode! : base.mode,
    shape: SHAPES.includes(input?.shape as GradientShape) ? input!.shape! : legacyShape,
    stops,
    softness: clamp(finite(input?.softness, base.softness)),
    angle: ((finite(input?.angle, base.angle) % 360) + 360) % 360,
    center: {
      x: clamp(finite(input?.center?.x, base.center.x)),
      y: clamp(finite(input?.center?.y, base.center.y)),
    },
    radius: clamp(finite(input?.radius, base.radius), 0.05, 2),
    advanced: {
      warp: clamp(finite(adv?.warp, base.advanced.warp), 0, 2),
      flow: clamp(finite(adv?.flow, base.advanced.flow), 0, 1),
      scale: clamp(finite(adv?.scale, base.advanced.scale), 0.4, 4),
      detail: Math.round(clamp(finite(adv?.detail, base.advanced.detail), 0, 6)),
      contrast: clamp(finite(adv?.contrast, base.advanced.contrast), 0.5, 3),
    },
    mapping3d: MAPPINGS.includes(input?.mapping3d as GradientMapping3D) ? input!.mapping3d! : base.mapping3d,
  };
}

export function sortedStops(spec: GradientSpec): GradientStop[] {
  return spec.stops.slice().sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function legacyColorsForGradient(spec: GradientSpec) {
  const stops = sortedStops(spec);
  return {
    c1: stops[0]?.color ?? '#000000',
    c2: stops[stops.length - 1]?.color ?? '#ffffff',
    type: spec.shape === 'radial' || spec.shape === 'twin-radial' ? 'radial' as const : 'linear' as const,
  };
}

export interface GradientFillLike {
  type: string;
  c1: string;
  c2: string;
  gradient?: Partial<GradientSpec>;
}

export function gradientFromFill(fill: GradientFillLike): GradientSpec {
  const legacyShape: GradientShape = fill.type === 'radial' ? 'radial' : 'linear';
  return normalizeGradientSpec(fill.gradient, fill.c1, fill.c2, legacyShape);
}

export function fillPatchForGradient(specInput: GradientSpec) {
  const gradient = normalizeGradientSpec(specInput);
  const legacy = legacyColorsForGradient(gradient);
  return { ...legacy, gradient };
}

export function gradientSignature(spec: GradientSpec, phase = 0): string {
  const moving = spec.mode === 'advanced' && spec.advanced.flow > 0;
  // A long scene advances phase by tiny fractions on every RAF. Keying the
  // raster to all of them forced a full procedural repaint at monitor rate,
  // even when several consecutive images were visually indistinguishable.
  // 480 samples per seamless loop keeps an 8 s scene at 60 fps and naturally
  // settles near 24 fps for a 20 s scene.
  const sampledPhase = Math.round((((phase % 1) + 1) % 1) * 480) / 480;
  return JSON.stringify(spec) + (moving ? `|${sampledPhase.toFixed(4)}` : '');
}

export function gradientCss(specInput: GradientSpec): string {
  const spec = normalizeGradientSpec(specInput);
  // CSS is a startup/editor fallback. Keep authored stops here: expanding the
  // one-dimensional softness kernel into extra stops and then blurring the
  // real canvas applied softness twice, shifted endpoint colours and produced
  // a very wide dark wedge at the seam of conic gradients.
  const stops = sortedStops(spec).map((s) => {
    const color = s.opacity == null || s.opacity >= 1 ? s.color : `${s.color}${Math.round(s.opacity * 255).toString(16).padStart(2, '0')}`;
    return `${color} ${Math.round(s.position * 1000) / 10}%`;
  }).join(', ');
  const cx = Math.round(spec.center.x * 1000) / 10;
  const cy = Math.round(spec.center.y * 1000) / 10;
  if (spec.shape === 'radial') return `radial-gradient(circle at ${cx}% ${cy}%, ${stops})`;
  if (spec.shape === 'conic') return `conic-gradient(from ${spec.angle}deg at ${cx}% ${cy}%, ${stops})`;
  if (spec.shape === 'twin-radial') {
    const rx = Math.round((1 - spec.center.x) * 1000) / 10;
    const colors = sortedStops(spec);
    const inner = colors[0]?.color ?? '#000';
    const outer = colors[colors.length - 1]?.color ?? '#fff';
    return `radial-gradient(circle at ${cx}% ${cy}%, ${inner}, transparent 58%), radial-gradient(circle at ${rx}% ${cy}%, ${inner}, ${outer} 72%)`;
  }
  // Mesh and procedural fields need the canvas/WebGL renderer. This linear
  // expression is only a CSS fallback behind the real canvas during startup.
  return `linear-gradient(${spec.angle + 90}deg, ${stops})`;
}

type RGB = [number, number, number, number];
type PreparedStop = { position: number; color: RGB };

function parseColor(hex: string, alpha = 1): RGB {
  const h = cleanHex(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), clamp(alpha) * 255];
}

function mixColor(a: RGB, b: RGB, t: number): RGB {
  const k = clamp(t);
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
    a[3] + (b[3] - a[3]) * k,
  ];
}

function prepareStops(spec: GradientSpec): PreparedStop[] {
  return sortedStops(spec).map((stop) => ({
    position: stop.position,
    color: parseColor(stop.color, stop.opacity),
  }));
}

function sampleLinearStops(stops: PreparedStop[], t: number): RGB {
  const x = clamp(t);
  if (x <= stops[0].position) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    const right = stops[i];
    if (x <= right.position) {
      const left = stops[i - 1];
      const span = Math.max(1e-6, right.position - left.position);
      return mixColor(left.color, right.color, (x - left.position) / span);
    }
  }
  return stops[stops.length - 1].color;
}

function samplePreparedStops(stops: PreparedStop[], t: number, softness = 0): RGB {
  const amount = clamp(softness);
  if (amount <= 0) return sampleLinearStops(stops, t);

  // A small Gaussian convolution really feathers the colour ramp. Unlike an
  // easing curve, it does not squeeze the transition into a harder midpoint;
  // it rounds corners at authored stops and gently blends the ramp boundaries.
  const radius = amount * 0.28;
  const offsets = [-1, -0.5, 0, 0.5, 1];
  const weights = [1, 4, 6, 4, 1];
  const result: RGB = [0, 0, 0, 0];
  for (let i = 0; i < offsets.length; i++) {
    const color = sampleLinearStops(stops, t + offsets[i] * radius);
    for (let channel = 0; channel < 4; channel++) result[channel] += color[channel] * weights[i];
  }
  return result.map((channel) => channel / 16) as RGB;
}

export function sampleGradientRGB(specInput: GradientSpec, t: number): RGB {
  const spec = normalizeGradientSpec(specInput);
  // Used by the stop editor when inserting a new authored colour. Softness is
  // a render treatment, so it must not silently bake modified colours back
  // into the gradient document.
  return sampleLinearStops(prepareStops(spec), t);
}

export function gradientRenderStops(specInput: GradientSpec): GradientStop[] {
  // Authored stops remain the renderer contract. Raster backgrounds apply
  // softness spatially after painting; expanding the ramp here caused every
  // canvas path to receive the effect twice.
  return sortedStops(normalizeGradientSpec(specInput));
}

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function noise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

function fbm(x: number, y: number, detail: number): number {
  let sum = 0, amp = 0.55, freq = 1, norm = 0;
  const octaves = Math.max(1, Math.min(7, 1 + Math.round(detail)));
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / Math.max(1e-6, norm);
}

function prepareMeshPalette(stops: PreparedStop[]): RGB[] {
  return Array.from({ length: 5 }, (_, i) => stops[Math.min(i, stops.length - 1)].color);
}

function meshColor(spec: GradientSpec, colors: RGB[], stopCount: number, x: number, y: number): RGB {
  const spread = 1 - spec.softness * 0.22;
  const easedX = clamp(0.5 + (x - 0.5) * spread);
  const easedY = clamp(0.5 + (y - 0.5) * spread);
  const top = mixColor(colors[0], colors[1], easedX);
  const bottom = mixColor(colors[3], colors[2], easedX);
  let result = mixColor(top, bottom, easedY);
  if (stopCount >= 5) {
    const dx = x - spec.center.x, dy = y - spec.center.y;
    const pool = Math.exp(-(dx * dx + dy * dy) / 0.075);
    result = mixColor(result, colors[4], pool * 0.82);
  }
  return result;
}

function samplePreparedGradientPoint(
  spec: GradientSpec,
  stops: PreparedStop[],
  x: number,
  y: number,
  phase = 0,
  meshPalette?: RGB[],
): RGB {
  let px = x, py = y;
  const advanced = spec.mode === 'advanced';
  const { warp, flow, scale, detail, contrast } = spec.advanced;

  if (advanced) {
    const a = phase * Math.PI * 2;
    const driftX = Math.cos(a) * flow * 0.75;
    const driftY = Math.sin(a) * flow * 0.75;
    const sx = (px - 0.5) * scale + 0.5;
    const sy = (py - 0.5) * scale + 0.5;
    const amplitude = warp * 0.16 + (spec.shape === 'warped-field' ? 0.16 : 0);
    if (amplitude > 0) {
      const nx = fbm(sx * 2.2 + 7.4 + driftX, sy * 2.2 + driftY, detail);
      const ny = fbm(sx * 2.2 - 4.7 - driftY, sy * 2.2 + 9.1 + driftX, detail);
      px += (nx - 0.5) * amplitude;
      py += (ny - 0.5) * amplitude;
    }
  }

  if (spec.shape === 'mesh') return meshColor(spec, meshPalette ?? prepareMeshPalette(stops), stops.length, clamp(px), clamp(py));

  let t = 0;
  const dx = px - spec.center.x, dy = py - spec.center.y;
  if (spec.shape === 'radial') {
    t = Math.hypot(dx, dy) / Math.max(0.05, spec.radius);
  } else if (spec.shape === 'twin-radial') {
    const d1 = Math.hypot(px - spec.center.x, py - spec.center.y);
    const d2 = Math.hypot(px - (1 - spec.center.x), py - spec.center.y);
    t = Math.min(d1, d2) / Math.max(0.05, spec.radius);
  } else if (spec.shape === 'conic') {
    t = ((Math.atan2(dy, dx) / (Math.PI * 2)) + spec.angle / 360 + 1) % 1;
  } else if (spec.shape === 'warped-field') {
    const a = phase * Math.PI * 2;
    const n = fbm((px * spec.advanced.scale + Math.cos(a) * spec.advanced.flow) * 2.6,
      (py * spec.advanced.scale + Math.sin(a) * spec.advanced.flow) * 2.6, spec.advanced.detail + 1);
    t = 0.18 + n * 0.72 + (px - 0.5) * 0.16;
  } else {
    const rad = spec.angle * Math.PI / 180;
    const vx = Math.cos(rad), vy = Math.sin(rad);
    const cover = Math.max(1e-5, Math.abs(vx) + Math.abs(vy));
    t = 0.5 + ((px - 0.5) * vx + (py - 0.5) * vy) / cover;
  }

  if (advanced) t = 0.5 + (t - 0.5) * contrast;
  return samplePreparedStops(stops, clamp(t), spec.softness);
}

export function sampleGradientPoint(specInput: GradientSpec, x: number, y: number, phase = 0): RGB {
  const spec = normalizeGradientSpec(specInput);
  return samplePreparedGradientPoint(spec, prepareStops(spec), x, y, phase);
}

function addNativeStops(gradient: CanvasGradient, spec: GradientSpec) {
  // The rendered canvas receives one spatial blur pass below. Feeding the
  // already-feathered stop ramp into it would double the effect.
  for (const stop of sortedStops(spec)) {
    const color = stop.opacity == null || stop.opacity >= 1
      ? stop.color
      : `${stop.color}${Math.round(stop.opacity * 255).toString(16).padStart(2, '0')}`;
    gradient.addColorStop(stop.position, color);
  }
}

export function gradientBlurRadius(specInput: GradientSpec, width: number, height: number): number {
  const spec = normalizeGradientSpec(specInput);
  if (spec.softness <= 0) return 0;
  // Express the radius as a share of the short edge. Basic and Advanced use
  // different raster budgets, so a fixed raster-pixel cap made the same value
  // look different after their textures were scaled to the stage. The active
  // raster budgets already bound real render cost; the final guard only
  // protects direct callers with unusually large canvases.
  // Canvas/CSS blur treats this number as a Gaussian deviation; the visible
  // transition spans roughly six times the radius. 1.8% therefore produces a
  // deliberate ~11% feather at Softness 1 instead of washing out the field.
  return Math.min(64, Math.max(0, Math.min(width, height)) * 0.018 * spec.softness);
}

type BlurBuffers = { source: HTMLCanvasElement; padded: HTMLCanvasElement };
const blurBuffers = new WeakMap<HTMLCanvasElement, BlurBuffers>();

function canvasBuffer(width: number, height: number): HTMLCanvasElement {
  const buffer = document.createElement('canvas');
  buffer.width = width;
  buffer.height = height;
  return buffer;
}

function applyGradientBlur(canvas: HTMLCanvasElement, spec: GradientSpec): void {
  const blur = gradientBlurRadius(spec, canvas.width, canvas.height);
  if (blur <= 0) return;

  const pad = Math.max(2, Math.ceil(blur * 3));
  let buffers = blurBuffers.get(canvas);
  if (!buffers) {
    buffers = { source: canvasBuffer(canvas.width, canvas.height), padded: canvasBuffer(canvas.width + pad * 2, canvas.height + pad * 2) };
    blurBuffers.set(canvas, buffers);
  }
  const { source, padded } = buffers;
  if (source.width !== canvas.width) source.width = canvas.width;
  if (source.height !== canvas.height) source.height = canvas.height;
  if (padded.width !== canvas.width + pad * 2) padded.width = canvas.width + pad * 2;
  if (padded.height !== canvas.height + pad * 2) padded.height = canvas.height + pad * 2;

  const sourceCtx = source.getContext('2d');
  const paddedCtx = padded.getContext('2d');
  const ctx = canvas.getContext('2d');
  if (!sourceCtx || !paddedCtx || !ctx) return;
  const w = canvas.width, h = canvas.height;
  sourceCtx.clearRect(0, 0, w, h);
  sourceCtx.drawImage(canvas, 0, 0);

  // Extend the four edge pixels into the blur padding. A regular filtered draw
  // samples transparent pixels outside the canvas and creates a dark frame;
  // clamped edges keep a background gradient opaque from corner to corner.
  paddedCtx.clearRect(0, 0, padded.width, padded.height);
  paddedCtx.drawImage(source, pad, pad);
  paddedCtx.drawImage(source, 0, 0, w, 1, pad, 0, w, pad);
  paddedCtx.drawImage(source, 0, h - 1, w, 1, pad, pad + h, w, pad);
  paddedCtx.drawImage(source, 0, 0, 1, h, 0, pad, pad, h);
  paddedCtx.drawImage(source, w - 1, 0, 1, h, pad + w, pad, pad, h);
  paddedCtx.drawImage(source, 0, 0, 1, 1, 0, 0, pad, pad);
  paddedCtx.drawImage(source, w - 1, 0, 1, 1, pad + w, 0, pad, pad);
  paddedCtx.drawImage(source, 0, h - 1, 1, 1, 0, pad + h, pad, pad);
  paddedCtx.drawImage(source, w - 1, h - 1, 1, 1, pad + w, pad + h, pad, pad);

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(padded, -pad, -pad);
  ctx.restore();
}

export function paintGradientCanvas(
  canvas: HTMLCanvasElement,
  specInput: GradientSpec,
  width: number,
  height: number,
  phase = 0,
): void {
  const spec = normalizeGradientSpec(specInput);
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Softness is a single spatial operation for rendered backgrounds. The
  // shared point sampler retains its 1-D convolution as a fallback for 3D
  // vertex fills, where there is no complete image to post-filter.
  const renderSpec = spec.softness > 0 ? { ...spec, softness: 0 } : spec;

  // Basic gradients use the browser's native, high-resolution interpolation.
  if (spec.mode === 'basic' && (spec.shape === 'linear' || spec.shape === 'radial')) {
    let gradient: CanvasGradient;
    if (spec.shape === 'radial') {
      const cx = spec.center.x * w, cy = spec.center.y * h;
      gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * spec.radius);
    } else {
      const rad = spec.angle * Math.PI / 180;
      const vx = Math.cos(rad), vy = Math.sin(rad);
      const half = (Math.abs(vx) * w + Math.abs(vy) * h) / 2;
      const cx = w / 2, cy = h / 2;
      gradient = ctx.createLinearGradient(cx - vx * half, cy - vy * half, cx + vx * half, cy + vy * half);
    }
    addNativeStops(gradient, renderSpec);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    applyGradientBlur(canvas, spec);
    return;
  }

  const image = ctx.createImageData(w, h);
  const data = image.data;
  // Normalisation, sorting, hex parsing and opacity composition are invariant
  // across this raster. Preparing once here removes hundreds of thousands of
  // object allocations from every Advanced frame.
  const preparedStops = prepareStops(renderSpec);
  const meshPalette = renderSpec.shape === 'mesh' ? prepareMeshPalette(preparedStops) : undefined;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const c = samplePreparedGradientPoint(renderSpec, preparedStops, (px + 0.5) / w, (py + 0.5) / h, phase, meshPalette);
      const i = (py * w + px) * 4;
      data[i] = Math.round(c[0]); data[i + 1] = Math.round(c[1]);
      data[i + 2] = Math.round(c[2]); data[i + 3] = Math.round(c[3]);
    }
  }
  ctx.putImageData(image, 0, 0);
  applyGradientBlur(canvas, spec);
}

export function advancedRasterSize(width: number, height: number, maxEdge = 384): [number, number] {
  const scale = Math.min(1, maxEdge / Math.max(1, width, height));
  return [Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale))];
}

export function gradientRasterMaxEdge(specInput: GradientSpec): number {
  const spec = normalizeGradientSpec(specInput);
  if (spec.mode === 'basic' && (spec.shape === 'linear' || spec.shape === 'radial')) return 1080;
  // Animated procedural fields are deliberately lower resolution: they are
  // smooth colour fields, so canvas interpolation hides the difference while
  // the 7–8× lower pixel count keeps timeline playback and sliders responsive.
  if (spec.advanced.flow <= 0) return 288;
  if (spec.shape === 'warped-field' || spec.shape === 'mesh') return 160;
  // Conic has a hard seam/edge and needs more samples than the soft fields to
  // avoid visible stair-stepping when the canvas is scaled to the stage.
  if (spec.shape === 'conic') return 224;
  return 176;
}
