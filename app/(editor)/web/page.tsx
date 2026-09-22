'use client';

// ── /web: devices → real 3D export ───────────────────────────────────────
// Replaces the old paste-HTML/component → animate → export-CSS-keyframes
// flow. Pick a device, drive it with an existing motion template, put an
// image on its screen, export a standalone interactive HTML+glb.
//
// Rendered as EditorShell's `children` (app/(editor)/layout.tsx), not
// through DesktopEditor — DesktopEditor bails out early when nav === 'web'
// (see components/DesktopEditor.tsx) so this page owns the whole screen,
// including its own IconRail, rather than sitting inside the shared
// rail/panels/stage grid the other sections use.
//
// Styled with the app's own panel classes (globals.css: .rail, .card, .tpl-
// list/.tpl-item, .ctl-row via ControlRow, .stage-col/.stage-wrap/.stage-
// canvas, .btn).

import { useEffect, useRef, useState } from 'react';
import IconRail from '@/components/IconRail';
import { ControlRow } from '@/components/Controls';
import { WEB_DEVICES } from '@/three3d/webDevices';
import { initWebMvpViewer } from '@/three3d/webMvpViewer';
import { initWebTemplateScene } from '@/three3d/webTemplateScene';
import { DEFAULT_SCREEN_TRANSFORM, type ScreenTransform } from '@/three3d/screenImage';
import { getTemplate, defaultsFor } from '@/templates';
import { dimsFor } from '@/store/useSceneStore';
import { downloadWebMvpZip, downloadWebMvpTemplateZip } from '@/lib/webMvpExport';
import { demoSourceForSlot } from '@/lib/demoAssets';
import type { ControlDef } from '@/lib/types';

const zoomDef: ControlDef = { key: 'zoom', label: 'Zoom', type: 'slider', min: 0.2, max: 3, step: 0.01, default: 1 };
const posXDef: ControlDef = { key: 'px', label: 'Position X', type: 'slider', min: 0, max: 100, step: 1, default: 50 };
const posYDef: ControlDef = { key: 'py', label: 'Position Y', type: 'slider', min: 0, max: 100, step: 1, default: 50 };

const FITS: { id: ScreenTransform['fit']; label: string }[] = [
  { id: 'cover', label: 'Cover' },
  { id: 'width', label: 'Fit width' },
  { id: 'contain', label: 'Contain' },
];

// Device clones are full GLB instances with their own 1024² screen texture —
// not cheap 2D cards. Motion presets default to 10-70 layers, way past what a
// device grid can carry, so instancing is hard-capped at 12 (see three3d/
// webTemplateScene.ts's own MAX_INSTANCES and lib/webMvpExport.ts's bake
// step — this page's UI just mirrors the same number).
const MAX_INSTANCES = 12;

interface ScreenSlot { url: string; name: string }
function clampTemplateValues(v: Record<string, any>): Record<string, any> {
  if (!('count' in v)) return v;
  return { ...v, count: Math.min(Number(v.count), MAX_INSTANCES) };
}

// The session canvas — fixed, not responsive-fill: a web session is authored
// at one size (like a hero/banner slot) and exported at that size, the same
// way the 2D canvas has a fixed aspect rather than filling whatever window
// it's previewed in.
const SESSION_W = 1300;
const SESSION_H = 720;

