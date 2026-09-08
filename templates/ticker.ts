import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';
import { clamp, loopCycles, stepHold } from '@/lib/motion';
import { cardPath } from '@/lib/cardPath';
import { canvasScale } from './lattice';
import { repeatCopies, repeatCoordinate } from './infiniteField';
import { variant } from './variant';
import { tiltPointCanvas, multiplyQuaternion, quaternionFromEuler } from '@/lib/tilt3d';

// Reference size (px) shared with the renderer's sprite normalization, so that
// `cardSize` reads directly in on-screen pixels.
const BASE = 340;

// ============================================================
//  TICKER — a marquee band that runs edge to edge
//
//  Where Runway grows a featured card at the centre, a ticker is deliberately
//  flat: every card keeps the same size, so the strip reads as one continuous
//  band of content rather than a carousel with a hero. That is the whole point
//  of the family, and it is why the featuredness term from cardPath is used
//  only for draw order here, never for scale.
//
//  Two things make it more than a constant-speed Runway:
//
//  · Hold — the strip can advance in discrete steps instead of gliding, the
//    stop-and-go of a departure board. This routes through `stepHold`, which
//    was already in lib/motion.ts (documented for exactly this) with no
//    consumer until now.
//
//  · Rows — cards deal across N rows, and alternate rows can run opposite
//    directions, which is what gives a marquee its woven look.
// ============================================================

function tickerField(v: Record<string, any>, ctx: {width:number;height:number}) {
  const n=Math.max(1,Math.round(v.count)), rows=Math.max(1,Math.round(v.rows));
  const k=canvasScale(ctx), size=v.cardSize*k/BASE;
  const period=Math.ceil(n/rows)*v.gap*size;
  // A diagonal bound covers rotation; the tilt preset additionally zooms in.
  const view=Math.hypot(ctx.width,ctx.height);
  const offset=Math.hypot(v.offset?.x??0,v.offset?.y??0)*k;
  return {n,k,period,copies:period>0 ? repeatCopies(view,period,v.cardSize*k,offset) : 1};
}

