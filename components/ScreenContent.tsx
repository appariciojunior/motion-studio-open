'use client';

import { useRef } from 'react';
import { use3DStore, defaultModelFor } from '@/store/use3DStore';
import { findDevice, SLOT_LABELS } from '@/three3d/devices';
import { ControlRow } from './Controls';
import type { ControlDef } from '@/lib/types';

const zoomDef: ControlDef = { key: 'zoom', label: 'Zoom', type: 'slider', min: 0.2, max: 3, step: 0.01, default: 1 };
const posXDef: ControlDef = { key: 'px', label: 'Position X', type: 'slider', min: 0, max: 100, step: 1, default: 50 };
const posYDef: ControlDef = { key: 'py', label: 'Position Y', type: 'slider', min: 0, max: 100, step: 1, default: 50 };
const timeDef: ControlDef = { key: 'statusTime', label: 'Time', type: 'text', default: '9:41' };
const batteryDef: ControlDef = { key: 'statusBattery', label: 'Battery', type: 'slider', min: 0, max: 100, step: 1, default: 100, unit: '%' };
const signalDef: ControlDef = { key: 'statusSignal', label: 'Signal', type: 'slider', min: 0, max: 4, step: 1, default: 4 };

const FITS: { id: 'cover' | 'width' | 'contain'; label: string }[] = [
  { id: 'cover', label: 'Cover' },
  { id: 'width', label: 'Fit width' },
  { id: 'contain', label: 'Contain' },
];

// Right column, Mockup mode only — the artwork shown on the active device's
// "Screen" mesh (fit/zoom/anchor + real corner radius, composited in
// three3d/mockup.ts). Only shown for a recognised bundled device: a custom
// uploaded .glb has no known "Screen" mesh to composite onto.
//
// Assets are held per SCREEN SLOT rather than per device, so a phone shot
// serves every phone and swapping device keeps the artwork. The panel states
// the panel's real native pixel size so a screenshot can be prepared to fit.
export default function ScreenContent() {
  const modelUrl = use3DStore((s) => (s.models[s.effectId] ?? defaultModelFor(s.effectId)).url);
  const screenMediaBySlot = use3DStore((s) => s.screenMedia);
  const setScreenMedia = use3DStore((s) => s.setScreenMedia);
  const screenFit = use3DStore((s) => s.screenFit);
  const setScreenFit = use3DStore((s) => s.setScreenFit);
  const screenZoom = use3DStore((s) => s.screenZoom);
  const setScreenZoom = use3DStore((s) => s.setScreenZoom);
  const screenOffsetX = use3DStore((s) => s.screenOffsetX);
  const screenOffsetY = use3DStore((s) => s.screenOffsetY);
  const setScreenOffset = use3DStore((s) => s.setScreenOffset);
  const statusBarMode = use3DStore((s) => s.statusBarMode);
  const setStatusBarMode = use3DStore((s) => s.setStatusBarMode);
  const statusBarTime = use3DStore((s) => s.statusBarTime);
  const setStatusBarTime = use3DStore((s) => s.setStatusBarTime);
  const statusBarBattery = use3DStore((s) => s.statusBarBattery);
  const setStatusBarBattery = use3DStore((s) => s.setStatusBarBattery);
  const statusBarSignal = use3DStore((s) => s.statusBarSignal);
  const setStatusBarSignal = use3DStore((s) => s.setStatusBarSignal);
  const fileRef = useRef<HTMLInputElement>(null);

  const device = findDevice(modelUrl);
  if (!device) return null;

  const slot = device.slot;
  const media = screenMediaBySlot[slot] ?? null;
  const [pxW, pxH] = device.screenPx;

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    setScreenMedia(slot, { url, kind: f.type.startsWith('video/') ? 'video' : 'image' });
  };

  return (
    <>
      <div className="section-head">
        <span className="eyebrow">Screen Content</span>
        <span className="badge">{pxW} × {pxH}</span>
      </div>
      <div className="section-body mc-body">
        <div className="ctl-hint">{SLOT_LABELS[slot]} — shared by every {slot} device.</div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />

        {media ? (
          <div className="sc-asset">
            {media.kind === 'video'
              ? <video className="sc-asset-thumb" src={media.url} muted playsInline />
              : <img className="sc-asset-thumb" src={media.url} alt="" />}
            <span className="sc-asset-name">{SLOT_LABELS[slot]}</span>
            <button className="sc-asset-x" title="Remove" onClick={() => setScreenMedia(slot, null)}>✕</button>
          </div>
        ) : (
          <button className="btn full" onClick={() => fileRef.current?.click()}>Upload image or video…</button>
        )}

        {media && (
          <>
            <button className="btn full" onClick={() => fileRef.current?.click()}>Replace {media.kind}…</button>
            <div className="ctl-row">
              <label className="ctl-label">Fit</label>
              <div className="pills">
                {FITS.map((f) => (
                  <button
                    key={f.id}
                    className={`pill ${screenFit === f.id ? 'active' : ''}`}
                    onClick={() => setScreenFit(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <ControlRow def={zoomDef} value={screenZoom} onChange={(v) => setScreenZoom(Number(v))} />
            <ControlRow def={posXDef} value={screenOffsetX} onChange={(v) => setScreenOffset(Number(v), screenOffsetY)} />
            <ControlRow def={posYDef} value={screenOffsetY} onChange={(v) => setScreenOffset(screenOffsetX, Number(v))} />
          </>
        )}

        {slot === 'phone' && (
          <div className="e3d-group" style={{ marginTop: 12 }}>
            <div className="e3d-group-title">iPhone Status Bar</div>
            <div className="ctl-hint">Show system information above the phone screen content.</div>
            <div className="ctl-row">
              <label className="ctl-label">Status Bar</label>
              <div className="pills">
                {(['off', 'light', 'dark'] as const).map((mode) => (
                  <button key={mode} className={`pill ${statusBarMode === mode ? 'active' : ''}`} onClick={() => setStatusBarMode(mode)}>
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {statusBarMode !== 'off' && (
              <>
                <ControlRow def={timeDef} value={statusBarTime} onChange={(v) => setStatusBarTime(String(v))} />
                <ControlRow def={batteryDef} value={statusBarBattery} onChange={(v) => setStatusBarBattery(Number(v))} />
                <ControlRow def={signalDef} value={statusBarSignal} onChange={(v) => setStatusBarSignal(Number(v))} />
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
