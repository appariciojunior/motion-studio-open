'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayerTransform, Template } from '@/lib/types';
import { defaultsFor, easingFor, layerCountFor } from '@/templates';
import { resolveEasing } from '@/lib/easing';

// Live template thumbnail: run the template's own transform at a fixed frame
// and render the resulting card layout as plain divs. Because it uses the real
// transform + declared defaults, thumbs always match the actual motion.
const THUMB_FRAME = 40;              // ~1.3s in — useful idle pose
const PREVIEW_FPS = 30;
const CTX_BASE = { fps: 30, width: 810, height: 1080, duration: 8, totalFrames: 240 }; // 3:4 preview space, nominal 8s clip
const TEX_LONG = 600;                 // placeholder long edge
const DRAW_BUDGET = 28;              // max cards a thumbnail paints; layout still uses the real count
const SPRITE_BASE = 340;

// The pose's clip as a CSS inset(), or undefined when the card is whole.
function clipPathFor(c: LayerTransform['clip']): string | undefined {
  if (!c) return undefined;
  if (c.x0 <= 0 && c.y0 <= 0 && c.x1 >= 1 && c.y1 >= 1) return undefined;
  const pc = (n: number) => `${(Math.max(0, Math.min(1, n)) * 100).toFixed(2)}%`;
  return `inset(${pc(c.y0)} ${pc(1 - c.x1)} ${pc(1 - c.y1)} ${pc(c.x0)})`;
}

interface CardPose {
  x: number; y: number; w: number; h: number;
  rotation: number; skewX: number; alpha: number; dim: number; z: number; r: number;
  clipPath?: string;
}

export default function TemplateThumb({
  template,
  autoPreview = false,
}: {
  template: Template;
  autoPreview?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(THUMB_FRAME);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Desktop previews follow hover/focus. Mobile groups can opt into autoplay;
  // an IntersectionObserver keeps off-screen cards at the cheap static pose.
  useEffect(() => {
    const root = rootRef.current;
    const card = root?.closest<HTMLElement>('.tpl-card');
    if (!card) return;

    let raf = 0;
    let running = false;
    let startedAt = 0;
    let lastFrame = -1;
    let hovered = false;
    let focused = false;
    let autoVisible = false;
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

    const reconcile = () => {
      if ((autoPreview && autoVisible) || hovered || focused) start();
      else stop();
    };

    const pointerEnter = () => { hovered = true; reconcile(); };
    const pointerLeave = () => { hovered = false; reconcile(); };
    const focusIn = () => { focused = true; reconcile(); };

    const stopAfterFocus = (event: FocusEvent) => {
      if (!card.contains(event.relatedTarget as Node | null)) {
        focused = false;
        reconcile();
      }
    };

    card.addEventListener('pointerenter', pointerEnter);
    card.addEventListener('pointerleave', pointerLeave);
    card.addEventListener('focusin', focusIn);
    card.addEventListener('focusout', stopAfterFocus);
    let observer: IntersectionObserver | null = null;
    if (autoPreview) {
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(([entry]) => {
          autoVisible = entry.isIntersecting;
          reconcile();
        }, { threshold: 0.05 });
        observer.observe(card);
      } else {
        autoVisible = true;
        reconcile();
      }
    }
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      card.removeEventListener('pointerenter', pointerEnter);
      card.removeEventListener('pointerleave', pointerLeave);
      card.removeEventListener('focusin', focusIn);
      card.removeEventListener('focusout', stopAfterFocus);
    };
  }, [autoPreview]);

  const poses = useMemo<CardPose[]>(() => {
    const v = defaultsFor(template.meta.id);
    const texAspect = template.meta.cardAspect === 'canvas'
      ? CTX_BASE.width / CTX_BASE.height
      : template.meta.cardAspect ?? 4 / 5;
    const texW = TEX_LONG * Math.min(1, texAspect);
    const texH = TEX_LONG * Math.min(1, 1 / texAspect);
    // The REAL count, asked of the template. It is a layout input, not a drawing
    // cost: lattice families derive their columns, rows and wrap period from it,
    // so clamping it here used to lay out a different grid than the stage —
    // measured at up to 2645px of divergence on Grid, on an 810px-wide canvas.
    // The draw budget is enforced further down instead, by showing fewer of the
    // correct cards.
    const count = layerCountFor(template.meta.id, v,
      { width: CTX_BASE.width, height: CTX_BASE.height, cardAspect: texAspect });
    const norm = SPRITE_BASE / TEX_LONG;
    const ease = resolveEasing(easingFor(template.meta.id));
    const ctx = {
      ...CTX_BASE,
      ease,
      easedPhase: (phase: number) => { const b = Math.floor(phase); return b + ease(phase - b); },
      // The thumbnail draws every card at the placeholder proportions, so a
      // lattice template has to space them by THAT shape or its gutters come out
      // uneven here even when they are right on the stage.
      cardAspect: texAspect,
    };
    const out: CardPose[] = [];
    for (let i = 0; i < count; i++) {
      const t = template.transform(frame, i, count, v, ctx);
      const w = texW * norm * t.scale * (t.scaleX ?? 1);
      const h = texH * norm * t.scale * (t.scaleY ?? 1);
      out.push({
        x: t.x, y: t.y, w, h,
        rotation: t.rotation,
        skewX: t.skewX ?? 0,
        alpha: t.alpha,
        dim: Math.max(0, Math.min(1, t.dim ?? 0)),
        clipPath: clipPathFor(t.clip),
        z: Math.round(t.depth * 1000 + i),
        r: (Math.min(w, h) / 2) * Math.max(0, Math.min(1, (v.cornerRadius ?? 0) / 100)),
      });
    }

    // Draw budget. A thumbnail is a few hundred px across and the catalogue runs
    // to 140 cards, so keep the DOM bounded — but drop whole cards rather than
    // move them. Invisible ones go first (a scattered flicker field like
    // Parallax has most of its cards at alpha 0 at any instant, and picking
    // purely by distance from centre could fill the whole budget with
    // currently-invisible cards while every actually-visible one gets cut for
    // sitting farther out), then off-canvas ones, then the furthest from
    // centre — so what survives is what a viewer would actually have seen.
    if (out.length <= DRAW_BUDGET) return out;
    const halfW = CTX_BASE.width / 2, halfH = CTX_BASE.height / 2;
    const offCanvas = (p: CardPose) =>
      Math.abs(p.x) - p.w / 2 > halfW || Math.abs(p.y) - p.h / 2 > halfH;
    return out
      .map((p, i) => ({ p, i, invisible: p.alpha < 0.02 ? 1 : 0, off: offCanvas(p) ? 1 : 0, d: Math.hypot(p.x, p.y) }))
      .sort((a, b) => a.invisible - b.invisible || a.off - b.off || a.d - b.d)
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
            aspectRatio: `${Math.max(0.001, p.w)} / ${Math.max(0.001, p.h)}`,
            left: `${50 + (p.x / CTX_BASE.width) * 100}%`,
            top: `${50 + (p.y / CTX_BASE.height) * 100}%`,
            transform: `translate(-50%, -50%) rotate(${p.rotation}rad) skewX(${p.skewX}rad)`,
            opacity: p.alpha,
            // Mirrors the renderer: a receding card darkens, it does not
            // go see-through.
            filter: p.dim > 0 ? `brightness(${(1 - p.dim).toFixed(3)})` : undefined,
            // Mirrors the renderer's mask: a wipe clips a still card.
            clipPath: p.clipPath,
            zIndex: p.z,
            borderRadius: `${Math.max(1, (p.r / p.w) * 100)}%`,
          }}
        />
      ))}
    </div>
  );
}
