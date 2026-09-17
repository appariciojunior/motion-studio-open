'use client';

import { useMemo, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { catalogTemplateList, getTemplate } from '@/templates';
import { ControlRow, controlVisible } from './Controls';
import EasingPanel from './EasingPanel';
import TrackInspector from './TrackInspector';
import {
  MAX_CAMERA_STOPS, SCENE_CAMERA_STOP_ZOOM,
  SCENE_CAMERA_ON, cameraStopKeys, readSceneCameraPath, sceneCameraControlsFor,
  sceneHasCamera,
} from '@/lib/sceneCamera';
import {
  CAMERA_MOVES, CAMERA_MOVE_AMOUNT, CAMERA_MOVE_DIR, CAMERA_MOVE_KEY,
  CUSTOM_MOVE, cameraMoveById, cameraMovePatch,
} from '@/lib/cameraMoves';
import CameraPathPad from './CameraPathPad';
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
  const sceneW = useSceneStore((s) => s.width);
  const sceneH = useSceneStore((s) => s.height);
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
  const patchSceneCamera = useSceneStore((s) => s.patchSceneCamera);
  // The path: the Shot is stop 1, and each of these is another one.
  const path = readSceneCameraPath(sceneCamera);
  // Does this scene HAVE a camera? A template that has never been given one
  // shows no camera controls at all — the section collapses to the one row
  // that offers to add it. Standard presets are finished work: growing a block
  // of camera controls under every one of them changes how they read, and the
  // camera is something you reach for when you are building a compose, not
  // something every scene is carrying.
  const hasCamera = sceneHasCamera(sceneCamera);
  // Adding one starts it where the shot already is, so the picture does not
  // jump the moment you ask for a camera. The first stop is what makes it move,
  // and that is a click on the pad.
  const addCamera = () => patchSceneCamera({ [SCENE_CAMERA_ON]: 1 });
  // Which stop the pad is editing. -1 is the Shot, which the pad draws as the
  // frame it starts from and does not let you drag: it is set by Shot above.
  const [selectedStop, setSelectedStop] = useState(-1);
  // Hand-editing the path is folded away. Choosing a move by name is the
  // front door; placing stops yourself is the thing the named moves cannot do,
  // and it was the only door before this.
  const [pathOpen, setPathOpen] = useState(false);

  // ---- the move, chosen by name ----
  const moveId = typeof sceneCamera[CAMERA_MOVE_KEY] === 'string'
    ? (sceneCamera[CAMERA_MOVE_KEY] as string) : CUSTOM_MOVE;
  const move = cameraMoveById(moveId);
  const moveAmount = Number(sceneCamera[CAMERA_MOVE_AMOUNT] ?? 60);
  const moveDir = String(sceneCamera[CAMERA_MOVE_DIR] ?? 'centre');
  // Re-generating on every knob turn is the point: a move is a recipe, so the
  // stops are always whatever the recipe currently says.
  const applyMove = (id: string, amount = moveAmount, dir = moveDir) =>
    patchSceneCamera({ ...cameraMovePatch(id, amount, dir), [CAMERA_MOVE_AMOUNT]: amount, [CAMERA_MOVE_DIR]: dir });
  // Touching the path by hand makes it yours: the chosen move stops being a
  // true description of the stops, so it stops claiming to be one.
  const markCustom = () => {
    if (moveId !== CUSTOM_MOVE) patchSceneCamera({ [CAMERA_MOVE_KEY]: CUSTOM_MOVE });
  };
  const stopAt = path.stops[selectedStop];
  // A stop added by clicking the pad lands where you pointed, at the zoom the
  // camera already has — so the new leg is a move, not a move plus a surprise.
  const addStop = (x: number, y: number) => {
    markCustom();
    const keys = cameraStopKeys(path.stops.length);
    patchSceneCamera({
      [keys.pad]: { x, y },
      [keys.zoom]: Number(sceneCamera._camZoom) || 100,
    });
    setSelectedStop(path.stops.length);
  };
  // Where the BUTTON puts a new stop, as opposed to a click on the pad, which
  // puts it where you pointed. A third of a frame on from wherever the path
  // currently ends: dropping it at the centre would bury it under Start and
  // look like the button did nothing.
  const addStopFromButton = () => {
    const ultimo = path.stops[path.stops.length - 1]
      ?? { x: Number(sceneCamera._camPanX) || 0, y: Number(sceneCamera._camPanY) || 0 };
    const dentro = (n: number) => Math.max(-100, Math.min(100, n));
    addStop(dentro(ultimo.x + 33), dentro(ultimo.y - 22));
  };
  const moveStop = (i: number, x: number, y: number) => {
    markCustom();
    patchSceneCamera({ [cameraStopKeys(i).pad]: { x, y } });
  };
  const zoomStop = (i: number, zoom: number) => {
    markCustom();
    patchSceneCamera({ [cameraStopKeys(i).zoom]: zoom });
  };
  // Only the LAST stop can go: dropping one from the middle would renumber
  // every stop after it, and a path whose stop 3 silently became stop 2 is a
  // path nobody can keep track of.
  const removeStop = () => {
    markCustom();
    const keys = cameraStopKeys(path.stops.length - 1);
    patchSceneCamera({ [keys.pad]: null, [keys.zoom]: null });
    setSelectedStop((i) => (i >= path.stops.length - 1 ? -1 : i));
  };
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
      <>
          <div className="section-head">
            <span className="eyebrow">Camera</span>
            <button type="button" className="badge" onClick={hasCamera ? resetSceneCamera : addCamera}>
              {hasCamera ? "Remove" : "Add"}
            </button>
          </div>
          {!hasCamera && (
            <div className="section-body">
              <div className="ctl-hint">Nothing is filming this scene. A camera lets you frame it from somewhere else, and travel across it while it plays.</div>
              {/* A real button and not only the badge in the header: the badge
                  is where you turn a camera OFF once you have one, and it is
                  too quiet to be the way you discover you can have one. */}
              <div className="ctl-row">
                <div className="ctl-input cam-stop-actions">
                  <button type="button" className="badge cam-cta" onClick={addCamera}>Add a camera</button>
                </div>
              </div>
            </div>
          )}
          {hasCamera && cameraControls.length > 0 && (
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
          {hasCamera && (
          <div className="section-body">
            {/* CHOOSING a move, not building one. The pad below is folded away
                because authoring coordinates over time is the hardest thing in
                this app and it was the only way in. See lib/cameraMoves. */}
            <div className="ctl-section-title">Move</div>
            <div className="cam-moves">
              {CAMERA_MOVES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`cam-move ${moveId === m.id ? 'is-on' : ''}`}
                  title={m.hint}
                  onClick={() => applyMove(m.id)}
                >
                  {m.label}
                </button>
              ))}
              <button
                type="button"
                className={`cam-move ${moveId === CUSTOM_MOVE ? 'is-on' : ''}`}
                title="Stops you placed yourself"
                onClick={() => { patchSceneCamera({ [CAMERA_MOVE_KEY]: CUSTOM_MOVE }); setPathOpen(true); }}
              >
                Custom
              </button>
            </div>
            <div className="ctl-hint">
              {move ? move.hint : 'Stops you placed by hand. Open the path below to edit them.'}
            </div>
            {/* At most two, and they belong to the chosen move. */}
            {move?.knobs.map((def) => (
              <ControlRow
                key={def.key}
                def={def}
                value={def.key === CAMERA_MOVE_AMOUNT ? moveAmount : moveDir}
                onChange={(val) => (def.key === CAMERA_MOVE_AMOUNT
                  ? applyMove(move.id, Number(val), moveDir)
                  : applyMove(move.id, moveAmount, String(val)))}
              />
            ))}

            {/* ---- hand editing, folded ---- */}
            <button
              type="button"
              className="cam-disclose"
              aria-expanded={pathOpen}
              onClick={() => setPathOpen((v) => !v)}
            >
              <span>{pathOpen ? 'Hide' : 'Edit'} the path</span>
              <span className="cam-count">{path.stops.length} / {MAX_CAMERA_STOPS} stops</span>
            </button>
            {pathOpen && (
            <>
            <div className="ctl-hint">Pick a stop on the strip, aim it in the pad, set how close it is below. The camera settles into each in turn.</div>
            <CameraPathPad
              shot={{
                x: Number(sceneCamera._camPanX) || 0,
                y: Number(sceneCamera._camPanY) || 0,
                zoom: Number(sceneCamera._camZoom) || 100,
              }}
              stops={path.stops}
              selected={selectedStop}
              max={MAX_CAMERA_STOPS}
              frameAspect={sceneW / Math.max(1, sceneH)}
              onSelect={setSelectedStop}
              onMoveStop={moveStop}
              onAddStop={addStop}
            />
            {/* One row for whichever stop is selected, instead of a row per
                stop: the panel stays the same height at one stop and at four. */}
            {stopAt && (
              <>
                {/* Named, so the row and the dot are visibly the same thing.
                    Before this it said "Stop 2 zoom" next to a dot labelled 2
                    that was the FIRST stop, because the Shot was counted as 1. */}
                <div className="cam-stop-head">Selected · Stop {selectedStop + 1}</div>
                <ControlRow
                  def={{ ...SCENE_CAMERA_STOP_ZOOM, label: `Stop ${selectedStop + 1} zoom` }}
                  value={stopAt.zoom}
                  onChange={(val) => zoomStop(selectedStop, Number(val))}
                />
                {selectedStop === path.stops.length - 1 && (
                  <div className="ctl-row">
                    <div className="ctl-input cam-stop-actions">
                      <button type="button" className="badge" onClick={removeStop}>Remove stop {selectedStop + 1}</button>
                    </div>
                  </div>
                )}
              </>
            )}
            </>
            )}
          </div>
          )}
          <div className="hairline" />
      </>

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