const ticker: Template = {
  meta: { id: 'ticker-01', name: 'Ticker 01', group: 'Ticker', isNew: true, defaultEasing: { id: 'linear' }, repeatAssets: true },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'pills',  options: ['left','right','up','down'], default: 'left' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 60, step: 1,    default: 12 },
    { key: 'rows',         label: 'Rows',          type: 'slider', min: 1, max: 6, step: 1,     default: 1 },
    { key: 'flow',         label: 'Flow',          type: 'pills', options: ['same','opposed','staggered'], default: 'opposed', section: 'Motion' },
    { key: 'laneOffset',   label: 'Lane Offset',   type: 'slider', min: -100, max: 100, step: 1, default: 0, section: 'Motion', unit: '%', description: 'Phase shift added per row, in cells. Keeps rows from starting aligned.' },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 40, max: 600, step: 1,  default: 220 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,   default: 8 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0, max: 600, step: 1,   default: 250 }, // px between card centres (at base size)
    { key: 'rowGap',       label: 'Row Gap',       type: 'slider', min: 0, max: 600, step: 1,   default: 260 },
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: -30, max: 30, step: 1, default: -6, section: 'Depth', unit: '°', description: 'Rotates the complete ticker plane.' },
    { key: 'hold',         label: 'Step Hold',     type: 'slider', min: 0, max: 90, step: 1,    default: 0 },  // % of each step spent stopped
    { key: 'offset',       label: 'Offset',        type: 'xypad',                               default: { x: 0, y: 0 } },
    { key: 'outerFade',    label: 'Outer Fade',    type: 'slider', min: 0, max: 100, step: 1,   default: 100 }, // fade while leaving the frame %
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 4, step: 0.1,   default: 0.8 }, // cards/sec
  ],

  layerCount: (v,ctx) => {const g=tickerField(v,ctx);return g.n*g.copies;},
  mediaCount: (v) => Math.max(1,Math.round(v.count)),
  mediaIndex: (index,_count,v) => index % Math.max(1,Math.round(v.count)),
  transform: (frame, index, count, v, ctx) => {
    const geo=tickerField(v,ctx), repeated=count===geo.n*geo.copies;
    const copy=Math.floor(index/geo.n);
    if(repeated){index%=geo.n;count=geo.n;}
    const horiz = v.direction === 'left' || v.direction === 'right';
    const baseDir = (v.direction === 'left' || v.direction === 'up') ? 1 : -1;

    // Deal the cards across rows: row = index % rows keeps consecutive images on
    // different rows, so a small asset set spreads instead of clustering.
    const rows = Math.max(1, Math.round(v.rows));
    const row = index % rows;
    const slot = Math.floor(index / rows);
    const perRow = Math.max(1, Math.ceil(count / rows));

    // Weave: odd rows travel the other way.
    const dir = v.flow === 'opposed' && row % 2 === 1 ? -baseDir : baseDir;

    // Period is the row length, so every card lands back on its own slot at the
    // loop point — the same guarantee the other conveyors make.
    const cycles = loopCycles(v.speed, ctx.duration, perRow);
    // Lane phase. `staggered` is the fixed half-cell weave the family shipped
    // with; `laneOffset` is the free version, and the reason a multi-lane band
    // reads as woven rather than as a rigid grid sliding sideways — with every
    // lane in phase, the rows line up into columns and the eye reads a table.
    // A whole-cell offset is a no-op by construction, so the loop is unaffected.
    const stagger = (v.flow === 'staggered' ? row * 0.5 : 0)
      + row * ((v.laneOffset ?? 0) / 100);
    const raw = (frame / ctx.totalFrames) * cycles * dir + stagger;

    // Hold > 0 turns the glide into discrete steps. `stepHold` is loop-safe
    // (f(n) = n at integers), and handing it ctx.ease means the scene's easing
    // curve shapes each step — so stepping and easing compose instead of
    // fighting, which is what running easedPhase on top would do.
    const hold = v.hold / 100;
    const phase = hold > 0 ? stepHold(raw, hold, ctx.ease) : ctx.easedPhase(raw);

    // gap:1 → x carries the raw signed offset in card units
    const p = cardPath({ kind: 'line', index: slot, count: perRow, phase, gap: 1, wrap: true });
    const offset = p.x;
    const sizeFactor = v.cardSize * geo.k / BASE;

    // Along-track position, and the row's cross-track position centred on 0.
    const along = repeated && geo.period>0 ? repeatCoordinate(offset * v.gap * sizeFactor, geo.period, copy, geo.copies) : offset * v.gap * sizeFactor;
    const across = (row - (rows - 1) / 2) * v.rowGap * sizeFactor;

    const px = horiz ? along : across;
    const py = horiz ? across : along;
    const roll = (Number(v.tilt ?? 0) * Math.PI) / 180;
    const x = px * Math.cos(roll) - py * Math.sin(roll) + v.offset.x * geo.k;
    const y = px * Math.sin(roll) + py * Math.cos(roll) + v.offset.y * geo.k;

    // Constant scale — a ticker has no hero card.
    const scale = sizeFactor;

    // Outer fade: cards dissolve as they leave the frame instead of popping at
    // the edge, which is what makes the band read as endless.
    let alpha = 1;
    const half = (horiz ? ctx.width : ctx.height) / 2;
    const cardHalf = v.cardSize * geo.k / 2;
    const axisPos = horiz ? x : y;
    const leaving = Math.abs(axisPos) - (half - cardHalf);
    if (leaving > 0) {
      const t = Math.min(1, leaving / Math.max(1, cardHalf * 2));
      alpha *= 1 - (v.outerFade / 100) * (t * t * (3 - 2 * t));
    }

    return {
      x,
      y,
      scale,
      rotation: roll,
      alpha,
      // Rows nearer the bottom of the stack draw on top, and within a row the
      // card closest to centre wins — stable, and never flickers mid-travel.
      depth: row + p.depthNorm * 0.5,
    };
  },
};

