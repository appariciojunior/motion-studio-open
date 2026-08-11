'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { use3DStore, defaultModelFor } from '@/store/use3DStore';
import { ControlRow } from './Controls';
import type { ControlDef } from '@/lib/types';

const scaleDef: ControlDef = { key: 'scale', label: 'Scale', type: 'slider', min: 0.1, max: 4, step: 0.05, default: 1 };
const offXDef: ControlDef = { key: 'offsetX', label: 'Offset X', type: 'slider', min: -2, max: 2, step: 0.02, default: 0 };
const offYDef: ControlDef = { key: 'offsetY', label: 'Offset Y', type: 'slider', min: -2, max: 2, step: 0.02, default: 0 };
const offZDef: ControlDef = { key: 'offsetZ', label: 'Position Z', type: 'slider', min: -2, max: 2, step: 0.02, default: 0 };
const rotXDef: ControlDef = { key: 'rotX', label: 'X Rotation', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' };
const rotYDef: ControlDef = { key: 'rotY', label: 'Y Rotation', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' };
const rotZDef: ControlDef = { key: 'rotZ', label: 'Z Rotation', type: 'slider', min: -180, max: 180, step: 1, default: 0, unit: '°' };

// MODEL CONTROL — top block of the right sidebar in 3D mode. Transforms the 3D
// object (center / scale / rotate) and uploads a .glb to run the effect on.
const rotPadDef: ControlDef = { key: 'rotationPad', label: 'Rotate', type: 'xypad', max: 180, default: { x: 0, y: 0 } };

export default function ModelControl() {
  const effectId = use3DStore((s) => s.effectId);
  const model = use3DStore((s) => s.models[s.effectId] ?? defaultModelFor(s.effectId));
  const setModelScale = use3DStore((s) => s.setModelScale);
  const setModelOffset = use3DStore((s) => s.setModelOffset);
  const setModelDepth = use3DStore((s) => s.setModelDepth);
  const setModelRotation = use3DStore((s) => s.setModelRotation);
  const storeCenterModel = use3DStore((s) => s.centerModel);
  const setModelUrl = use3DStore((s) => s.setModelUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  // No per-mode branch here any more: the store recentres to the ACTIVE
  // effect's own default — (0, 0) for Mockup, whose device meshes arrive
  // bbox-centred, and the daisy's tuned nudge for 3D.
  const centerModel = () => storeCenterModel();

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    setModelUrl(url, f.name);
  };

  return (
    <>
      <div className="section-head"><span className="eyebrow">Model Control</span></div>
      <div className="section-body mc-body">
        <button className="btn full" onClick={() => centerModel()}>Center model</button>

        <ControlRow def={scaleDef} value={model.scale} onChange={(v) => setModelScale(v)} />
        <ControlRow def={offXDef} value={model.offsetX} onChange={(v) => setModelOffset(v, model.offsetY)} />
        <ControlRow def={offYDef} value={model.offsetY} onChange={(v) => setModelOffset(model.offsetX, v)} />

        {effectId === 'mockup' && (
          <>
            <ControlRow def={offZDef} value={model.offsetZ} onChange={(v) => setModelDepth(Number(v))} />
            <ControlRow def={rotXDef} value={THREE.MathUtils.radToDeg(model.rotX)} onChange={(v) => setModelRotation(THREE.MathUtils.degToRad(Number(v)), model.rotY, model.rotZ)} />
            <ControlRow def={rotYDef} value={THREE.MathUtils.radToDeg(model.rotY)} onChange={(v) => setModelRotation(model.rotX, THREE.MathUtils.degToRad(Number(v)), model.rotZ)} />
            <ControlRow def={rotZDef} value={THREE.MathUtils.radToDeg(model.rotZ)} onChange={(v) => setModelRotation(model.rotX, model.rotY, THREE.MathUtils.degToRad(Number(v)))} />
          </>
        )}

        <ControlRow
          def={rotPadDef}
          value={{
            x: Math.round(THREE.MathUtils.radToDeg(model.rotY)),
            y: Math.round(THREE.MathUtils.radToDeg(model.rotX)),
          }}
          onChange={(v) => setModelRotation(
            THREE.MathUtils.degToRad(Number(v.y)),
            THREE.MathUtils.degToRad(Number(v.x)),
            model.rotZ,
          )}
        />


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
