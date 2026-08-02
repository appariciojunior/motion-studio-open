'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Template } from '@/lib/types';
import { defaultsFor, easingFor } from '@/templates';
import { resolveEasing } from '@/lib/easing';

// Live template thumbnail: run the template's own transform at a fixed frame
// and render the resulting card layout as plain divs. Because it uses the real
// transform + declared defaults, thumbs always match the actual motion.
const THUMB_FRAME = 40;              // ~1.3s in — useful idle pose
const PREVIEW_FPS = 30;
const CTX_BASE = { fps: 30, width: 810, height: 1080, duration: 8, totalFrames: 240 }; // 3:4 preview space, nominal 8s clip
const TEX_W = 480, TEX_H = 600;      // placeholder texture proportions
const DRAW_BUDGET = 28;              // max cards a thumbnail paints; layout still uses the real count
const SPRITE_BASE = 340;

interface CardPose {
  x: number; y: number; w: number; h: number;
  rotation: number; skewX: number; alpha: number; z: number; r: number;
}

export default function TemplateThumb({ template }: { template: Template }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(THUMB_FRAME);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Only the hovered or keyboard-focused card gets an animation loop. Every
  // other thumbnail remains a cheap static pose.
  useEffect(() => {
    const root = rootRef.current;
    const card = root?.closest<HTMLElement>('.tpl-card');
    if (!card) return;

    let raf = 0;
    let running = false;
    let startedAt = 0;
    let lastFrame = -1;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const tick = (now: number) => {
      if (!running) return;
      const nextFrame = Math.floor(((now - startedAt) / 1000) * PREVIEW_FPS) % CTX_BASE.totalFrames;
      if (nextFrame !== lastFrame) {
        lastFrame = nextFrame;
        setFrame(nextFrame);
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running || reducedMotion.matches) return;
      running = true;
      startedAt = performance.now();
      lastFrame = -1;
      setIsPreviewing(true);
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      setIsPreviewing(false);
      setFrame(THUMB_FRAME);
    };

    const stopAfterFocus = (event: FocusEvent) => {
      if (!card.contains(event.relatedTarget as Node | null)) stop();
    };

    card.addEventListener('pointerenter', start);
    card.addEventListener('pointerleave', stop);
    card.addEventListener('focusin', start);
    card.addEventListener('focusout', stopAfterFocus);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      card.removeEventListener('pointerenter', start);
      card.removeEventListener('pointerleave', stop);
      card.removeEventListener('focusin', start);
      card.removeEventListener('focusout', stopAfterFocus);
    };
  }, []);

  const poses = useMemo<CardPose[]>(() => {
    const v = defaultsFor(template.meta.id);
    // The REAL count. It is a layout input, not a drawing cost: lattice families
    // derive their columns, rows and wrap period from it, so clamping it here
    // used to lay out a different grid than the stage — measured at up to
    // 2645px of divergence on Grid, on an 810px-wide canvas. The draw budget is
    // enforced further down instead, by showing fewer of the correct cards.
    const count = Math.max(1, Math.round(v.count ?? 6));
    const norm = SPRITE_BASE / Math.max(TEX_W, TEX_H);
    const ease = resolveEasing(easingFor(template.meta.id));
    const ctx = {
      ...CTX_BASE,
      ease,
      easedPhase: (phase: number) => { const b = Math.floor(phase); return b + ease(phase - b); },
      // The thumbnail draws every card at the placeholder proportions, so a
      // lattice template has to space them by THAT shape or its gutters come out
      // uneven here even when they are right on the stage.
      cardAspect: TEX_W / TEX_H,
    };
    const out: CardPose[] = [];
    for (let i = 0; i < count; i++) {
      const t = template.transform(frame, i, count, v, ctx);
      const w = TEX_W * norm * t.scale * (t.scaleX ?? 1);
      const h = TEX_H * norm * t.scale * (t.scaleY ?? 1);
      out.push({
        x: t.x, y: t.y, w, h,
        rotation: t.rotation,
        skewX: t.skewX ?? 0,
        alpha: t.alpha,
        z: Math.round(t.depth * 1000 + i),
        r: (Math.min(w, h) / 2) * Math.max(0, Math.min(1, (v.cornerRadius ?? 0) / 100)),
      });
    }

    // Draw budget. A thumbnail is a few hundred px across and the catalogue runs
    // to 140 cards, so keep the DOM bounded — but drop whole cards rather than
    // move them. Off-canvas ones go first, then the furthest from centre, so what
    // survives is what a viewer would actually have seen.
    if (out.length <= DRAW_BUDGET) return out;
    const halfW = CTX_BASE.width / 2, halfH = CTX_BASE.height / 2;
    const offCanvas = (p: CardPose) =>
      Math.abs(p.x) - p.w / 2 > halfW || Math.abs(p.y) - p.h / 2 > halfH;
    return out
      .map((p, i) => ({ p, i, off: offCanvas(p) ? 1 : 0, d: Math.hypot(p.x, p.y) }))
      .sort((a, b) => a.off - b.off || a.d - b.d)
      .slice(0, DRAW_BUDGET)
      .sort((a, b) => a.i - b.i)
      .map((e) => e.p);
  }, [frame, template]);

  // scale preview space → thumbnail space (thumb is 3:4 like CTX)
  return (
    <div ref={rootRef} className={`tpl-thumb ${isPreviewing ? 'is-previewing' : ''}`} aria-hidden="true">
      {poses.map((p, i) => (
        <div
          key={i}
          className="tpl-thumb-el"
          style={{
            width: `${(p.w / CTX_BASE.width) * 100}%`,
            aspectRatio: `${TEX_W} / ${TEX_H}`,
            left: `${50 + (p.x / CTX_BASE.width) * 100}%`,
            top: `${50 + (p.y / CTX_BASE.height) * 100}%`,
            transform: `translate(-50%, -50%) rotate(${p.rotation}rad) skewX(${p.skewX}rad)`,
            opacity: p.alpha,
            zIndex: p.z,
            borderRadius: `${Math.max(1, (p.r / p.w) * 100)}%`,
          }}
        />
      ))}
    </div>
  );
}