// Ticker Tilt is not a collection of individually rotated cards. It is one
// rigid, flat sheet. The sheet first tips away around X, then yaws around Y.
// That compound rotation is important: horizontal rows stay aligned while the
// columns lean toward an off-centre vanishing point and distant rows compress.
// A single Y rotation only makes a side-facing trapezoid, which is the wrong
// visual language for this effect.
const tickerTilt: Template = {
  ...ticker,
  meta: {
    ...ticker.meta,
    id: 'ticker-02',
    name: 'Ticker Tilt',
    engine: 'webgl',
    defaultEasing: { id: 'smooth' },
  },
  controls: ticker.controls.flatMap((control) => {
    if (control.key === 'tilt') return [];
    const patched =
      control.key === 'count' ? { ...control, default: 24 } :
      control.key === 'rows' ? { ...control, default: 4 } :
      control.key === 'flow' ? { ...control, default: 'same' } :
      control.key === 'cardSize' ? { ...control, default: 180 } :
      control.key === 'gap' ? { ...control, default: 200 } :
      control.key === 'rowGap' ? { ...control, default: 210 } :
      control.key === 'outerFade' ? { ...control, default: 0 } :
      control.key === 'speed' ? { ...control, default: 0.6 } :
      control;
    if (control.key !== 'rowGap') return [patched];
    return [
      patched,
      { key: 'zoom',        label: 'Zoom',        type: 'slider' as const, min: 0, max: 100, step: 1, default: 32 },
      { key: 'tilt',        label: 'Tilt',        type: 'slider' as const, min: -55, max: 55, step: 1, default: 30 },
      { key: 'perspective', label: 'Perspective', type: 'slider' as const, min: 0, max: 100, step: 1, default: 60 },
    ];
  }),
  transform: (frame, index, count, v, ctx) => {
    // The base ticker's `tilt` is a 2D roll. Here the same public key means
    // WebGL yaw, so explicitly neutralize the base roll before projecting the
    // rigid sheet. Letting both interpretations stack was the source of the
    // crooked, individually scattered look in the old preset.
    const flat = ticker.transform(frame, index, count, { ...v, tilt: 0 }, ctx);
    const pitch = -(4 + clamp(v.perspective / 100, 0, 1) * 38) * Math.PI / 180;
    const yaw = -(clamp(v.tilt, -55, 55) / 55) * 22 * Math.PI / 180;
    const cp = Math.cos(pitch);
    const shear = -Math.sin(pitch) * Math.sin(yaw);
    // At the reference default (32%) the sheet deliberately overscans the
    // frame, so its clipped edges read as a continuous surface rather than a
    // small floating grid.
    const zoom = 1.45 + clamp(v.zoom / 100, 0, 1) * 1.8;
    return {
      ...flat,
      x: (flat.x + flat.y * shear) * zoom,
      y: flat.y * cp * zoom,
      scale: flat.scale * zoom,
      rotation: 0,
      // Multi-layer scenes use Pixi. This affine projection preserves the
      // plane's dominant lean; the single-layer preview/export uses WebGL.
      skewX: Math.atan(shear),
      scaleY: cp,
    };
  },
  transform3d: (frame, index, count, v, ctx) => {
    const flat = ticker.transform(frame, index, count, { ...v, tilt: 0 }, ctx);
    const pitchDeg = -(4 + clamp(v.perspective / 100, 0, 1) * 38);
    const yawDeg = -(clamp(v.tilt, -55, 55) / 55) * 22;
    const pitch = pitchDeg * Math.PI / 180;
    const yaw = yawDeg * Math.PI / 180;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const zoom = 1.45 + clamp(v.zoom / 100, 0, 1) * 1.8;
    const localX = flat.x * zoom;
    const localY = flat.y * zoom;
    const point = tiltPointCanvas({ x: localX, y: localY, z: 0 }, { pitch: pitchDeg, yaw: yawDeg });

    // Renderer world Y points up while template Y points down. These equations
    // are Ry(yaw) * Rx(pitch) applied to (localX, -localY, 0), then converted
    // back to the template's canvas-down convention.
    return {
      x: point.x,
      y: point.y,
      z: point.z,
      // Match Ry * Rx used for centres; Three's default XYZ Euler order
      // otherwise makes overlapping cards intersect instead of sharing a plane.
      quaternion: multiplyQuaternion(quaternionFromEuler(0,yaw,0), quaternionFromEuler(pitch,0,0)),
      // Every copy of one image shares its rank, even while render slots wrap.
      depthBias: 8 * (1 + index % Math.max(1,Math.round(v.count))),
      scale: flat.scale * zoom,
      alpha: flat.alpha,
    };
  },
};

