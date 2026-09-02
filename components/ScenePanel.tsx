'use client';

import { useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { catalogTemplateList, getTemplate } from '@/templates';
import { ControlRow, controlVisible } from './Controls';
import EasingPanel from './EasingPanel';
import TrackInspector from './TrackInspector';
import type { ControlDef } from '@/lib/types';

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

  const getControlSection = (def: ControlDef): 'Layout' | 'Motion' | 'Depth' | 'Finish' => {
    if (def.section) return def.section;
    const k = def.key.toLowerCase();
    if (k.includes('speed') || k.includes('motion') || k.includes('spin') || k.includes('flow') || k.includes('dir') || k.includes('hold') || k.includes('sec') || k.includes('wobble') || k.includes('drift')) return 'Motion';
    if (k.includes('tilt') || k.includes('zoom') || k.includes('persp') || k.includes('depth') || k.includes('cam') || k.includes('dist') || k.includes('curve') || k.includes('align')) return 'Depth';
    if (k.includes('radius') || k.includes('fade') || k.includes('light') || k.includes('shadow') || k.includes('blur') || k.includes('grain')) return 'Finish';
    return 'Layout';
  };

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
        {sections.map((section) => {
          const controls = primaryControls.filter((def) => getControlSection(def) === section);
          if (!controls.length) return null;
          return (
            <div className="ctl-section" key={section}>
              <div className="ctl-section-title">{section}</div>
              {controls.map((def) => (
                <ControlRow key={def.key} def={def} value={values[def.key]} onChange={(val) => setValue(def.key, val)} />
              ))}
            </div>
          );
        })}
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