// Free orbit uses the plain device viewer (three3d/webMvpViewer.ts) and has no
// controls of its own. The others drive the device with an EXISTING 2D/3D
// motion template instead of a bespoke animation — see three3d/
// webTemplateScene.ts. `canvasSize` is the reference frame each preset's
// px-space values (planeSize, orbitRadius…) were authored against, independent
// of the session canvas's own on-screen size above.
const WEB_MOTIONS = [
  { key: 'free', label: 'Free orbit', templateId: null as string | null, canvasSize: dimsFor('3:4') },
  // Gap 20% (the control's own max): the template's 10% default packs device
  // clones edge-to-edge, which reads as one smeared shape at this scale —
  // devices need more breathing room than flat 2D cards do. Backward reads
  // better than the default forward for a device flythrough. Defaults to the
  // iPad — its 16:9-ish screen reads better than the phone's tall sliver at
  // this canvas's landscape framing.
  { key: 'tunnel-01', label: 'Card Tunnel', templateId: 'tunnel-01', canvasSize: dimsFor('16:9'), valuesOverride: { gap: 20, direction: 'backward' }, defaultDeviceKey: 'ipadpro' },
  { key: 'ring-r01', label: 'Ring 01', templateId: 'ring-r01', canvasSize: dimsFor('4:5') },
  { key: 'orbit-3d-01', label: 'Orbit 3D 01', templateId: 'orbit-3d-01', canvasSize: dimsFor('4:5') },
  { key: 'carousel3d-01', label: 'Carousel 3D 01', templateId: 'carousel3d-01', canvasSize: dimsFor('3:4') },
  { key: 'deck-r01', label: 'Deck 04', templateId: 'deck-r01', canvasSize: dimsFor('3:4') },
  { key: 'spinner-01', label: 'Spinner 01', templateId: 'spinner-01', canvasSize: dimsFor('1:1') },
  { key: 'globe-r01', label: 'Sphere 01', templateId: 'globe-r01', canvasSize: dimsFor('3:4') },
];

