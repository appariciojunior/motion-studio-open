import type { Template } from '@/lib/types';
import { TAU, clamp, frac, hash2, lerp, loopCycles, smooth } from '@/lib/motion';
import { quaternionFromEuler, wrapEnvelope } from '@/lib/tilt3d';

const BASE = 340;

// Thickness/shadow are OUR OWN depth-shading additions — animos exposes no
// equivalent control for either on Card Tunnel or Depth Stack Scroll, so
// there is no measured fidelity target here, only usefulness. Corner Radius
// IS measured on both, but at a DIFFERENT default each (1.5 vs 3), so it can
// no longer be one shared control — each template below declares its own.
const sharedFinish = [
  { key: 'thickness', label: 'Thickness', type: 'slider' as const, min: 0, max: 24, step: 1, default: 10, section: 'Finish' as const, unit: 'px' as const, advanced: true },
  { key: 'shadow', label: 'Shadow', type: 'toggle' as const, options: ['on','off'], default: 'off', section: 'Finish' as const, advanced: true },
];

export const cardTunnel: Template = {
  meta: { id: 'tunnel-01', name: 'Card Tunnel', group: '3D & Perspective', isNew: true, engine: 'webgl', catalog3d: true, repeatAssets: true, cardAspect: 16 / 9, defaultEasing: { id: 'linear' } },
  controls: [
    // Direction is the only motion control the reference exposes for this
    // family — Count/Perspective/Speed below are our own additions (no
    // measured equivalent), kept because they are genuinely useful, not
    // because animos has them.
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward','backward'], default: 'forward', section: 'Motion' },
    { key: 'count', label: 'Card Count', type: 'slider', min: 8, max: 48, step: 4, default: 24, section: 'Layout', advanced: true },
    { key: 'tunnelSize', label: 'Tunnel Size', type: 'slider', min: 60, max: 120, step: 2, default: 90, section: 'Layout', unit: '%' },
    { key: 'cardLength', label: 'Card Length', type: 'slider', min: 30, max: 90, step: 5, default: 55, section: 'Layout', unit: '%' },
    { key: 'gap', label: 'Gap', type: 'slider', min: 2, max: 20, step: 1, default: 10, section: 'Layout', unit: '%' },
    { key: 'depth', label: 'Tunnel Depth', type: 'slider', min: 500, max: 2400, step: 25, default: 1500, section: 'Depth', unit: 'px', advanced: true },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 100, step: 1, default: 58, section: 'Depth', unit: '%', advanced: true },
    { key: 'camDistance', label: 'Camera Distance', type: 'slider', min: 0.5, max: 2.5, step: 0.05, default: 1, section: 'Depth', unit: '×', precision: 2, advanced: true,
      description: 'Moves the camera itself closer or further, at the same Perspective.' },
    { key: 'depthFade', label: 'Depth Fade', type: 'slider', min: 0, max: 100, step: 5, default: 45, section: 'Finish', unit: '%' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.35, section: 'Motion', unit: '×', precision: 1, advanced: true },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 12, step: 0.5, default: 1.5, section: 'Finish', unit: '%', precision: 1 },
    ...sharedFinish,
  ],
  camera: (v) => ({ fov: 34 + clamp(v.perspective / 100, 0, 1) * 38, near: 1, far: 6000, distance: v.camDistance }),
  transform3d: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'backward' ? -1 : 1;
    const laneCount = Math.max(1, Math.ceil(count / 4));
    const lane = Math.floor(index / 4);
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, laneCount) * dir;
    const u = frac(lane / laneCount - phase / laneCount);
    const side = index % 4;
    const half = Math.min(ctx.width, ctx.height) * (v.tunnelSize / 100) * 0.42;
    const z = lerp(-v.depth * 0.62, v.depth * 0.42, u);
    const edge = wrapEnvelope(u, 0.08);
    const farFade = 1 - (v.depthFade / 100) * smooth(clamp((0.28 - u) / 0.28, 0, 1));
    const cardPx = Math.min(ctx.width, ctx.height) * (v.cardLength / 100) * (1 - v.gap / 120);
    let x = 0, y = 0, rx = 0, ry = 0;
    if (side === 0) { x = -half; ry = Math.PI / 2; }
    if (side === 1) { x = half; ry = -Math.PI / 2; }
    if (side === 2) { y = -half; rx = Math.PI / 2; }
    if (side === 3) { y = half; rx = -Math.PI / 2; }
    const speedZ = -(loopCycles(v.speed, ctx.duration, laneCount) / laneCount) * v.depth / Math.max(0.001, ctx.duration) * dir;
    return {
      x, y, z,
      quaternion: quaternionFromEuler(rx, ry, 0),
      scale: cardPx / BASE,
      alpha: edge * farFade,
      thickness: v.thickness,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: 0.62 + u * 0.48,
      velocity: { x: 0, y: 0, z: speedZ },
    };
  },
  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'backward' ? -1 : 1;
    const laneCount = Math.max(1, Math.ceil(count / 4));
    const lane = Math.floor(index / 4);
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, laneCount) * dir;
    const u = frac(lane / laneCount - phase / laneCount);
    const side = index % 4;
    const half = Math.min(ctx.width, ctx.height) * (v.tunnelSize / 100) * 0.32;
    const zN = smooth(u);
    return {
      x: side === 0 ? -half : side === 1 ? half : 0,
      y: side === 2 ? -half : side === 3 ? half : 0,
      scale: (Math.min(ctx.width, ctx.height) * v.cardLength / 100 / BASE) * lerp(0.2, 1, zN),
      rotation: side < 2 ? Math.PI / 2 : 0,
      alpha: wrapEnvelope(u, 0.08),
      depth: u,
    };
  },
};

