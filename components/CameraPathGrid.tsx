'use client';

import { useRef, useState } from 'react';
import type { CameraStop } from '@/lib/sceneCamera';

/**
 * The path as pins on a grid of cells.
 *
 * Three attempts at a continuous pad failed before this, and the reason is the
 * same one every time: a continuous surface asks you to AIM. You hunt for a
 * position, you land a pixel off, and a stop at (37, -16) tells you nothing you
 * can act on. Snapping to cells removes the aiming entirely — there are
 * thirty-five places a stop can be and you cannot miss any of them.
 *
 * The order is the pin number, so the path reads without drawing a single line
 * between them, which is what turned the last version into a thicket.
 *
 * Adding is deliberate and in two parts: pick a cell, press Add pin. One gesture
 * per action, so a click never creates something you did not ask for — the
 * earlier pads added a stop on any click that missed a handle.
 */

const COLS = 7;
const ROWS = 5;
const RANGE = 100;   // per-cent of a frame, each way

/** Cell centre in pan units. Column 0 is -100, the last is +100. */
const cellX = (c: number) => Math.round((c / (COLS - 1)) * 2 * RANGE - RANGE);
const cellY = (r: number) => Math.round((r / (ROWS - 1)) * 2 * RANGE - RANGE);
/** And back: the cell a stop sits in. */
const colOf = (x: number) => Math.max(0, Math.min(COLS - 1, Math.round(((x + RANGE) / (2 * RANGE)) * (COLS - 1))));
const rowOf = (y: number) => Math.max(0, Math.min(ROWS - 1, Math.round(((y + RANGE) / (2 * RANGE)) * (ROWS - 1))));

export interface CameraPathGridProps {
  /** Where the camera starts, drawn as the anchor pin. */
  shot: { x: number; y: number };
  stops: CameraStop[];
  /** -1 while the Shot is chosen, otherwise the index into `stops`. */
  selected: number;
  max: number;
  onSelect: (index: number) => void;
  onMoveStop: (index: number, x: number, y: number) => void;
  onAddStop: (x: number, y: number) => void;
  onReset: () => void;
}

export default function CameraPathGrid({
  shot, stops, selected, max, onSelect, onMoveStop, onAddStop, onReset,
}: CameraPathGridProps) {
  // The cell Add pin will use. Starts under the shot so the first pin lands
  // somewhere sensible rather than in a corner.
  const [cell, setCell] = useState<{ c: number; r: number }>(
    () => ({ c: colOf(shot.x), r: rowOf(shot.y) }),
  );
  // Which pin a drag owns. A pointermove that checks only `buttons === 1`
  // accepts any pressed pointer crossing the grid, which is how a drag on a
  // neighbouring control ends up moving something in here.
  const dragging = useRef<number | null>(null);
  const full = stops.length >= max;

  // EVERY stop in a cell, not just the first. A generated move can settle two
  // stops a few per cent apart, and at seven columns across a whole frame that
  // is the same cell — showing one of them would quietly hide the rest.
  const naCelula = (c: number, r: number) =>
    stops.map((s, i) => ({ s, i })).filter(({ s }) => colOf(s.x) === c && rowOf(s.y) === r);
  const ocupada = (c: number, r: number) =>
    stops.findIndex((s) => colOf(s.x) === c && rowOf(s.y) === r);

  const escolher = (c: number, r: number) => {
    setCell({ c, r });
    const i = ocupada(c, r);
    if (i >= 0) onSelect(i);
    else if (colOf(shot.x) === c && rowOf(shot.y) === r) onSelect(-1);
  };

  const celulas = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const aqui = ocupada(c, r);
      const ehShot = colOf(shot.x) === c && rowOf(shot.y) === r;
      celulas.push(
        <button
          key={`${c}-${r}`}
          type="button"
          className={`cpg-cell ${cell.c === c && cell.r === r ? 'is-cell-on' : ''}`}
          onPointerDown={() => escolher(c, r)}
          onPointerEnter={() => {
            const i = dragging.current;
            if (i === null) return;
            onMoveStop(i, cellX(c), cellY(r));
            setCell({ c, r });
          }}
          aria-label={`Cell ${c + 1}, ${r + 1}`}
        >
          {ehShot && (
            <span className="cpg-pin is-shot" title="Where the shot starts">S</span>
          )}
          {/* Fanned, so two stops in one cell are both reachable. */}
          {naCelula(c, r).map(({ i }, k, todos) => (
            <span
              key={i}
              className={`cpg-pin ${selected === i ? 'is-on' : ''}`}
              style={todos.length > 1
                ? {
                  transform: `translate(calc(-50% + ${(k - (todos.length - 1) / 2) * 8}px), calc(-50% + ${(k - (todos.length - 1) / 2) * 6}px))`,
                  zIndex: 1 + k,
                }
                : undefined}
              title={`Stop ${i + 1} — drag to another cell`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(i);
                setCell({ c, r });
                dragging.current = i;
              }}
            >
              {i + 1}
            </span>
          ))}
        </button>,
      );
    }
  }

  return (
    <div
      className="cpg"
      onPointerUp={() => { dragging.current = null; }}
      onPointerLeave={() => { dragging.current = null; }}
    >
      <div className="cpg-head">
        <span className="ctl-label">Camera path</span>
        <button
          type="button"
          className="badge"
          disabled={full || ocupada(cell.c, cell.r) >= 0}
          title={full ? `${max} stops is the most one clip can settle at` : 'Put a stop on the chosen cell'}
          onClick={() => onAddStop(cellX(cell.c), cellY(cell.r))}
        >
          + Pin
        </button>
        <button
          type="button"
          className="badge"
          disabled={stops.length === 0}
          onClick={onReset}
        >
          Reset
        </button>
      </div>

      <div className="cpg-grid" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
        {celulas}
      </div>

      <div className="ctl-hint">
        {stops.length === 0
          ? 'Click a cell, then + Pin. S is where the shot starts.'
          : 'Drag pins to move · click a cell + Pin to add'}
      </div>
    </div>
  );
}
