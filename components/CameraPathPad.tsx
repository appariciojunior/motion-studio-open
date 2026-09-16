'use client';

import { useRef } from 'react';
import type { CameraStop } from '@/lib/sceneCamera';

/**
 * The whole camera path in ONE control.
 *
 * The first version spent two rows per stop — a pad and a zoom — and at four
 * stops the panel was nine rows of camera. That is the wrong shape: a path is
 * one thing, and how many stops it has must not decide how tall the panel is.
 * So every stop lives inside this single pad and the row under it edits
 * whichever one is selected.
 *
 * The pad is the FRAME, at ±100% of it on each axis, which is the unit Pan
 * already uses. A dot's SIZE is its zoom, so the path reads at a glance.
 *
 * WHAT THIS VERSION FIXES, reported as "ficou confuso de como eu clicar":
 *
 *  - Nothing said the pad was clickable. The only instruction was a grey line
 *    of text below it. An empty pad now says so in the middle of itself, and
 *    there is an Add stop button as well, because a gesture nobody can see is
 *    not a feature.
 *  - Stop 1 was the Shot, drawn as a dot like the others and not draggable.
 *    You would try to drag it and nothing would happen. It is labelled Start
 *    now, drawn as a ring rather than a dot, and says where it is edited.
 *  - The stops were numbered from 2, so the first one you added was "Stop 2".
 *    They start at 1.
 *  - The selected stop was a 2px outline. It now carries a halo, and the row
 *    that edits it names it, so the two are visibly the same thing.
 */

const RANGE = 100;  // per-cent of a frame, each way — the pad's own edges

export interface CameraPathPadProps {
  /** Where the camera starts: the Shot, drawn as the anchor. */
  shot: { x: number; y: number; zoom: number };
  stops: CameraStop[];
  /** -1 while the Shot is selected, otherwise the index into `stops`. */
  selected: number;
  max: number;
  onSelect: (index: number) => void;
  onMoveStop: (index: number, x: number, y: number) => void;
  onAddStop: (x: number, y: number) => void;
}

export default function CameraPathPad({
  shot, stops, selected, max, onSelect, onMoveStop, onAddStop,
}: CameraPathPadProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Which stop this gesture owns. A pointermove that checks only `buttons === 1`
  // accepts any pressed pointer that happens to pass over the pad, which is how
  // a drag on a neighbouring control ends up moving something here.
  const dragging = useRef<number | null>(null);
  const full = stops.length >= max;

  const pct = (n: number) => ((n / RANGE + 1) / 2) * 100;
  const fromClient = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    const nx = clamp01((clientX - rect.left) / rect.width);
    const ny = clamp01((clientY - rect.top) / rect.height);
    return { x: Math.round((nx * 2 - 1) * RANGE), y: Math.round((ny * 2 - 1) * RANGE) };
  };

  // A stop's dot grows with its zoom, between roughly half and double the base.
  const dotSize = (zoom: number) => 14 + Math.max(-6, Math.min(12, (zoom - 100) / 16));

  const points = [
    { x: shot.x, y: shot.y, zoom: shot.zoom, index: -1 },
    ...stops.map((s, i) => ({ ...s, index: i })),
  ];

  return (
    <div className="campath-wrap">
      <div
        ref={ref}
        className={`campath ${full ? 'is-full' : ''}`}
        onPointerDown={(e) => {
          // An empty patch of pad is a new stop, which is the gesture the empty
          // state advertises: no button to find, and it lands where you pointed.
          if ((e.target as HTMLElement).closest('.campath-dot')) return;
          if (full) return;
          const p = fromClient(e.clientX, e.clientY);
          if (p) onAddStop(p.x, p.y);
        }}
        onPointerMove={(e) => {
          const i = dragging.current;
          if (i === null || e.buttons !== 1) return;
          const p = fromClient(e.clientX, e.clientY);
          if (p) onMoveStop(i, p.x, p.y);
        }}
        onPointerUp={() => { dragging.current = null; }}
        onPointerCancel={() => { dragging.current = null; }}
        onLostPointerCapture={() => { dragging.current = null; }}
      >
        <svg className="campath-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line className="campath-mid" x1="50" y1="0" x2="50" y2="100" />
          <line className="campath-mid" x1="0" y1="50" x2="100" y2="50" />
          {points.slice(1).map((p, i) => (
            <line
              key={i}
              className="campath-leg"
              x1={pct(points[i].x)}
              y1={pct(points[i].y)}
              x2={pct(p.x)}
              y2={pct(p.y)}
            />
          ))}
        </svg>
        {/* The frame's own corners, so the pad reads as a picture rather than
            as an empty box with dots in it. */}
        <span className="campath-corner tl" aria-hidden />
        <span className="campath-corner tr" aria-hidden />
        <span className="campath-corner bl" aria-hidden />
        <span className="campath-corner br" aria-hidden />

        {stops.length === 0 && (
          // The gesture, said where the gesture happens. This is the whole fix
          // for "how do I click": the instruction used to live under the pad.
          <div className="campath-empty" aria-hidden>
            <span className="campath-plus">+</span>
            <span>Click anywhere to add a stop</span>
          </div>
        )}

        {points.map((p) => {
          const isShot = p.index === -1;
          const size = dotSize(p.zoom);
          return (
            <button
              key={p.index}
              type="button"
              className={`campath-dot ${isShot ? 'is-shot' : ''} ${selected === p.index ? 'is-selected' : ''}`}
              style={{ left: `${pct(p.x)}%`, top: `${pct(p.y)}%`, width: size, height: size }}
              title={isShot
                ? 'Where the shot starts — move it with Zoom and Pan above'
                : `Stop ${p.index + 1} — drag to move, click to edit its zoom`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(p.index);
                // The Shot is an anchor, not a handle: it is said above.
                if (isShot) return;
                dragging.current = p.index;
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              }}
            >
              <span className="campath-num">{isShot ? '' : p.index + 1}</span>
              {isShot && <span className="campath-tag">Start</span>}
            </button>
          );
        })}
      </div>
      <div className="campath-hint">
        {stops.length === 0
          ? 'Start is where the Shot above puts the camera.'
          : full
            ? `${stops.length} of ${max} stops — the most one clip can settle at.`
            : 'Drag a stop to move it · a bigger dot is a closer shot'}
      </div>
    </div>
  );
}
