import type { Template } from '@/lib/types';
import { clamp } from '@/lib/motion';
import { repeatCoordinate } from './infiniteField';
import { variant } from './variant';

const BASE = 340;
const DEG = Math.PI / 180;

// ============================================================
//  PROXIMITY — a wide field of small plates, and a focus point that
//  tours it while the camera rides along
//
//  Not to be confused with the Dock family (templates/proximity.ts), which
//  shares the reference's name for this and none of its mechanic: Dock is a
//  tidy grid of tiles that magnify near a moving cursor, a macOS dock. This is
//  a FIELD — five hundred plates by default, scattered on a jittered lattice
//  far wider than the frame — and the camera is locked to the focus point, so
//  what the viewer sees is the field streaming past while whatever the focus
//  touches swells up out of it. The control surfaces have almost nothing in
//  common (`minScale/maxScale/maxDist/panRange/atmosphere` here against
//  `cols/gap/magnify/focusRadius`), which is what settled that they are two
//  families and not one with missing sliders.
//
//  Read out of the reference's own renderer, not measured off it:
//
//  · The stage is 1080 wide and every number below lives in that space; the
//    frame is a window onto it, scaled by width/1080.
//  · The focus point walks a CLOSED loop through waypoints pinned to a 7x7
//    grid of 360px cells centred on the stage. Each leg is a Catmull-Rom
//    segment and the scene's own curve shapes the progress WITHIN a leg, so
//    the point arrives and leaves each pin rather than cruising through it.
//  · The field is not sized to the frame — it is sized to the PATH, expanded
//    by half a frame plus a 200px margin on each side, so the camera never
//    reaches an edge. Cols and rows then fall out of the count and that
//    rectangle's aspect: cols = round(sqrt(count * w/h)).
//  · A plate's size is a straight lerp from `maxScale` at the focus to
//    `minScale` at `maxDist` (as a share of the 1080 stage) and no further.
//  · `panRange` scales the whole path about the stage centre — 100 is the
//    authored path, 180 nearly doubles the ground it covers.
//  · Plates are drawn smallest first, so the swollen one is always on top.
//
//  Two things in the reference's renderer are deliberately not carried over.
//  Its per-plate `blur` grows with distance, which a pose cannot state (there
//  is no per-card blur in LayerTransform) — and it is 0 on all five presets, so
//  a dead slider would be the only thing gained. And it picks each plate's
//  image by hash; here slot order picks it, because the asset binding belongs
//  to the track, not the template.
//
//  `atmosphere` fades rather than dims, against the house rule that distance
//  should darken. That is on purpose and it is what the reference does: this
//  haze is the field dissolving into the background, and the plates it touches
//  are 20px wide and essentially never overlap, so there is nothing to ghost
//  through.
// ============================================================

/** The reference's stage width; every authored number below is in this space. */
const REF_W = 1080;
/** Its waypoint grid: 7x7 cells of 360px, with (3,3) at the stage centre. */
const CELL = 360;
const CENTRE_X = 540;
const CENTRE_Y = 675;
/** Plate size on that stage, at scale 1. The presets all run `fit`, i.e. 2:3. */
const CARD_W = 400;
/** Half a plate, the margin the field keeps outside the path's reach. */
const MARGIN = CARD_W * 0.5;

type Pin = { c: number; r: number; t: number };

