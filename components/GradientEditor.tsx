'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ControlRow } from './Controls';
import type { ControlDef } from '@/lib/types';
import {
  MAX_GRADIENT_STOPS,
  gradientCss,
  normalizeGradientSpec,
  sampleGradientRGB,
  sortedStops,
  type GradientShape,
  type GradientSpec,
  type GradientStop,
} from '@/lib/gradient';

interface GradientEditorProps {
  value: GradientSpec;
  onChange: (value: GradientSpec) => void;
  showMapping?: boolean;
}

const PRESETS: Array<{ name: string; colors: string[]; angle?: number; shape?: GradientShape }> = [
  { name: 'Dusk', colors: ['#2b1055', '#7597de'], angle: 315 },
  { name: 'Ember', colors: ['#f12711', '#f5af19'], angle: 315 },
  { name: 'Lagoon', colors: ['#021c19', '#098274', '#37e2ca'], angle: 135 },
  { name: 'Grape', colors: ['#41295a', '#2f0743'], angle: 315 },
  { name: 'Peach', colors: ['#ee9ca7', '#ffdde1'], angle: 315 },
  { name: 'Halo', colors: ['#3a3a5a', '#0d0d14'], shape: 'radial' },
];

const BASIC_SHAPES: Array<[GradientShape, string]> = [['linear', 'Linear'], ['radial', 'Radial']];
const ADVANCED_SHAPES: Array<[GradientShape, string]> = [
  ...BASIC_SHAPES,
  ['conic', 'Conic'],
  ['mesh', 'Mesh'],
  ['warped-field', 'Warped Field'],
  ['twin-radial', 'Twin Radial'],
];

const angleDef: ControlDef = { key: 'gradient-angle', label: 'Angle', type: 'slider', min: 0, max: 360, step: 1, default: 90, unit: '°' };
const centerXDef: ControlDef = { key: 'gradient-center-x', label: 'Center X', type: 'slider', min: 0, max: 1, step: 0.01, precision: 2, default: 0.5 };
const centerYDef: ControlDef = { key: 'gradient-center-y', label: 'Center Y', type: 'slider', min: 0, max: 1, step: 0.01, precision: 2, default: 0.5 };
const radiusDef: ControlDef = { key: 'gradient-radius', label: 'Radius', type: 'slider', min: 0.05, max: 2, step: 0.01, precision: 2, default: 0.7 };
const softnessDef: ControlDef = { key: 'gradient-softness', label: 'Softness', type: 'slider', min: 0, max: 1, step: 0.01, precision: 2, default: 0 };
const stopPositionDef: ControlDef = { key: 'gradient-stop-position', label: 'Position', type: 'slider', min: 0, max: 100, step: 1, default: 0, unit: '%' };
const warpDef: ControlDef = { key: 'gradient-warp', label: 'Warp', type: 'slider', min: 0, max: 2, step: 0.01, precision: 2, default: 0 };
const flowDef: ControlDef = { key: 'gradient-flow', label: 'Flow', type: 'slider', min: 0, max: 1, step: 0.01, precision: 2, default: 0 };
const scaleDef: ControlDef = { key: 'gradient-scale', label: 'Scale', type: 'slider', min: 0.4, max: 4, step: 0.01, precision: 2, default: 1 };
const detailDef: ControlDef = { key: 'gradient-detail', label: 'Detail', type: 'slider', min: 0, max: 6, step: 1, default: 1 };
const contrastDef: ControlDef = { key: 'gradient-contrast', label: 'Contrast', type: 'slider', min: 0.5, max: 3, step: 0.01, precision: 2, default: 1 };

let stopCounter = 0;
const nextStopId = () => `stop-${Date.now().toString(36)}-${++stopCounter}`;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

