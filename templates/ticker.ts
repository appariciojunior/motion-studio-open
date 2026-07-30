import type { Template } from '@/lib/types';
import { loopCycles, stepHold } from '@/lib/motion';
import { cardPath } from '@/lib/cardPath';
import { variant } from './variant';

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

const ticker: Template = {
  meta: { id: 'ticker-01', name: 'Ticker 01', group: 'Ticker', defaultEasing: { id: 'linear' }, repeatAssets: true },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'pills',  options: ['left','right','up','down'], default: 'left' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 60, step: 1,    default: 12 },
    { key: 'rows',         label: 'Rows',          type: 'slider', min: 1, max: 5, step: 1,     default: 1 },
    { key: 'weave',        label: 'Weave Rows',    type: 'toggle', options: ['off','on'],       default: 'off' }, // alternate rows run the other way
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 40, max: 600, step: 1,  default: 220 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,   default: 8 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0, max: 600, step: 1,   default: 250 }, // px between card centres (at base size)
    { key: 'rowGap',       label: 'Row Gap',       type: 'slider', min: 0, max: 600, step: 1,   default: 260 },
    { key: 'hold',         label: 'Step Hold',     type: 'slider', min: 0, max: 90, step: 1,    default: 0 },  // % of each step spent stopped
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: -30, max: 30, step: 1,  default: 0 },  // degrees, uniform
    { key: 'offset',       label: 'Offset',        type: 'xypad',                               default: { x: 0, y: 0 } },
    { key: 'outerFade',    label: 'Outer Fade',    type: 'slider', min: 0, max: 100, step: 1,   default: 100 }, // fade while leaving the frame %
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 4, step: 0.1,   default: 0.8 }, // cards/sec
  ],

  transform: (frame, index, count, v, ctx) => {
    const horiz = v.direction === 'left' || v.direction === 'right';
    const baseDir = (v.direction === 'left' || v.direction === 'up') ? 1 : -1;

    // Deal the cards across rows: row = index % rows keeps consecutive images on
    // different rows, so a small asset set spreads instead of clustering.
    const rows = Math.max(1, Math.round(v.rows));
    const row = index % rows;
    const slot = Math.floor(index / rows);
    const perRow = Math.max(1, Math.ceil(count / rows));

    // Weave: odd rows travel the other way.
    const dir = v.weave === 'on' && row % 2 === 1 ? -baseDir : baseDir;

    // Period is the row length, so every card lands back on its own slot at the
    // loop point — the same guarantee the other conveyors make.
    const cycles = loopCycles(v.speed, ctx.duration, perRow);
    const raw = (frame / ctx.totalFrames) * cycles * dir;

    // Hold > 0 turns the glide into discrete steps. `stepHold` is loop-safe
    // (f(n) = n at integers), and handing it ctx.ease means the scene's easing
    // curve shapes each step — so stepping and easing compose instead of
    // fighting, which is what running easedPhase on top would do.
    const hold = v.hold / 100;
    const phase = hold > 0 ? stepHold(raw, hold, ctx.ease) : ctx.easedPhase(raw);

    // gap:1 → x carries the raw signed offset in card units
    const p = cardPath({ kind: 'line', index: slot, count: perRow, phase, gap: 1, wrap: true });
    const offset = p.x;
    const sizeFactor = v.cardSize / BASE;

    // Along-track position, and the row's cross-track position centred on 0.
    const along = offset * v.gap * sizeFactor;
    const across = (row - (rows - 1) / 2) * v.rowGap * sizeFactor;

    const x = (horiz ? along : across) + v.offset.x;
    const y = (horiz ? across : along) + v.offset.y;

    // Constant scale — a ticker has no hero card.
    const scale = sizeFactor;

    // Outer fade: cards dissolve as they leave the frame instead of popping at
    // the edge, which is what makes the band read as endless.
    let alpha = 1;
    const half = (horiz ? ctx.width : ctx.height) / 2;
    const cardHalf = v.cardSize / 2;
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
      rotation: (v.tilt * Math.PI) / 180,
      alpha,
      // Rows nearer the bottom of the stack draw on top, and within a row the
      // card closest to centre wins — stable, and never flickers mid-travel.
      depth: row + p.depthNorm * 0.5,
    };
  },
};

export const tickerVariants: Template[] = [
  ticker,
  variant(ticker, 'ticker-02', 'Ticker Tilt', {
    rows: 3, weave: 'on', tilt: -12, cardSize: 180, gap: 200, rowGap: 210, speed: 0.6, count: 24,
  }),
  variant(ticker, 'ticker-03', 'Ticker Step', {
    hold: 62, speed: 1.2, cardSize: 260, gap: 290, count: 10,
  }),
];
