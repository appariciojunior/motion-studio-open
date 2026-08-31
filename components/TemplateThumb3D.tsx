'use client';

// The catalogue thumbnail for a webgl preset, rendered with real three.
//
// Kept as its own component rather than a branch inside TemplateThumb because
// the two have nothing in common at runtime: the 2D path poses divs and holds no
// GPU resources, this one shares a single renderer with every other card. The 2D
// path also has a suite pinning it (verify-contexts), and folding this into it
// would put that under a conditional.
//
// Lifecycle, following the pattern MockupThumb established:
//   idle      → a still <img>, drawn once from the shared renderer
//   previewing→ the shared <canvas> is moved into THIS card and a rAF runs
// Only one card previews at a time, so there is one context and one loop no
// matter how long the catalogue gets.
import { useEffect, useRef, useState } from 'react';
import type { Template } from '@/lib/types';
import { frameColour, onThemeChange } from '@/lib/thumbStill';
import { cachedThumb, scheduleThumb } from '@/lib/thumbQueue';
import {
  CTX_BASE,
  attachCanvas,
  detachCanvas,
  renderThumbFrame,
  snapshotThumb,
} from '@/three3d/thumbScene';

const THUMB_FRAME = 40;   // ~1.3s in — the same idle pose the 2D path uses
const PREVIEW_FPS = 15;   // half the clip rate: 240 frames in 16s, not 8

// Which card currently owns the shared canvas. Module-level on purpose: it is a
// property of the renderer, not of any one component.
let releaseActive: (() => void) | null = null;

export default function TemplateThumb3D({
  template,
  autoPreview = false,
  onUnavailable,
}: {
  template: Template;
  autoPreview?: boolean;
  // Called when this card cannot get a GL context, so the parent can fall back
  // to the Pixi path instead of leaving an empty box.
  onUnavailable?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [still, setStill] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [themeVersion, setThemeVersion] = useState(0);

  useEffect(() => onThemeChange(() => setThemeVersion((n) => n + 1)), []);

  // The idle still: drawn once. The tones are built synchronously, so there is
  // nothing arriving late to redraw for.
  useEffect(() => {
    let alive = true;
    const key = `3d:${template.meta.id}:${THUMB_FRAME}:${frameColour()}`;
    setStill(cachedThumb(key));
    const scheduled = scheduleThumb(key, () => snapshotThumb(template, THUMB_FRAME));
    scheduled.promise
      .then((src) => { if (alive) setStill(src); })
      .catch((err) => {
        if (!alive) return;
        // Never silent, and never blank: a browser hands out a limited number of
        // GL contexts and this one can genuinely fail to get one (measured: five
        // catalogue pages open at once exhausts them). Say so, and let the parent
        // fall back to the Pixi path — a 2D pose of the preset is wrong, but an
        // empty card is worse and tells the reader nothing.
        console.warn(`[thumb3d] ${template.meta.id} sem contexto 3D, caindo para 2D:`, err);
        onUnavailable?.();
      });
    return () => { alive = false; scheduled.cancel(); };
  // `onUnavailable` is an inline fallback supplied by the parent. Depending on
  // its identity would reschedule the still after every state update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, themeVersion]);

  // Hover / focus / autoplay, same triggers as the 2D thumbnail.
  useEffect(() => {
    const host = hostRef.current;
    const card = host?.closest<HTMLElement>('.tpl-card');
    if (!card || !host) return;

    let raf = 0;
    let running = false;
    let startedAt = 0;
    let hovered = false, focused = false, autoVisible = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    let lastDrawn = -1;
    const tick = (now: number) => {
      if (!running) return;
      const frame = Math.floor(((now - startedAt) / 1000) * PREVIEW_FPS) % CTX_BASE.totalFrames;
      // Only draw when the frame actually advances. rAF fires at the display
      // rate (60Hz and up) while the clip runs at 30 — without this guard every
      // other draw is the same picture, on a shared renderer that other cards
      // are waiting for.
      if (frame !== lastDrawn) {
        lastDrawn = frame;
        renderThumbFrame(template, frame);
      }
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      detachCanvas();
      setPreviewing(false);
      if (releaseActive === stop) releaseActive = null;
      // Leave a still that matches where the animation stopped, so the card does
      // not jump back to frame 40 under the pointer.
      try { setStill(snapshotThumb(template, THUMB_FRAME)); } catch { /* noop */ }
    };

    const start = () => {
      if (running || reducedMotion.matches) return;
      // Take the canvas from whoever holds it — there is only one.
      releaseActive?.();
      releaseActive = stop;
      running = true;
      startedAt = performance.now();
      attachCanvas(host);
      setPreviewing(true);
      raf = requestAnimationFrame(tick);
    };

    const reconcile = () => {
      if ((autoPreview && autoVisible) || hovered || focused) start();
      else stop();
    };

    const onEnter = () => { hovered = true; reconcile(); };
    const onLeave = () => { hovered = false; reconcile(); };
    const onFocusIn = () => { focused = true; reconcile(); };
    const onFocusOut = (e: FocusEvent) => {
      if (!card.contains(e.relatedTarget as Node | null)) { focused = false; reconcile(); }
    };

    card.addEventListener('pointerenter', onEnter);
    card.addEventListener('pointerleave', onLeave);
    card.addEventListener('focusin', onFocusIn);
    card.addEventListener('focusout', onFocusOut);

    let observer: IntersectionObserver | null = null;
    if (autoPreview && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(([entry]) => {
        autoVisible = entry.isIntersecting;
        reconcile();
      }, { threshold: 0.05 });
      observer.observe(card);
    }

    return () => {
      stop();
      observer?.disconnect();
      card.removeEventListener('pointerenter', onEnter);
      card.removeEventListener('pointerleave', onLeave);
      card.removeEventListener('focusin', onFocusIn);
      card.removeEventListener('focusout', onFocusOut);
    };
  }, [template, autoPreview]);

  return (
    <div
      ref={hostRef}
      className={`tpl-thumb ${previewing ? 'is-previewing' : ''}`}
      aria-hidden="true"
    >
      {/* Skeleton while the still is being rendered. Without it the box sits
          empty — aspect-ratio holds its size, so what shows is a bare frame,
          which reads as broken rather than as loading. */}
      {!previewing && !still && <div className="tpl-thumb-skeleton" />}
      {!previewing && still && (
        <img
          src={still}
          alt=""
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}
