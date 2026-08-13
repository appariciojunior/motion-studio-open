import type { Template } from '@/lib/types';
import { clamp } from '@/lib/motion';
import { multiplyQuaternion, quaternionFromEuler, tiltPointCanvas } from '@/lib/tilt3d';
import { variant } from './variant';

const BASE = 340;

const DEG = Math.PI / 180;
// Measured against the reference's 4:5 stage: a face-on 4:3 card spans about
// 48% of the canvas width at the default 85% camera zoom.
const CARD_SIZE = 420;
const ORBIT_BASE_SIZE = 420;

function cardDimensions(ctx: Parameters<Template['transform']>[4], longEdge = CARD_SIZE) {
  const aspect = Math.max(0.05, Number(ctx.cardAspect ?? 4 / 3));
  return {
    width: longEdge * Math.min(1, aspect),
    height: longEdge * Math.min(1, 1 / aspect),
  };
}

// MOVO's Diameter is the empty diameter left inside the belt, not the radius
// followed by the card centres. Even at Diameter 0 the cards therefore orbit
// around half of their cross-axis size instead of collapsing into one point.
// Treating the public value as a raw radius was what crushed Spinner 01 into a
// thin pile in the middle of the canvas.
function orbitRadius(v: Record<string, any>, ctx: Parameters<Template['transform']>[4], horizontal: boolean) {
  const card = cardDimensions(ctx, ORBIT_BASE_SIZE);
  const crossAxisSize = horizontal ? card.height : card.width;
  // Frame measurements at Diameter 0 and 70 show that the authored control is
  // added to a card-sized base at half strength. The card-sized base keeps opposite
  // faces separated by the same amount as the reference while still letting
  // the belt close tightly when Diameter is reduced to zero.
  return crossAxisSize + Math.max(0, Number(v.diameter ?? 70)) * 0.5;
}

function spinnerPhase(frame: number, v: Record<string, any>, ctx: Parameters<Template['transform']>[4]) {
  const direction = v.direction === 'reverse' ? -1 : 1;
  return ctx.easedPhase((frame / Math.max(1, ctx.totalFrames)) * Number(v.speed ?? 1) * direction);
}

function motionRotation(phase: number, v: Record<string, any>) {
  return v.motionRotation === 'rotation' ? phase * Math.PI * 2 : 0;
}

function faceAlpha(cosine: number, v: Record<string, any>) {
  if (cosine >= 0 && v.frontface === 'hide') return 0;
  if (cosine < 0 && v.backface === 'hide') return 0;
  const fade = clamp(Number(v.fade ?? 0) / 100, 0, 1);
  const faded = 1 - fade * (1 - Math.abs(cosine));
  return v.fadeMode === 'solid' ? (faded > 0.72 ? 1 : 0) : faded;
}