// ============================================================
//  Reference-catalogue presets (Marquee 01–22)
//
//  The reference tool authors a marquee from `planeSize` and `gap` in its own
//  units. Measured live across four of its presets (planeSize 55 / 115 / 160 /
//  180), a card is 3:4 portrait with
//        height  = 2 * planeSize * REF_UNIT
//        pitch   = height + REF_UNIT * gap
//  and REF_UNIT held to within 0.1% across all four, so this is the tool's real
//  sizing rule rather than a curve fit. The reference canvas is 1080x1440 where
//  this project normalizes the long edge to 1080 — hence the 0.75.
//
//  Ticker's own `gap`/`rowGap` are centre distances AT BASE SIZE, so dividing
//  the measured pitches by the card's size factor cancels REF_UNIT out entirely
//  and leaves an exact form with no fitted constant in it:
//        gap    = BASE * (1    + gap / (2 * planeSize))
//        rowGap = BASE * (0.75 + gap / (2 * planeSize))
//  REF_UNIT survives only to set `cardSize` itself.
// ============================================================
const REF_UNIT = 2.155 * 0.75;

interface RefMarquee {
  axis: 'vertical' | 'horizontal';
  reverse?: boolean;
  lanes: number;
  planeSize: number;
  gap: number;
  weave?: boolean;   // reference `alternate` — lanes run against each other
  hold?: number;     // % of each step spent stopped
  angle?: number;    // whole-plane rotation, degrees
  lane?: number;     // per-lane phase offset, % of one cell
  cycles?: number;   // times the whole asset set passes per reference clip
  assets?: number;   // the reference preset's `count` — its asset set size
  seconds?: number;  // the reference clip length those cycles were authored for
}

