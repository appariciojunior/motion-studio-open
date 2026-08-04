'use client';

import { useRef } from 'react';
import { use3DStore } from '@/store/use3DStore';
import { ControlRow } from './Controls';
import type { ControlDef } from '@/lib/types';

const STEP = Math.PI / 12; // 15° per rotate click
const scaleDef: ControlDef = { key: 'scale', label: 'Scale', type: 'slider', min: 0.1, max: 4, step: 0.05, default: 1 };
const offXDef: ControlDef = { key: 'offsetX', label: 'Offset X', type: 'slider', min: -2, max: 2, step: 0.02, default: 0 };
const offYDef: ControlDef = { key: 'offsetY', label: 'Offset Y', type: 'slider', min: -2, max: 2, step: 0.02, default: 0 };

// MODEL CONTROL — top block of the right sidebar in 3D mode. Transforms the 3D
// object (center / scale / rotate) and uploads a .glb to run the effect on.
export default function ModelControl() {
  const model = use3DStore((s) => s.model);
  const setModelScale = use3DStore((s) => s.setModelScale);
  const nudgeRot = use3DStore((s) => s.nudgeRot);
  const setModelOffset = use3DStore((s) => s.setModelOffset);
  const storeCenterModel = use3DStore((s) => s.centerModel);
  const setModelUrl = use3DStore((s) => s.setModelUrl);
  const effectId = use3DStore((s) => s.effectId);
  const fileRef = useRef<HTMLInputElement>(null);

  // Device mockups are already bbox-centred by fitAndCenter — recentring
  // should return to (0, 0), not the daisy model's hand-tuned offset.
  const centerModel = () => (effectId === 'mockup' ? storeCenterModel(0, 0) : storeCenterModel());

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    setModelUrl(url, f.name);
  };

  return (
    <>
      <div className="section-head"><span className="eyebrow">Model Control</span></div>
      <div className="section-body mc-body">
        <button className="btn full" onClick={centerModel}>Center model</button>

        <ControlRow def={scaleDef} value={model.scale} onChange={(v) => setModelScale(v)} />
        <ControlRow def={offXDef} value={model.offsetX} onChange={(v) => setModelOffset(v, model.offsetY)} />
        <ControlRow def={offYDef} value={model.offsetY} onChange={(v) => setModelOffset(model.offsetX, v)} />

        <div className="mc-field-label">Rotate</div>
        <div className="mc-rotate">
          <button className="mc-arrow up" title="Tilt up" onClick={() => nudgeRot(-STEP, 0)}>▲</button>
          <button className="mc-arrow left" title="Rotate left" onClick={() => nudgeRot(0, -STEP)}>◀</button>
          <button className="mc-arrow center" title="Reset rotation" onClick={centerModel}>■</button>
          <button className="mc-arrow right" title="Rotate right" onClick={() => nudgeRot(0, STEP)}>▶</button>
          <button className="mc-arrow down" title="Tilt down" onClick={() => nudgeRot(STEP, 0)}>▼</button>
        </div>

        <div className="mc-field-label">Model</div>
        <input
          ref={fileRef}
          type="file"
          accept=".glb,.gltf,model/gltf-binary"
          style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button className="btn full" onClick={() => fileRef.current?.click()}>
          {model.name ? `↑ ${model.name}` : 'Upload .glb…'}
        </button>
        {model.url && (
          <button className="mc-reset-model" onClick={() => setModelUrl(null, null)}>Use default model</button>
        )}
      </div>
    </>
  );
}
