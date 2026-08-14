'use client';

import { useSceneStore } from '@/store/useSceneStore';
import { useWebStore } from '@/store/useWebStore';
import { getTemplate } from '@/templates';
import { ControlRow } from './Controls';
import EasingPanel from './EasingPanel';

// Web mode (SPIKE) — the same SCENE + TIMING stack the 2D mode shows
// (see ScenePanel), with one difference the mode forces: `count` is derived.
// Templates ship it as a free slider, but here the layers are the elements the
// user marked — there is no count to choose.
//
// Layout mode lives in the right panel next to the selection it acts on
// (see WebSelectionPanel).

export default function WebScenePanel() {
  const activeTemplateId = useSceneStore((s) => s.activeTemplateId);
  const values = useSceneStore((s) => s.values);
  const setValue = useSceneStore((s) => s.setValue);
  const duration = useSceneStore((s) => s.duration);
  const setDuration = useSceneStore((s) => s.setDuration);

  const selected = useWebStore((s) => s.selected);

  const template = getTemplate(activeTemplateId);
  const count = selected.length;

  return (
    <>
      <div className="section-head">
        <span className="eyebrow">Scene</span>
        <span className="badge">{template.meta.name}</span>
      </div>
      <div className="section-body">
        {template.controls.map((def) =>
          def.key === 'count' ? (
            <div className="ctl-row" key="count">
              <label className="ctl-label">Count</label>
              <div className="ctl-input">
                <span className="web-derived">
                  {count} <em>from selection</em>
                </span>
              </div>
            </div>
          ) : (
            <ControlRow
              key={def.key}
              def={def}
              value={values[def.key]}
              onChange={(val) => setValue(def.key, val)}
            />
          ),
        )}
      </div>

      <div className="hairline" />

      <div className="section-head"><span className="eyebrow">Timing</span></div>
      <div className="section-body">
        <ControlRow
          def={{ key: '_duration', label: 'Duration', type: 'slider', min: 1, max: 60, step: 1, default: 8 }}
          value={duration}
          onChange={(v) => setDuration(Math.max(1, Number(v)))}
        />
      </div>

      <div className="hairline" />

      <EasingPanel />
    </>
  );
}
