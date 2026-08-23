'use client';

import { useRef, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { AdjustIcon, CurveIcon } from './EditorIcons';
import {
  EASING_PRESETS,
  EASING_MAP,
  resolveEasing,
  easingBezier,
  sampleEasing,
  type Bezier,
  type EasingSpec,
} from '@/lib/easing';

// SVG unit square is 0..100; the viewBox adds padding so overshoot/spring
// curves that leave [0,1] stay visible.
const VB = { x: -16, y: -26, w: 132, h: 152 };

// Build an SVG polyline path for a curve fn across x∈[0,1].
function curvePath(fn: (t: number) => number, n = 48): string {
  return sampleEasing(fn, n)
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${(x * 100).toFixed(2)} ${((1 - y) * 100).toFixed(2)}`)
    .join(' ');
}

// A small preset preview curve (own tiny viewBox with padding).
function MiniCurve({ spec }: { spec: EasingSpec }) {
  const fn = resolveEasing(spec);
  const d = sampleEasing(fn, 24)
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${(x * 24).toFixed(2)} ${((1 - y) * 24).toFixed(2)}`)
    .join(' ');
  return (
    <svg className="ez-mini" viewBox="-4 -8 32 40" preserveAspectRatio="none" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function EasingPanel() {
  const easing = useSceneStore((s) => s.easing);
  const setEasing = useSceneStore((s) => s.setEasing);
  const resetValues = useSceneStore((s) => s.resetValues);

  const activePreset = EASING_MAP[easing.id];
  const initialTab: 'defaults' | 'custom' =
    activePreset?.group === 'signature' ? 'defaults' : 'custom';
  const [tab, setTab] = useState<'defaults' | 'custom'>(initialTab);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<0 | 1 | null>(null);

  const bezier = easingBezier(easing);        // null for physics curves
  const fn = resolveEasing(easing);

  // ---- handle dragging ----
  const pointFromEvent = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const svgX = VB.x + ((clientX - rect.left) / rect.width) * VB.w;
    const svgY = VB.y + ((clientY - rect.top) / rect.height) * VB.h;
    const nx = Math.max(0, Math.min(1, svgX / 100));      // x locked to [0,1]
    const ny = Math.max(-0.4, Math.min(1.4, 1 - svgY / 100)); // y may overshoot
    return [Number(nx.toFixed(3)), Number(ny.toFixed(3))];
  };

  const updateHandle = (which: 0 | 1, clientX: number, clientY: number) => {
    const b: Bezier = (bezier ?? [0.25, 0.25, 0.75, 0.75]).slice() as Bezier;
    const [nx, ny] = pointFromEvent(clientX, clientY);
    if (which === 0) { b[0] = nx; b[1] = ny; } else { b[2] = nx; b[3] = ny; }
    setEasing({ id: 'custom', bezier: b });
  };

  const onInput = (i: number, raw: string) => {
    const val = Number(raw);
    if (Number.isNaN(val)) return;
    const b: Bezier = (bezier ?? [0.25, 0.25, 0.75, 0.75]).slice() as Bezier;
    b[i] = i % 2 === 0 ? Math.max(0, Math.min(1, val)) : val; // clamp x, free y
    setEasing({ id: 'custom', bezier: b });
  };

  const signature = EASING_PRESETS.filter((p) => p.group === 'signature');
  const standard = EASING_PRESETS.filter((p) => p.group === 'standard');
  const physics = EASING_PRESETS.filter((p) => p.group === 'physics');

  // handle pixel positions in viewBox units
  const hx1 = (bezier?.[0] ?? 0) * 100, hy1 = (1 - (bezier?.[1] ?? 0)) * 100;
  const hx2 = (bezier?.[2] ?? 1) * 100, hy2 = (1 - (bezier?.[3] ?? 1)) * 100;

  return (
    <>
      <div className="section-head"><span className="eyebrow">Easing</span></div>
      <div className="section-body ez-body">
        {/* ---- curve editor ---- */}
        <div
          className="ez-editor"
          onPointerMove={(e) => {
            if (dragging.current === null) return;
            updateHandle(dragging.current, e.clientX, e.clientY);
          }}
          onPointerUp={() => { dragging.current = null; }}
          onPointerLeave={() => { dragging.current = null; }}
        >
          <svg
            ref={svgRef}
            className="ez-svg"
            viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
            preserveAspectRatio="none"
          >
            {/* dotted grid */}
            {[0, 25, 50, 75, 100].map((gx) =>
              [0, 25, 50, 75, 100].map((gy) => (
                <circle key={`${gx}-${gy}`} className="ez-grid-dot" cx={gx} cy={gy} r={0.9} />
              ))
            )}
            {/* curve */}
            <path className="ez-curve" d={curvePath(fn)} />
            {/* handles (bezier curves only) */}
            {bezier && (
              <>
                <line className="ez-guide" x1={0} y1={100} x2={hx1} y2={hy1} />
                <line className="ez-guide" x1={100} y1={0} x2={hx2} y2={hy2} />
                <circle
                  className="ez-handle"
                  cx={hx1} cy={hy1} r={4.2}
                  onPointerDown={(e) => { e.stopPropagation(); dragging.current = 0; }}
                />
                <circle
                  className="ez-handle"
                  cx={hx2} cy={hy2} r={4.2}
                  onPointerDown={(e) => { e.stopPropagation(); dragging.current = 1; }}
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

        {/* ---- Defaults / Custom tabs ---- */}
        <div className="segmented ez-tabs">
          <button className={`seg ${tab === 'defaults' ? 'active' : ''}`} onClick={() => setTab('defaults')}><AdjustIcon size={13} />Defaults</button>
          <button className={`seg ${tab === 'custom' ? 'active' : ''}`} onClick={() => setTab('custom')}><CurveIcon size={13} />Custom</button>
        </div>

        {/* ---- preset list ---- */}
        {tab === 'defaults' ? (
          <div className="ez-list">
            {signature.map((p) => (
              <PresetRow key={p.id} id={p.id} label={p.label} active={easing.id === p.id} onPick={() => setEasing({ id: p.id })} />
            ))}
          </div>
        ) : (
          <div className="ez-list">
            <div className="ez-group-label">Standard</div>
            {standard.map((p) => (
              <PresetRow key={p.id} id={p.id} label={p.label} active={easing.id === p.id} onPick={() => setEasing({ id: p.id })} />
            ))}
            <div className="ez-group-label">Physics</div>
            {physics.map((p) => (
              <PresetRow key={p.id} id={p.id} label={p.label} active={easing.id === p.id} onPick={() => setEasing({ id: p.id })} />
            ))}
          </div>
        )}

        {easing.id === 'custom' && <div className="ez-custom-tag">Custom curve</div>}

        {/* ---- reset ---- */}
        <button className="ez-reset" onClick={resetValues}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3 8a5 5 0 1 1 1.5 3.5M3 8V4.5M3 8h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Reset all values
        </button>
      </div>
    </>
  );
}

function PresetRow({ id, label, active, onPick }: { id: string; label: string; active: boolean; onPick: () => void }) {
  return (
    <button className={`ez-item ${active ? 'active' : ''}`} onClick={onPick}>
      <span className="ez-item-label">{label}</span>
      <MiniCurve spec={{ id }} />
    </button>
  );
}
