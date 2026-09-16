'use client';

import { useRef } from 'react';
import type { CameraStop } from '@/lib/sceneCamera';

/**
 * The path, drawn as what the camera actually SEES.
 *
 * Every earlier version of this drew a stop as a dot, and a dot is the wrong
 * object. A stop is a framing — where the camera points AND how much it takes
 * in — so a dot could only ever say half of it, and the other half lived in a
 * slider underneath with nothing tying the two together. Worse, the dot's size
 * was its zoom with bigger meaning CLOSER, which is backwards from how anyone
 * reads a frame: a tight shot is a small rectangle, not a big blob.
 *
 * So a stop is a rectangle, and it is the frame. Drag the rectangle to aim,
 * drag its corner to zoom. One object, both halves, and the separate zoom row
 * is gone. A small rectangle is a close shot because it is literally less of
 * the scene.
 *
 * The pad is the reachable area: the frame at 100%, plus the pan range either
 * side of it, which is two frames across. A frame at zoom Z is therefore 50/Z
 * per cent of the pad wide.
 *
 * This is the hand-editing surface and no longer the front door — a move is
 * chosen by name in the panel above (lib/cameraMoves). It exists for placing a
 * stop exactly where you want it, which the named moves deliberately cannot do.
 */

const RANGE = 100;        // per-cent of a frame, each way — the pad's own edges
const MIN_ZOOM = 25;
const MAX_ZOOM = 300;

export interface CameraPathPadProps {
  shot: { x: number; y: number; zoom: number };
  stops: CameraStop[];
  /** -1 while the Shot is selected, otherwise the index into `stops`. */
  selected: number;
  max: number;
  /** Scene width / height, so a frame is drawn the shape it really is. */
  frameAspect: number;
  onSelect: (index: number) => void;
  onMoveStop: (index: number, x: number, y: number) => void;
  onZoomStop: (index: number, zoom: number) => void;
  onAddStop: (x: number, y: number) => void;
}

type Gesture = { index: number; kind: 'move' | 'zoom' };

