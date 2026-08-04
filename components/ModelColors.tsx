'use client';

import { use3DStore } from '@/store/use3DStore';
import { findDevice } from '@/three3d/devices';
import FillRow from './FillRow';

// Friendly display names for the bundled daisy groups (keys stay unchanged).
const PART_LABELS: Record<string, string> = { Cube: 'Center', Cylinder: 'Stem', Plane: 'Petals' };

// Per-part model colouring. Groups are detected generically by the effect and
// reported to the store. Each group uses the shared FillRow (solid / linear /
// radial), same pattern as the background. Click a part in the viewport to
// select/highlight its group here.
export default function ModelColors() {
  const modelUrl = use3DStore((s) => s.model.url);
  const parts = use3DStore((s) => s.parts);
  const partFills = use3DStore((s) => s.partFills);
  const selected = use3DStore((s) => s.selectedPart);
  const setPartFill = use3DStore((s) => s.setPartFill);
  const clearPartFill = use3DStore((s) => s.clearPartFill);
  const selectPart = use3DStore((s) => s.selectPart);

  // Bundled devices use the Finish swatches (left panel) instead — their part
  // keys are raw, obfuscated glTF material names, meaningless as a colour list.
  if (findDevice(modelUrl)) return null;

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
                selected={selected === key}
                onEnter={() => selectPart(key)}
                onLeave={() => selected === key && selectPart(null)}
                onType={(t) => (t === 'none' ? clearPartFill(key) : setPartFill(key, { type: t }))}
                onColor={(which, hex) => setPartFill(key, { [which]: hex })}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}
