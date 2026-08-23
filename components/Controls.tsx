'use client';

import { useEffect, useRef, useState } from 'react';
import type { ControlDef } from '@/lib/types';
import MobileSheet from './MobileSheet';
import { useMobileInteractions } from './MobileInteractions';

// grows with what is typed, so nothing clips and nothing floats in empty box
const fieldWidth = (text: string) => `calc(${Math.min(8, Math.max(3, text.length))}ch + 14px)`;

interface RowProps {
  def: ControlDef;
  value: any;
  onChange: (val: any) => void;
}

export function ControlRow({ def, value, onChange }: RowProps) {
  return (
    <div className="ctl-row" title={def.description}>
      <label className="ctl-label">{def.label}</label>
      <div className="ctl-input">{renderControl(def, value, onChange)}</div>
    </div>
  );
}

function renderControl(def: ControlDef, value: any, onChange: (v: any) => void) {
  switch (def.type) {
    case 'slider': return <SliderControl def={def} value={value} onChange={onChange} />;
    case 'toggle': return <ToggleControl def={def} value={value} onChange={onChange} />;
    case 'pills': return <PillsControl def={def} value={value} onChange={onChange} />;
    case 'select': return <SelectControl def={def} value={value} onChange={onChange} />;
    case 'color': return <ColorControl value={value} onChange={onChange} />;
    case 'xypad': return <XYPadControl def={def} value={value} onChange={onChange} />;
    case 'upload': return <UploadControl value={value} onChange={onChange} />;
    case 'text': return <TextControl value={value} onChange={onChange} />;
    default: return null;
  }
}

