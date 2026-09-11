'use client';

import { useMemo, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { catalogTemplateList, getTemplate } from '@/templates';
import { ControlRow, controlVisible } from './Controls';
import EasingPanel from './EasingPanel';
import TrackInspector from './TrackInspector';
import { SCENE_CAMERA_MOVE_CONTROLS, readSceneCameraMove, sceneCameraControlsFor, sceneCameraTravels } from '@/lib/sceneCamera';
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
  const sceneCamera = useSceneStore((s) => s.sceneCamera);
  const setSceneCameraValue = useSceneStore((s) => s.setSceneCameraValue);
  const resetSceneCamera = useSceneStore((s) => s.resetSceneCamera);
  // Every VISIBLE layer decides, whatever engine draws it: both renderers apply
  // the shot now, so both have to be asked whether they already offer the move.
  const visibleTemplateIds = useSceneStore((s) => s.tracks
    .filter((t) => t.visible)
    .map((t) => t.templateId)
    .join(','));
  // Only the moves no visible layer already offers: a second knob for the same
  // move makes the panel fiddlier, not more capable. See lib/sceneCamera.
  // Hold means nothing until the camera actually travels, so it appears with
  // the travel rather than sitting there doing nothing.
  const travels = sceneCameraTravels(readSceneCameraMove(sceneCamera));
  const moveControls = travels
    ? SCENE_CAMERA_MOVE_CONTROLS
    : SCENE_CAMERA_MOVE_CONTROLS.filter((def) => def.key !== '_camHold');
  const cameraControls = useMemo(
    () => (visibleTemplateIds
      ? sceneCameraControlsFor(visibleTemplateIds.split(',').map((id) => getTemplate(id)))
      : []),
    [visibleTemplateIds],
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

      {/* The shot: where the camera stands. Scene-level, so it sits OUTSIDE the
          per-layer block above — two layers composited from two camera
          positions are not one picture.

          What shows up under Shot is only what is NOT already on the panel: 67
          of the 82 webgl presets declare their own zoom, 61 their own offset,
          31 their own yaw, and a 2D scene is offered no orbit because there is
          no perspective to swing. A second knob for the same move is what makes
          a panel feel fiddly instead of capable, so that half can come out
          empty and only Move is left — which is the case for a preset that
          already frames itself. Nothing in the catalogue moves the frame over
          time, so Move is never a duplicate of anything. */}
      {(cameraControls.length > 0 || moveControls.length > 0) && (
        <>
          <div className="section-head">
            <span className="eyebrow">Camera</span>
            <button type="button" className="badge" onClick={resetSceneCamera}>Reset</button>
          </div>
          {cameraControls.length > 0 && (
          <div className="section-body">
            <div className="ctl-section-title">Shot</div>
            <div className="ctl-hint">Moves the camera, not the cards — the same motion seen from somewhere else.</div>
            {cameraControls.map((def) => (
              <ControlRow
                key={def.key}
                def={def}
                value={sceneCamera[def.key] ?? def.default}
                onChange={(val) => setSceneCameraValue(def.key, Number(val))}
              />
            ))}
          </div>
          )}
          {/* Where it GOES. Separate block because it is a different question
              from where it stands, and because it is the half that makes this a
              camera rather than a crop. */}
          <div className="section-body">
            <div className="ctl-section-title">Move</div>
            <div className="ctl-hint">Drag the pad and the frame travels there over the clip.</div>
            {moveControls.map((def) => (
              <ControlRow
                key={def.key}
                def={def}
                value={sceneCamera[def.key] ?? def.default}
                onChange={(val) => setSceneCameraValue(def.key, val)}
              />
            ))}
          </div>
          <div className="hairline" />
        </>
      )}

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
