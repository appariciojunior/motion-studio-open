'use client';

import { useMemo, useRef } from 'react';
import {
  easingBezier,
  resolveEasing,
  sampleEasing,
  type Bezier,
  type EasingSpec,
} from '@/lib/easing';

// The curve editor, lifted out of EasingPanel so it can be mounted anywhere:
// it takes the spec and an onChange and holds no store of its own. The panel
// passes the scene's easing; the docs pass local state. Same widget, same
// maths, same CSS — one implementation.

// SVG unit square is 0..100; the viewBox adds padding so overshoot/spring
// curves that leave [0,1] stay visible.
const VB = { x: -16, y: -20, w: 132, h: 132 };

// The handle's own radius plus its stroke, in curve units. Clamping to the bare
// viewBox edge left the dot centred ON the edge, so half of it fell outside a
// box that clips — the value was right and the handle was cut in half.
const EZ_HANDLE_R = 3.1;
const EZ_INSET = (EZ_HANDLE_R + 0.9) / 100;

// what the viewBox shows, pulled in so a handle at the limit is still whole
const EZ_Y_MAX = 1 - VB.y / 100 - EZ_INSET;
const EZ_Y_MIN = 1 - (VB.y + VB.h) / 100 + EZ_INSET;

// Field of marks over the unit square: step 6.25 puts one every ~10px, close to
// the stage's 12px pitch, and 0/25/50/75/100 all fall on it.
const EZ_STEP = 6.25;
const EZ_MARK = 1.25;                       // ~2px, the stage's square
const EZ_GRID = Array.from({ length: 100 / EZ_STEP + 1 }, (_, i) => i * EZ_STEP);

/** Build an SVG polyline path for a curve fn across x∈[0,1]. */
export function curvePath(fn: (t: number) => number, n = 48): string {
  return sampleEasing(fn, n)
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${(x * 100).toFixed(2)} ${((1 - y) * 100).toFixed(2)}`)
    .join(' ');
}

export default function EasingCurveEditor({
  spec,
  onChange,
}: {
  spec: EasingSpec;
  onChange: (next: EasingSpec) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<0 | 1 | null>(null);

  const bezier = easingBezier(spec);          // null for physics curves
  const fn = resolveEasing(spec);

  // The plot fits its box with xMidYMid meet, so the drawn area is centred and
  // usually smaller than the element: undo exactly that, from the element's own
  // client rect. getScreenCTM() looks like the tidy way to do this and is not —
  // inside a scrolling panel its matrix disagreed with clientY by 2974px.
  const pointFromEvent = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / VB.w, rect.height / VB.h);
    const offX = rect.left + (rect.width - VB.w * scale) / 2;
    const offY = rect.top + (rect.height - VB.h * scale) / 2;
    const svgX = VB.x + (clientX - offX) / scale;
    const svgY = VB.y + (clientY - offY) / scale;
    const nx = Math.max(0, Math.min(1, svgX / 100));      // x locked to [0,1]
    // y may overshoot, but only as far as the viewBox draws — a handle dragged
    // past the edge is a handle you cannot see
    const ny = Math.max(EZ_Y_MIN, Math.min(EZ_Y_MAX, 1 - svgY / 100));
    return [Number(nx.toFixed(3)), Number(ny.toFixed(3))];
  };

  const capture = (e: React.PointerEvent<SVGCircleElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no live pointer */ }
  };

  const updateHandle = (which: 0 | 1, clientX: number, clientY: number) => {
    const b: Bezier = (bezier ?? [0.25, 0.25, 0.75, 0.75]).slice() as Bezier;
    const [nx, ny] = pointFromEvent(clientX, clientY);
    if (which === 0) { b[0] = nx; b[1] = ny; } else { b[2] = nx; b[3] = ny; }
    onChange({ id: 'custom', bezier: b });
  };

  const onInput = (i: number, raw: string) => {
    const val = Number(raw);
    if (Number.isNaN(val)) return;
    const b: Bezier = (bezier ?? [0.25, 0.25, 0.75, 0.75]).slice() as Bezier;
    b[i] = i % 2 === 0 ? Math.max(0, Math.min(1, val)) : val; // clamp x, free y
    onChange({ id: 'custom', bezier: b });
  };

  const grid = useMemo(() => EZ_GRID.flatMap((gx) => EZ_GRID.map((gy) => (
    <rect
      key={`${gx}-${gy}`}
      className="ez-grid-dot"
      x={gx - EZ_MARK / 2}
      y={gy - EZ_MARK / 2}
      width={EZ_MARK}
      height={EZ_MARK}
    />
  ))), []);

  // handle pixel positions in viewBox units
  const hx1 = (bezier?.[0] ?? 0) * 100, hy1 = (1 - (bezier?.[1] ?? 0)) * 100;
  const hx2 = (bezier?.[2] ?? 1) * 100, hy2 = (1 - (bezier?.[3] ?? 1)) * 100;

  return (
    <>
      <div
        className="ez-editor"
        onPointerMove={(e) => {
          if (dragging.current === null) return;
          updateHandle(dragging.current, e.clientX, e.clientY);
        }}
        onPointerUp={() => { dragging.current = null; }}
        onPointerCancel={() => { dragging.current = null; }}
        onLostPointerCapture={() => { dragging.current = null; }}
      >
        <svg
          ref={svgRef}
          className="ez-svg"
          viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* field of squares, same mark as the stage behind the preview */}
          <g className="ez-grid">{grid}</g>
          {/* curve */}
          <path className="ez-curve" d={curvePath(fn)} />
          {/* handles (bezier curves only) */}
          {bezier && (
            <>
              <line className="ez-guide" x1={0} y1={100} x2={hx1} y2={hy1} />
              <line className="ez-guide" x1={100} y1={0} x2={hx2} y2={hy2} />
              <circle className="ez-handle" cx={hx1} cy={hy1} r={EZ_HANDLE_R} />
              <circle className="ez-handle" cx={hx2} cy={hy2} r={EZ_HANDLE_R} />
              <circle
                className="ez-grab"
                cx={hx1} cy={hy1} r={7}
                onPointerDown={(e) => { e.stopPropagation(); dragging.current = 0; capture(e); }}
              />
              <circle
                className="ez-grab"
                cx={hx2} cy={hy2} r={7}
                onPointerDown={(e) => { e.stopPropagation(); dragging.current = 1; capture(e); }}
              />
            </>
          )}
        </svg>
      </div>

      {/* ---- numeric control points ---- */}
      <div className="ez-nums">
        {[0, 1, 2, 3].map((i) => (
          <input
            key={i}
            className="ez-num"
            type="number"
            step={0.01}
            value={bezier ? bezier[i].toFixed(2) : ''}
            placeholder="—"
            disabled={!bezier}
            onChange={(e) => onInput(i, e.target.value)}
          />
        ))}
      </div>
    </>
  );
}