// The reference's five authored paths, read live out of its
// `waypointsPerModeBaseline` on 2026-08-23. Grid coordinates, closed loops —
// the last pin repeats the first and is dropped when the spline is built.
const PATHS: Record<string, Pin[]> = {
  // Proximity 01: an irregular tour that leaves the grid on the left.
  wander: [
    { c: 3, r: 3, t: 0 }, { c: 2.083, r: 2.497, t: 0.125 }, { c: 1.262, r: 3.449, t: 0.25 },
    { c: 4.294, r: 3.809, t: 0.375 }, { c: 4.84, r: 2.167, t: 0.5 }, { c: 2.569, r: 2.167, t: 0.625 },
    { c: 0.211, r: 4.249, t: 0.75 }, { c: 0.211, r: 2.929, t: 0.875 }, { c: 3, r: 3, t: 1 },
  ],
  // Proximity 02: straight out to one side, back through the middle, out the other.
  shuttle: [
    { c: 3, r: 3, t: 0 }, { c: 1, r: 3, t: 0.25 }, { c: 3, r: 3, t: 0.5 },
    { c: 5, r: 3, t: 0.75 }, { c: 3, r: 3, t: 1 },
  ],
  // Proximity 03: a circle of radius two cells.
  circle: [
    { c: 5, r: 3, t: 0 }, { c: 4, r: 2, t: 0.125 }, { c: 3, r: 1, t: 0.25 }, { c: 2, r: 2, t: 0.375 },
    { c: 1, r: 3, t: 0.5 }, { c: 2, r: 4, t: 0.625 }, { c: 3, r: 5, t: 0.75 }, { c: 4, r: 4, t: 0.875 },
    { c: 5, r: 3, t: 1 },
  ],
  // Proximity 04: a wide diamond that returns through the centre each leg.
  diamond: [
    { c: 3, r: 3, t: 0 }, { c: 0, r: 3, t: 0.2 }, { c: 3, r: 6, t: 0.4 },
    { c: 6, r: 3, t: 0.6 }, { c: 3, r: 0, t: 0.8 }, { c: 3, r: 3, t: 1 },
  ],
  // Proximity 05: two single-cell loops either side of the centre.
  figure8: [
    { c: 3, r: 3, t: 0 }, { c: 4, r: 2, t: 0.125 }, { c: 5, r: 3, t: 0.25 }, { c: 4, r: 4, t: 0.375 },
    { c: 3, r: 3, t: 0.5 }, { c: 2, r: 2, t: 0.625 }, { c: 1, r: 3, t: 0.75 }, { c: 2, r: 4, t: 0.875 },
    { c: 3, r: 3, t: 1 },
  ],
};

/** Grid cell → stage px. */
const pinPoint = (p: Pin): [number, number] => [
  CENTRE_X + (p.c - 3) * CELL,
  CENTRE_Y + (p.r - 3) * CELL,
];

/**
 * The reference's own 1-D value hash. Reproduced rather than reusing
 * lib/motion's `hash2` because the scatter it produces IS the field's look:
 * a different hash is a different arrangement of five hundred plates.
 */
const hash1 = (x: number) => {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Focus point at loop phase `u`, as a closed Catmull-Rom through the path's
 * pins with `ease` shaping the progress inside each leg.
 */
function focusAt(pins: Pin[], u: number, ease: (t: number) => number): [number, number] {
  const n = Math.max(2, pins.length - 1);       // the closing pin repeats the first
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push(pinPoint(pins[i]));

  let seg = n - 1;
  let local = 0;
  for (let i = 0; i < n; i++) {
    const t0 = pins[i].t;
    const t1 = i + 1 < pins.length ? pins[i + 1].t : 1;
    if (u >= t0 && u <= t1) { seg = i; local = t1 > t0 ? (u - t0) / (t1 - t0) : 0; break; }
  }

  const s = ease(clamp(local, 0, 1));
  const p0 = pts[(seg - 1 + n) % n], p1 = pts[seg % n];
  const p2 = pts[(seg + 1) % n], p3 = pts[(seg + 2) % n];
  const s2 = s * s, s3 = s2 * s;
  const spline = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s2 + (-a + 3 * b - 3 * c + d) * s3);
  return [spline(p0[0], p1[0], p2[0], p3[0]), spline(p0[1], p1[1], p2[1], p3[1])];
}

/**
 * The reference's build envelope: the field grows in over the first 7% of the
 * loop and shrinks away over the last 12.5%, on a cubic-bezier(.8,0,.2,1).
 * It scales BOTH the plate size and the reach of the focus, so the field does
 * not just fade — it collapses toward nothing and rebuilds.
 */
function buildEnvelope(u: number): number {
  const inEnd = 0.06997084548104957;
  const outStart = 300 / 343;
  const shape = (x: number) => {
    // cubic-bezier(.8, 0, .2, 1), solved by Newton the way the reference does.
    let r = clamp(x, 0, 1);
    for (let k = 0; k < 8; k++) {
      const i = 1 - r;
      const fx = 3 * i * i * r * 0.8 + 3 * i * r * r * 0.2 + r * r * r;
      const dx = 3 * i * i * 0.8 + 6 * i * r * (0.2 - 0.8) + 3 * r * r * (1 - 0.2);
      if (Math.abs(dx) < 1e-6) break;
      r = clamp(r - (fx - x) / dx, 0, 1);
    }
    return 3 * (1 - r) * r * r + r * r * r;
  };
  if (u <= inEnd) return shape(u / inEnd);
  if (u >= outStart) return shape((1 - u) / (1 - outStart));
  return 1;
}

