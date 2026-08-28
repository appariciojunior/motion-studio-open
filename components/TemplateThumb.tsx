'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayerTransform, Template } from '@/lib/types';
import { defaultsFor, easingFor, layerCountFor } from '@/templates';
import { resolveEasing } from '@/lib/easing';
import { magnification, matrix3dString, pose3dMatrix, thumbPerspective } from '@/lib/thumbPose3d';

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
  // The card's own box, before the pose's 2x2 — always positive.
  x: number; y: number; w: number; h: number;
  // That 2x2, in pixi's convention, handed to CSS as a matrix().
  a: number; b: number; c: number; d: number;
  // Drawn half-extents, so the draw budget can tell what is off-canvas.
  ex: number; ey: number;
  alpha: number; dim: number; z: number; r: number;
  clipPath?: string;
  // Set only on the webgl path: the full 3D pose as a CSS matrix3d(), which
  // replaces the 2x2 entirely. See lib/thumbPose3d.
  matrix3d?: string;
  // Grey tone for this card, and the shadow the pose asks for. Every card used
  // to be the same #c9c9c9, so a stack of them read as one blob and the
  // presets that separate their cards with thickness and a cast shadow — the
  // Stickers especially — showed nothing at all.
  tone: string;
  shadow?: string;
}

// Draw budget. A thumbnail is a few hundred px across and the catalogue runs to
// 140 cards, so keep the DOM bounded — but drop whole cards rather than move
// them. Invisible ones go first (a scattered flicker field like Parallax has
// most of its cards at alpha 0 at any instant, and picking purely by distance
// from centre could fill the whole budget with currently-invisible cards while
// every actually-visible one gets cut for sitting farther out), then off-canvas
// ones, then the furthest from centre — so what survives is what a viewer would
// actually have seen.
function applyBudget(out: CardPose[]): CardPose[] {
  if (out.length <= DRAW_BUDGET) return out;
  const halfW = CTX_BASE.width / 2, halfH = CTX_BASE.height / 2;
  const offCanvas = (p: CardPose) =>
    Math.abs(p.x) - p.ex > halfW || Math.abs(p.y) - p.ey > halfH;
  return out
    .map((p, i) => ({ p, i, invisible: p.alpha < 0.02 ? 1 : 0, off: offCanvas(p) ? 1 : 0, d: Math.hypot(p.x, p.y) }))
    .sort((a, b) => a.invisible - b.invisible || a.off - b.off || a.d - b.d)
    .slice(0, DRAW_BUDGET)
    .sort((a, b) => a.i - b.i)
    .map((e) => e.p);
}

// A card's own grey. Walking by the golden ratio spreads the tones so that
// NEIGHBOURING cards differ (a plain ramp gives adjacent cards near-identical
// values, which is the case that needs separating), stays deterministic so a
// previewing thumbnail does not shimmer, and holds to neutral greys — the
// palette has no accent colour to borrow and a thumbnail is not the place to
// invent one.
function toneFor(index: number): string {
  const t = (index * 0.6180339887) % 1;
  return `hsl(0 0% ${(63 + t * 29).toFixed(1)}%)`;
}

