'use client';

import { useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { useBoardStore } from '@/store/useBoardStore';
import { getTemplate } from '@/templates';
import { BOARD_CONTROLS } from '@/lib/boardPose';
import { serializeBoardProject, parseBoardProject, applyBoardProject } from '@/lib/boardProject';
import { ControlRow } from './Controls';
import { DimInput } from './CanvasPanel';
import EasingPanel from './EasingPanel';

// Quick frame presets (label → w×h). 1440×720 is the default artboard.
const FRAME_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '1440×720', w: 1440, h: 720 },
  { label: '16:9', w: 1280, h: 720 },
  { label: '1:1', w: 1080, h: 1080 },
];

// Board mode right panel: how many cards, how they're arranged (layer 1), and
// whether the chosen animation runs on top (layer 2). The animation itself is
// picked from the template list on the left and lives in the scene store.
export default function BoardPanel() {
  const count = useBoardStore((s) => s.count);
  const setCount = useBoardStore((s) => s.setCount);
  const board = useBoardStore((s) => s.board);
  const setBoardValue = useBoardStore((s) => s.setBoardValue);
  const resetBoard = useBoardStore((s) => s.resetBoard);
  const motionOn = useBoardStore((s) => s.motionOn);
  const setMotionOn = useBoardStore((s) => s.setMotionOn);
  const hoverPlay = useBoardStore((s) => s.hoverPlay);
  const setHoverPlay = useBoardStore((s) => s.setHoverPlay);
  const hoverMs = useBoardStore((s) => s.hoverMs);
  const setHoverMs = useBoardStore((s) => s.setHoverMs);
  const hoverScope = useBoardStore((s) => s.hoverScope);
  const setHoverScope = useBoardStore((s) => s.setHoverScope);
  const hoverRadius = useBoardStore((s) => s.hoverRadius);
  const setHoverRadius = useBoardStore((s) => s.setHoverRadius);
  const hoverSide = useBoardStore((s) => s.hoverSide);
  const setHoverSide = useBoardStore((s) => s.setHoverSide);
  const liftOn = useBoardStore((s) => s.liftOn);
  const setLiftOn = useBoardStore((s) => s.setLiftOn);
  const frameW = useBoardStore((s) => s.frameW);
  const frameH = useBoardStore((s) => s.frameH);
  const setFrameSize = useBoardStore((s) => s.setFrameSize);

  const activeTemplateId = useSceneStore((s) => s.activeTemplateId);
  const duration = useSceneStore((s) => s.duration);
  const setDuration = useSceneStore((s) => s.setDuration);
  const template = getTemplate(activeTemplateId);

  // ---- project save/load ----
  const [paste, setPaste] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const download = () => {
    const blob = new Blob([serializeBoardProject()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `board-${activeTemplateId}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus({ kind: 'ok', msg: 'Downloaded.' });
  };

  const load = (text: string) => {
    const res = parseBoardProject(text);
    if (!res.ok) { setStatus({ kind: 'err', msg: res.error }); return; }
    applyBoardProject(res.project);
    setStatus({ kind: 'ok', msg: 'Loaded — screen restored.' });
    setPaste('');
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => load(String(reader.result ?? ''));
    reader.readAsText(f);
    e.target.value = '';
  };

  return (
    <>
      {/* ---- Frame: the artboard the scene composes on ---- */}
      <div className="section-head"><span className="eyebrow">Frame</span></div>
      <div className="section-body">
        <div className="ctl-row">
          <label className="ctl-label">Size px</label>
          <div className="dim-inputs">
            <DimInput value={frameW} onCommit={(v) => setFrameSize(v, frameH)} />
            <span className="dim-x">×</span>
            <DimInput value={frameH} onCommit={(v) => setFrameSize(frameW, v)} />
          </div>
        </div>
        <div className="pills">
          {FRAME_PRESETS.map((p) => (
            <button
              key={p.label}
              className={`pill ${frameW === p.w && frameH === p.h ? 'active' : ''}`}
              onClick={() => setFrameSize(p.w, p.h)}
            >{p.label}</button>
          ))}
        </div>
      </div>

      <div className="hairline" />

      {/* ---- Board: the static arrangement (layer 1) ---- */}
      <div className="section-head">
        <span className="eyebrow">Board</span>
        <button className="web-auto-btn" onClick={resetBoard}>Reset</button>
      </div>
      <div className="section-body">
        <ControlRow
          def={{ key: '_count', label: 'Cards', type: 'slider', min: 1, max: 200, step: 1, default: 3 }}
          value={count}
          onChange={(v) => setCount(Number(v))}
        />
        {BOARD_CONTROLS.map((def) => (
          <ControlRow
            key={def.key}
            def={def}
            value={(board as any)[def.key]}
            onChange={(val) => setBoardValue(def.key as any, val)}
          />
        ))}
      </div>

      <div className="hairline" />

      {/* ---- Motion: run the selected animation on top of the board ---- */}
      <div className="section-head">
        <span className="eyebrow">Motion</span>
        {motionOn && <span className="badge">{template.meta.name}</span>}
      </div>
      <div className="section-body">
        <ControlRow
          def={{ key: '_motionOn', label: 'Animation', type: 'toggle', options: ['Off', 'On'], default: 'Off' }}
          value={motionOn ? 'On' : 'Off'}
          onChange={(v) => setMotionOn(v === 'On')}
        />
        <div className="ctl-hint">
          {motionOn
            ? 'The animation picked on the left runs as motion added on top of the board arrangement.'
            : 'Static board. Turn on to layer the selected animation over your arrangement — pick it in the list on the left.'}
        </div>
      </div>

      {motionOn && (
        <>
          <div className="hairline" />
          <div className="section-head"><span className="eyebrow">Trigger</span></div>
          <div className="section-body">
            <ControlRow
              def={{ key: '_hoverPlay', label: 'Play on', type: 'toggle', options: ['Always', 'Hover'], default: 'Always' }}
              value={hoverPlay ? 'Hover' : 'Always'}
              onChange={(v) => setHoverPlay(v === 'Hover')}
            />
            {hoverPlay && (
              <>
                <ControlRow
                  def={{ key: '_hoverScope', label: 'Scope', type: 'toggle', options: ['Board', 'Card'], default: 'Board' }}
                  value={hoverScope === 'card' ? 'Card' : 'Board'}
                  onChange={(v) => setHoverScope(v === 'Card' ? 'card' : 'board')}
                />
                {hoverScope === 'card' && (
                  <>
                    <ControlRow
                      def={{ key: '_hoverRadius', label: 'Spread', type: 'slider', min: 0, max: 8, step: 1, default: 1 }}
                      value={hoverRadius}
                      onChange={(v) => setHoverRadius(Number(v))}
                    />
                    <ControlRow
                      def={{ key: '_hoverSide', label: 'Reveal', type: 'pills', options: ['both', 'left', 'right'], default: 'both' }}
                      value={hoverSide}
                      onChange={(v) => setHoverSide(v as 'both' | 'left' | 'right')}
                    />
                    <ControlRow
                      def={{ key: '_liftOn', label: 'Lift (Stack 01)', type: 'toggle', options: ['Off', 'On'], default: 'On' }}
                      value={liftOn ? 'On' : 'Off'}
                      onChange={(v) => setLiftOn(v === 'On')}
                    />
                  </>
                )}
                <ControlRow
                  def={{ key: '_hoverMs', label: 'Ramp', type: 'slider', min: 0, max: 1500, step: 50, default: 350 }}
                  value={hoverMs}
                  onChange={(v) => setHoverMs(Number(v))}
                />
                <div className="ctl-hint">
                  {hoverScope === 'card'
                    ? 'Point at one card to animate it and its neighbours — spread sets how many cards each side react.'
                    : 'The effect eases up when the pointer enters the board and back to a standstill on leave.'}
                </div>
              </>
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
      )}

      <div className="hairline" />

      {/* ---- Project: save / restore the whole screen as JSON ---- */}
      <div className="section-head"><span className="eyebrow">Project</span></div>
      <div className="section-body">
        <button className="web-clear" onClick={download}>Download JSON</button>
        <div className="ctl-hint">Saves the board arrangement and the chosen animation.</div>

        <textarea
          className="field board-json"
          placeholder="Paste a board JSON here to restore…"
          value={paste}
          onChange={(e) => { setPaste(e.target.value); setStatus(null); }}
          rows={4}
          spellCheck={false}
        />
        <div className="board-json-actions">
          <button className="web-clear" disabled={!paste.trim()} onClick={() => load(paste)}>Load pasted</button>
          <label className="upload board-json-file">
            <input type="file" accept="application/json,.json" onChange={onFile} />
            <span>Upload file…</span>
          </label>
        </div>
        {status && (
          <div className={`ctl-hint board-json-status ${status.kind === 'err' ? 'is-err' : 'is-ok'}`}>
            {status.msg}
          </div>
        )}
      </div>
    </>
  );
}
