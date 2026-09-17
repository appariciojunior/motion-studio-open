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

// How much of a frame the whole grid covers, each way. Not one number: a grid
// fixed at the full reach is what put five of the Survey's six stops in ONE
// cell, fanned on top of each other and impossible to tell apart. The clip
// that move is taken from only travels 37% of a frame across and 29% down, so
// at +-100 its stops are all within two cells of the middle.
//
// The grid picks the tightest of these that still holds every stop, so a small
// move spreads across all seven columns and a big one still fits. Round
// numbers, and shown in the header, so the cell you click always means
// something you could have worked out. The 10 is there for Drift, whose whole
// excursion is under four per cent: at 25 its two pins still shared a cell.
const RANGES = [10, 25, 50, 100];

const rangeFor = (pontos: { x: number; y: number }[]) => {
  const maior = pontos.reduce((m, p) => Math.max(m, Math.abs(p.x), Math.abs(p.y)), 0);
  return RANGES.find((r) => maior <= r) ?? RANGES[RANGES.length - 1];
};

/** Cell centre in pan units. Column 0 is -range, the last is +range. */
const cellX = (c: number, range: number) => Math.round((c / (COLS - 1)) * 2 * range - range);
const cellY = (r: number, range: number) => Math.round((r / (ROWS - 1)) * 2 * range - range);
/** And back: the cell a stop sits in. */
const colOf = (x: number, range: number) => Math.max(0, Math.min(COLS - 1, Math.round(((x + range) / (2 * range)) * (COLS - 1))));
const rowOf = (y: number, range: number) => Math.max(0, Math.min(ROWS - 1, Math.round(((y + range) / (2 * range)) * (ROWS - 1))));

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
  const range = rangeFor([shot, ...stops]);
  // The cell Add pin will use. Starts under the shot so the first pin lands
  // somewhere sensible rather than in a corner.
  const [cell, setCell] = useState<{ c: number; r: number }>(
    () => ({ c: Math.floor(COLS / 2), r: Math.floor(ROWS / 2) }),
  );
  // Which pin a drag owns. A pointermove that checks only `buttons === 1`
  // accepts any pressed pointer crossing the grid, which is how a drag on a
  // neighbouring control ends up moving something in here.
  const dragging = useRef<number | null>(null);
  const full = stops.length >= max;

  // EVERYTHING in a cell, the Shot included. A generated move can settle two
  // stops in one cell even after the grid tightens, and the Shot sits wherever
  // the camera starts — which for most moves is the middle, exactly where a
  // stop tends to be. Fanning only the stops left S hidden underneath one.
  const naCelula = (c: number, r: number) => {
    const aqui: { i: number }[] = [];
    if (colOf(shot.x, range) === c && rowOf(shot.y, range) === r) aqui.push({ i: -1 });
    stops.forEach((s2, i) => {
      if (colOf(s2.x, range) === c && rowOf(s2.y, range) === r) aqui.push({ i });
    });
    return aqui;
  };
  const ocupada = (c: number, r: number) =>
    stops.findIndex((s) => colOf(s.x, range) === c && rowOf(s.y, range) === r);

  const escolher = (c: number, r: number) => {
    setCell({ c, r });
    const i = ocupada(c, r);
    if (i >= 0) onSelect(i);
    else if (colOf(shot.x, range) === c && rowOf(shot.y, range) === r) onSelect(-1);
  };

  const celulas = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const aqui = ocupada(c, r);
      celulas.push(
        <button
          key={`${c}-${r}`}
          type="button"
          className={`cpg-cell ${cell.c === c && cell.r === r ? 'is-cell-on' : ''}`}
          onPointerDown={() => escolher(c, r)}
          onPointerEnter={() => {
            const i = dragging.current;
            if (i === null) return;
            onMoveStop(i, cellX(c, range), cellY(r, range));
            setCell({ c, r });
          }}
          aria-label={`Cell ${c + 1}, ${r + 1}`}
        >
          {/* Fanned, so two pins in one cell are both reachable. */}
          {naCelula(c, r).map(({ i }, k, todos) => (
            <span
              key={i}
              className={`cpg-pin ${i === -1 ? 'is-shot' : ''} ${selected === i ? 'is-on' : ''}`}
              style={todos.length > 1
                ? {
                  transform: `translate(calc(-50% + ${(k - (todos.length - 1) / 2) * 8}px), calc(-50% + ${(k - (todos.length - 1) / 2) * 6}px))`,
                  zIndex: 1 + k,
                }
                : undefined}
              title={i === -1
                ? 'Where the shot starts — set by Zoom and Pan above'
                : `Stop ${i + 1} — drag to another cell`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(i);
                setCell({ c, r });
                // The Shot is an anchor, not a pin: it moves with Pan above.
                if (i >= 0) dragging.current = i;
              }}
            >
              {i === -1 ? 'S' : i + 1}
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
        <span className="ctl-label">Camera path <span className="cpg-range">±{range}%</span></span>
        <button
          type="button"
          className="badge"
          disabled={full || ocupada(cell.c, cell.r) >= 0}
          title={full ? `${max} stops is the most one clip can settle at` : 'Put a stop on the chosen cell'}
          onClick={() => onAddStop(cellX(cell.c, range), cellY(cell.r, range))}
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
