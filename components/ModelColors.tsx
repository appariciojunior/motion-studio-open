'use client';

import { use3DStore, defaultModelFor } from '@/store/use3DStore';
import { findDevice } from '@/three3d/devices';
import FillRow from './FillRow';
import { fillPatchForGradient, gradientFromFill } from '@/lib/gradient';

// Friendly display names for the bundled daisy groups (keys stay unchanged).
const PART_LABELS: Record<string, string> = { Cube: 'Center', Cylinder: 'Stem', Plane: 'Petals' };

// Per-part model colouring. Groups are detected generically by the effect and
// reported to the store. Each group uses the shared FillRow (solid / linear /
// radial), same pattern as the background. Click a part in the viewport to
// select/highlight its group here.
//
// For bundled devices, shows Finish colour swatches instead of per-part fills.
export default function ModelColors() {
  const modelUrl = use3DStore((s) => (s.models[s.effectId] ?? defaultModelFor(s.effectId)).url);
  const parts = use3DStore((s) => s.parts);
  const partFills = use3DStore((s) => s.partFills);
  const selected = use3DStore((s) => s.selectedPart);
  const setPartFill = use3DStore((s) => s.setPartFill);
  const clearPartFill = use3DStore((s) => s.clearPartFill);
  const selectPart = use3DStore((s) => s.selectPart);
  const setParam = use3DStore((s) => s.setParam);
  const params = use3DStore((s) => s.params.mockup) ?? {};

  const device = findDevice(modelUrl);

  if (device) {
    // The mesh ships painted in its first listed finish, so that one is also
    // the "leave the original materials alone" choice.
    const active = (params.finish as string | undefined) ?? device.finishes[0].hex;
    return (
      <>
        <div className="section-head">
          <span className="eyebrow">Finish</span>
          <span className="badge">{device.finishes.find((f) => f.hex === active)?.label ?? 'Custom'}</span>
        </div>
        <div className="section-body mc-colors">
          <div className="finish-swatches">
            {device.finishes.map((f) => (
              <button
                key={f.key}
                type="button"
                title={f.label}
                aria-label={f.label}
                aria-pressed={active === f.hex}
                className={`finish-swatch ${active === f.hex ? 'active' : ''}`}
                style={{ background: f.hex }}
                // Repaints the enclosure only (see markEnclosureMaterials in
                // three3d/mockup.ts). It must NOT switch `useModelColor` off:
                // that flag flattens every part — glass, bezel, camera rings —
                // to one colour, which is what made the handset look like a
                // solid block instead of a finished device.
                onClick={() => setParam('mockup', 'finish', f.hex)}
              />
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="section-head">
        <span className="eyebrow">Model Colors</span>
        {selected && <button className="mc-reset-model" onClick={() => selectPart(null)}>clear selection</button>}
      </div>
      <div className="section-body mc-colors">
        {parts.length === 0 ? (
          <div className="mc-colors-hint">No model loaded yet.</div>
        ) : (
          <>
            <div className="mc-colors-hint">Click a part in the view to find its group.</div>
            {parts.map((key) => (
              <FillRow
                key={key}
                label={PART_LABELS[key] ?? key}
                fill={partFills[key]}
                allowNone
                showEditor
                collapsibleEditor
                selected={selected === key}
                onEnter={() => selectPart(key)}
                onLeave={() => selected === key && selectPart(null)}
                onType={(t) => {
                  if (t === 'none') { clearPartFill(key); return; }
                  if (t === 'linear' || t === 'radial') {
                    const current = partFills[key] ?? { type: t, c1: '#cccccc', c2: '#ffffff' };
                    const gradient = gradientFromFill(current);
                    setPartFill(key, { ...fillPatchForGradient({ ...gradient, shape: t }), type: t });
                  } else setPartFill(key, { type: t });
                }}
                onColor={(which, hex) => setPartFill(key, { [which]: hex })}
                onGradient={(gradient) => setPartFill(key, fillPatchForGradient(gradient))}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}