const proximityField: Template = {
  meta: {
    id: 'field-prox-01',
    name: 'Proximity 01',
    group: 'Proximity',
    isNew: true,
    // The reference's own curve on this preset, and the one its path timing
    // was authored against.
    defaultEasing: { id: 'custom', bezier: [0.86, 0.14, 0.14, 0.86] },
    // All five presets run `imageFit: fit`, which on its stage is a 400x600
    // plate.
    cardAspect: 2 / 3,
    repeatAssets: true,
  },

  controls: [
    { key: 'path',         label: 'Path',          type: 'select', options: ['wander','shuttle','circle','diamond','figure8'], default: 'wander', section: 'Motion', description: 'The closed tour the focus point walks.' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 50, max: 800, step: 10,  default: 500, description: 'Plates in the field. They cover the path, not the frame.' },
    { key: 'maxScale',     label: 'Max Scale',     type: 'slider', min: 0, max: 200, step: 1,    default: 60, unit: '%', section: 'Depth', description: 'Plate size where the focus point is standing.' },
    { key: 'minScale',     label: 'Min Scale',     type: 'slider', min: 0, max: 100, step: 1,    default: 5, unit: '%', section: 'Depth', description: 'Plate size out beyond the focus reach.' },
    { key: 'maxDist',      label: 'Reach',         type: 'slider', min: 5, max: 100, step: 1,    default: 35, unit: '%', section: 'Depth', description: 'How far the focus swells plates, as a share of the stage width.' },
    { key: 'atmosphere',   label: 'Atmosphere',    type: 'slider', min: 0, max: 100, step: 1,    default: 0, unit: '%', section: 'Depth', description: 'Haze that dissolves the far plates into the background.' },
    { key: 'sizeMix',      label: 'Size Mix',      type: 'slider', min: 0, max: 100, step: 1,    default: 0, unit: '%', section: 'Layout', description: 'Random size variation between plates.' },
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: 0, max: 45, step: 1,     default: 0, unit: '°', section: 'Layout', description: 'Random rotation spread.' },
    { key: 'panRange',     label: 'Pan Range',     type: 'slider', min: 0, max: 200, step: 5,    default: 100, unit: '%', section: 'Motion', description: 'Scales the path about the stage centre.' },
    { key: 'buildInOut',   label: 'Build In/Out',  type: 'toggle', options: ['off','on'],        default: 'off', section: 'Motion', description: 'Collapse the field to nothing at both ends of the loop.' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,    default: 0 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                default: { x: 0, y: 0 } },
  ],

  layerCount: (v) => Math.max(1,Math.round(v.count))*9,
  mediaCount: (v) => Math.max(1,Math.round(v.count)),
  mediaIndex: (index,_count,v) => index % Math.max(1,Math.round(v.count)),
  transform: (frame, index, count, v, ctx) => {
    const motifCount=Math.max(1,Math.round(v.count));
    const repeated=count===motifCount*9;
    const copy=Math.floor(index/motifCount);
    if(repeated){index%=motifCount;count=motifCount;}
    // One lap of the path per clip — the reference's loop is its `duration`,
    // and pinning the scene duration per preset (store/useSceneStore) is what
    // carries its cadence over.
    const u = ((frame / ctx.totalFrames) % 1 + 1) % 1;
    const pins = PATHS[v.path] ?? PATHS.wander;

    // Stage → frame. The reference measures everything against a 1080-wide
    // stage and scales by the frame's width, so a taller frame shows more of
    // the field rather than a bigger one.
    const k = ctx.width / REF_W;
    const halfH = ctx.height / 2 / Math.max(1e-6, k);   // half frame, in stage px

    const pan = Math.max(0, v.panRange) / 100;
    const [fxRaw, fyRaw] = focusAt(pins, u, ctx.ease);
    const fx = CENTRE_X + (fxRaw - CENTRE_X) * pan;
    const fy = CENTRE_Y + (fyRaw - CENTRE_Y) * pan;

    // The field's rectangle: the path's own extent, opened out by half a frame
    // and a margin so the camera never sees past the plates.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pins) {
      const [px, py] = pinPoint(p);
      const sx = CENTRE_X + (px - CENTRE_X) * pan;
      const sy = CENTRE_Y + (py - CENTRE_Y) * pan;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
    const maxCard = CARD_W * Math.max(v.maxScale,v.minScale) / 100 * (1 + clamp(v.sizeMix,0,100)/200)
      / Math.min(1,ctx.cardAspect ?? 2/3);
    const marginX = Math.max(MARGIN, maxCard/2, Math.abs(v.offset.x));
    const marginY = Math.max(MARGIN, maxCard/2, Math.abs(v.offset.y));
    const x0 = minX - CENTRE_X - marginX;
    const x1 = maxX + CENTRE_X + marginX;
    const y0 = minY - halfH - marginY;
    const y1 = maxY + halfH + marginY;
    const spanX = x1 - x0;
    const spanY = y1 - y0;

    const n = Math.max(1, Math.round(count));
    const cols = Math.max(1, Math.round(Math.sqrt(n * (spanX / spanY))));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cellW = spanX / cols;
    const cellH = spanY / rows;

    // This plate's home on the jittered lattice. The jitter is ±0.425 of a
    // cell, which is what stops the field reading as a grid without letting
    // neighbours swap places.
    const col = index % cols;
    const row = Math.floor(index / cols);
    const px = x0 + (col + 0.5 + (hash1(index * 2 + 1) - 0.5) * 0.85) * cellW;
    const py = y0 + (row + 0.5 + (hash1(index * 2 + 9) - 0.5) * 0.85) * cellH;

    const env = v.buildInOut === 'on' ? buildEnvelope(u) : 1;
    const near = (Math.max(0, v.maxScale) / 100) * env;
    const far = (Math.max(0, v.minScale) / 100) * env;
    const reach = Math.max(0.01, (Math.max(0.001, v.maxDist) / 100) * REF_W * env);

    const nearX = repeatCoordinate(px-fx,spanX,0,1);
    const nearY = repeatCoordinate(py-fy,spanY,0,1);
    const dist = Math.hypot(repeated ? nearX : px-fx, repeated ? nearY : py-fy);
    const t = dist >= reach ? 1 : dist <= 0 ? 0 : dist / reach;

    const mix = clamp(v.sizeMix, 0, 100) / 100;
    const jitterSize = mix > 0 ? 1 + (hash1(index * 3.137 + 4.2) - 0.5) * mix : 1;
    const plate = (near + (far - near) * t) * jitterSize;

    // Atmosphere bites only past the halfway mark of the reach, on a
    // smoothstep, so the plates around the focus stay solid.
    const haze = clamp(v.atmosphere, 0, 100) / 100;
    let alpha = 1;
    if (haze > 0) {
      const w = clamp((t - 0.5) * 2, 0, 1);
      alpha = 1 - haze * w * w * (3 - 2 * w);
    }
    // Keep the pose continuous down to zero size/opacity; thresholding here
    // teleports a small but still visible plate back to the origin.

    // The camera rides the focus: it is what puts the swollen plate in the
    // middle of the frame instead of wherever the path happens to be.
    const aspect = Math.max(0.05, ctx.cardAspect ?? 2 / 3);
    const widthPx = CARD_W * plate * k;
    const spread = clamp(v.tilt, 0, 45);

    return {
      x: (repeated ? repeatCoordinate(px-fx,spanX,copy%3,3) : px-fx) * k + v.offset.x * k,
      y: (repeated ? repeatCoordinate(py-fy,spanY,Math.floor(copy/3),3) : py-fy) * k + v.offset.y * k,
      scale: widthPx / (BASE * Math.min(1, aspect)),
      rotation: spread > 0 ? (hash1(index * 1.917 + 8.3) - 0.5) * 2 * spread * DEG : 0,
      alpha: plate > 0 ? alpha : 0,
      // Smallest first, so the plate the focus is standing on is never buried.
      depth: plate,
    };
  },
};