function rgbHex(rgb: [number, number, number, number]) {
  return `#${rgb.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function presetSpec(current: GradientSpec, preset: (typeof PRESETS)[number]): GradientSpec {
  const colors = preset.colors;
  return normalizeGradientSpec({
    ...current,
    mode: 'basic',
    shape: preset.shape ?? 'linear',
    angle: preset.angle ?? current.angle,
    stops: colors.map((color, i) => ({ id: `preset-${preset.name.toLowerCase()}-${i}`, color, position: i / Math.max(1, colors.length - 1), opacity: 1 })),
  });
}

function StopColor({ stop, onColor }: { stop: GradientStop; onColor: (color: string) => void }) {
  const [text, setText] = useState(stop.color.slice(1));
  useEffect(() => setText(stop.color.slice(1)), [stop.color]);
  const commit = () => {
    if (/^[0-9a-f]{6}$/i.test(text)) onColor(`#${text}`);
    else setText(stop.color.slice(1));
  };
  return (
    <div className="ctl-row">
      <label className="ctl-label">Colour</label>
      <div className="ctl-input">
        <div className="color gradient-stop-color">
          <input type="color" aria-label="Stop colour" value={stop.color} onChange={(e) => onColor(e.target.value)} />
          <input
            className="field"
            aria-label="Stop hex"
            value={`#${text}`}
            maxLength={7}
            onChange={(e) => setText(e.target.value.replace(/^#/, ''))}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
        </div>
      </div>
    </div>
  );
}

export default function GradientEditor({ value, onChange, showMapping = false }: GradientEditorProps) {
  const spec = useMemo(() => normalizeGradientSpec(value), [value]);
  const stops = useMemo(() => sortedStops(spec), [spec]);
  const [selectedId, setSelectedId] = useState(stops[0]?.id ?? '');
  const barRef = useRef<HTMLDivElement>(null);
  const selected = stops.find((stop) => stop.id === selectedId) ?? stops[0];

  useEffect(() => {
    if (!stops.some((stop) => stop.id === selectedId)) setSelectedId(stops[0]?.id ?? '');
  }, [selectedId, stops]);

  const emit = (patch: Partial<GradientSpec>) => onChange(normalizeGradientSpec({ ...spec, ...patch }));
  const replaceStop = (id: string, patch: Partial<GradientStop>) => {
    emit({ stops: spec.stops.map((stop) => stop.id === id ? { ...stop, ...patch } : stop) });
  };
  const addStopAt = (position: number) => {
    if (stops.length >= MAX_GRADIENT_STOPS) return;
    const pos = clamp(position);
    const stop = { id: nextStopId(), position: pos, color: rgbHex(sampleGradientRGB(spec, pos)), opacity: 1 };
    setSelectedId(stop.id);
    emit({ stops: [...spec.stops, stop] });
  };
  const addLargestGap = () => {
    let position = 0.5, gap = -1;
    for (let i = 1; i < stops.length; i++) {
      const nextGap = stops[i].position - stops[i - 1].position;
      if (nextGap > gap) { gap = nextGap; position = (stops[i].position + stops[i - 1].position) / 2; }
    }
    addStopAt(position);
  };
  const removeSelected = () => {
    if (!selected || stops.length <= 2) return;
    const index = stops.findIndex((s) => s.id === selected.id);
    const next = stops.filter((s) => s.id !== selected.id);
    setSelectedId(next[Math.max(0, index - 1)]?.id ?? next[0].id);
    emit({ stops: next });
  };
  const barPosition = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    return rect ? clamp((clientX - rect.left) / Math.max(1, rect.width)) : 0.5;
  };

  const shapes = spec.mode === 'advanced' ? ADVANCED_SHAPES : BASIC_SHAPES;
  const needsCenter = spec.shape === 'radial' || spec.shape === 'conic' || spec.shape === 'twin-radial';
  const needsRadius = spec.shape === 'radial' || spec.shape === 'twin-radial';

  return (
    <div className="gradient-editor">
      <div className="ctl-row">
        <label className="ctl-label">Gradient mode</label>
        <div className="ctl-input">
          <div className="segmented">
            <button className={`seg ${spec.mode === 'basic' ? 'active' : ''}`} onClick={() => emit({
              mode: 'basic',
              shape: BASIC_SHAPES.some(([shape]) => shape === spec.shape) ? spec.shape : 'linear',
            })}>Basic</button>
            <button className={`seg ${spec.mode === 'advanced' ? 'active' : ''}`} onClick={() => emit({ mode: 'advanced' })}>Advanced</button>
          </div>
        </div>
      </div>

      <div className="ctl-row">
        <label className="ctl-label">Presets</label>
        <div className="gradient-presets" aria-label="Gradient presets">
          {PRESETS.map((preset) => {
            const preview = presetSpec(spec, preset);
            return <button key={preset.name} title={preset.name} aria-label={preset.name}
              style={{ background: gradientCss(preview) }} onClick={() => onChange(preview)} />;
          })}
        </div>
      </div>

      <div className="ctl-row gradient-stops-row">
        <div className="gradient-row-label">
          <label className="ctl-label">Stops</label>
          <span>{stops.length} / {MAX_GRADIENT_STOPS}</span>
        </div>
        <div
          ref={barRef}
          className="gradient-ramp"
          role="presentation"
          style={{ background: gradientCss({ ...spec, mode: 'basic', shape: spec.shape === 'radial' ? 'radial' : 'linear' }) }}
          onPointerDown={(e) => { if (e.target === e.currentTarget) addStopAt(barPosition(e.clientX)); }}
        >
          {stops.map((stop) => (
            <button
              key={stop.id}
              type="button"
              className={`gradient-stop ${selected?.id === stop.id ? 'selected' : ''}`}
              style={{ left: `${stop.position * 100}%`, background: stop.color }}
              aria-label={`Colour stop ${Math.round(stop.position * 100)}%`}
              onClick={(e) => { e.stopPropagation(); setSelectedId(stop.id); }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setSelectedId(stop.id);
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) replaceStop(stop.id, { position: barPosition(e.clientX) });
              }}
            />
          ))}
        </div>
        <div className="gradient-ramp-actions">
          <button className="btn" type="button" onClick={() => emit({ stops: spec.stops.map((stop) => ({ ...stop, position: 1 - stop.position })) })}>Reverse</button>
          <button className="btn" type="button" disabled={stops.length >= MAX_GRADIENT_STOPS} onClick={addLargestGap}>Add stop</button>
        </div>
      </div>

      {selected && (
        <div className="gradient-stop-editor ctl-section">
          <div className="gradient-stop-heading">
            <h4 className="ctl-section-title">Selected stop</h4>
            <button className="link-btn" type="button" disabled={stops.length <= 2} onClick={removeSelected}>Remove</button>
          </div>
          <StopColor stop={selected} onColor={(color) => replaceStop(selected.id, { color })} />
          <ControlRow def={stopPositionDef} value={Math.round(selected.position * 100)}
            onChange={(position) => replaceStop(selected.id, { position: clamp(Number(position) / 100) })} />
        </div>
      )}

      <div className="ctl-row">
        <label className="ctl-label">Shape</label>
        <div className="ctl-input">
          <select className="field" value={spec.shape} onChange={(e) => emit({ shape: e.target.value as GradientShape })}>
            {shapes.map(([shape, label]) => <option key={shape} value={shape}>{label}</option>)}
          </select>
        </div>
      </div>

      <ControlRow def={softnessDef} value={spec.softness}
        onChange={(softness) => emit({ softness: Number(softness) })} />

      {spec.shape === 'linear' && <ControlRow def={angleDef} value={spec.angle} onChange={(angle) => emit({ angle: Number(angle) })} />}
      {needsCenter && <>
        <ControlRow def={{ ...centerXDef, label: spec.shape === 'twin-radial' ? 'Orb X' : 'Center X' }} value={spec.center.x}
          onChange={(x) => emit({ center: { ...spec.center, x: Number(x) } })} />
        <ControlRow def={{ ...centerYDef, label: spec.shape === 'twin-radial' ? 'Orb Y' : 'Center Y' }} value={spec.center.y}
          onChange={(y) => emit({ center: { ...spec.center, y: Number(y) } })} />
      </>}
      {needsRadius && <ControlRow def={radiusDef} value={spec.radius} onChange={(radius) => emit({ radius: Number(radius) })} />}

      {spec.mode === 'advanced' && <div className="gradient-advanced ctl-section">
        <h4 className="ctl-section-title">Advanced</h4>
        <ControlRow def={warpDef} value={spec.advanced.warp}
          onChange={(warp) => emit({ advanced: { ...spec.advanced, warp: Number(warp) } })} />
        <ControlRow def={flowDef} value={spec.advanced.flow}
          onChange={(flow) => emit({ advanced: { ...spec.advanced, flow: Number(flow) } })} />
        <ControlRow def={scaleDef} value={spec.advanced.scale}
          onChange={(scale) => emit({ advanced: { ...spec.advanced, scale: Number(scale) } })} />
        <ControlRow def={detailDef} value={spec.advanced.detail}
          onChange={(detail) => emit({ advanced: { ...spec.advanced, detail: Number(detail) } })} />
        <ControlRow def={contrastDef} value={spec.advanced.contrast}
          onChange={(contrast) => emit({ advanced: { ...spec.advanced, contrast: Number(contrast) } })} />
      </div>}

      {showMapping && (
        <div className="ctl-row">
          <label className="ctl-label">3D mapping</label>
          <div className="ctl-input">
            <select className="field" value={spec.mapping3d} onChange={(e) => emit({ mapping3d: e.target.value as GradientSpec['mapping3d'] })}>
              <option value="uv">UV</option>
              <option value="object">Object</option>
              <option value="screen">Screen</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
