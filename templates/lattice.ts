import type { TransformCtx } from '@/lib/types';

// ============================================================
//  LATTICE — how many cells a tiled wall needs, and where they sit
//
//  Shared by Frames and Grid. Both are toroidal walls: the cells wrap over one
//  lattice period, so the wall covers the canvas only while that period is at
//  least as large as the canvas. That is a fact about the frame, not a taste
//  decision, which is why the cell total is DERIVED here instead of being asked
//  of the user. The reference tool reaches the same conclusion — its Grid ships
//  no count control at all, only Plane Size and Gap.
//
//  The rule, read off four measured reference states (its stage is 1080x1440,
//  cards 3:4, gap held at 80 throughout):
//
//      planeSize   card       pitch       grid
//        700     700x933    780x1013     3x3
//        400     400x533    480x613      3x3
//        200     200x267    280x346      5x5
//        100     100x133    180x213      7x7
//
//  Cells GROW in number as they shrink in size, and the gap never moves. Fitted
//  per axis, every one of those eight numbers is the smallest ODD n with
//  n*pitch >= span. Odd keeps a cell centred on the frame; a rival fit —
//  (n-1)*pitch + card >= span — reproduces seven of the eight and misses the
//  last by 29px, so it is not the rule.
//
//  Converted to this project's canvas the rule reproduces the reference exactly:
//  at 810x1080, Plane Size 700/Gap 60 solves to 3x3, 200 to 5x5, 100 to 7x7 —
//  the same walls, cell for cell.
// ============================================================

// A wall is drawn one sprite per cell, so the derivation needs a ceiling. These
// only bind at the very bottom of the Plane Size range (Plane Size 60 / Gap 0
// wants 19x19); everywhere in normal use the rule is what decides.
const MAX_CELLS = 180;
const MAX_PER_AXIS = 25;

// Both walls PAN, and a one-cell period is not a conveyor: pan it by one pitch
// and the same picture is back. At Grid 04's 375px gap the rule alone solves to
// a single column, which would have shown one image six times over the clip.
// Three is also the smallest lattice the reference was ever measured at — every
// one of its four sampled states is 3x3 or larger — so this floor is consistent
// with the data without being distinguished BY it: at 700 and 400 the rule
// returns 3 on its own, so no measurement can tell a floor from a coincidence.
const MIN_PER_AXIS = 3;

export interface Lattice {
  cols: number;
  rows: number;
  cardW: number;
  cardH: number;
  /** Card plus gutter. Equals card + gap unless the budget capped an axis. */
  pitchX: number;
  pitchY: number;
}

// The smallest odd n whose n cells span `span`.
function oddCover(span: number, pitch: number): number {
  if (!(pitch > 0)) return 1;
  const n = Math.max(1, Math.ceil(span / pitch));
  return n % 2 === 1 ? n : n + 1;
}

// The divisor of `n` closest to `want`, so a fixed number of cards still tiles a
// complete rectangle — a half-filled row would scroll through the frame as a
// hole punched in the wall.
function divisorNear(n: number, want: number): number {
  let best = 1;
  for (let d = 1; d <= n; d++) {
    if (n % d !== 0) continue;
    if (Math.abs(d - want) < Math.abs(best - want)) best = d;
  }
  return best;
}

export function solveLattice(
  v: Record<string, any>,
  ctx: Pick<TransformCtx, 'width' | 'height' | 'cardAspect'>,
  declaredAspect = 3 / 4,
  // The layer count the CALLER is working with. The studio passes what
  // `layerCount` derived, so it agrees and nothing below fires. The board and
  // web-export surfaces are different: their card total is however many elements
  // the user placed in their own markup, which the canvas has no say over. Given
  // one, the lattice fits a complete rectangle to it instead — otherwise cards
  // past the derived cell total land exactly on top of earlier ones.
  //
  // This deliberately reads the transform's own `count` argument rather than a
  // `count` key in the value bag: a scene saved before these families lost their
  // Count control still carries that key, and honouring it would quietly pin
  // those scenes to the old wall.
  atLeast?: number,
): Lattice {
  // The renderer normalizes a sprite's LONG edge, so cardSize is that edge and
  // the short one follows the card's RESOLVED aspect — which the scene's card
  // shape can override away from the family's declared one. Spacing off the
  // declared value instead leaves one gutter right and the other wrong: at the
  // 4:5 shape a nominal 60px gap came out 60 down and 25 across.
  const aspect = ctx.cardAspect ?? declaredAspect;
  const size = Math.max(1, Number(v.cardSize) || 1);
  const cardW = aspect < 1 ? size * aspect : size;
  const cardH = aspect < 1 ? size : size / aspect;
  const gap = Math.max(0, Number(v.gap) || 0);

  const axis = (n: number) => Math.min(MAX_PER_AXIS, Math.max(MIN_PER_AXIS, n));
  let cols = axis(oddCover(ctx.width, cardW + gap));
  let rows = axis(oddCover(ctx.height, cardH + gap));
  // Spend the budget on the axis that has cells to spare, two at a time so both
  // stay odd.
  while (cols * rows > MAX_CELLS && (cols > MIN_PER_AXIS || rows > MIN_PER_AXIS)) {
    if (cols >= rows && cols > MIN_PER_AXIS) cols -= 2;
    else if (rows > MIN_PER_AXIS) rows -= 2;
    else break;
  }

  // A caller working to a fixed card total gets a complete rectangle of exactly
  // that many, laid out as close to the derived proportions as its divisors allow.
  const fixed = Math.round(Number(atLeast));
  if (Number.isFinite(fixed) && fixed >= 1 && fixed !== cols * rows) {
    cols = divisorNear(fixed, cols);
    rows = Math.max(1, Math.round(fixed / cols));
  }

  // Safety net for a capped axis: one gutter, solved on whichever axis is short,
  // so the wall still covers the frame. It has to be the gutter and not a factor
  // on the pitch — a single factor adds a different amount to each axis and
  // pulls the two gutters apart, the exact asymmetry this family was fixed for
  // once already. Uncapped, both terms are <= gap by construction, so this
  // returns the gap the user set, untouched.
  const gutter = Math.max(gap, ctx.width / cols - cardW, ctx.height / rows - cardH);
  return { cols, rows, cardW, cardH, pitchX: cardW + gutter, pitchY: cardH + gutter };
}

// The layer count a lattice family wants. Templates hand this straight to their
// `layerCount`, and the renderer sizes the sprite pool by it.
export function latticeCount(
  v: Record<string, any>,
  ctx: Pick<TransformCtx, 'width' | 'height' | 'cardAspect'>,
  declaredAspect = 3 / 4,
): number {
  const { cols, rows } = solveLattice(v, ctx, declaredAspect);
  return cols * rows;
}