function refMarquee(r: RefMarquee): Record<string, any> {
  const cardSize = Math.round(2 * r.planeSize * REF_UNIT);
  const ratio = r.gap / (2 * r.planeSize);

  // `cardSize` is the card's LONG edge (3:4 portrait ⇒ its height), so which
  // dimension faces the travel axis depends on the axis: a horizontal band is
  // spaced by card WIDTH, a vertical one by card HEIGHT. Using height for both
  // is what left a quarter-card hole between every pair in the horizontal
  // presets — the edge gap has to come out as cardSize*ratio either way.
  const alongUnit = r.axis === 'vertical' ? 1 : 3 / 4;
  const acrossUnit = r.axis === 'vertical' ? 3 / 4 : 1;
  const gap = Math.round(BASE * (alongUnit + ratio));
  const rowGap = Math.round(BASE * (acrossUnit + ratio));

  // Enough cards per lane to overscan the travel axis, so a band never shows its
  // own end. Two things stretch what has to be covered: a tilted plane presents
  // the canvas diagonal to the travel axis rather than one side, and a lane
  // pushed by `lane` starts up to a full cell short. Both cost real cards.
  const alongPitch = gap * (cardSize / BASE);
  const cardAlong = cardSize * alongUnit;
  const roll = Math.abs(((r.angle ?? 0) * Math.PI) / 180);
  const along = r.axis === 'vertical'
    ? 810 * Math.sin(roll) + 1080 * Math.cos(roll)
    : 810 * Math.cos(roll) + 1080 * Math.sin(roll);
  const perLane = Math.max(2, Math.ceil((along + 2 * cardAlong) / alongPitch) + 1);

  return {
    // Reference `forward` moves content along +y (measured: a lane's cards ran
    // -547 -> -472 -> -398 over 4s), which is this family's `down`.
    direction: r.axis === 'vertical' ? (r.reverse ? 'up' : 'down')
                                     : (r.reverse ? 'left' : 'right'),
    rows: r.lanes,
    count: r.lanes * perLane,
    cardSize,
    gap,
    rowGap,
    cornerRadius: 0,
    flow: r.weave === false ? 'same' : 'opposed',
    laneOffset: r.lane ?? 0,
    hold: r.hold ?? 0,
    tilt: r.angle ?? 0,
    // The reference band clips at the canvas edge instead of dissolving
    // (depthFade was 0 on all 22 of its presets).
    outerFade: 0,
    // Cells per second. The reference tool's `cycles` counts how many times the
    // whole asset set passes, not how many cells move, so the rate is
    // cycles * assets / seconds. Measured on Marquee 01 to confirm: it travels
    // 8201px over its authored 20s clip at a dead-constant 410 reference px/s,
    // which is 11 cells — exactly its `count` of 11, and why its loop closes.
    // Reading `cycles` as cells put every preset at a third of its real pace.
    //
    // `loopCycles` then snaps the clip to a whole number of lane lengths so
    // every texture lands back on its own slot. That is a different repeat unit
    // than the reference's (which advances one asset set), but it is the same
    // idea and it holds the authored rate across clip lengths.
    speed: ((r.cycles ?? 1) * (r.assets ?? 11)) / (r.seconds ?? 20),
  };
}

// `variant` only patches control defaults, so a preset that also ships its own
// curve — or its own card shape — needs `meta` patched alongside.
function preset(
  id: string,
  name: string,
  ref: RefMarquee,
  easing: EasingSpec = { id: 'linear' }
): Template {
  const t = variant(ticker, id, name, refMarquee(ref));
  return { ...t, meta: { ...t.meta, defaultEasing: easing, cardAspect: 3 / 4 } };
}

const LINEAR: EasingSpec = { id: 'linear' };
const FLOW: EasingSpec = { id: 'flow' };
const SMOOTH: EasingSpec = { id: 'smooth' };
const EASE: EasingSpec = { id: 'ease' };