// Figma spec: the whole 34px track is the slider. Fill #2d2d2d over #232323,
// a 2×16px #424242 bar as handle, value inside the track right-aligned
// (12px #aaa), click the value to type an exact number.
function SliderControl({ def, value, onChange }: RowProps) {
  const mobile = useMobileInteractions();
  const min = def.min ?? 0, max = def.max ?? 100, step = def.step ?? 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [dragging, setDragging] = useState(false);
  const num = Number(value);
  const pct = Math.max(0, Math.min(100, ((num - min) / (max - min)) * 100));
  // Where the fill starts. A range that spans zero anchors there; everything
  // else keeps filling from the left edge.
  const signed = min < 0 && max > 0;
  const zeroPct = signed ? (-min / (max - min)) * 100 : 0;
  const fillLeft = signed ? Math.min(pct, zeroPct) : 0;
  const fillWidth = signed ? Math.abs(pct - zeroPct) : pct;
  const decimals = def.precision ?? (step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0);

  const setFromX = (clientX: number, fine = false) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const effectiveStep = fine ? step * 0.1 : step;
    const snapped = Math.round((min + t * (max - min)) / effectiveStep) * effectiveStep;
    onChange(Number(Math.max(min, Math.min(max, snapped)).toFixed(4)));
  };

  const clampValue = (next: number) => Number(Math.max(min, Math.min(max, next)).toFixed(4));
  // Typed values land on the same grid dragging uses, otherwise a step-1 row
  // could store 18.5 while showing "19" — the readout would be lying.
  // Shift means a finer grid here too, same as shift-dragging the track.
  const snapValue = (next: number, grid = step) => clampValue(Math.round(next / grid) * grid);
  // Escape has to leave without writing, so the unmount-triggered blur needs
  // to be told to keep quiet.
  const abortEdit = useRef(false);
  const primed = useRef(false);
  const settled = useRef(false);
  // A move only counts as a drag if THIS track was the one pressed. Checking
  // e.buttons alone let any held pointer sweeping past a row rewrite it — drag
  // one slider, cross its neighbour, and the neighbour moved too.
  const pressed = useRef(false);
  // Where a press on the readout started, to tell a click apart from a drag.
  const valPress = useRef<{ x: number; y: number } | null>(null);
  const startEdit = () => {
    abortEdit.current = false;
    primed.current = false;
    settled.current = false;
    setDraft(String(Number(num.toFixed(decimals))));
    setEditing(true);
  };
  // A half-typed value ("-", "1.", "") is not a number yet: parse, and only
  // write when the result is finite. A comma reads as a decimal separator so a
  // pt-BR keyboard commits the value it shows.
  const commitDraft = (rawDraft: string) => {
    const next = Number(String(rawDraft).trim().replace(',', '.'));
    if (Number.isFinite(next)) onChange(snapValue(next));
  };
  const openExact = () => {
    setDraft(String(num));
    setSheetOpen(true);
  };
  const applyExact = () => {
    const next = Number(String(draft).trim().replace(',', '.'));
    if (Number.isFinite(next)) onChange(snapValue(next));
    setSheetOpen(false);
  };

  return (
    <div
      ref={trackRef}
      className={`strack ${mobile ? 'strack-mobile' : ''} ${dragging ? 'is-dragging' : ''}`}
      tabIndex={0}
      onPointerDown={(e) => {
        if (editing) return;
        try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* no live pointer: nothing to capture */ }
        pressed.current = true;
        setDragging(true);
        setFromX(e.clientX, e.shiftKey);
      }}
      onPointerMove={(e) => { if (!editing && pressed.current && e.buttons === 1) setFromX(e.clientX, e.shiftKey); }}
      onPointerUp={() => { pressed.current = false; setDragging(false); }}
      onPointerCancel={() => { pressed.current = false; setDragging(false); }}
      onLostPointerCapture={() => { pressed.current = false; setDragging(false); }}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === 'Enter') { e.preventDefault(); startEdit(); return; }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
        e.preventDefault();
        const sign = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1;
        const delta = step * (e.shiftKey ? 0.1 : 1) * sign;
        onChange(Number(Math.max(min, Math.min(max, num + delta)).toFixed(4)));
      }}
      onDoubleClick={(e) => {
        // double-click resets to the control's declared default
        if (editing) return;
        if ((e.target as HTMLElement).closest('.sval, .sval-input')) return;
        const d = Number(def.default);
        if (Number.isFinite(d)) onChange(d);
      }}
      title="Double-click to reset"
    >
      {/* A control that spans zero fills FROM zero, not from the left edge:
          right of centre reads positive, left reads negative, and zero reads
          empty. Filling from the edge made a signed slider look like a
          magnitude bar — Card Bend at 0 showed a half-full track, which reads
          as "half on" rather than "neutral". */}
      <div className="sfill" style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }} />
      {signed && <div className="szero" style={{ left: `${zeroPct}%` }} />}
      <div className="shandle" style={{ left: `${pct}%` }} />
      {mobile && dragging && <output className="slider-bubble" style={{ left: `${pct}%` }}>{num.toFixed(decimals)}{def.unit ?? ''}</output>}
      {editing ? (
        <input
          className="sval-input"
          // text + inputMode, not type="number": a number input refuses to
          // report a selection, so select-on-focus is impossible and every
          // keystroke lands NEXT TO the old value (340 then "5" gave 3405).
          type="text"
          inputMode="decimal"
          style={{ width: fieldWidth(draft) }}
          value={draft}
          // autoFocus + onFocus was not enough: the caret landed at the end of
          // the old value, so typing still appended. Focus and select from the
          // mount ref instead, once per edit, so the first keystroke replaces.
          ref={(el) => {
            if (!el || primed.current) return;
            primed.current = true;
            el.focus();
            el.select();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onFocus={(e) => e.currentTarget.select()}
          onMouseUp={(e) => { if (settled.current) return; settled.current = true; e.preventDefault(); }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (!abortEdit.current) commitDraft(draft); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commitDraft(draft); setEditing(false); return; }
            if (e.key === 'Escape') { abortEdit.current = true; setEditing(false); return; }
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            // nudge from what is typed, not from what is stored
            e.preventDefault();
            const typed = Number(draft.trim().replace(',', '.'));
            const base = Number.isFinite(typed) ? typed : num;
            const grid = step * (e.shiftKey ? 0.1 : 1);
            const next = snapValue(base + grid * (e.key === 'ArrowUp' ? 1 : -1), grid);
            setDraft(String(next));
            onChange(next);
          }}
        />
      ) : (
        <span
          className="sval"
          title={mobile ? 'Tap to enter an exact value' : 'Click to type an exact value'}
          // pointerdown only shields the track from starting a drag — pressing
          // the number must never move the value. The edit opens on release,
          // and only if the pointer stayed put: a drag that happens to start
          // over the readout is ignored rather than turned into a text field.
          onPointerDown={(e) => { e.stopPropagation(); valPress.current = { x: e.clientX, y: e.clientY }; }}
          onClick={(e) => {
            e.stopPropagation();
            const from = valPress.current;
            valPress.current = null;
            if (from && Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) > 4) return;
            mobile ? openExact() : startEdit();
          }}
        >
          {num.toFixed(decimals)}{def.unit ?? ''}
        </span>
      )}
      {mobile && sheetOpen && (
        <MobileSheet title={def.label} onClose={() => setSheetOpen(false)}>
          <div className="mobile-number-editor">
            <button onClick={() => setDraft(String(clampValue((Number(draft) || 0) - step)))} aria-label={`Decrease ${def.label}`}>−</button>
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              autoFocus
            />
            <button onClick={() => setDraft(String(clampValue((Number(draft) || 0) + step)))} aria-label={`Increase ${def.label}`}>+</button>
          </div>
          <div className="mobile-sheet-actions">
            <button className="btn" onClick={() => setDraft(String(def.default))}>Reset</button>
            <button className="btn" onClick={() => setSheetOpen(false)}>Cancel</button>
            <button className="btn solid" onClick={applyExact}>Apply</button>
          </div>
        </MobileSheet>
      )}
    </div>
  );
}