// What the stage spends light on, said in CSS. `thickness` gives a card a real
// edge and `shadowStrength` a cast shadow; without either, a pale card on a
// pale field has no boundary. Scaled by the card's drawn width so a thumbnail
// a few hundred px across gets a proportionate shadow rather than a smudge.
function shadowFor(thickness: number, strength: number, widthPct: number): string | undefined {
  const lift = Math.max(thickness > 0.05 ? 0.35 : 0, Math.min(1, strength));
  if (lift <= 0.02) return undefined;
  const spread = Math.max(1, widthPct * 0.06);
  return `0 ${(spread * 0.5).toFixed(2)}px ${spread.toFixed(2)}px rgba(0,0,0,${(0.45 * lift).toFixed(3)})`;
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
  // A CSS 3D transform is measured in the element's own pixels, and the
  // template poses in preview pixels, so the webgl path needs the ratio between
  // them. Measured rather than assumed: the thumbnail is fluid.
  const [scale, setScale] = useState(0);

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

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const read = () => setScale(el.getBoundingClientRect().width / CTX_BASE.width);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { poses, perspectivePx } = useMemo<{ poses: CardPose[]; perspectivePx: number }>(() => {
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
    // Eye distance, derived the same way renderer3d derives its camera, then
    // taken into thumbnail pixels along with every other length.
    const { perspective, gain } = thumbPerspective(template, v, ctx);
    const k = scale > 0 ? scale : 0.28; // 0.28 only for the first paint
    const perspectivePx = perspective * k;

    const out: CardPose[] = [];

    // ---- the webgl path ----
    // 119 of the 271 catalogue presets pose through transform3d, and this used
    // to call transform() for all of them — so 44% of the thumbnails drew the
    // 2D fallback's geometry instead of the one the stage draws. The camera is
    // frontal and centred, so CSS perspective reproduces the projection exactly
    // (lib/thumbPose3d explains why, and the flip conjugation it needs).
    if (template.meta.engine === 'webgl' && template.transform3d) {
      for (let i = 0; i < count; i++) {
        const t = template.transform3d(frame, i, count, v, ctx);
        // The gain applies to the drawn size too: if the pose grows and the
        // card does not, the layout spreads without the cards following.
        const w = texW * norm * t.scale * gain;
        const h = texH * norm * t.scale * gain;
        const mag = magnification(perspective, t.z);
        // Behind the eye: the stage clips it, so drop it rather than draw a
        // card that CSS would fold inside out.
        if (mag <= 0) continue;
        out.push({
          x: t.x, y: t.y, w, h,
          a: 1, b: 0, c: 0, d: 1,
          // Extents after perspective, so the draw budget still measures what
          // is actually on canvas.
          ex: (w * mag) / 2, ey: (h * mag) / 2,
          alpha: t.alpha,
          dim: Math.max(0, Math.min(1, t.dim ?? 0)),
          // Depth order has to be computed, not delegated. `transform-style:
          // preserve-3d` would let the browser sort these by real depth, but it
          // is defeated by the `overflow: hidden` the thumbnail needs to clip —
          // an overflow other than visible forces a flattened context. So each
          // card is flattened on its own and paint order comes from z-index.
          // Higher t.z is nearer the camera (magnification is D/(P-z)), so it
          // paints on top. Assigned as a rank further down.
          z: t.z,
          r: (Math.min(w, h) / 2) * Math.max(0, Math.min(1, (v.cornerRadius ?? 0) / 100)),
          matrix3d: matrix3dString(pose3dMatrix(t, k, gain)),
          tone: toneFor(i),
          shadow: shadowFor(t.thickness ?? 0, t.shadowStrength ?? 0, (w / CTX_BASE.width) * 100),
        });
      }
      // Turn the raw depths into a dense paint order. Using t.z directly would
      // hand CSS values in the thousands (and negatives, which z-index takes
      // but which then compete with the badge's own stacking).
      const byDepth = [...out].sort((a, b) => a.z - b.z);
      byDepth.forEach((p, rank) => { p.z = rank + 1; });
      return { poses: applyBudget(out), perspectivePx };
    }

    // ---- the 2D path ----
    for (let i = 0; i < count; i++) {
      const t = template.transform(frame, i, count, v, ctx);
      const w = texW * norm * t.scale;
      const h = texH * norm * t.scale;
      // A pose is rotation + skew + a scale per axis, and the renderer that
      // defines what those four mean is pixi: its Container builds
      //   (a, b) = ( cos(rotation + skewY), sin(rotation + skewY)) * scaleX
      //   (c, d) = (-sin(rotation - skewX), cos(rotation - skewX)) * scaleY
      // Building the same pose out of CSS `rotate() skewX()` is NOT the same
      // parameterization: CSS skewX shears the box, so its second column comes
      // out along the right direction but 1/cos(skewX) too long, and a pose
      // whose skew passes 90 degrees (a card showing its back — half of any
      // Spinner belt at any instant) inverts instead. Measured against the
      // exact parallelogram on an 810x1080 preview, that mapping was off by
      // 157px on Spinner 01 and by more than the canvas on Hinge 04, while
      // negative heights collapsed those cards to a 0.001px hairline. Handing
      // the 2x2 straight to matrix() reproduces every pose exactly and costs
      // nothing; the families that only ever skew a few degrees (Ticker,
      // Coverflow) move by under 7px.
      const sx = t.scaleX ?? 1, sy = t.scaleY ?? 1;
      const rs = t.rotation + (t.skewY ?? 0), rk = t.rotation - (t.skewX ?? 0);
      const a = Math.cos(rs) * sx, b = Math.sin(rs) * sx;
      const c = -Math.sin(rk) * sy, d = Math.cos(rk) * sy;
      out.push({
        x: t.x, y: t.y, w, h, a, b, c, d,
        ex: (Math.abs(a) * w + Math.abs(c) * h) / 2,
        ey: (Math.abs(b) * w + Math.abs(d) * h) / 2,
        alpha: t.alpha,
        dim: Math.max(0, Math.min(1, t.dim ?? 0)),
        clipPath: clipPathFor(t.clip),
        z: Math.round(t.depth * 1000 + i),
        r: (Math.min(w, h) / 2) * Math.max(0, Math.min(1, (v.cornerRadius ?? 0) / 100)),
        // No shadow on this path: a 2D pose carries no thickness or shadow
        // strength to honour, and inventing one would say something about the
        // preset that the stage does not.
        tone: toneFor(i),
      });
    }

    return { poses: applyBudget(out), perspectivePx };
  }, [frame, template, scale]);

  // scale preview space → thumbnail space (thumb is 3:4 like CTX)
  return (
    <div
      ref={rootRef}
      className={`tpl-thumb ${isPreviewing ? 'is-previewing' : ''}`}
      aria-hidden="true"
      // The eye distance the cards were projected against. Only set on the
      // webgl path; a 2D pose has no depth and would gain nothing but risk.
      style={poses[0]?.matrix3d ? { perspective: `${perspectivePx.toFixed(2)}px` } : undefined}
    >
      {poses.map((p, i) => (
        <div
          key={i}
          className="tpl-thumb-el"
          style={{
            width: `${(p.w / CTX_BASE.width) * 100}%`,
            aspectRatio: `${Math.max(0.001, p.w)} / ${Math.max(0.001, p.h)}`,
            // On the webgl path the position is INSIDE the matrix and must not
            // also be here: left/top do not go through the perspective divide,
            // so applying both put every card at twice its offset from centre
            // and with no foreshortening.
            left: p.matrix3d ? '50%' : `${50 + (p.x / CTX_BASE.width) * 100}%`,
            top: p.matrix3d ? '50%' : `${50 + (p.y / CTX_BASE.height) * 100}%`,
            transform: p.matrix3d
              ? `translate(-50%, -50%) ${p.matrix3d}`
              : `translate(-50%, -50%) matrix(${p.a.toFixed(5)}, ${p.b.toFixed(5)}, ${p.c.toFixed(5)}, ${p.d.toFixed(5)}, 0, 0)`,
            background: p.tone,
            boxShadow: p.shadow,
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