// A belt of fixed-size 4:3 cards rotating around the selected axis. Diameter
// separates their centres; Hinge moves the pivot away from each card centre.
const spinner: Template = {
  meta: {
    id: 'spinner-01', name: 'Spinner 01', group: 'Spinner', repeatAssets: true,
    engine: 'webgl', cardAspect: 4 / 3, isNew: true, defaultEasing: { id: 'linear' },
  },
  controls: [
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward', 'reverse'], default: 'forward' },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0.1, max: 3, step: 0.05, default: 1, unit: '×', section: 'Motion' },
    { key: 'motionRotation', label: 'Motion Rotation', type: 'toggle', options: ['static', 'rotation'], default: 'static', section: 'Motion' },
    { key: 'count', label: 'Count', type: 'slider', min: 2, max: 40, step: 1, default: 9 },
    { key: 'cornerRadius', label: 'Corner', type: 'slider', min: 0, max: 100, step: 1, default: 10, unit: '%' },
    { key: 'shape', label: 'Shape', type: 'toggle', options: ['normal', 'squircle'], default: 'squircle' },
    { key: 'axis', label: 'Axis', type: 'toggle', options: ['vertical', 'horizontal'], default: 'horizontal' },
    { key: 'fanRotation', label: 'Rotation', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' },
    { key: 'diameter', label: 'Diameter', type: 'slider', min: 0, max: 1000, step: 1, default: 70 },
    { key: 'hinge', label: 'Hinge', type: 'slider', min: -500, max: 500, step: 1, default: 0 },
    { key: 'fade', label: 'Fade', type: 'slider', min: 0, max: 100, step: 1, default: 0, unit: '%' },
    { key: 'fadeMode', label: 'Fade Mode', type: 'toggle', options: ['alpha', 'solid'], default: 'alpha', visibleWhen: { key: 'fade', not: 0 } },
    { key: 'frontface', label: 'Frontface', type: 'toggle', options: ['show', 'hide'], default: 'show' },
    { key: 'backface', label: 'Backface', type: 'toggle', options: ['show', 'hide'], default: 'show' },
    { key: 'rotateX', label: 'X', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' },
    { key: 'rotateY', label: 'Y', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' },
    { key: 'rotateZ', label: 'Z', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' },
    { key: 'zoom', label: 'Zoom', type: 'slider', min: 25, max: 200, step: 1, default: 85, unit: '%' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 50, max: 1500, step: 1, default: 125 },
    { key: 'offsetX', label: 'Offset X', type: 'slider', min: -100, max: 100, step: 1, default: 0 },
    { key: 'offsetY', label: 'Offset Y', type: 'slider', min: -100, max: 100, step: 1, default: 0 },
  ],
  transform: (frame, index, count, v, ctx) => {
    const phase = spinnerPhase(frame, v, ctx);
    // The reference deals media backwards around the belt. With Forward motion
    // the slot at -40deg travels through the edge-on centre and then down the
    // frame; using +index mirrored that sequence even though the ring silhouette
    // itself looked correct.
    const angle = phase * Math.PI * 2 - (index / count) * Math.PI * 2;
    // The reference family is a 3D card belt: the active axis is the axis
    // around which cards flip, yielding a compressed stack at the side view.
    // This is the equivalent 2D projection, including the thin edge-on pass.
    const sine = Math.sin(angle);
    const cosine = Math.cos(angle);
    const hinge = Number(v.hinge ?? 0);
    const depth = (cosine + 1) / 2;
    // Cards are tangent to the orbit, not radial. They are edge-on at the
    // front/back of the ring and face-on at its two lateral extremes.
    const edge = Math.max(0.12, Math.abs(sine));
    const horizontal = v.axis === 'horizontal';
    const radius = orbitRadius(v, ctx, horizontal);
    const orbitX = horizontal ? 0 : sine * radius + hinge * (1 - cosine);
    const orbitY = horizontal ? sine * radius + hinge * (1 - cosine) : 0;
    const spin = motionRotation(phase, v);
    const spinCos = Math.cos(spin), spinSin = Math.sin(spin);
    return {
      x: orbitX * spinCos - orbitY * spinSin + Number(v.offsetX ?? 0),
      y: orbitX * spinSin + orbitY * spinCos + Number(v.offsetY ?? 0),
      scale: CARD_SIZE / BASE,
      scaleX: horizontal ? 1 : edge,
      scaleY: horizontal ? edge : 1,
      rotation: Number(v.fanRotation ?? 0) * DEG + spin,
      alpha: faceAlpha(sine, v),
      depth,
    };
  },
  transform3d: (frame, index, count, v, ctx) => {
    const phase = spinnerPhase(frame, v, ctx);
    const a = phase * Math.PI * 2 - (index / count) * Math.PI * 2;
    const hinge = Number(v.hinge ?? 0);
    const horizontal = v.axis === 'horizontal';
    const radius = orbitRadius(v, ctx, horizontal);
    const sin = Math.sin(a), cos = Math.cos(a);
    const depth = (cos + 1) / 2;
    const orbitPoint = {
      x: horizontal ? 0 : sin * radius + hinge * (1 - cos),
      y: horizontal ? sin * radius + hinge * (1 - cos) : 0,
      z: cos * radius + hinge * sin,
    };
    const spin = motionRotation(phase, v);
    const spinCos = Math.cos(spin), spinSin = Math.sin(spin);
    const localPoint = {
      x: orbitPoint.x * spinCos - orbitPoint.y * spinSin,
      y: orbitPoint.x * spinSin + orbitPoint.y * spinCos,
      z: orbitPoint.z,
    };
    const rig = { pitch: Number(v.rotateX ?? 0), yaw: Number(v.rotateY ?? 0), roll: Number(v.rotateZ ?? 0) };
    const point = tiltPointCanvas(localPoint, rig);
    const qSpinner = quaternionFromEuler(
      horizontal ? Math.PI / 2 - a : 0,
      horizontal ? 0 : a - Math.PI / 2,
      Number(v.fanRotation ?? 0) * DEG,
    );
    const qMotion = quaternionFromEuler(0, 0, spin);
    const qRig = quaternionFromEuler(rig.pitch * DEG, rig.yaw * DEG, rig.roll * DEG);
    return {
      x: point.x + Number(v.offsetX ?? 0),
      y: point.y + Number(v.offsetY ?? 0),
      z: point.z,
      quaternion: multiplyQuaternion(qRig, multiplyQuaternion(qMotion, qSpinner)),
      scale: CARD_SIZE / BASE,
      alpha: faceAlpha(sin, v),
    };
  },
  camera: (v) => ({
    // The reference's Perspective control uses a long lens. Keeping the old
    // 50-degree house FOV made near faces flare into obvious trapezoids even
    // though their size and orbit were correct. A 20-degree baseline preserves
    // the same z=0 zoom while matching the reference's gentler keystone.
    fov: clamp(20 * (125 / Math.max(50, Number(v.perspective ?? 125))), 5, 80),
    distance: 100 / Math.max(25, Number(v.zoom ?? 85)),
    near: 1,
    far: 100000,
  }),
};

function spinnerPreset(
  id: string,
  name: string,
  patch: Record<string, any> = {},
  easing: 'linear' | 'glide' | 'flow' = 'linear',
) {
  const template = variant(spinner, id, name, patch);
  return { ...template, meta: { ...template.meta, defaultEasing: { id: easing } } };
}

export const spinnerVariants: Template[] = [
  spinner,
  spinnerPreset('spinner-02', 'Spinner 02', { motionRotation: 'rotation' }),
  spinnerPreset('spinner-03', 'Spinner 03', { count: 32, axis: 'vertical', diameter: 500, rotateX: -60, rotateY: 60, rotateZ: 90, zoom: 50, perspective: 1500 }),
  spinnerPreset('spinner-04', 'Spinner 04', { count: 18, axis: 'vertical', rotateX: -18, rotateY: -4, offsetY: 7, perspective: 840 }),
  spinnerPreset('spinner-05', 'Spinner 05', { count: 32, perspective: 1000 }),
  spinnerPreset('spinner-06', 'Spinner 06', { count: 40, axis: 'vertical', diameter: 1000, rotateX: 20, zoom: 39 }),
  spinnerPreset('hinge-01', 'Hinge 01', { hinge: 282, rotateX: -45, rotateY: -45, zoom: 75 }),
  spinnerPreset('hinge-02', 'Hinge 02', { hinge: 282, rotateX: -45, zoom: 75 }),
  spinnerPreset('hinge-03', 'Hinge 03', { hinge: 282, rotateY: -30, zoom: 75 }),
  spinnerPreset('hinge-04', 'Hinge 04', { count: 12, hinge: 282, rotateY: -15, zoom: 75, perspective: 1345, offsetX: -5 }),
  spinnerPreset('hinge-05', 'Hinge 05', { count: 12, hinge: 280, rotateX: -115, rotateY: -35, rotateZ: -15, zoom: 75, perspective: 1000 }, 'glide'),
  spinnerPreset('fan-01', 'Fan 01', { count: 12, direction: 'reverse', axis: 'vertical', fanRotation: 180, hinge: 75, rotateY: -60, rotateZ: -180, zoom: 125, perspective: 250, offsetX: -16, backface: 'hide' }, 'flow'),
  spinnerPreset('fan-02', 'Fan 02', { diameter: 50, zoom: 180, perspective: 150, offsetY: 34 }),
  spinnerPreset('fan-03', 'Fan 03', { axis: 'vertical', diameter: 440, fade: 13, fadeMode: 'solid', rotateX: -26, rotateY: 120, zoom: 127, perspective: 1000, offsetX: 34, offsetY: 5, backface: 'hide' }),
];
