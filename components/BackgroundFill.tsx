'use client';

import { useRef } from 'react';
import { use3DStore, defaultEnvironmentFor } from '@/store/use3DStore';
import { ControlRow } from './Controls';
import FillRow from './FillRow';
import type { ControlDef } from '@/lib/types';
import { fillPatchForGradient, gradientFromFill } from '@/lib/gradient';

const BG_ALPHA: ControlDef = { key: 'bg-alpha', label: 'Alpha', type: 'slider', min: 0, max: 100, step: 1, default: 100 };
const amtDef: ControlDef = { key: 'a', label: 'Texture Amount', type: 'slider', min: 0, max: 100, step: 1, default: 0 };
const scaleDef: ControlDef = { key: 's', label: 'Texture Scale', type: 'slider', min: 0.5, max: 10, step: 0.1, default: 3 };
const sunDef: ControlDef = { key: 'sun', label: 'Sunlight', type: 'slider', min: 0, max: 100, step: 1, default: 0 };
const shadowDef: ControlDef = { key: 'sh', label: 'Sun Shadow', type: 'slider', min: 0, max: 100, step: 1, default: 0 };
const mScaleDef: ControlDef = { key: 'ms', label: 'Mask Scale', type: 'slider', min: 2, max: 100, step: 1, default: 16 };
const mOffXDef: ControlDef = { key: 'mx', label: 'Mask Offset X', type: 'slider', min: -100, max: 100, step: 1, default: 0 };
const mOffYDef: ControlDef = { key: 'my', label: 'Mask Offset Y', type: 'slider', min: -100, max: 100, step: 1, default: 0 };

// Stage background — same fill pattern as model parts (solid / linear / radial),
// paint-stroke texture amount, plus the warm sun (masked by an alpha window).
// `hideTexture` drops the two paint-relief rows — Mockup mode has no painted
// wall to apply them to (its background is the stage CSS gradient).
export default function BackgroundFill({ hideTexture }: { hideTexture?: boolean } = {}) {
  // Reads/writes the ACTIVE effect's own environment (setBgFill & co. already
  // patch use3DStore.getState().effectId's slot) — so this one panel, shared
  // between the 3D and Mockup nav tabs, never bleeds one effect's background
  // into the other's.
  const env = use3DStore((s) => s.environments[s.effectId] ?? defaultEnvironmentFor(s.effectId));
  const { bgFill, bgTexAmount, bgTexScale, sunIntensity, sunShadow, sunMask, sunMaskScale, sunMaskOffsetX, sunMaskOffsetY } = env;
  const setBgFill = use3DStore((s) => s.setBgFill);
  const setBgTexAmount = use3DStore((s) => s.setBgTexAmount);
  const setBgTexScale = use3DStore((s) => s.setBgTexScale);
  const setSunIntensity = use3DStore((s) => s.setSunIntensity);
  const setSunShadow = use3DStore((s) => s.setSunShadow);
  const setSunMask = use3DStore((s) => s.setSunMask);
  const setSunMaskScale = use3DStore((s) => s.setSunMaskScale);
  const setSunMaskOffset = use3DStore((s) => s.setSunMaskOffset);
  const maskRef = useRef<HTMLInputElement>(null);

  const onMask = (f: File | undefined) => { if (f) setSunMask(URL.createObjectURL(f)); };

  return (
    <>
      <div className="section-head"><span className="eyebrow">Background</span></div>
      <div className="section-body mc-colors">
        <FillRow
          label="Fill"
          fill={bgFill}
          showEditor
          onType={(t) => {
            const type = t === 'none' ? 'solid' : t;
            if (type === 'linear' || type === 'radial') {
              const gradient = gradientFromFill(bgFill);
              setBgFill({ ...fillPatchForGradient({ ...gradient, shape: type }), type });
            } else setBgFill({ type });
          }}
          onColor={(which, hex) => setBgFill({ [which]: hex })}
          onGradient={(gradient) => setBgFill(fillPatchForGradient(gradient))}
        />
        <ControlRow def={BG_ALPHA} value={bgFill.alpha ?? 100} onChange={(v) => setBgFill({ alpha: Number(v) })} />
        {!hideTexture && <ControlRow def={amtDef} value={bgTexAmount} onChange={(v) => setBgTexAmount(v)} />}
        {!hideTexture && <ControlRow def={scaleDef} value={bgTexScale} onChange={(v) => setBgTexScale(v)} />}
        <ControlRow def={sunDef} value={sunIntensity} onChange={(v) => setSunIntensity(v)} />
        <ControlRow def={shadowDef} value={sunShadow} onChange={(v) => setSunShadow(v)} />

        {/* sun mask — warm sun only shows through this alpha shape (window) */}
        <div className="mc-field-label" style={{ marginTop: 6 }}>Sun Mask</div>
        <input ref={maskRef} type="file" accept="image/png,image/*" style={{ display: 'none' }}
          onChange={(e) => onMask(e.target.files?.[0])} />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn full" onClick={() => maskRef.current?.click()}>
            {sunMask ? 'Replace mask…' : 'Upload mask…'}
          </button>
          {sunMask && <button className="btn" title="No mask (full sun)" onClick={() => setSunMask(null)}>✕</button>}
        </div>
        {sunMask && <>
          <ControlRow def={mScaleDef} value={sunMaskScale} onChange={(v) => setSunMaskScale(v)} />
          <ControlRow def={mOffXDef} value={sunMaskOffsetX} onChange={(v) => setSunMaskOffset(v, sunMaskOffsetY)} />
          <ControlRow def={mOffYDef} value={sunMaskOffsetY} onChange={(v) => setSunMaskOffset(sunMaskOffsetX, v)} />
        </>}
      </div>
    </>
  );
}
