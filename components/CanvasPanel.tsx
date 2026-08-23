'use client';

import { useEffect, useState } from 'react';
import { useSceneStore, ASPECTS } from '@/store/useSceneStore';
import BackgroundPanel from './BackgroundPanel';
import { useUIStore } from '@/store/useUIStore';

const FPS_OPTIONS = [15, 25, 30, 60] as const;

// Pixel input that commits on blur/Enter so half-typed values don't
// resize the canvas mid-keystroke.
export function DimInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) onCommit(n);
    else setText(String(value));
  };
  return (
    <input
      className="field dim-field"
      type="number"
      min={16}
      max={8192}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function Collapsible({ title, children, defaultOpen = false, openKey }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  openKey?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen, openKey]);
  return (
    <div className="collapsible">
      <button className={`collapsible-head ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span className="c-label">{title}</span>
        <span className="chev">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2L7 5l-3.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

// `is3DMode` drops Safe area and the Background/Logo/Audio collapsibles — 3D
// and Mockup mode have their own BackgroundFill panel and no overlay concept.
export default function CanvasPanel({ is3DMode = false }: { is3DMode?: boolean } = {}) {
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const aspect = useSceneStore((s) => s.aspect);
  const activeTemplateId = useSceneStore((s) => s.activeTemplateId);
  const setAspect = useSceneStore((s) => s.setAspect);
  const customW = useSceneStore((s) => s.customW);
  const customH = useSceneStore((s) => s.customH);
  const setCustomDims = useSceneStore((s) => s.setCustomDims);
  const fps = useSceneStore((s) => s.fps);
  const setFps = useSceneStore((s) => s.setFps);
  const safeArea = useSceneStore((s) => s.safeArea);
  const toggleSafeArea = useSceneStore((s) => s.toggleSafeArea);
  const safeAreaMargin = useSceneStore((s) => s.safeAreaMargin);
  const setSafeAreaMargin = useSceneStore((s) => s.setSafeAreaMargin);
  const background = useSceneStore((s) => s.background);
  const setBackground = useSceneStore((s) => s.setBackground);
  const logo = useSceneStore((s) => s.logo);
  const setLogo = useSceneStore((s) => s.setLogo);
  const setAudioUrl = useSceneStore((s) => s.setAudioUrl);
  const audioUrl = useSceneStore((s) => s.audioUrl);
  const isStickerCanvas = activeTemplateId.startsWith('stickers-')
    || activeTemplateId.startsWith('poster-')
    || activeTemplateId.startsWith('spinner-')
    || activeTemplateId.startsWith('hinge-')
    || activeTemplateId.startsWith('fan-');

  return (
    <>
      <div className="section-head"><span className="eyebrow">Canvas</span><button className="panel-head-toggle" onClick={toggleRightPanel} title="Collapse right panels" aria-label="Collapse right panels"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button></div>
      <div className="section-body">
        <div className="ctl-row">
          <label className="ctl-label">Aspect</label>
          <div className="pills aspect-pills">
            {Object.keys(ASPECTS).map((a) => (
              <button key={a} className={`pill ${aspect === a ? 'active' : ''}`} onClick={() => setAspect(a)}>{a}</button>
            ))}
            <button className={`pill ${aspect === 'custom' ? 'active' : ''}`} onClick={() => setCustomDims(customW, customH)}>W×H</button>
          </div>
        </div>

        {aspect === 'custom' && (
          <>
            <div className="ctl-row">
              <label className="ctl-label">Size px</label>
              <div className="dim-inputs">
                <DimInput value={customW} onCommit={(v) => setCustomDims(v, customH)} />
                <span className="dim-x">×</span>
                <DimInput value={customH} onCommit={(v) => setCustomDims(customW, v)} />
              </div>
            </div>
            <div className="ctl-hint">Preview scales to fit — the exact size applies on export.</div>
          </>
        )}

        <div className="ctl-row">
          <label className="ctl-label">FPS</label>
          <div className="pills pills-fit">
            {FPS_OPTIONS.map((f) => (
              <button
                key={f}
                type="button"
                className={`pill ${fps === f ? 'active' : ''}`}
                aria-pressed={fps === f}
                onClick={() => setFps(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {!is3DMode && (
          <>
            <div className="ctl-row">
              <label className="ctl-label">Safe area</label>
              <button type="button" className={`toggle-switch ${safeArea ? 'on' : ''}`} role="switch" aria-checked={safeArea} onClick={toggleSafeArea}>
                <span className="toggle-switch-knob" />
              </button>
            </div>
            {safeArea && (
              <div className="ctl-row safe-area-margin-row">
                <label className="ctl-label" htmlFor="safe-area-margin">Margin</label>
                <div className="safe-area-margin-control">
                  <input id="safe-area-margin" className="safe-area-margin-slider" type="range" min="1" max="25" step="1" value={safeAreaMargin} style={{ '--safe-area-progress': `${((safeAreaMargin - 1) / 24) * 100}%` } as React.CSSProperties} onChange={(event) => setSafeAreaMargin(Number(event.target.value))} />
                  <output>{safeAreaMargin}%</output>
                </div>
              </div>
            )}
          </>
        )}

        {is3DMode && (
          <div className="ctl-row">
            <label className="ctl-label">Background</label>
            <div className="segmented">
              <button className={`seg ${background.source !== 'transparent' ? 'active' : ''}`} onClick={() => setBackground({ source: 'color' })}>Opaque</button>
              <button className={`seg ${background.source === 'transparent' ? 'active' : ''}`} onClick={() => setBackground({ source: 'transparent' })}>Transparent</button>
            </div>
          </div>
        )}
      </div>

      {!is3DMode && (
      <>
      <div className="hairline" />
      <div className="section-body" style={{ paddingTop: 4 }}>
        <Collapsible title="Background" defaultOpen={isStickerCanvas} openKey={activeTemplateId}>
          {isStickerCanvas && (
            <div className="ctl-hint">The template starts on white. Your background choice is kept when switching Spinner, Sticker or Poster presets.</div>
          )}
          <BackgroundPanel background={background} setBackground={setBackground} />
        </Collapsible>

        <Collapsible title="Logo">
          <div className="ctl-row">
            <label className="ctl-label">Image</label>
            <label className="upload">
              <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setLogo({ url: URL.createObjectURL(f) }); }} />
              <span>{logo.url ? 'Replace…' : 'Upload…'}</span>
            </label>
          </div>
          <div className="ctl-row">
            <label className="ctl-label">Corner</label>
            <div className="pills">
              {(['tl', 'tr', 'bl', 'br'] as const).map((p) => (
                <button key={p} className={`pill ${logo.position === p ? 'active' : ''}`} onClick={() => setLogo({ position: p })}>{p.toUpperCase()}</button>
              ))}
            </div>
          </div>
        </Collapsible>

        <Collapsible title="Audio">
          <div className="ctl-row">
            <label className="ctl-label">Track</label>
            <label className="upload">
              <input type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setAudioUrl(URL.createObjectURL(f)); }} />
              <span>{audioUrl ? 'Replace…' : 'Upload…'}</span>
            </label>
          </div>
        </Collapsible>
      </div>
      </>
      )}
    </>
  );
}
