'use client';

import { useEffect, useState } from 'react';
import { useSceneStore, ASPECTS } from '@/store/useSceneStore';
import { ControlRow } from './Controls';
import GradientEditor from './GradientEditor';
import { normalizeGradientSpec } from '@/lib/gradient';
import type { ControlDef } from '@/lib/types';

const FPS_OPTIONS = [15, 25, 30, 60] as const;
const BG_ALPHA: ControlDef = { key: 'background-alpha', label: 'Alpha', type: 'slider', min: 0, max: 100, step: 1, default: 100 };
const BG_SOURCES: { id: 'color' | 'image' | 'card'; label: string }[] = [
  { id: 'color', label: 'Color' },
  { id: 'image', label: 'Image' },
  { id: 'card', label: 'From card' },
];

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
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2L7 5l-3.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

// `is3DMode` drops Safe area and the Background/Logo/Audio collapsibles — 3D
// and Mockup mode have their own BackgroundFill panel and no overlay concept.
export default function CanvasPanel({ is3DMode = false }: { is3DMode?: boolean } = {}) {
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
  const backgroundGradient = normalizeGradientSpec(background.gradientSpec, background.color, background.color2);

  return (
    <>
      <div className="section-head"><span className="eyebrow">Canvas</span></div>
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
          <div className="ctl-row">
            <label className="ctl-label">Safe area</label>
            <div className="segmented">
              <button className={`seg ${!safeArea ? 'active' : ''}`} onClick={() => safeArea && toggleSafeArea()}>Off</button>
              <button className={`seg ${safeArea ? 'active' : ''}`} onClick={() => !safeArea && toggleSafeArea()}>On</button>
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
              <div className="ctl-row">
                <label className="ctl-label">Source</label>
                <div className="pills">
                  {BG_SOURCES.map((src) => (
                    <button key={src.id} className={`pill ${background.source === src.id ? 'active' : ''}`} onClick={() => setBackground({ source: src.id })}>{src.label}</button>
                  ))}
                </div>
              </div>

              {background.source === 'color' && (
                <>
                  <div className="ctl-row">
                    <label className="ctl-label">Fill</label>
                    <div className="segmented">
                      <button className={`seg ${!background.gradient ? 'active' : ''}`} onClick={() => setBackground({ gradient: false })}>Solid</button>
                      <button className={`seg ${background.gradient ? 'active' : ''}`} onClick={() => setBackground({ source: 'color', gradient: true, gradientSpec: backgroundGradient })}>Gradient</button>
                    </div>
                  </div>
                  {!background.gradient && <ControlRow def={{ key: 'bgc', label: 'Colour', type: 'color', default: '' }} value={background.color} onChange={(v) => setBackground({ color: v })} />}
                  {background.gradient && <GradientEditor value={backgroundGradient} onChange={(gradientSpec) => setBackground({ source: 'color', gradient: true, gradientSpec })} />}
                  <ControlRow def={BG_ALPHA} value={background.alpha ?? 100} onChange={(v) => setBackground({ alpha: Number(v) })} />
                </>
              )}

              {background.source === 'image' && (
                <>
                  <div className="ctl-row">
                    <label className="ctl-label">Image</label>
                    <label className="upload">
                      <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setBackground({ imageUrl: URL.createObjectURL(f) }); }} />
                      <span>{background.imageUrl ? 'Replace…' : 'Upload…'}</span>
                    </label>
                  </div>
                  <ControlRow def={{ key: 'bgblur', label: 'Blur', type: 'slider', min: 0, max: 100, step: 1, default: 28 }} value={background.blur} onChange={(v) => setBackground({ blur: Number(v) })} />
                  <ControlRow def={BG_ALPHA} value={background.alpha ?? 100} onChange={(v) => setBackground({ alpha: Number(v) })} />
                </>
              )}

              {background.source === 'card' && (
                <>
                  <div className="ctl-hint">Reflects the featured card — the background moves with the animation.</div>
                  <ControlRow def={{ key: 'bgblur', label: 'Blur', type: 'slider', min: 0, max: 100, step: 1, default: 28 }} value={background.blur} onChange={(v) => setBackground({ blur: Number(v) })} />
                  <ControlRow def={BG_ALPHA} value={background.alpha ?? 100} onChange={(v) => setBackground({ alpha: Number(v) })} />
                </>
              )}
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
