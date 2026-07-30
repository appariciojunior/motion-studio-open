'use client';

import { useEffect, useRef } from 'react';
import { SceneRenderer } from '@/lib/renderer';
import type { IRenderer } from '@/lib/rendererTypes';
import { setRendererInstance } from '@/lib/rendererInstance';
import { useSceneStore } from '@/store/useSceneStore';
import { getTemplate } from '@/templates';

export default function PreviewStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<IRenderer | null>(null);
  const rafRef = useRef<number>(0);
  const anchorTimeRef = useRef<number>(0);   // wall-clock at playback start
  const anchorFrameRef = useRef<number>(0);  // frame at playback start
  const lastRenderedFrameRef = useRef<number | null>(null);
  const dirtyRef = useRef<boolean>(true);    // a paused preview redraws only when this is set
  const lastPlayingRef = useRef<boolean>(true);

  const width = useSceneStore((s) => s.width);
  const height = useSceneStore((s) => s.height);
  // Engine flag drives a full canvas remount — a canvas can never be reused
  // across GL libraries (context attributes and loss behaviour differ).
  //
  // Layer stacking is a 2D compositing feature: only the Pixi renderer draws a
  // container per track. So a stack of two or more layers stays on Pixi even if
  // the selected track's template is webgl — that template falls back to its own
  // 2D `transform`, which every template provides. Otherwise selecting a webgl
  // layer would swap in the single-motion 3D renderer and the other layers would
  // vanish.
  const engine = useSceneStore((s) =>
    s.tracks.length > 1 ? 'pixi' : getTemplate(s.activeTemplateId).meta.engine ?? 'pixi',
  );

  useEffect(() => {
    let mounted = true;
    let renderer: IRenderer | null = null;

    // Render only when there's something new to show: while playing (frame
    // advancing), or once after any state/texture change while paused. An idle
    // paused preview draws nothing — no wasted GPU/CPU at 60fps on a still image.
    const loop = () => {
      const st = useSceneStore.getState();

      // freeze/resume card video decoding together with the timeline
      if (st.playing !== lastPlayingRef.current) {
        lastPlayingRef.current = st.playing;
        if (st.playing) rendererRef.current?.resumeVideos?.();
        else rendererRef.current?.pauseVideos?.();
        dirtyRef.current = true;
      }

      if (st.playing) {
        const now = performance.now();
        if (anchorTimeRef.current === 0) {
          anchorTimeRef.current = now;
          anchorFrameRef.current = st.frame;
        }
        const elapsed = (now - anchorTimeRef.current) / 1000;
        const total = Math.max(1, Math.round(st.duration * st.fps));
        const frame = Math.floor(anchorFrameRef.current + elapsed * st.fps) % total;
        // Compare against the frame we actually rendered, rather than the
        // store value. Store updates are batched and can lag behind the clock;
        // using st.frame here can reset videos more than once per loop and
        // makes them appear to jump backwards/forwards.
        if (lastRenderedFrameRef.current !== null && frame < lastRenderedFrameRef.current) {
          rendererRef.current?.restartVideos?.(); // clip wrapped — 'hold' videos restart with it
        }
        lastRenderedFrameRef.current = frame;
        if (frame !== st.frame) st.setFrame(frame);
        rendererRef.current?.renderFrame(frame);
      } else {
        anchorTimeRef.current = 0;
        lastRenderedFrameRef.current = null;
        if (dirtyRef.current) {
          dirtyRef.current = false;
          rendererRef.current?.renderFrame(st.frame);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    // any store change (control tweak, scrub, asset/effect/bg edit) means the
    // paused preview must redraw once
    const unsub = useSceneStore.subscribe(() => { dirtyRef.current = true; });

    (async () => {
      if (engine === 'webgl') {
        // three stays out of the bundle for 2D-only sessions
        const { SceneRenderer3D } = await import('@/lib/renderer3d');
        renderer = new SceneRenderer3D();
      } else {
        renderer = new SceneRenderer();
      }
      // async texture loads (images/videos) also need a redraw when they arrive
      renderer.onDirty = () => { dirtyRef.current = true; };
      await renderer.init(canvasRef.current!);
      if (!mounted) { renderer.destroy(); return; }
      rendererRef.current = renderer;
      setRendererInstance(renderer);
      dirtyRef.current = true;
      lastPlayingRef.current = useSceneStore.getState().playing;
      rafRef.current = requestAnimationFrame(loop);
    })();

    return () => {
      mounted = false;
      unsub();
      cancelAnimationFrame(rafRef.current);
      setRendererInstance(null);
      rendererRef.current = null;
      renderer?.destroy();
    };
  }, [engine]);

  // live resize on aspect/fps-driven dimension changes
  useEffect(() => {
    rendererRef.current?.resize(width, height);
    dirtyRef.current = true; // canvas resized — redraw even if paused
  }, [width, height]);

  return (
    <div className="stage-wrap">
      <canvas key={engine} ref={canvasRef} className="stage-canvas" />
    </div>
  );
}