export const depthStackScroll: Template = {
  meta: { id: 'depth-stack-01', name: 'Depth Stack Scroll', group: '3D & Perspective', isNew: true, engine: 'webgl', catalog3d: true, repeatAssets: true, cardAspect: 16 / 9, defaultEasing: { id: 'smooth' } },
  controls: [
    { key: 'layout', label: 'Layout', type: 'pills', options: ['fan','scatter'], default: 'fan', section: 'Layout' },
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward','backward'], default: 'forward', section: 'Motion' },
    { key: 'count', label: 'Card Count', type: 'slider', min: 4, max: 50, step: 1, default: 7, section: 'Layout' },
    { key: 'cardSizePct', label: 'Card Size', type: 'slider', min: 20, max: 70, step: 1, default: 40, section: 'Layout', unit: '%' },
    // Percentage of the stage, not a raw px depth — matches the reference's
    // own unit. Rescaled inside transform3d so the already-verified default
    // look (previously 720px on a ~1080 stage) lands in the same place.
    { key: 'depthGap', label: 'Depth Gap', type: 'slider', min: 18, max: 80, step: 2, default: 32, section: 'Depth', unit: '%' },
    { key: 'spread', label: 'Spread', type: 'slider', min: 0, max: 120, step: 2, default: 26, section: 'Layout', unit: '%' },
    { key: 'spreadAngle', label: 'Spread Angle', type: 'slider', min: -180, max: 180, step: 2, default: -58, section: 'Layout', unit: '°' },
    { key: 'wobble', label: 'Wobble', type: 'slider', min: 0, max: 100, step: 5, default: 30, section: 'Motion', unit: '%',
      description: 'Adds a gentle per-card oscillation on top of the resting spread, out of phase card to card.' },
    { key: 'tilt', label: 'Resting Tilt', type: 'slider', min: -20, max: 20, step: 0.5, default: 0, section: 'Depth', unit: '°', precision: 1, advanced: true },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 100, step: 1, default: 42, section: 'Depth', unit: '%', advanced: true },
    { key: 'camDistance', label: 'Camera Distance', type: 'slider', min: 0.5, max: 2.5, step: 0.05, default: 1, section: 'Depth', unit: '×', precision: 2, advanced: true,
      description: 'Moves the camera itself closer or further, at the same Perspective.' },
    { key: 'fade', label: 'Depth Fade', type: 'slider', min: 0, max: 100, step: 5, default: 45, section: 'Finish', unit: '%' },
    { key: 'depthBlur', label: 'Depth Blur', type: 'slider', min: 0, max: 8, step: 0.5, default: 2.5, section: 'Finish', unit: '%', precision: 1 },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.3, section: 'Motion', unit: '×', precision: 1, advanced: true },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 12, step: 0.5, default: 3, section: 'Finish', unit: '%', precision: 1 },
    ...sharedFinish,
  ],
  camera: (v) => ({ fov: 20 + clamp(v.perspective / 100, 0, 1) * 42, distance: v.camDistance }),
  transform3d: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'backward' ? -1 : 1;
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir;
    const u = frac(index / count - phase / count);
    const edge = wrapEnvelope(u, 0.075);
    const spreadPx = Math.min(ctx.width, ctx.height) * v.spread / 100;
    // The reference's percentage is the projected hero-card footprint. A raw
    // stage percentage describes the unprojected plane and looked about a third
    // too small after perspective/depth were applied.
    const cardPx = Math.min(ctx.width, ctx.height) * v.cardSizePct / 100 * 1.42;
    // 2.2x calibrated so the reference's 32% default reproduces the same
    // absolute depth (~760px) the family already shipped and was verified
    // clean at — depthGap is new, the depth of field it produces should not be.
    const depthPx = Math.min(ctx.width, ctx.height) * (v.depthGap / 100) * 2.2;
    const z = lerp(-depthPx * 0.62, depthPx * 0.38, u);
    const backness = 1 - smooth(u);
    const spreadAngle = v.spreadAngle * Math.PI / 180;
    let x = Math.cos(spreadAngle) * spreadPx * backness;
    let y = Math.sin(spreadAngle) * spreadPx * backness;
    let rotationZ = (backness - 0.5) * -0.12;
    if (v.layout === 'scatter') {
      x += (hash2(index, 4.1) - 0.5) * spreadPx * 1.4;
      y += (hash2(index, 6.7) - 0.5) * spreadPx * 1.4;
      rotationZ += (hash2(index, 2.9) - 0.5) * 0.22;
    }
    // Wobble: a slow, per-card-phased oscillation layered on the resting
    // spread. Frequency 3 is an integer multiple of the period in `u`, so
    // sin(TAU·3·u) returns to the same value at u=0 and u=1 — the loop seam
    // is untouched at any Wobble amount.
    const wobbleAmt = clamp(v.wobble, 0, 100) / 100;
    const wobblePhase = hash2(index, 9.3) * TAU;
    const wobbleOsc = Math.sin(u * TAU * 3 + wobblePhase);
    x += wobbleOsc * wobbleAmt * spreadPx * 0.08;
    y += Math.cos(u * TAU * 2 + wobblePhase) * wobbleAmt * spreadPx * 0.05;
    rotationZ += wobbleOsc * wobbleAmt * 4 * Math.PI / 180;
    const lean = (v.tilt + backness * 5) * Math.PI / 180;
    const blurFade = clamp(v.depthBlur / 8, 0, 1) * backness * 0.18;
    return {
      x,
      y,
      z,
      quaternion: quaternionFromEuler(lean, -lean * 0.35, rotationZ),
      scale: cardPx / BASE,
      alpha: edge * (1 - (v.fade / 100) * backness) * (1 - blurFade),
      thickness: v.thickness,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: 0.68 + smooth(u) * 0.4,
      velocity: { x: 0, y: 0, z: -depthPx * v.speed * dir },
    };
  },
  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'backward' ? -1 : 1;
    const u = frac(index / count - ((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir) / count);
    const cardPx = Math.min(ctx.width, ctx.height) * v.cardSizePct / 100;
    const spreadPx = Math.min(ctx.width, ctx.height) * v.spread / 100;
    const backness = 1 - smooth(u);
    const spreadAngle = v.spreadAngle * Math.PI / 180;
    return {
      x: Math.cos(spreadAngle) * spreadPx * backness,
      y: Math.sin(spreadAngle) * spreadPx * backness,
      scale: cardPx / BASE * lerp(0.78, 1, u),
      rotation: (backness - 0.5) * -0.12,
      alpha: wrapEnvelope(u, 0.075) * (1 - (v.fade / 100) * backness),
      depth: u,
    };
  },
};

