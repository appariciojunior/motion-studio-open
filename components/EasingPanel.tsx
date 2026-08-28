'use client';

import { useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import EasingCurveEditor from '@/components/EasingCurveEditor';
import {
  EASING_PRESETS,
  EASING_MAP,
  resolveEasing,
  sampleEasing,
  type EasingSpec,
} from '@/lib/easing';

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

  const signature = EASING_PRESETS.filter((p) => p.group === 'signature');
  const standard = EASING_PRESETS.filter((p) => p.group === 'standard');
  const physics = EASING_PRESETS.filter((p) => p.group === 'physics');

  return (
    <>
      <div className="section-head"><span className="eyebrow">Easing</span></div>
      <div className="section-body ez-body">
        {/* The curve plot and its four numbers live in EasingCurveEditor, which
            holds no store — the same widget the docs mount with local state. */}
        <EasingCurveEditor spec={easing} onChange={setEasing} />

        {/* ---- Defaults / Custom tabs ---- */}
        <div className="segmented ez-tabs">
          <button className={`seg ${tab === 'defaults' ? 'active' : ''}`} onClick={() => setTab('defaults')}>Defaults</button>
          <button className={`seg ${tab === 'custom' ? 'active' : ''}`} onClick={() => setTab('custom')}>Custom</button>
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
