'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react';
import { useSceneStore, type AssetItem } from '@/store/useSceneStore';
import { getTemplate } from '@/templates';
import { CARD_SHAPES, cardAspectFor, coverCrop, cropFromRect, normalizeCrop, parseCardShape } from '@/lib/crop';
import { isVideoSource } from '@/lib/videoTexture';
import { CloseIcon, CropIcon } from './EditorIcons';
import { ControlRow } from './Controls';
import './MediaCropEditor.css';

type Gesture = { x: number; y: number; scale: number; rect: ReturnType<typeof coverCrop> };
const POSITIONS = [0, 0.5, 1].flatMap(y => [0, 0.5, 1].map(x => ({ x, y })));

export default function MediaCropEditor({ asset, onClose }: { asset: AssetItem; onClose: () => void }) {
  const meta = useSceneStore(s => getTemplate(s.activeTemplateId).meta);
  const width = useSceneStore(s => s.width);
  const height = useSceneStore(s => s.height);
  const savedShape = useSceneStore(s => s.cardShape);
  const [shape, setShape] = useState(savedShape);
  const [crop, setCrop] = useState(() => normalizeCrop(asset.crop));
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [error, setError] = useState(false);
  const [grid, setGrid] = useState(true);
  const [all, setAll] = useState(false);
  const [custom, setCustom] = useState(!['auto', ...Object.keys(CARD_SHAPES)].includes(savedShape));
  const initialRatio = cardAspectFor(meta, width, height, savedShape);
  const [customW, setCustomW] = useState(String(Math.round(initialRatio * 1000)));
  const [customH, setCustomH] = useState('1000');
  const panel = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const video = isVideoSource(asset.url, asset.kind);
  const fullBleed = meta.cardAspect === 'canvas';
  const aspect = cardAspectFor(meta, width, height, shape);
  const ready = size.w > 0 && size.h > 0 && !error;
  const rect = coverCrop(size.w || 1, size.h || 1, aspect, crop);
  const customValid = !custom || parseCardShape(`${customW}:${customH}`) !== null;

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  // Native wheel listener prevents the page from scrolling while zooming.
  useEffect(() => {
    const el = frame.current;
    if (!el || !ready) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setCrop(c => normalizeCrop({ ...c, zoom: c.zoom * Math.exp(-e.deltaY * 0.002) }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [ready]);

  const begin = (e: PointerEvent<HTMLDivElement>) => {
    if (!ready || e.button !== 0 || gesture.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    const bounds = e.currentTarget.getBoundingClientRect();
    gesture.current = { x: e.clientX, y: e.clientY, scale: bounds.width / rect.fw, rect };

  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = (e.clientX - g.x) / g.scale, dy = (e.clientY - g.y) / g.scale;
    const { fx, fy, fw } = g.rect;
    setCrop(cropFromRect(size.w, size.h, aspect, fx - dx, fy - dy, fw));
  };
  const end = () => { gesture.current = null; };
  const keyboard = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!ready) return;
    const step = e.shiftKey ? 20 : 2;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!delta[e.key]) return;
    e.preventDefault(); e.stopPropagation();
    const [dx, dy] = delta[e.key];
    setCrop(cropFromRect(size.w, size.h, aspect, rect.fx + dx, rect.fy + dy, rect.fw));
  };
  const changeCustom = (w: string, h: string) => {
    setCustomW(w); setCustomH(h);
    if (parseCardShape(`${w}:${h}`) !== null) setShape(`${w}:${h}`);
  };
  const apply = () => {
    if (!ready || !customValid) return;
    // Commit once, so cancel is lossless and history records one adjustment.
    useSceneStore.setState(s => ({
      cardShape: fullBleed ? s.cardShape : shape,
      assets: s.assets.map(a => all || a.id === asset.id ? { ...a, crop: { ...crop } } : a),
    }));
    onClose();
  };
  const mediaStyle: CSSProperties = { width: `${size.w / rect.fw * 100}%`, height: `${size.h / rect.fh * 100}%`, left: `${-rect.fx / rect.fw * 100}%`, top: `${-rect.fy / rect.fh * 100}%` };
  const interactions = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end, onKeyDown: keyboard };

  return (
    <section ref={panel} className="media-crop" aria-labelledby="media-crop-title" tabIndex={-1}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
      <header className="media-crop-head">
        <div><CropIcon size={16}/><h2 id="media-crop-title">Adjust media</h2></div>
        <button className="icon-btn" aria-label="Back to media" title="Back to media" onClick={onClose}><CloseIcon size={16}/></button>
      </header>
      <div className="media-crop-body">
        <section className="media-crop-preview" aria-label="Crop preview">
          <div className="media-crop-preview-bar"><span>PREVIEW</span><button aria-pressed={grid} onClick={() => setGrid(!grid)}>Grid {grid ? 'on' : 'off'}</button></div>
          <div className="media-crop-stage">
            <div ref={frame} className={`media-crop-frame ${grid ? 'has-grid' : ''}`} style={{ aspectRatio: aspect, width: `min(${Math.min(1, aspect) * 100}%, ${Math.min(1, aspect) * 220}px)` }}
              tabIndex={0} role="group" aria-label="Drag image to reposition. Use arrow keys to move the selection. Scroll to zoom."
              onPointerDown={begin} {...interactions}>
              {asset.url && (video ? <video className="media-crop-image" src={asset.url} style={mediaStyle} muted playsInline preload="auto"
                onLoadedMetadata={e => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })} onError={() => setError(true)} />
                : <img className="media-crop-image" src={asset.url} style={mediaStyle} alt={asset.name} draggable={false}
                  onLoad={e => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onError={() => setError(true)} />)}
              {ready && <div className="media-crop-thirds" aria-hidden="true"><i/><i/><i/><i/></div>}
            </div>
            {!ready && <p className="media-crop-status" role="status">{error || !asset.url ? 'Media unavailable. Close and replace this file.' : 'Loading media…'}</p>}
          </div>
          <p className="media-crop-help">Drag to reposition · Scroll to zoom</p>
          <div className="media-crop-file"><strong title={asset.name}>{asset.name}</strong><span>{ready ? `${size.w} × ${size.h}` : '—'}</span></div>
        </section>
        <fieldset className="media-crop-controls" disabled={!ready}>
          <div className="media-crop-section">
            <label>Aspect ratio</label>
            {fullBleed ? <p className="media-crop-note">Follows the canvas · {width} × {height}</p> : <>
              <div className="media-crop-ratios">
                {['auto', '3:4', '9:16', '1:1', '4:5', '4:3', '16:9'].map(value => <button key={value} aria-pressed={!custom && shape === value}
                  onClick={() => { setCustom(false); setShape(value); }}>{value === 'auto' ? 'Auto' : value}</button>)}
                <button aria-pressed={custom} onClick={() => { setCustom(true); changeCustom(customW, customH); }}>Custom</button>
              </div>
              {custom && <div className="media-crop-dimensions"><label>W<input aria-label="Crop ratio width" type="number" min="1" value={customW} onChange={e => changeCustom(e.target.value, customH)} /></label><span>×</span><label>H<input aria-label="Crop ratio height" type="number" min="1" value={customH} onChange={e => changeCustom(customW, e.target.value)} /></label></div>}
              {!customValid && <p role="alert" className="media-crop-note">Use positive dimensions with a ratio between 1:10 and 10:1.</p>}
              <p className="media-crop-note">Card ratio applies to all media.</p>
            </>}
          </div>
          <div className="media-crop-section">
            <ControlRow
              def={{ key: 'mediaCropZoom', label: 'Zoom', type: 'slider', min: 100, max: 500, step: 1, default: 100, unit: '%' }}
              value={Math.round(crop.zoom * 100)}
              onChange={value => { if (ready) setCrop(c => normalizeCrop({ ...c, zoom: Number(value) / 100 })); }}
            />
            <div className="media-crop-label"><button onClick={() => setCrop(normalizeCrop())}>Reset crop</button></div>
          </div>
          <div className="media-crop-position">
            <div><label>Position</label><p className="media-crop-note">Quick alignment</p></div>
            <div className="media-crop-align" role="group" aria-label="Align crop">
              {POSITIONS.map(p => <button key={`${p.x}-${p.y}`} aria-label={`${['Left', 'Center', 'Right'][p.x * 2]} / ${['Top', 'Middle', 'Bottom'][p.y * 2]}`} aria-pressed={Math.abs(crop.x - p.x) < 0.001 && Math.abs(crop.y - p.y) < 0.001} onClick={() => setCrop(c => ({ ...c, ...p }))}><span/></button>)}
            </div>
          </div>
        </fieldset>
      </div>
      <footer className="media-crop-footer">
        <label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)}/> Apply crop to all media</label>
        <div><button className="btn" onClick={onClose}>Cancel</button><button className="btn media-crop-apply" disabled={!ready || !customValid} onClick={apply}>Apply</button></div>
      </footer>
    </section>
  );
}
