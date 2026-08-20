'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { use3DStore, defaultModelFor } from '@/store/use3DStore';
import { ControlRow } from './Controls';
import RotationBall from './RotationBall';
import type { ControlDef } from '@/lib/types';

const scaleDef: ControlDef = { key: 'scale', label: 'Scale', type: 'slider', min: 0.1, max: 4, step: 0.05, default: 1 };
const offXDef: ControlDef = { key: 'offsetX', label: 'Offset X', type: 'slider', min: -2, max: 2, step: 0.02, default: 0 };
const offYDef: ControlDef = { key: 'offsetY', label: 'Offset Y', type: 'slider', min: -2, max: 2, step: 0.02, default: 0 };
const offZDef: ControlDef = { key: 'offsetZ', label: 'Position Z', type: 'slider', min: -2, max: 2, step: 0.02, default: 0 };
// MODEL CONTROL — top block of the right sidebar in 3D mode. Transforms the 3D
// object (center / scale / rotate) and uploads a .glb to run the effect on.
//
// Rotation used to be three sliders plus an xypad that could only reach two of
// the three axes. RotationBall carries all three, with typable degrees, so the
// sliders and the pad would now be a third and fourth way to set the same
// numbers.

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
          <ControlRow def={offZDef} value={model.offsetZ} onChange={(v) => setModelDepth(Number(v))} />
        )}

        <div className="mc-field-label">Rotate</div>
        <RotationBall
          value={{
            x: Math.round(THREE.MathUtils.radToDeg(model.rotX)),
            y: Math.round(THREE.MathUtils.radToDeg(model.rotY)),
            z: Math.round(THREE.MathUtils.radToDeg(model.rotZ)),
          }}
          onChange={(r) => setModelRotation(
            THREE.MathUtils.degToRad(r.x),
            THREE.MathUtils.degToRad(r.y),
            THREE.MathUtils.degToRad(r.z),
          )}
        />


        {/* Mockup gets its model from the device picker in the left column, so
            this block is only ever a way to break that mode: an arbitrary .glb
            has no "Screen" mesh to composite onto (ScreenContent hides itself
            for one), and "Use default model" clears the device outright. 3D is
            the opposite — bringing your own .glb is the whole point there. */}
        {effectId !== 'mockup' && (
          <>
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
          </>
        )}
      </div>
    </>
  );
}