export default function CameraPathPad({
  shot, stops, selected, max, frameAspect, onSelect, onMoveStop, onZoomStop, onAddStop,
}: CameraPathPadProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Which stop this gesture owns, and which half of it. A pointermove that
  // checks only `buttons === 1` accepts any pressed pointer that happens to
  // cross the pad, which is how a drag on a neighbouring control ends up
  // moving something in here.
  const gesture = useRef<Gesture | null>(null);
  const full = stops.length >= max;

  // ---- the pad FITS the path ----
  // Showing the full reach every time is what made this unreadable: a real
  // move covers a third of a frame, so at a fixed +-100 the frames pile up in
  // the middle on top of each other. The pad shows the path instead, with
  // room around it, and never zooms in past the full reach so a one-stop move
  // does not look enormous.
  const todos = [{ ...shot, index: -1 }, ...stops.map((s2, i) => ({ ...s2, index: i }))];
  const meia = (zoom: number) => 100 / Math.max(0.25, zoom / 100) / 2;
  const limites = todos.reduce((acc, p) => {
    const m = meia(p.zoom);
    return {
      x0: Math.min(acc.x0, p.x - m), x1: Math.max(acc.x1, p.x + m),
      y0: Math.min(acc.y0, p.y - m), y1: Math.max(acc.y1, p.y + m),
    };
  }, { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
  const centro = { x: (limites.x0 + limites.x1) / 2, y: (limites.y0 + limites.y1) / 2 };
  const VISTA = Math.min(
    RANGE * 2,
    Math.max(60, Math.max(limites.x1 - limites.x0, limites.y1 - limites.y0) * 1.25),
  );
  const pctX = (n: number) => ((n - centro.x) / VISTA + 0.5) * 100;
  const pctY = (n: number) => ((n - centro.y) / VISTA + 0.5) * 100;
  const fromClient = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    const dentro = (n: number) => Math.max(-RANGE, Math.min(RANGE, Math.round(n)));
    return { x: dentro((nx - 0.5) * VISTA + centro.x), y: dentro((ny - 0.5) * VISTA + centro.y) };
  };

  // The frame at this zoom, as a share of the pad. The pad spans two frames, so
  // a 100% frame is half of it and a 200% one a quarter.
  const frameW = (zoom: number) => (meia(zoom) * 2 / VISTA) * 100;
  const frameH = (zoom: number) => frameW(zoom) * (frameAspect > 0 ? 1 / frameAspect : 1);

  // Dragging a corner sets the zoom: the further out you pull the corner, the
  // wider the frame, so the smaller the zoom.
  // Pulling the corner out opens the frame, so the zoom falls.
  const zoomFromCorner = (cx: number, px: number) => {
    const m = Math.max(2, Math.abs(px - cx));
    return Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (100 / m) * 100)));
  };

  const points = todos;

  return (
    <div className="campath-wrap">
      <div
        ref={ref}
        className={`campath ${full ? 'is-full' : ''}`}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('.camframe')) return;
          if (full) return;
          const p = fromClient(e.clientX, e.clientY);
          if (p) onAddStop(p.x, p.y);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || e.buttons !== 1) return;
          const p = fromClient(e.clientX, e.clientY);
          if (!p) return;
          if (g.kind === 'move') { onMoveStop(g.index, p.x, p.y); return; }
          const alvo = stops[g.index];
          if (!alvo) return;
          onZoomStop(g.index, zoomFromCorner(alvo.x, p.x));
        }}
        onPointerUp={() => { gesture.current = null; }}
        onPointerCancel={() => { gesture.current = null; }}
        onLostPointerCapture={() => { gesture.current = null; }}
      >
        <svg className="campath-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line className="campath-mid" x1="50" y1="0" x2="50" y2="100" />
          <line className="campath-mid" x1="0" y1="50" x2="100" y2="50" />
          {points.slice(1).map((p, i) => (
            <line
              key={i}
              className="campath-leg"
              x1={pctX(points[i].x)} y1={pctY(points[i].y)}
              x2={pctX(p.x)} y2={pctY(p.y)}
            />
          ))}
        </svg>

        {stops.length === 0 && (
          <div className="campath-empty" aria-hidden>
            <span className="campath-plus">+</span>
            <span>Click anywhere to add a stop</span>
          </div>
        )}

        {points.map((p) => {
          const isShot = p.index === -1;
          const w = frameW(p.zoom);
          const h = frameH(p.zoom);
          return (
            <div
              key={p.index}
              className={`camframe ${isShot ? 'is-shot' : ''} ${selected === p.index ? 'is-selected' : ''}`}
              style={{
                left: `${pctX(p.x)}%`, top: `${pctY(p.y)}%`,
                width: `${w}%`, height: `${h}%`,
              }}
              role="button"
              tabIndex={0}
              title={isShot
                ? 'Where the shot starts — sized by Zoom above'
                : `Stop ${p.index + 1} — drag to aim, drag the corner to zoom`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(p.index);
                if (isShot) return;
                gesture.current = { index: p.index, kind: 'move' };
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              }}
            >
              <span className="camframe-num">{isShot ? 'Start' : p.index + 1}</span>
              {selected === p.index && <span className="camframe-zoom">{Math.round(p.zoom)}%</span>}
              {!isShot && selected === p.index && (
                <span
                  className="camframe-grip"
                  title="Drag to zoom"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect(p.index);
                    gesture.current = { index: p.index, kind: 'zoom' };
                    (e.currentTarget.parentElement as HTMLElement)?.setPointerCapture?.(e.pointerId);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="campath-hint">
        {stops.length === 0
          ? 'Each stop is a frame. Start is the one the Shot above sets.'
          : full
            ? `${stops.length} of ${max} stops — the most one clip can settle at.`
            : 'Drag a frame to aim it · drag its corner to zoom · a smaller frame is a closer shot'}
      </div>
    </div>
  );
}
