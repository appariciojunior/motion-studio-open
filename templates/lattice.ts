import type { TransformCtx } from '@/lib/types';

type CanvasCtx = Pick<TransformCtx, 'width' | 'height' | 'cardAspect'>;

/** Authored sizes use a 1080px long edge; output resolution is not geometry. */
export const canvasScale = (ctx: Pick<CanvasCtx, 'width' | 'height'>) =>
  Math.max(1, ctx.width, ctx.height) / 1080;

export interface Lattice {
  cols: number; rows: number;
  motifCols: number; motifRows: number;
  cardW: number; cardH: number; pitchX: number; pitchY: number;
  scale: number;
}

const oddCover = (span: number, pitch: number) => {
  const n = Math.max(1, Math.ceil(span / pitch));
  return n % 2 === 1 ? n : n + 1;
};
function divisorNear(n: number, want: number) {
  let best = 1;
  for (let d = 1; d <= n; d++) {
    if (n % d === 0 && Math.abs(d - want) < Math.abs(best - want)) best = d;
  }
  return best;
}

/**
 * A repeating motif and its offscreen copies are separate. The motif determines
 * timing and media identity; the viewport only determines how many copies to draw.
 * A copy crossing a motif boundary is replaced by an identical neighbouring copy.
 * The outermost copies must make that exchange entirely outside the viewport.
 */
export function solveLattice(v: Record<string, any>, ctx: CanvasCtx, declaredAspect = 3 / 4, fixedCount?: number): Lattice {
  const scale = canvasScale(ctx);
  const aspect = Math.max(0.05, ctx.cardAspect ?? declaredAspect);
  const size = Math.max(1, Number(v.cardSize) || 1);
  const w = size * Math.min(1, aspect), h = size * Math.min(1, 1 / aspect);
  const gap = Math.max(0, Number(v.gap) || 0);
  const cardW = w * scale, cardH = h * scale;
  const pitchX = (w + gap) * scale, pitchY = (h + gap) * scale;
  // Reference composition is independent of output dimensions and aspect.
  let motifCols = Math.max(3, oddCover(810, w + gap));
  let motifRows = Math.max(3, oddCover(1080, h + gap));
  const roll = (Number(v.tilt ?? 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(roll)), s = Math.abs(Math.sin(roll));
  const ox = Math.abs(Number(v.offset?.x ?? 0)) * scale;
  const oy = Math.abs(Number(v.offset?.y ?? 0)) * scale;
  const minSwell = v.breath === 'on' ? Math.max(0.1, 1 - (Number(v.pulseAmt) || 0) / 200) : 1;
  const extentX = (c * (ctx.width + 2 * ox) + s * (ctx.height + 2 * oy)) / minSwell + cardW;
  const extentY = (s * (ctx.width + 2 * ox) + c * (ctx.height + 2 * oy)) / minSwell + cardH;
  const copiesX = oddCover(extentX + 2 * motifCols * pitchX, motifCols * pitchX);
  const copiesY = oddCover(extentY + 2 * motifRows * pitchY, motifRows * pitchY);
  let cols = motifCols * copiesX, rows = motifRows * copiesY;
  // Board/Web can animate a user-owned, fixed number of DOM elements. Do not
  // duplicate or discard those elements, or silently change their authored gap.
  const fixed = Math.round(Number(fixedCount));
  if (Number.isFinite(fixed) && fixed >= 1 && fixed !== cols * rows) {
    cols = divisorNear(fixed, motifCols); rows = fixed / cols;
    motifCols = cols; motifRows = rows;
  }
  return { cols, rows, motifCols, motifRows, cardW, cardH, pitchX, pitchY, scale };
}

export const latticeCount = (v: Record<string, any>, ctx: CanvasCtx, aspect = 3 / 4) => {
  const l = solveLattice(v, ctx, aspect);
  return l.cols * l.rows;
};

/** Stable texture/placeholder identity for repeated copies of the same card. */
export function latticeMediaIndex(index: number, count: number, v: Record<string, any>, ctx: CanvasCtx) {
  const l = solveLattice(v, ctx, 3 / 4, count);
  return (index % l.cols) % l.motifCols + (Math.floor(index / l.cols) % l.motifRows) * l.motifCols;
}

/** One axis of a motif, repeated into a fixed, centred offscreen buffer. */
export function latticeAxis(cell: number, motif: number, cells: number, pitch: number, pan: number, shift = 0) {
  const span = motif * pitch;
  const raw = ((cell % motif) + shift) * pitch - pan;
  const wrapped = ((raw % span) + span) % span - span / 2;
  return wrapped + (Math.floor(cell / motif) - (cells / motif - 1) / 2) * span;
}