// The reference's five presets, read live out of its own
// `paramsPerModeBaseline` and `waypointsPerModeBaseline` on 2026-08-23. Their
// clip lengths (14.3, 12, 16, 15, 14s) are pinned in store/useSceneStore, since
// a lap of the path is a lap of the clip.
export const proximityFieldVariants: Template[] = [
  proximityField, // Proximity 01 — wander, reach 35, build in/out, pan 100
  variant(proximityField, 'field-prox-02', 'Proximity 02', {
    path: 'shuttle', maxDist: 43, panRange: 165, buildInOut: 'off',
  }),
  variant(proximityField, 'field-prox-03', 'Proximity 03', {
    path: 'circle', maxDist: 41, maxScale: 63, minScale: 8, sizeMix: 50,
    atmosphere: 50, panRange: 145, buildInOut: 'off',
  }, { id: 'custom', bezier: [0.33, 0, 0, 1] }),
  variant(proximityField, 'field-prox-04', 'Proximity 04', {
    path: 'diamond', count: 100, maxDist: 5, maxScale: 63, minScale: 43,
    sizeMix: 100, tilt: 6, panRange: 125, buildInOut: 'off',
  }, { id: 'custom', bezier: [0.33, 0, 0, 1] }),
  variant(proximityField, 'field-prox-05', 'Proximity 05', {
    path: 'figure8', maxDist: 32, maxScale: 99, minScale: 0, panRange: 180,
    buildInOut: 'off',
  }, { id: 'custom', bezier: [0.76, 0, 0.24, 1] }),
];