export function controlVisible(def: ControlDef, values: Record<string, any>): boolean {
  const rule = def.visibleWhen;
  if (!rule) return true;
  const current = values[rule.key];
  if (rule.equals !== undefined && current !== rule.equals) return false;
  if (rule.not !== undefined && current === rule.not) return false;
  return true;
}

function ToggleControl({ def, value, onChange }: RowProps) {
  const options = def.options ?? ['on', 'off'];
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button key={opt} className={`seg ${value === opt ? 'active' : ''}`} onClick={() => onChange(opt)}>{opt}</button>
      ))}
    </div>
  );
}

function PillsControl({ def, value, onChange }: RowProps) {
  const options = def.options ?? [];
  return (
    <div className={`pills ${options.length <= 4 ? 'pills-fit' : ''}`}>
      {options.map((opt) => (
        <button key={opt} className={`pill ${value === opt ? 'active' : ''}`} onClick={() => onChange(opt)}>{opt}</button>
      ))}
    </div>
  );
}

function SelectControl({ def, value, onChange }: RowProps) {
  return (
    <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      {(def.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
    </select>
  );
}

function ColorControl({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  return (
    <div className="color">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <input className="field" type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// A small always-editable number field: typing replaces (the whole value is
// selected on focus), Enter or leaving commits clamped and snapped, Escape puts
// the stored value back. Same rules as the slider readout, minus the track.
function ExactNumber({ label, value, min, max, step, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // while the field is not being typed in, it mirrors the store
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  // Selecting once per visit, from whichever of focus/click arrives first, so
  // the first keystroke replaces the value instead of extending it.
  const selectAll = () => {
    if (settled.current) return;
    settled.current = true;
    inputRef.current?.select();
  };
  const commit = (raw: string) => {
    const n = Number(String(raw).trim().replace(',', '.'));
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    const snapped = Math.round(n / step) * step;
    onCommit(Number(Math.max(min, Math.min(max, snapped)).toFixed(4)));
  };
  return (
    <input
      ref={inputRef}
      className="exact-num"
      type="text"
      inputMode="decimal"
      style={{ width: fieldWidth(draft) }}
      aria-label={label}
      value={draft}
      onFocus={() => { setFocused(true); selectAll(); }}
      // a real mouse release would drop the caret mid-value, so the release
      // that opened the field is swallowed; a second click places it normally
      onMouseUp={(e) => { if (!settled.current) e.preventDefault(); }}
      onClick={selectAll}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setFocused(false); settled.current = false; commit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(draft); e.currentTarget.blur(); return; }
        if (e.key === 'Escape') { setDraft(String(value)); e.currentTarget.blur(); return; }
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const typed = Number(draft.trim().replace(',', '.'));
        const base = Number.isFinite(typed) ? typed : value;
        const grid = step * (e.shiftKey ? 0.1 : 1);
        const next = Number(Math.max(min, Math.min(max, Math.round((base + grid * (e.key === 'ArrowUp' ? 1 : -1)) / grid) * grid)).toFixed(4));
        setDraft(String(next));
        onCommit(next);
      }}
    />
  );
}

const PAD_GRID = [12.5, 25, 37.5, 62.5, 75, 87.5];

function XYPadControl({ def, value, onChange }: RowProps) {
  const mobile = useMobileInteractions();
  const ref = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  // Where the drag began, in client space: shift locks to one axis and needs a
  // line to lock ONTO. Anchoring on the press — not on the last move — is what
  // keeps a shift-drag straight instead of letting it creep a pixel per frame.
  const anchor = useRef<{ x: number; y: number } | null>(null);
  // Which axis a shift-drag committed to, and whether shift was held last move.
  const axis = useRef<'x' | 'y' | null>(null);
  const wasLocked = useRef(false);
  // Where the drag began, kept apart from the shift anchor: taking shift after
  // travelling already tells us the direction, so the lock can bite at once.
  const press = useRef<{ x: number; y: number } | null>(null);
  const range = def.max ?? 400;
  const v = value ?? { x: 0, y: 0 };
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  const setFromEvent = (clientX: number, clientY: number, lock = false) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let px = clientX, py = clientY;
    // The anchor is where shift was taken: that is the line to hold, and the
    // press point is what tells us which way the drag was already going.
    if (lock && !wasLocked.current) {
      anchor.current = { x: clientX, y: clientY };
      // Already moving when shift arrives? Then the direction is known and the
      // axis commits on this very frame — no free frame slipping through.
      const p = press.current;
      const pdx = p ? Math.abs(clientX - p.x) : 0, pdy = p ? Math.abs(clientY - p.y) : 0;
      axis.current = Math.max(pdx, pdy) > 6 ? (pdx >= pdy ? 'x' : 'y') : null;
    }
    if (!lock) axis.current = null;
    wasLocked.current = lock;
    const from = anchor.current;
    if (lock && from) {
      const dx = Math.abs(clientX - from.x), dy = Math.abs(clientY - from.y);
      // Commit to an axis once the drag clears 6px, then STAY on it. Re-deciding
      // every move made a near-diagonal drag flip axis frame to frame.
      if (!axis.current && Math.max(dx, dy) > 6) axis.current = dx >= dy ? 'x' : 'y';
      // Shift holds the line the drag is ALREADY on: the other component keeps
      // the value it had when shift was taken. Snapping it to the pad's centre
      // instead was wrong — it yanked the dot onto the zero line, which is a
      // different gesture from constraining the one in progress.
      if (axis.current === 'x') py = from.y;
      else if (axis.current === 'y') px = from.x;
      // before the axis is chosen the drag stays free, so taking shift never
      // jumps the dot
    }
    // A captured pointer reports moves well outside the pad; without this the
    // value ran past ±range and the dot left the square entirely.
    const nx = clamp01((px - rect.left) / rect.width);
    const ny = clamp01((py - rect.top) / rect.height);
    onChange({ x: Math.round((nx * 2 - 1) * range), y: Math.round((ny * 2 - 1) * range) });
  };

  const pct = (n: number) => Math.max(0, Math.min(100, ((n / range + 1) / 2) * 100));
  const dotX = pct(v.x);
  const dotY = pct(v.y);

  return (
    <div className="xypad-wrap">
      <div
        ref={ref}
        className="xypad"
        title="Drag to place; hold Shift to travel in a straight line"
        onPointerDown={(e) => {
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no live pointer: nothing to capture */ }
          pressed.current = true;
          anchor.current = { x: e.clientX, y: e.clientY };
          press.current = { x: e.clientX, y: e.clientY };
          axis.current = null;
          setFromEvent(e.clientX, e.clientY, e.shiftKey);
        }}
        // shift is read per move, so it can be taken and released mid-drag
        onPointerMove={(e) => { if (pressed.current && e.buttons === 1) setFromEvent(e.clientX, e.clientY, e.shiftKey); }}
        onPointerUp={() => { pressed.current = false; anchor.current = null; press.current = null; axis.current = null; wasLocked.current = false; }}
        onPointerCancel={() => { pressed.current = false; anchor.current = null; press.current = null; axis.current = null; wasLocked.current = false; }}
        onLostPointerCapture={() => { pressed.current = false; anchor.current = null; press.current = null; axis.current = null; wasLocked.current = false; }}
      >
        <svg className="xypad-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {PAD_GRID.map((p) => <line key={`v${p}`} className="xypad-line" x1={p} y1={0} x2={p} y2={100} />)}
          {PAD_GRID.map((p) => <line key={`h${p}`} className="xypad-line" x1={0} y1={p} x2={100} y2={p} />)}
          <line className="xypad-mid" x1={50} y1={0} x2={50} y2={100} />
          <line className="xypad-mid" x1={0} y1={50} x2={100} y2={50} />
        </svg>
        <span className="xypad-tag xypad-tag-x">X</span>
        <span className="xypad-tag xypad-tag-y">Y</span>
        <div className="xypad-field">
          <div className="xypad-dot" style={{ left: `${dotX}%`, top: `${dotY}%` }} />
        </div>
      </div>
      <div className="xypad-vals">
        <span className="xypad-axis">X</span>
        <ExactNumber
          label={`${def.label} X`}
          value={v.x}
          min={-range}
          max={range}
          step={1}
          onCommit={(n) => onChange({ x: n, y: v.y })}
        />
        <span className="xypad-axis">Y</span>
        <ExactNumber
          label={`${def.label} Y`}
          value={v.y}
          min={-range}
          max={range}
          step={1}
          onCommit={(n) => onChange({ x: v.x, y: n })}
        />
      </div>
      {mobile && <button className="xypad-reset" onClick={() => onChange({ x: 0, y: 0 })}>Reset to center</button>}
    </div>
  );
}

function UploadControl({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  return (
    <label className="upload">
      <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(URL.createObjectURL(f)); }} />
      <span>{value ? 'Replace file…' : 'Choose file…'}</span>
    </label>
  );
}

function TextControl({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  return <input className="field" type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}
