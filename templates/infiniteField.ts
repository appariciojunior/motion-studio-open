/** Offscreen copies of a periodic field. Copies share media identity. */
export function repeatCopies(view: number, period: number, card: number, offset = 0): number {
  return Math.max(2, Math.ceil((view + card + 2 * Math.abs(offset)) / Math.max(1, period)) + 1);
}

/** Even buffers save a full row/column compared with symmetric odd buffers.
 * Their extra copy changes sides only while it is outside the visible area.
 */
export function repeatCoordinate(position: number, period: number, copy: number, copies: number): number {
  const span = Math.max(1, period);
  const local = ((position + span / 2) % span + span) % span - span / 2;
  const start = -Math.floor((copies - 1) / 2) - (copies % 2 === 0 && local > 0 ? 1 : 0);
  return local + (start + copy) * span;
}
