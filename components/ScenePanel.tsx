'use client';

import { useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { catalogTemplateList, getTemplate } from '@/templates';
import { ControlRow, controlVisible } from './Controls';
import EasingPanel from './EasingPanel';
import TrackInspector from './TrackInspector';

// Renders the SCENE + TIMING sections (no card wrapper — the page composes cards).
export default function ScenePanel() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeTemplateId = useSceneStore((s) => s.activeTemplateId);
  const values = useSceneStore((s) => s.values);
  const setValue = useSceneStore((s) => s.setValue);
  const setActiveTemplate = useSceneStore((s) => s.setActiveTemplate);
  const duration = useSceneStore((s) => s.duration);
  const setDuration = useSceneStore((s) => s.setDuration);
  const trackCount = useSceneStore((s) => s.tracks.length);
  const activeTrackName = useSceneStore(
    (s) => s.tracks.find((t) => t.id === s.activeTrackId)?.name ?? '',
  );

  const template = getTemplate(activeTemplateId);
  const visibleControls = template.controls.filter((def) => controlVisible(def, values));
  const primaryControls = visibleControls.filter((def) => !def.advanced);
  const advancedControls = visibleControls.filter((def) => def.advanced);
  const sections = ['Layout', 'Motion', 'Depth', 'Finish'] as const;
  const hasSections = primaryControls.some((def) => def.section);

  return (
    <>
      <div className="section-head">
        <span className="eyebrow">Scene</span>
        <select
          className="badge"
          value={activeTemplateId}
          onChange={(e) => setActiveTemplate(e.target.value)}
          style={{ paddingRight: 22 }}
        >
          {template.meta.catalogHidden && (
            <option value={template.meta.id}>{template.meta.name} (hidden)</option>
          )}
          {catalogTemplateList.map((t) => <option key={t.meta.id} value={t.meta.id}>{t.meta.name}</option>)}
        </select>
      </div>
      <div className="section-body">
        {/* With more than one layer, make it explicit that these controls edit
            the SELECTED layer's motion, not the whole scene's. */}
        {trackCount > 1 && (
          <div className="ctl-hint">Editing the motion of <b>{activeTrackName}</b>.</div>
        )}
        {hasSections ? sections.map((section) => {
          const controls = primaryControls.filter((def) => (def.section ?? 'Layout') === section);
          if (!controls.length) return null;
          return <div className="ctl-section" key={section}>
            <div className="ctl-section-title">{section}</div>
            {controls.map((def) => <ControlRow key={def.key} def={def} value={values[def.key]} onChange={(val) => setValue(def.key, val)} />)}
          </div>;
        }) : primaryControls.map((def) => (
          <ControlRow key={def.key} def={def} value={values[def.key]} onChange={(val) => setValue(def.key, val)} />
        ))}
        {advancedControls.length > 0 && (
          <div className="ctl-advanced">
            <button
              type="button"
              className="ctl-advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              Advanced settings <span>{advancedOpen ? '−' : '+'}</span>
            </button>
            {advancedOpen && advancedControls.map((def) => (
              <ControlRow key={def.key} def={def} value={values[def.key]} onChange={(val) => setValue(def.key, val)} />
            ))}
          </div>
        )}
      </div>

      <div className="hairline" />

      {/* layer compositing: opacity, blend, retiming, asset split. Only
          meaningful once a second layer exists. */}
      {trackCount > 1 && (
        <>
          <TrackInspector />
          <div className="hairline" />
        </>
      )}

      <div className="section-head"><span className="eyebrow">Timing</span></div>
      <div className="section-body">
        <ControlRow
          def={{ key: '_duration', label: 'Duration', type: 'slider', min: 1, max: 30, step: 1, default: 8 }}
          value={duration}
          onChange={(v) => setDuration(Math.max(1, Number(v)))}
        />
      </div>

      <div className="hairline" />

      <EasingPanel />
    </>
  );
}
