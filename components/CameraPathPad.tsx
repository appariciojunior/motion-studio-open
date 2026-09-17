'use client';

import { useRef } from 'react';
import type { CameraStop } from '@/lib/sceneCamera';

/**
 * The path, one stop at a time.
 *
 * Two earlier versions drew every stop at once and both were unreadable, for
 * the same reason by two different routes. Dots could only say WHERE a stop
 * was, never how much it took in, so its zoom lived in a slider elsewhere with
 * nothing tying them together. Rectangles said both — and then piled up: stops
 * differ mostly in zoom, so their frames come out concentric, and half a dozen
 * nested rectangles inside 250 pixels is a thicket, not a diagram. The second
 * attempt was reported as worse than the first, and it was.
 *
 * So this shows ONE. The strip along the top is the path as what it actually is
 * — an ordered list — and clicking a chip steps to that stop. Underneath, the
 * chosen stop is a frame you drag to aim, with the previous one behind it as a
 * ghost so you can see where the camera is coming from.
 *
 * Nothing overlaps, the height never changes with the number of stops, and each
 * question gets asked once: which stop (the strip), pointing where (the frame),
 * how close (the row the panel puts underneath).
 *
 * This is the hand-editing surface and not the front door — a move is chosen by
 * name above (lib/cameraMoves). It exists for placing a stop exactly where you
 * want it, which a named move deliberately cannot do.
 */

const RANGE = 100;   // per-cent of a frame, each way — how far a stop may sit

export interface CameraPathPadProps {
  shot: { x: number; y: number; zoom: number };
  stops: CameraStop[];
  /** -1 while the Shot is chosen, otherwise the index into `stops`. */
  selected: number;
  max: number;
  /** Scene width / height, so a frame is drawn the shape it really is. */
  frameAspect: number;
  onSelect: (index: number) => void;
  onMoveStop: (index: number, x: number, y: number) => void;
  onAddStop: (x: number, y: number) => void;
}

export default function CameraPathPad({
  shot, stops, selected, max, frameAspect, onSelect, onMoveStop, onAddStop,
}: CameraPathPadProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Whether THIS pad started the drag. A pointermove that checks only
  // `buttons === 1` accepts any pressed pointer crossing the pad, which is how
  // a drag on a neighbouring control ends up moving something in here.
  const dragging = useRef(false);
  const full = stops.length >= max;

  const todos = [
    { ...shot, index: -1 },
    ...stops.map((s, i) => ({ ...s, index: i })),
  ];
  const atual = todos.find((p) => p.index === selected) ?? todos[0];
  const anterior = todos[todos.findIndex((p) => p.index === atual.index) - 1] ?? null;

  // The pad covers the reach a stop has, plus half a frame of margin so a stop
  // at the limit is not drawn hard against the edge.
  const VISTA = RANGE * 2 + 60;
  const pct = (n: number) => ((n / VISTA) + 0.5) * 100;
  const fromClient = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    const dentro = (n: number) => Math.max(-RANGE, Math.min(RANGE, Math.round(n)));
    return {
      x: dentro(((clientX - rect.left) / rect.width - 0.5) * VISTA),
      y: dentro(((clientY - rect.top) / rect.height - 0.5) * VISTA),
    };
  };

  // A frame at zoom Z takes in 1/Z of a frame, and the pad is VISTA across.
  const frameW = (zoom: number) => (100 / Math.max(0.25, zoom / 100) / VISTA) * 100;
  const frameH = (zoom: number) => frameW(zoom) * (frameAspect > 0 ? 1 / frameAspect : 1);

  const quadro = (p: { x: number; y: number; zoom: number }, classe: string, rotulo?: string) => (
    <div
      className={`camframe ${classe}`}
      style={{
        left: `${pct(p.x)}%`, top: `${pct(p.y)}%`,
        width: `${frameW(p.zoom)}%`, height: `${frameH(p.zoom)}%`,
      }}
    >
      {rotulo && <span className="camframe-num">{rotulo}</span>}
    </div>
  );

  return (
    <div className="campath-wrap">
      {/* The path IS a list, so it is drawn as one. */}
      <div className="campath-strip">
        {todos.map((p) => (
          <button
            key={p.index}
            type="button"
            className={`campath-chip ${selected === p.index ? 'is-on' : ''} ${p.index === -1 ? 'is-shot' : ''}`}
            onClick={() => onSelect(p.index)}
            title={p.index === -1 ? 'Where the shot starts' : `Stop ${p.index + 1}`}
          >
            {p.index === -1 ? 'Start' : p.index + 1}
          </button>
        ))}
        <button
          type="button"
          className="campath-chip is-add"
          disabled={full}
          title={full ? `${max} stops is the most one clip can settle at` : 'Add a stop'}
          onClick={() => {
            const ultimo = stops[stops.length - 1] ?? shot;
            const dentro = (n: number) => Math.max(-RANGE, Math.min(RANGE, n));
            onAddStop(dentro(ultimo.x + 30), dentro(ultimo.y - 20));
          }}
        >
          +
        </button>
      </div>

      <div
        ref={ref}
        className="campath"
        onPointerDown={(e) => {
          // Clicking the pad AIMS the chosen stop rather than adding a new one:
          // adding is the + on the strip, and one gesture should do one thing.
          if (atual.index < 0) return;
          const p = fromClient(e.clientX, e.clientY);
          if (!p) return;
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          onMoveStop(atual.index, p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!dragging.current || e.buttons !== 1 || atual.index < 0) return;
          const p = fromClient(e.clientX, e.clientY);
          if (p) onMoveStop(atual.index, p.x, p.y);
        }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onLostPointerCapture={() => { dragging.current = false; }}
      >
        <svg className="campath-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line className="campath-mid" x1="50" y1="0" x2="50" y2="100" />
          <line className="campath-mid" x1="0" y1="50" x2="100" y2="50" />
          {anterior && (
            <line
              className="campath-leg"
              x1={pct(anterior.x)} y1={pct(anterior.y)}
              x2={pct(atual.x)} y2={pct(atual.y)}
            />
          )}
        </svg>

        {/* Where the camera is coming from, behind where it is going. */}
        {anterior && quadro(anterior, 'is-ghost', anterior.index === -1 ? 'Start' : String(anterior.index + 1))}
        {quadro(atual, atual.index === -1 ? 'is-shot is-selected' : 'is-selected',
          atual.index === -1 ? 'Start' : String(atual.index + 1))}
      </div>

      <div className="campath-hint">
        {atual.index === -1
          ? stops.length === 0
            ? 'Start is the frame the Shot above sets. Add a stop with + to make the camera travel.'
            : 'Start is set by the Shot above. Pick a stop to aim it.'
          : 'Click or drag inside the pad to aim this stop. The frame is what the camera sees.'}
      </div>
    </div>
  );
}
