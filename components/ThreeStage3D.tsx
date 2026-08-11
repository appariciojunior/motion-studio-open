'use client';

import { useEffect, useRef, useState } from 'react';
import { getThreeEffect, threeDefaults, threeEffects } from '@/three3d';
import { use3DStore, defaultModelFor } from '@/store/use3DStore';
import { useSceneStore } from '@/store/useSceneStore';
import { isOn } from '@/three3d/asciiControls';
import { findDevice } from '@/three3d/devices';
import type { CameraRig } from '@/three3d/cameraRig';
import { setRendererInstance } from '@/lib/rendererInstance';
import type { IRenderer } from '@/lib/rendererTypes';
import ViewGizmo from './ViewGizmo';

// 3D preview stage. Renders the active 3D effect into a canvas, then layers CSS
// post-processing driven by use3DStore params. The effect is (re)initialised
// only when the effect id (or uploaded model) changes; params/model are read
// live from the store inside the render loop, so slider drags don't re-init.
export default function ThreeStage3D({ effectId: forcedEffectId }: { effectId?: string } = {}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const threeEngineRef = useRef<{
    renderFrame: (frame: number) => void;
    setCaptureScale: (k: number) => void;
    captureFrame: (frame: number) => string;
  } | null>(null);
  const storeEffectId = use3DStore((s) => s.effectId);
  // Mockup mode forces 'mockup' regardless of the 3D-effects picker's own
  // choice, so switching between the "3D" and "Mockup" nav tabs never fights
  // over the same effectId.
  const def = getThreeEffect(forcedEffectId ?? storeEffectId) ?? threeEffects[0];   // guard stale ids
  const effectId = def.id;
  const overrides = use3DStore((s) => s.params[effectId]) ?? {};
  const dflts = threeDefaults(effectId);
  const p = { ...dflts, ...overrides };   // schema defaults + user edits
  const has = (k: string) => k in dflts;  // which controls this effect declares
  // Keyed on the effect THIS stage renders, not on the store's active id, so a
  // nav switch can never make the 3D tab load Mockup's device (or vice versa).
  const modelUrl = use3DStore((s) => (s.models[effectId] ?? defaultModelFor(effectId)).url);
  const width = useSceneStore((s) => s.width);
  const height = useSceneStore((s) => s.height);
  // effects that expose a camera get the view gizmo; the rest render without it
  const [rig, setRig] = useState<CameraRig | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const dispose = def.init(stage, canvas, {
      modelUrl: modelUrl ?? def.defaultModel,
      // read live from the store (schema defaults merged) — avoids re-init on drag
      getParams: () => ({ ...threeDefaults(effectId), ...(use3DStore.getState().params[effectId] ?? {}) }),
      getModel: () => use3DStore.getState().models[effectId] ?? defaultModelFor(effectId),
      getPartFills: () => use3DStore.getState().partFills,
      getSelectedPart: () => use3DStore.getState().selectedPart,
      onParts: (keys) => use3DStore.getState().setParts(keys),
      onPickPart: (key) => use3DStore.getState().selectPart(key),
      getBgFill: () => use3DStore.getState().bgFill,
      getBgTex: () => ({ amount: use3DStore.getState().bgTexAmount, scale: use3DStore.getState().bgTexScale }),
      getSunShadow: () => use3DStore.getState().sunShadow,
      getSunlight: () => use3DStore.getState().sunIntensity,
      getSunMask: () => use3DStore.getState().sunMask,
      getSunMaskTransform: () => {
        const s = use3DStore.getState();
        return { scale: s.sunMaskScale, offX: s.sunMaskOffsetX, offY: s.sunMaskOffsetY };
      },
      onCamera: setRig,
      getScreenMedia: () => {
        const s = use3DStore.getState();
        const slot = findDevice((s.models[effectId] ?? defaultModelFor(effectId)).url)?.slot;
        return slot ? (s.screenMedia[slot] ?? null) : null;
      },
      getScreenTransform: () => {
        const s = use3DStore.getState();
        return { fit: s.screenFit, zoom: s.screenZoom, offsetX: s.screenOffsetX, offsetY: s.screenOffsetY };
      },
      getScreenStatus: () => {
        const s = use3DStore.getState();
        return { mode: s.statusBarMode, time: s.statusBarTime, battery: s.statusBarBattery, signal: s.statusBarSignal };
      },
      onRenderer: (r) => { threeEngineRef.current = r; },
    });

    // Register with the same IRenderer contract the Pixi/R3F templates use, so
    // ExportDialog can extract/capture frames from this stage without knowing
    // which engine is behind it.
    const threeRenderer: IRenderer = {
      init: async () => {},
      resize: () => {},
      getFrameState: (f) => { useSceneStore.getState().setFrame(f); },
      renderFrame: (f) => {
        if (threeEngineRef.current) {
          threeEngineRef.current.renderFrame(f);
        } else {
          useSceneStore.getState().setFrame(f);
        }
      },
      captureFrame: (f) => {
        if (threeEngineRef.current) {
          return threeEngineRef.current.captureFrame(f);
        }
        useSceneStore.getState().setFrame(f);
        const c = canvasRef.current;
        return c ? c.toDataURL('image/jpeg', 0.92) : '';
      },
      setCaptureScale: (k) => {
        if (threeEngineRef.current) {
          threeEngineRef.current.setCaptureScale(k);
        }
      },
      extractCanvas: () => canvasRef.current!,
      syncAssets: () => {},
      destroy: () => {},
    };
    setRendererInstance(threeRenderer);

    return () => {
      setRendererInstance(null);
      dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectId, modelUrl]);   // reload when effect or uploaded model changes

  // ── Drive the timeline clock while playing in 3D / Mockup mode — PreviewStage
  // (which normally advances useSceneStore's frame) is unmounted here. ──
  const playing = useSceneStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let lastTime = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const st = useSceneStore.getState();
      const totalFrames = Math.max(1, Math.round(st.duration * st.fps));
      const nextFrame = (st.frame + dt * st.fps) % totalFrames;
      st.setFrame(nextFrame);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // ── CSS layers derived from params (only those the effect declares) ──
  const num = (k: string, d = 0) => Number(p[k] ?? d);
  const sat = num('saturation', 100);
  const gray = num('grayscale', 0);
  const tint = String(p.tint ?? '#00ff41');

  const bright = num('brightness', 100);
  const contrast = num('contrast', 100);

  // Applied to the <canvas> alone, not the wrapper — so the Adjustments group
  // grades the rendered device and leaves the stage backdrop untouched.
  const filters: string[] = [];
  if (has('brightness') && bright !== 100) filters.push(`brightness(${bright}%)`);
  if (has('contrast') && contrast !== 100) filters.push(`contrast(${contrast}%)`);
  if (has('saturation') && sat !== 100) filters.push(`saturate(${sat}%)`);
  if (has('grayscale') && gray > 0) filters.push(`grayscale(${gray}%)`);

  const canvasStyle: React.CSSProperties = {
    filter: filters.length ? filters.join(' ') : undefined,
    // A <canvas> is a REPLACED element: with `position:absolute; inset:0` and
    // `width:auto`, CSS resolves its used size from the intrinsic (attribute)
    // size and drops the over-constrained edge — so it does NOT stretch to the
    // stage. Stating 100%/100% is what lets the backing store be larger than
    // the box (the supersample the mockup renderer relies on) instead of the
    // canvas simply overflowing and being clipped.
    width: '100%',
    height: '100%',
    // `.three3d-layer` carries opacity .5 from the ASCII look it was ported
    // from. A photoreal device mockup must composite at full strength.
    ...(effectId === 'mockup' ? { opacity: 1 } : null),
  };

  const bgFill = use3DStore((s) => s.bgFill);
  const background =
    bgFill.type === 'linear' ? `linear-gradient(to top, ${bgFill.c1} 0%, ${bgFill.c2} 100%)`
    : bgFill.type === 'radial' ? `radial-gradient(130% 130% at 50% 50%, ${bgFill.c1} 0%, ${bgFill.c2} 100%)`
    : bgFill.c1;
  const stageStyle: React.CSSProperties = { background };

  // Same "contain" fit a <canvas>/<img> gets for free from object-fit, ported
  // to a plain div via container query units: whichever axis would overflow
  // first binds first, so the box always fits stage-wrap without distortion.
  const ratio = width / height;

  return (
    // fresh canvas per effect — ASCII uses a 2D context, Cartoon a WebGL one,
    // and a single <canvas> can't switch context types. Wrapped so the stage
    // keeps the scene's own aspect ratio (matches the Pixi stage) instead of
    // stretching to fill whatever box the layout gives it.
    <div className="stage-wrap" style={{ containerType: 'size' } as React.CSSProperties}>
      <div
        className="three3d-stage stage-canvas"
        ref={stageRef}
        style={{
          ...stageStyle,
          position: 'relative',
          width: `min(100cqw, ${100 * ratio}cqh)`,
          height: `min(100cqh, ${100 / ratio}cqw)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <canvas key={effectId} className="three3d-layer three3d-ascii" ref={canvasRef} style={canvasStyle} />

        {has('tint') && (
          <div
            className="three3d-lens three3d-tint"
            style={{ background: tint, opacity: num('tintOpacity', 0) / 100, mixBlendMode: (p.blend as any) ?? 'hue' }}
          />
        )}
        {has('vignette') && <div className="three3d-lens three3d-vignette" style={{ opacity: num('vignette', 0) / 100 }} />}
        {has('enableMask') && isOn(p.enableMask) && <div className="three3d-lens three3d-mask" />}
        {has('dotGrid') && isOn(p.dotGrid) && <div className="three3d-lens three3d-dotgrid" />}

        {rig && <ViewGizmo rig={rig} />}
      </div>
    </div>
  );
}