// ============================================================
//  PARALLAX TOTEM — was rebuilt from scratch this session.
//
//  What shipped here before was a floating multi-plane grid with independent
//  per-card sinusoidal drift — a reasonable guess from the NAME alone, never
//  checked against the reference. Measuring animos's actual Parallax Totem
//  control set (Columns, Scatter, Size variation, Parallax depth, Padding,
//  Corner radius, Curvature, Gap, Edge fade, Direction Up/Down) shows it is
//  really a SIXTH VARIANT of the Sphere Wall family — the same curved-wall
//  geometry `surface.ts` already implements — with three things added on top:
//  cards scattered off their resting slot, sized with variation, and columns
//  at different depths on the curve scrolling at different rates (the actual
//  "parallax" in the name, which the previous version never modeled at all).
//
//  Kept self-contained here (not importing surface.ts's geometry) to keep
//  this rebuild's risk local — Surface's own family is already verified
//  clean, and re-deriving the bend formula is four lines.
// ============================================================
export const parallaxTotem: Template = {
  meta: { id: 'parallax-totem-01', name: 'Parallax Totem', group: '3D & Perspective', isNew: true, engine: 'webgl', catalog3d: true, repeatAssets: true, cardAspect: 16 / 9, defaultEasing: { id: 'flow' } },
  controls: [
    { key: 'columns',       label: 'Columns',        type: 'slider', min: 2, max: 5, step: 1,     default: 2, section: 'Layout' },
    { key: 'count',         label: 'Count',          type: 'slider', min: 6, max: 30, step: 1,    default: 12, section: 'Layout', advanced: true },
    { key: 'cardSizePct',   label: 'Card Size',      type: 'slider', min: 12, max: 42, step: 1,    default: 26, section: 'Layout', unit: '%', advanced: true },
    { key: 'padding',       label: 'Padding',        type: 'slider', min: 0, max: 20, step: 0.5,   default: 13, section: 'Layout', unit: '%' },
    { key: 'gap',           label: 'Gap',            type: 'slider', min: 0.5, max: 20, step: 0.25, default: 6.75, section: 'Layout', unit: '%' },
    { key: 'curvature',     label: 'Curvature',      type: 'slider', min: -150, max: 150, step: 5, default: -100, section: 'Depth', unit: '%',
      description: 'Bends the shared totem while every card remains attached to it.' },
    { key: 'scatter',       label: 'Scatter',        type: 'slider', min: 0, max: 100, step: 5,    default: 70, section: 'Motion', unit: '%',
      description: 'Randomizes each card off its resting slot on the curve.' },
    { key: 'sizeVariation', label: 'Size Variation', type: 'slider', min: 0, max: 50, step: 5,     default: 30, section: 'Motion', unit: '%',
      description: "Randomizes each card's size around Card Size." },
    { key: 'parallaxDepth', label: 'Parallax Depth', type: 'slider', min: 0, max: 100, step: 5,    default: 50, section: 'Motion', unit: '%',
      description: 'Columns nearer the camera scroll at a different rate than columns further back.' },
    { key: 'direction',     label: 'Direction',      type: 'toggle', options: ['up','down'],       default: 'up', section: 'Motion' },
    { key: 'perspective',   label: 'Perspective',    type: 'slider', min: 0, max: 100, step: 1,    default: 50, section: 'Depth', unit: '%', advanced: true },
    { key: 'camDistance',   label: 'Camera Distance', type: 'slider', min: 0.5, max: 2.5, step: 0.05, default: 1, section: 'Depth', unit: '×', precision: 2, advanced: true,
      description: 'Moves the camera itself closer or further, at the same Perspective.' },
    { key: 'edgeFade',      label: 'Edge Fade',      type: 'slider', min: 0, max: 100, step: 5,    default: 0, section: 'Finish', unit: '%' },
    { key: 'cornerRadius',  label: 'Corner Radius',  type: 'slider', min: 0, max: 12, step: 0.5,   default: 0.5, section: 'Finish', unit: '%', precision: 1 },
    { key: 'speed',         label: 'Speed',          type: 'slider', min: 0, max: 2, step: 0.1,    default: 0.35, section: 'Motion', unit: '×', precision: 1, advanced: true },
    ...sharedFinish,
  ],
  camera: (v) => ({ fov: 24 + clamp(v.perspective / 100, 0, 1) * 38, distance: v.camDistance }),
  transform3d: (frame, index, count, v, ctx) => {
    const columns = Math.max(2, Math.round(v.columns));
    const col = index % columns;
    const row = Math.floor(index / columns);
    const rows = Math.max(1, Math.ceil(count / columns));

    const stage = Math.min(ctx.width, ctx.height);
    const cardPx0 = stage * (v.cardSizePct / 100) * 1.08;
    const gapMul = 1 + v.gap / 100;
    const stepX = cardPx0 * gapMul;
    const stepY = cardPx0 * gapMul * 0.85;
    const width = Math.max(stepX, (columns - 1) * stepX);

    // Same bend construction the Surface family uses: bow a wall of this
    // width into an arc, cards staying attached to the curve as it bends.
    // The bend is symmetric about the centre column, so both edges recede (or
    // advance) together — `depthN` below reads that as 0 at the centre and 1
    // at the edges (or the reverse, sign of `curvature` decides which).
    const centred = columns <= 1 ? 0 : (col / (columns - 1)) * 2 - 1;
    const bend = clamp(v.curvature / 150, -1, 1) * 1.35;
    const angle = centred * Math.abs(bend);
    const flat = Math.abs(bend) < 0.001;
    const radius = flat ? 1e8 : width / (2 * Math.abs(bend));
    const sign = Math.sign(bend) || 1;
    const bx = flat ? centred * width / 2 : Math.sin(angle) * radius;
    const bz = flat ? 0 : (1 - Math.cos(angle)) * radius * sign;
    const maxBz = flat ? 0 : (1 - Math.cos(Math.abs(bend))) * radius * sign;
    const depthN = Math.abs(maxBz) > 1e-6 ? clamp((bz / maxBz + 1) / 2, 0, 1) : 0.5;

    // Parallax: this column's OWN scroll rate, faster or slower than the
    // nominal speed depending how near the curve places it. Feeding the
    // adjusted rate into loopCycles (rather than scaling its output) is what
    // keeps the seam exact — loopCycles rounds to a whole number of cycles
    // for whatever speed it is given, so every column closes on its own
    // cycle count, however different those counts are from each other.
    const colSpeedMul = 1 + (v.parallaxDepth / 100) * (depthN - 0.5) * 1.6;
    const dirSign = v.direction === 'down' ? -1 : 1;
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed * colSpeedMul, ctx.duration, rows) * dirSign;
    const row01 = rows <= 1 ? 0.5 : frac(row / rows - phase / rows);
    const by = (row01 - 0.5) * rows * stepY;

    // Scatter and size variation: independent per-card, seeded off the index
    // so they stay fixed for that card's identity rather than reshuffling
    // frame to frame.
    const scatterAmt = v.scatter / 100;
    // Scatter is canvas-relative in the reference. Tying it to one card step
    // trapped the whole preset in the middle and produced a narrow stack of
    // edge-on slivers instead of a loose, frame-filling field.
    const scatterX = (hash2(index, 2.3) - 0.5) * stage * 1.55 * scatterAmt;
    const scatterY = (hash2(index, 5.7) - 0.5) * stage * 1.35 * scatterAmt;
    const scatterZ = (hash2(index, 8.1) - 0.5) * 2 * scatterAmt * stepX * 0.3;
    const sizeMul = 1 + (hash2(index, 7.1) - 0.5) * 2 * (v.sizeVariation / 100);

    const edge = 1 - (v.edgeFade / 100) * smooth(clamp((Math.abs(centred) - 0.55) / 0.45, 0, 1));
    const cardPx = cardPx0 * sizeMul;

    // A narrow totem (2-3 columns) at default size already sits its columns
    // close together, and Scatter — 70% by default, measured from the
    // reference, not something to turn down — pushes same-row cards from
    // neighbouring columns into each other's footprint. Two cards that close
    // in space and near-tied in depth is exactly the setup that reads as
    // flickering z-fighting stripes rather than one plainly occluding the
    // other (the same failure mode Helix 3D hit). A few pixels of per-index Z
    // stagger removes the possibility of a tie outright, at any Scatter
    // value, without shifting the totem's overall depth grouping.
    const zBias = index * 0.6;

    return {
      x: bx + scatterX,
      y: by + scatterY,
      z: bz + scatterZ + zBias,
      // Cards retain most of their camera-facing posture; curvature primarily
      // changes position/depth. Full surface-normal rotation was the source of
      // the black vertical shards seen in the copied version.
      rotationY: flat ? 0 : angle * sign * 0.28,
      scale: cardPx / BASE,
      alpha: edge,
      thickness: v.thickness,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: lerp(0.75, 1.05, depthN),
      velocity: { x: 0, y: -stepY * v.speed * colSpeedMul * dirSign, z: 0 },
    };
  },
  // Orthographic fallback: the curve degenerates to its 2D projection (no
  // keystone), matching how Surface's own 2D path handles the same bend.
  transform: (frame, index, count, v, ctx) => {
    const columns = Math.max(2, Math.round(v.columns));
    const col = index % columns;
    const row = Math.floor(index / columns);
    const rows = Math.max(1, Math.ceil(count / columns));

    const stage = Math.min(ctx.width, ctx.height);
    const cardPx0 = stage * (v.cardSizePct / 100) * 1.08;
    const gapMul = 1 + v.gap / 100;
    const stepX = cardPx0 * gapMul;
    const stepY = cardPx0 * gapMul * 0.85;
    const width = Math.max(stepX, (columns - 1) * stepX);

    const centred = columns <= 1 ? 0 : (col / (columns - 1)) * 2 - 1;
    const bend = clamp(v.curvature / 150, -1, 1) * 1.35;
    const angle = centred * Math.abs(bend);
    const flat = Math.abs(bend) < 0.001;
    const radius = flat ? 1e8 : width / (2 * Math.abs(bend));
    const sign = Math.sign(bend) || 1;
    const bx = flat ? centred * width / 2 : Math.sin(angle) * radius;
    const bz = flat ? 0 : (1 - Math.cos(angle)) * radius * sign;
    const maxBz = flat ? 0 : (1 - Math.cos(Math.abs(bend))) * radius * sign;
    const depthN = Math.abs(maxBz) > 1e-6 ? clamp((bz / maxBz + 1) / 2, 0, 1) : 0.5;

    const colSpeedMul = 1 + (v.parallaxDepth / 100) * (depthN - 0.5) * 1.6;
    const dirSign = v.direction === 'down' ? -1 : 1;
    const phase = (frame / ctx.totalFrames) * loopCycles(v.speed * colSpeedMul, ctx.duration, rows) * dirSign;
    const row01 = rows <= 1 ? 0.5 : frac(row / rows - phase / rows);
    const by = (row01 - 0.5) * rows * stepY;

    const scatterAmt = v.scatter / 100;
    const scatterX = (hash2(index, 2.3) - 0.5) * 2 * scatterAmt * stepX * 0.9;
    const scatterY = (hash2(index, 5.7) - 0.5) * 2 * scatterAmt * stepY * 0.4;
    const sizeMul = 1 + (hash2(index, 7.1) - 0.5) * 2 * (v.sizeVariation / 100);
    const edge = 1 - (v.edgeFade / 100) * smooth(clamp((Math.abs(centred) - 0.55) / 0.45, 0, 1));
    const depthScale = 1 + clamp(bz / 1500, -0.35, 0.35);

    return {
      x: bx + scatterX,
      y: by + scatterY,
      scale: (cardPx0 * sizeMul / BASE) * depthScale,
      rotation: 0,
      alpha: edge,
      depth: bz,
    };
  },
};

export const premium3dTemplates = [cardTunnel, depthStackScroll, parallaxTotem];
