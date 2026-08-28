'use client';

// The catalogue thumbnail for a 2D preset, rendered with the real Pixi.
//
// Replaces the div path for these presets. The divs were geometrically exact for
// position and the 2x2 — a suite pins that — but a thumbnail is supposed to look
// like the scene, and a div cannot: no rounded-corner mask, no wipe band, no
// tapered card, and the tone had to be invented because there was nothing to
// draw. Rendering through Pixi means the mask, the taper mesh and the skew
// semantics are the stage's own, not a mapping of them.
//
// Same lifecycle as the three thumbnail: a still <img> while idle, and the ONE
// shared canvas moved into this card while previewing.
import { useEffect, useRef, useState } from 'react';
import type { Template } from '@/lib/types';
import {
  CTX_BASE,
  attachCanvas2d,
  detachCanvas2d,
  getShared2d,
  renderThumbFrame2d,
  snapshotThumb2d,
} from '@/lib/thumbScene2d';

const THUMB_FRAME = 40;
// Half the clip rate, matching the other thumbnail path: 240 frames in 16s.
const PREVIEW_FPS = 15;

// Which card holds the shared canvas. Module-level: it belongs to the renderer.
let releaseActive: (() => void) | null = null;

export default function TemplateThumb2DGL({
  template,
  autoPreview = false,
  onUnavailable,
}: {
  template: Template;
  autoPreview?: boolean;
  // Called when Pixi cannot get a GL context. The div path is the last resort:
  // it draws no mask and no taper, but it needs no GPU at all.
  onUnavailable?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [still, setStill] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let alive = true;
    snapshotThumb2d(template, THUMB_FRAME)
      .then((src) => { if (alive) setStill(src); })
      // Never silent: a preset that cannot draw has to say so, or the card just
      // stays blank and the reason is invisible.
      .catch((err) => {
        console.warn(`[thumb2d] ${template.meta.id} sem contexto, caindo para divs:`, err);
        onUnavailable?.();
      });
    return () => { alive = false; };
  }, [template]);

  useEffect(() => {
    const host = hostRef.current;
    const card = host?.closest<HTMLElement>('.tpl-card');
    if (!card || !host) return;

    let raf = 0;
    let running = false;
    let startedAt = 0;
    let lastDrawn = -1;
    let hovered = false, focused = false, autoVisible = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      detachCanvas2d();
      setPreviewing(false);
      if (releaseActive === stop) releaseActive = null;
      snapshotThumb2d(template, THUMB_FRAME).then((src) => setStill(src)).catch(() => { /* noop */ });
    };

    const start = () => {
      if (running || reducedMotion.matches) return;
      releaseActive?.();      // there is only one canvas
      releaseActive = stop;
      running = true;
      startedAt = performance.now();
      lastDrawn = -1;
      setPreviewing(true);
      attachCanvas2d(host).then((ctx) => {
        const tick = (now: number) => {
          if (!running) return;
          const frame = Math.floor(((now - startedAt) / 1000) * PREVIEW_FPS) % CTX_BASE.totalFrames;
          // Draw only when the frame advances: rAF runs at the display rate while
          // the clip runs slower, and the renderer is shared.
          if (frame !== lastDrawn) {
            lastDrawn = frame;
            renderThumbFrame2d(ctx, template, frame);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }).catch(() => { running = false; setPreviewing(false); });
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

  // Warm the shared Application once, so the first hover does not pay for init.
  useEffect(() => { getShared2d().catch(() => { /* no GL */ }); }, []);

  return (
    <div
      ref={hostRef}
      className={`tpl-thumb ${previewing ? 'is-previewing' : ''}`}
      aria-hidden="true"
    >
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