export default function WebPage() {
  const [deviceKey, setDeviceKey] = useState(WEB_DEVICES[0].key);
  const device = WEB_DEVICES.find((d) => d.key === deviceKey) ?? WEB_DEVICES[0];
  const [motionKey, setMotionKey] = useState(WEB_MOTIONS[0].key);
  const motion = WEB_MOTIONS.find((m) => m.key === motionKey) ?? WEB_MOTIONS[0];

  // Picking a motion with its own preferred device (Card Tunnel → iPad, its
  // screen reads better than the phone's sliver at this canvas's landscape
  // framing) switches to it once, on the switch itself — a device picked
  // afterward sticks, same as every other control here.
  useEffect(() => {
    if (motion.defaultDeviceKey) setDeviceKey(motion.defaultDeviceKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionKey]);

  // The active template's own control values — same "full reset on switch"
  // contract the editor uses (store/useSceneStore's setTemplate). Read live by
  // the render loop via valuesRef, so a slider drag never re-inits the scene.
  const [values, setValues] = useState<Record<string, any>>(() => (motion.templateId ? clampTemplateValues({ ...defaultsFor(motion.templateId), ...motion.valuesOverride }) : {}));
  const valuesRef = useRef(values);
  valuesRef.current = values;
  useEffect(() => {
    setValues(motion.templateId ? clampTemplateValues({ ...defaultsFor(motion.templateId), ...motion.valuesOverride }) : {});
  }, [motion.templateId]);

  // One slot per possible device clone (index i's image goes on clone i,
  // cycled — see three3d/webTemplateScene.ts). Free orbit only ever shows
  // one device, so it just reads slot 0.
  // Seeded from the same bundled demo set the Library/Assets panel opens
  // with (lib/demoAssets.ts) — a fresh session shows real imagery on every
  // device screen instead of blank black glass. Replace or remove like any
  // upload; nothing here is fetched or persisted beyond this page's state.
  const [screenSlots, setScreenSlots] = useState<(ScreenSlot | null)[]>(() =>
    Array.from({ length: MAX_INSTANCES }, (_, i) => {
      const demo = demoSourceForSlot(i);
      return { url: demo.url, name: demo.name };
    }));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef(0);
  // Object URL lifecycle lives in a ref, not inside the setState updater:
  // React (Strict Mode especially) may invoke a functional updater more than
  // once to check it's pure, and createObjectURL/revokeObjectURL are real
  // side effects — called twice, the second pass revokes the blob the first
  // pass just handed to <img>, and the load fails.
  const slotUrlsRef = useRef<(string | null)[]>(Array(MAX_INSTANCES).fill(null));
  const onSlotFile = (i: number, f: File | undefined) => {
    if (!f) return;
    const prev = slotUrlsRef.current[i];
    if (prev) URL.revokeObjectURL(prev);
    const next = URL.createObjectURL(f);
    slotUrlsRef.current[i] = next;
    setScreenSlots((s) => { const copy = s.slice(); copy[i] = { url: next, name: f.name }; return copy; });
  };
  const clearSlot = (i: number) => {
    const prev = slotUrlsRef.current[i];
    if (prev) { URL.revokeObjectURL(prev); slotUrlsRef.current[i] = null; }
    setScreenSlots((s) => { const copy = s.slice(); copy[i] = null; return copy; });
  };
  const visibleSlots = motion.templateId ? MAX_INSTANCES : 1;
  const screenImageUrls = screenSlots.slice(0, visibleSlots).map((s) => s?.url ?? null);
  const hasAnyScreenImage = screenImageUrls.some(Boolean);
  // Stable primitive key — the array above is a fresh object every render,
  // so the scene-init effect below keys off this instead to avoid
  // re-loading the model on every unrelated re-render.
  const screenImageUrlsKey = screenImageUrls.join('|');

  // Same isolation principle as store/use3DStore.ts's per-effect state: this
  // is local to this page, not use3DStore's global screenFit/screenZoom
  // (that's Mockup-only state) — components/ScreenContent.tsx's UI pattern is
  // reused, its store binding is not.
  const [screenTransform, setScreenTransform] = useState<ScreenTransform>(DEFAULT_SCREEN_TRANSFORM);
  const screenTransformRef = useRef(screenTransform);
  screenTransformRef.current = screenTransform;
  const patchScreenTransform = (patch: Partial<ScreenTransform>) => setScreenTransform((s) => ({ ...s, ...patch }));

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const dispose = motion.templateId
      ? initWebTemplateScene(stage, canvas, {
          device, templateId: motion.templateId, canvasSize: motion.canvasSize,
          getValues: () => valuesRef.current, screenImageUrls,
          getScreenTransform: () => screenTransformRef.current,
        })
      : initWebMvpViewer(stage, canvas, device, screenImageUrls[0] ?? null, () => screenTransformRef.current);
    return dispose;
    // valuesRef is read live — not a dependency. Changing device/motion/screen
    // is the only thing that should re-load the model. screenImageUrlsKey
    // stands in for screenImageUrls (a fresh array reference every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, motion.templateId, motion.canvasSize, screenImageUrlsKey]);

  const onExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      if (motion.templateId) {
        await downloadWebMvpTemplateZip(device.key, device, device.label, motion.templateId, motion.canvasSize, values, screenImageUrls, screenTransform);
      } else {
        await downloadWebMvpZip(device.key, device, device.label, screenImageUrls[0] ?? null, screenTransform);
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const template = motion.templateId ? getTemplate(motion.templateId) : null;

  return (
    <div style={{
      height: '100vh', display: 'grid',
      gridTemplateColumns: 'var(--rail-w) 260px 1fr 280px',
      gridTemplateRows: '1fr',
      // .rail/.templates/.stage-col/.right (globals.css) already declare
      // their own `grid-area: rail|templates|stage|right` — this is what was
      // missing at first: without a matching grid-template-areas, those
      // names don't resolve to anything in THIS grid and every item silently
      // falls back to the same auto-placed cell.
      gridTemplateAreas: '"rail templates stage right"',
      background: 'var(--stage)',
    }}>
      <IconRail />

      {/* LEFT — pick what's on stage: device + motion. */}
      <aside className="card templates" style={{ minHeight: 0 }}>
        <div className="section-head">
          <span className="eyebrow">Web sessions</span>
        </div>

        <div className="card-scroll">
          <div className="tpl-list" style={{ overflow: 'visible' }}>
            <div className="tpl-group-label">Device</div>
            {WEB_DEVICES.map((d) => (
              <button key={d.key} className={`tpl-item ${d.key === deviceKey ? 'active' : ''}`} onClick={() => setDeviceKey(d.key)}>
                <span className="tpl-name">{d.label}</span>
              </button>
            ))}

            <div className="tpl-group-label">Motion</div>
            {WEB_MOTIONS.map((m) => (
              <button key={m.key} className={`tpl-item ${m.key === motionKey ? 'active' : ''}`} onClick={() => setMotionKey(m.key)}>
                <span className="tpl-name">{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="stage-col">
        <div className="stage-wrap">
          <div
            ref={stageRef}
            className="stage-canvas"
            // True session resolution is 1300×720 — width caps there and
            // aspect-ratio holds the proportion, so it scales DOWN to fit a
            // narrower viewport (same contract .stage-canvas's own
            // max-width/max-height:100% makes for the 2D editor canvas)
            // without ever exceeding the authored size.
            style={{ width: '100%', maxWidth: SESSION_W, aspectRatio: `${SESSION_W} / ${SESSION_H}`, position: 'relative' }}
          >
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>
        </div>
      </div>

      {/* RIGHT — manipulate what's on stage: screen content + the active
          motion template's own controls, plus export. */}
      <aside className="right card-scroll">
        <div className="section-head">
          <span className="eyebrow">Screen content</span>
        </div>
        <div className="section-body">
          <div className="ctl-hint">
            {device.label} screen — {device.screenPx[0]} × {device.screenPx[1]}
            {motion.templateId ? ` · up to ${MAX_INSTANCES} clones, one image each (cycled if fewer)` : ''}
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { onSlotFile(uploadTargetRef.current, e.target.files?.[0]); e.target.value = ''; }} />

          {Array.from({ length: visibleSlots }, (_, i) => {
            const slot = screenSlots[i];
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {slot ? (
                  <div className="sc-asset">
                    <img className="sc-asset-thumb" src={slot.url} alt="" />
                    <span className="sc-asset-name">{visibleSlots > 1 ? `Screen ${i + 1} — ` : ''}{slot.name}</span>
                    <button className="sc-asset-x" title="Remove" onClick={() => clearSlot(i)}>✕</button>
                  </div>
                ) : (
                  <button type="button" className="upload" onClick={() => { uploadTargetRef.current = i; fileInputRef.current?.click(); }}>
                    <span>{visibleSlots > 1 ? `Upload image ${i + 1}…` : 'Upload image…'}</span>
                  </button>
                )}
              </div>
            );
          })}

          {hasAnyScreenImage && (
            <>
              <div className="ctl-row">
                <label className="ctl-label">Fit</label>
                <div className="pills">
                  {FITS.map((f) => (
                    <button
                      key={f.id}
                      className={`pill ${screenTransform.fit === f.id ? 'active' : ''}`}
                      onClick={() => patchScreenTransform({ fit: f.id })}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <ControlRow def={zoomDef} value={screenTransform.zoom} onChange={(v) => patchScreenTransform({ zoom: Number(v) })} />
              <ControlRow def={posXDef} value={screenTransform.offsetX} onChange={(v) => patchScreenTransform({ offsetX: Number(v) })} />
              <ControlRow def={posYDef} value={screenTransform.offsetY} onChange={(v) => patchScreenTransform({ offsetY: Number(v) })} />
            </>
          )}
        </div>

        {template && (
          <>
            <div className="hairline" />
            <div className="section-head">
              <span className="eyebrow">{template.meta.name} controls</span>
            </div>
            <div className="section-body">
              {template.controls.map((def) => {
                // The scene only ever instances MAX_INSTANCES clones (see
                // three3d/webTemplateScene.ts) regardless of what this
                // template's own slider allows — cap what's shown so the
                // control doesn't promise a density the stage won't render.
                const shown = def.key === 'count' && def.type === 'slider' ? { ...def, max: Math.min(def.max ?? MAX_INSTANCES, MAX_INSTANCES) } : def;
                return (
                  <ControlRow
                    key={def.key}
                    def={shown}
                    value={values[def.key]}
                    onChange={(v) => setValues((s) => ({ ...s, [def.key]: v }))}
                  />
                );
              })}
            </div>
          </>
        )}

        <div className="hairline" />
        <div className="section-body">
          <button className="btn full" onClick={onExport} disabled={exporting}>
            {exporting ? 'Building…' : 'Export session (.zip)'}
          </button>
          {exportError && <p className="ctl-hint" style={{ color: '#c0392b' }}>{exportError}</p>}
          <p className="ctl-hint">
            {motion.templateId
              ? `Downloads index.html + model.glb${hasAnyScreenImage ? ' + screen image(s)' : ''}. "${motion.label}" is baked into a frame table and replayed on load — no dependency on this app.`
              : `Downloads index.html + model.glb${hasAnyScreenImage ? ' + screen image' : ''}. Loads three.js from a CDN, renders the device in real 3D, orbit-controllable.`}
          </p>
        </div>
      </aside>
    </div>
  );
}