export const tickerVariants: Template[] = [
  ticker,
  tickerTilt,
  variant(ticker, 'ticker-03', 'Ticker Step', {
    hold: 62, speed: 1.2, cardSize: 260, gap: 290, count: 10,
  }),

  // Three lanes weaving against each other — the family's home base.
  preset('ticker-04', 'Ticker 04', { axis: 'vertical',   lanes: 3, planeSize: 160, gap: 25, lane: -15 }, LINEAR),
  preset('ticker-05', 'Ticker 05', { axis: 'horizontal', lanes: 3, planeSize: 160, gap: 25, lane: -15, reverse: true }, LINEAR),

  // Lanes locked in the same direction, faster, one lane pushed half a cell.
  preset('ticker-06', 'Ticker 06', { axis: 'vertical',   lanes: 3, planeSize: 115, gap: 42, lane: 50, weave: false, reverse: true, seconds: 5 }, FLOW),
  preset('ticker-07', 'Ticker 07', { axis: 'horizontal', lanes: 3, planeSize: 115, gap: 42, lane: 50, weave: false, reverse: true, seconds: 5 }, FLOW),

  // Stepped: a steep curve per cell reads as stop-and-go with no pause at all.
  preset('ticker-08', 'Ticker 08', { axis: 'vertical',   lanes: 3, planeSize: 160, gap: 40 }, FLOW),
  preset('ticker-09', 'Ticker 09', { axis: 'horizontal', lanes: 3, planeSize: 160, gap: 40 }, FLOW),

  preset('ticker-10', 'Ticker 10', { axis: 'vertical',   lanes: 3, planeSize: 115, gap: 42, weave: false, reverse: true, cycles: 2, seconds: 6 }, SMOOTH),
  preset('ticker-11', 'Ticker 11', { axis: 'horizontal', lanes: 3, planeSize: 115, gap: 42, weave: false, cycles: 2, seconds: 6 }, SMOOTH),

  // The whole plane leans.
  preset('ticker-12', 'Ticker 12', { axis: 'vertical',   lanes: 3, planeSize: 160, gap: 25, lane: -15, angle: 20 }, LINEAR),
  preset('ticker-13', 'Ticker 13', { axis: 'horizontal', lanes: 3, planeSize: 160, gap: 25, lane: -15, angle: -20, reverse: true }, LINEAR),

  // Four tighter lanes.
  preset('ticker-14', 'Ticker 14', { axis: 'vertical',   lanes: 4, planeSize: 100, gap: 13, lane: -15, reverse: true }, LINEAR),
  preset('ticker-15', 'Ticker 15', { axis: 'horizontal', lanes: 4, planeSize: 100, gap: 13, lane: -15, reverse: true }, LINEAR),

  // Six lanes of small cards — the densest weave in the family.
  preset('ticker-16', 'Ticker 16', { axis: 'vertical',   lanes: 6, planeSize: 55, gap: 20, weave: false, reverse: true, cycles: 2, seconds: 5 }, SMOOTH),
  preset('ticker-17', 'Ticker 17', { axis: 'horizontal', lanes: 4, planeSize: 100, gap: 13, lane: -15, angle: -15, reverse: true }, LINEAR),
  preset('ticker-18', 'Ticker 18', { axis: 'horizontal', lanes: 5, planeSize: 75,  gap: 20, weave: false, reverse: true, angle: 10, cycles: 2, seconds: 7 }, EASE),

  // Two wide lanes.
  preset('ticker-19', 'Ticker 19', { axis: 'vertical',   lanes: 2, planeSize: 140, gap: 25, lane: -15 }, LINEAR),
  preset('ticker-20', 'Ticker 20', { axis: 'horizontal', lanes: 2, planeSize: 150, gap: 25, lane: -15 }, LINEAR),
  preset('ticker-21', 'Ticker 21', { axis: 'horizontal', lanes: 2, planeSize: 152, gap: 20, lane: 50, reverse: true, seconds: 15 }, FLOW),
  preset('ticker-22', 'Ticker 22', { axis: 'vertical',   lanes: 2, planeSize: 145, gap: 20, lane: 50, reverse: true, seconds: 15 }, FLOW),

  // Gapless, very slow — the band reads as one continuous ribbon.
  preset('ticker-23', 'Ticker 23', { axis: 'vertical',   lanes: 3, planeSize: 112, gap: 0, lane: 35, seconds: 30 }, LINEAR),
  preset('ticker-24', 'Ticker 24', { axis: 'vertical',   lanes: 3, planeSize: 112, gap: 5, lane: 35, weave: false, reverse: true, seconds: 30 }, LINEAR),

  // A single lane of large cards — the plain vertical marquee.
  // The reference preset behind this one carries 5 assets, not the usual 11.
  preset('ticker-25', 'Ticker 25', { axis: 'vertical',   lanes: 1, planeSize: 180, gap: 40, weave: false, reverse: true, assets: 5, seconds: 10 }, LINEAR),
];
