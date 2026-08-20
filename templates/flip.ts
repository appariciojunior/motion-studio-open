import type { Template } from '@/lib/types';
import { clamp, loopCycles } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;
const DEG = Math.PI / 180;

// ============================================================
//  FLIP — a stepped strip of cards, the one leaving folding away on its hinge
//
//  Reverse-engineered from app.arqe.ai's Flip 01-06 on 2026-08-19 by hooking
//  its 2D canvas (it is not a WebGL scene) and reading the transform matrix and
//  clip path of every draw. None of the numbers below are guesses; each is
//  quoted with what it was measured against.
//
//  It is NOT a split-flap board, which is what the name suggests and what an
//  earlier attempt in this file assumed. `__frameCardSlots` reports a constant
//  337.5x450 card at every sample, and the strip's own translation accounts for
//  all of the movement:
//
//    * `visible` cards sit in a window centred on the canvas, spaced by
//      pitch = planeSize + gap (measured: tops 21/495/969 on a 1440 canvas for
//      planeSize 450, gap 24 => pitch 474, centres 246/720/1194, mean = 720).
//    * Every `speed` seconds the whole strip advances exactly one pitch, so a
//      card walks slot by slot toward the exit end and off.
//    * The step is shaped by the reference's own Ease curve, [.87,0,.13,1]:
//      solving that bezier at x=0.25 gives y=0.0397 against a measured 0.0401,
//      and at x=0.40 gives 0.1563 against a measured 0.154. Our `ease` preset
//      is bit-for-bit the same bezier, so `ctx.easedPhase` reproduces it and
//      the curve picker still works.
//
//  The fold is real, but it belongs to the two cards at the ends of the window,
//  not to all of them. The reference paints them as a 200-triangle mesh (the
//  standard way to fake 3D on a 2D canvas); the middle cards stay single rects.
//  Measuring the mesh's hull frame by frame:
//
//    * The outgoing card's FAR edge stays pinned exactly where the strip put it
//      (measured bottom 353.4 against a strip slot bottom of 351.6) while its
//      leading edge collapses onto it. The incoming card mirrors it about its
//      own leading edge. Both hinge on the edge facing the window's interior.
//    * It turns a quarter turn in half a slot: the flap is edge-on, and drawn
//      not at all, exactly at the step's midpoint.
//    * Its height follows a perspective projection, not a plain cosine. For a
//      flap of extent E turned by t about its hinge and seen from D away,
//      h = E*cos(t) * D/(D + E*sin(t)). Fitting D on Flip 01 (E=450) gives
//      997, and on Flip 03 (E=670) gives 1481 — so D is not a fixed camera
//      distance but 2.21x the card's own extent, and E cancels out of the
//      formula. Checked back against untouched samples: predicted 375.6 vs
//      measured 375.8, and 601.8 vs 602.0.
//
//  `planeSize` is the card's extent ALONG the travel axis, not its height: the
//  same value of 450 renders 337.5x450 in a vertical preset and 450x600 in a
//  horizontal one. Reading it as "height" would have sized every horizontal
//  preset 33% wrong.
//
//  The mesh also bows the flap into a keystone, its far edge narrower than its
//  near one. That is projective, so no affine pose can state it — scale, skew
//  and rotation all keep opposite edges parallel and equal. It first shipped
//  without one, and an A/B against the reference with matched artwork measured
//  the cost: the reference tapers 20.8% of the card's width at peak fold and a
//  purely affine version tapers 0%, which reads as a card being squashed flat
//  rather than turning away. `LayerTransform.taper` was added for it, and the
//  renderer draws a tapered pose through a PerspectiveMesh; the WebGL engine
//  was not needed, so this family keeps its blacks (see the Runway regression).
//
//  The reference's `rows`, `tiltStyle`, `scaleFocus` and `scaleCenter` are dead
//  keys: they sit in every preset's baseline but appear in neither the schema's
//  sections nor the rendered Controls panel. Ignored on purpose.
// ============================================================

/** Perspective distance the flap turns against, in units of its own extent. */
const FOLD_CAMERA = 2.21;

