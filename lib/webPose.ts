// ============================================================
//  WEB MODE — LayerTransform → CSS (SPIKE)
//  The 2D renderer hands a template's LayerTransform to a PIXI sprite
//  (lib/renderer.ts). This does the same job against a DOM element. The
//  mapping is direct — x/y → translate, rotation → rotate, scale → scale,
//  skew → skew, alpha → opacity, depth → z-index — which is the whole reason
//  the templates port to the DOM without being rewritten.
// ============================================================

import type { LayerTransform, TransformCtx } from './types';
import type { Template } from './types';
import type { LayoutMode } from '@/store/useWebStore';

const DEG = 180 / Math.PI;

/**
 * The pose to actually apply, given the layout mode.
 *
 * 'own' uses the template's pose as-is: the element is positioned from the
 * container centre, exactly like a sprite on the canvas.
 *
 * 'decorate' keeps the element where the user's CSS put it and applies only
 * what the template *changes over time* — its pose at `frame` relative to its
 * pose at frame 0. Without that subtraction a positional template would fling
 * the element to its absolute canvas coordinate (carousel's first card sits at
 * x ≈ -510) the instant motion started, which reads as a bug rather than a
 * design choice. Alpha is absolute in both modes: a template that fades a
 * layer means the layer to be faded.
 */
export function poseFor(
  template: Template,
  mode: LayoutMode,
  frame: number,
  index: number,
  count: number,
  values: Record<string, any>,
  ctx: TransformCtx,
): LayerTransform {
  const t = template.transform(frame, index, count, values, ctx);
  if (mode === 'own') return t;

  const rest = template.transform(0, index, count, values, ctx);
  return {
    x: t.x - rest.x,
    y: t.y - rest.y,
    // Scale and skew are multiplicative/additive about a rest pose that may
    // not be identity (carousel's featured card rests at 1.2), so normalize
    // against it rather than against 1.
    scale: rest.scale !== 0 ? t.scale / rest.scale : t.scale,
    scaleX: (t.scaleX ?? 1) / (rest.scaleX ?? 1),
    scaleY: (t.scaleY ?? 1) / (rest.scaleY ?? 1),
    rotation: t.rotation - rest.rotation,
    skewX: (t.skewX ?? 0) - (rest.skewX ?? 0),
    skewY: (t.skewY ?? 0) - (rest.skewY ?? 0),
    alpha: t.alpha,
    dim: t.dim,
    clip: t.clip,
    depth: t.depth,
  };
}

/** The CSS `clip-path` for a pose's clip, or '' when the card is whole. */
export function clipPathCss(t: LayerTransform): string {
  const c = t.clip;
  if (!c) return '';
  const pc = (n: number) => `${(Math.max(0, Math.min(1, n)) * 100).toFixed(2)}%`;
  if (c.x0 <= 0 && c.y0 <= 0 && c.x1 >= 1 && c.y1 >= 1) return '';
  return `inset(${pc(c.y0)} ${pc(1 - c.x1)} ${pc(1 - c.y1)} ${pc(c.x0)})`;
}

/** The CSS `transform` value for a pose. Order matches the sprite pipeline. */
export function transformCss(t: LayerTransform, mode: LayoutMode): string {
  // In 'own' the element is pinned at the container's centre via left/top 50%,
  // so it has to be pulled back by half its own size before the pose applies.
  const anchor = mode === 'own' ? 'translate(-50%, -50%) ' : '';
  const parts = [
    `${anchor}translate(${t.x.toFixed(2)}px, ${t.y.toFixed(2)}px)`,
    `rotate(${(t.rotation * DEG).toFixed(3)}deg)`,
    `scale(${(t.scale * (t.scaleX ?? 1)).toFixed(4)}, ${(t.scale * (t.scaleY ?? 1)).toFixed(4)})`,
  ];
  const sx = t.skewX ?? 0;
  const sy = t.skewY ?? 0;
  if (sx || sy) parts.push(`skew(${(sx * DEG).toFixed(3)}deg, ${(sy * DEG).toFixed(3)}deg)`);
  return parts.join(' ');
}

/** Apply a pose to an element. Only touches properties the mode owns. */
export function applyPose(el: HTMLElement, t: LayerTransform, mode: LayoutMode, i: number) {
  el.style.transform = transformCss(t, mode);
  el.style.opacity = String(t.alpha);
  // A receding card darkens rather than going see-through — same rule as the
  // sprite renderer, so an exported board matches the stage.
  const dim = Math.max(0, Math.min(1, t.dim ?? 0));
  if (dim > 0) el.style.filter = `brightness(${(1 - dim).toFixed(3)})`;
  else el.style.removeProperty('filter');
  // A wipe reveals a still card with a moving edge, so it clips rather than
  // moves — same rule as the sprite renderer's mask.
  const cp = clipPathCss(t);
  if (cp) el.style.clipPath = cp; else el.style.removeProperty('clip-path');
  el.style.zIndex = String(Math.round(t.depth * 1000 + i)); // stable tiebreak
  if (mode === 'own') {
    el.style.position = 'absolute';
    el.style.left = '50%';
    el.style.top = '50%';
    el.style.margin = '0';
  }
}

/** Undo everything applyPose set, so switching modes doesn't leave residue. */
export function clearPose(el: HTMLElement) {
  for (const p of ['transform', 'opacity', 'filter', 'clip-path', 'z-index', 'position', 'left', 'top', 'margin', 'transform-origin']) {
    el.style.removeProperty(p);
  }
}