const flip: Template = {
  meta: {
    id: 'flip-01', name: 'Flip 01', group: 'Flip', isNew: true,
    // The reference's own default curve, and the one every measurement above
    // was taken under.
    defaultEasing: { id: 'ease' }, repeatAssets: true, cardAspect: 3 / 4,
  },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'pills',  options: ['up','down','left','right'], default: 'up' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 20, step: 1,   default: 6 },
    { key: 'visible',      label: 'Visible',       type: 'slider', min: 2, max: 6, step: 1,    default: 3, description: 'How many cards the window holds. One card always waits outside it.' },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 900, step: 1, default: 338, description: 'The card measured along the direction it travels.' },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0, max: 200, step: 1,  default: 18 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 0 },
    // Stated as seconds per step rather than a rate because that is the unit
    // the reference authored its presets in, so their values carry over as-is.
    { key: 'stepTime',     label: 'Step Time',     type: 'slider', min: 0.3, max: 6, step: 0.1, default: 2, unit: 's', precision: 1, description: 'Seconds the strip takes to advance one card.' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const n = Math.max(2, Math.round(count));
    // At least one card has to live outside the window: the card leaving and
    // the card arriving are drawn at the same instant, and with `visible === n`
    // the wrap would make them the same sprite, so one of the two could not be
    // drawn at all.
    const vis = clamp(Math.round(v.visible), 1, n - 1);

    const vertical = v.direction === 'up' || v.direction === 'down';
    // Slot 0 is the one cards leave from. Travelling up or left puts it at the
    // negative end of the axis; down or right flips the whole strip over.
    const dir = (v.direction === 'up' || v.direction === 'left') ? 1 : -1;

    // Size the sprite so its ALONG-axis edge measures `cardSize` px on screen.
    // The renderer normalises a sprite's LONG edge to BASE before applying
    // scale, so which factor is needed depends on both the card's shape and
    // which of its edges faces the direction of travel.
    const aspect = Math.max(0.05, ctx.cardAspect ?? 3 / 4);
    const scale = vertical
      ? (v.cardSize * Math.max(1, aspect)) / BASE
      : v.cardSize / (BASE * Math.min(1, aspect));

    const pitch = v.cardSize + v.gap;

    // One phase unit per step. loopCycles snaps the clip to a whole number of
    // FULL passes of the pool, so frame totalFrames lands back on frame 0.
    const stepsPerSec = 1 / Math.max(0.05, v.stepTime);
    const phase = ctx.easedPhase(
      (frame / ctx.totalFrames) * loopCycles(stepsPerSec, ctx.duration, n),
    );

    // This card's continuous slot, wrapped into [-1, n-1). Slot 0 is the exit
    // slot, so a card is on screen across (-0.5, vis-0.5): half a slot of fold
    // at each end, flat everywhere between.
    const c = ((((index - phase + 1) % n) + n) % n) - 1;

    const leaving = c < 0;
    const arriving = c > vis - 1;
    if (leaving ? c <= -0.5 : arriving && c >= vis - 0.5) {
      return { x: v.offset.x, y: v.offset.y, scale: 0, rotation: 0, alpha: 0, depth: -1 };
    }

    // A quarter turn per half slot, hinged on the edge facing into the window.
    let turn = 0;
    let hinge = 0; // +1 pins the card's far edge, -1 its near one
    if (leaving) { turn = -c * 2; hinge = 1; }
    else if (arriving) { turn = (c - (vis - 1)) * 2; hinge = -1; }

    const theta = clamp(turn, 0, 1) * 90 * DEG;
    // E cancels: E*cos(t) * (k*E)/(k*E + E*sin(t)) = E * cos(t)*k/(k + sin(t)).
    const fold = Math.cos(theta) * FOLD_CAMERA / (FOLD_CAMERA + Math.sin(theta));

    // Hold the hinged edge still while the card shortens onto it.
    const along = dir * (
      (c - (vis - 1) / 2) * pitch + hinge * (v.cardSize / 2) * (1 - fold)
    );

    // The projective half of the same fold. A point `y` along the flap from its
    // hinge sits `y*sin(theta)` further from the camera, so the card's CROSS
    // axis shrinks by D/(D + y*sin(theta)) there — 1 at the hinge, and
    // K/(K + sin(theta)) at the far edge. That taper is what makes the card
    // read as turning rather than as being squashed: measured on the reference
    // at 20.8% of the card's width at peak fold, against 0% for a pure affine
    // pose. LayerTransform.taper exists for exactly this.
    //
    // Which edge recedes follows the hinge through `dir`: the hinge always
    // faces the window's interior, so the receding edge is the outer one, and
    // 'down'/'right' put it on the opposite side from 'up'/'left'.
    const hingeAtHigh = dir * hinge > 0;
    const taper = theta > 1e-4
      ? {
          edge: (vertical
            ? (hingeAtHigh ? 'top' : 'bottom')
            : (hingeAtHigh ? 'left' : 'right')) as 'top' | 'bottom' | 'left' | 'right',
          ratio: FOLD_CAMERA / (FOLD_CAMERA + Math.sin(theta)),
        }
      : undefined;

    return {
      x: (vertical ? 0 : along) + v.offset.x,
      y: (vertical ? along : 0) + v.offset.y,
      scale,
      rotation: 0,
      alpha: 1,
      scaleX: vertical ? 1 : fold,
      scaleY: vertical ? fold : 1,
      ...(taper ? { taper } : {}),
      // Nothing overlaps — a folding card only ever shrinks inside its own slot
      // — so this just needs to be stable and to put the exit end on top.
      depth: vis - c,
    };
  },
};

// Flip 02-06 are arqé's own paramsPerModeBaseline values, read live on
// 2026-08-19. count/visible/cornerRadius/direction carry over unit for unit;
// planeSize and gap are px on its 1080x1440 stage and cross to our 810x1080 one
// through the same 0.75 factor templates/carousel.ts uses. Every one of the six
// runs at speed 2, and none of them overrides the curve.
export const flipVariants: Template[] = [
  flip, // Flip 01 — planeSize 450, gap 24, visible 3, up
  variant(flip, 'flip-02', 'Flip 02', {
    visible: 4, cardSize: 330, gap: 0,
  }),
  variant(flip, 'flip-03', 'Flip 03', {
    visible: 2, cardSize: 503, gap: 15,
  }),
  variant(flip, 'flip-04', 'Flip 04', {
    direction: 'right', cardSize: 338, gap: 18,
  }),
  variant(flip, 'flip-05', 'Flip 05', {
    direction: 'down', cardSize: 390, gap: 0, cornerRadius: 29,
  }),
  variant(flip, 'flip-06', 'Flip 06', {
    visible: 2, direction: 'right', cardSize: 353, gap: 15,
  }),
];
