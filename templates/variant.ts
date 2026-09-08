import type { Template } from '@/lib/types';
import type { EasingSpec } from '@/lib/easing';

// A variant is the same template (controls + transform) shipped with different
// declared defaults — mirroring the reference tool's "Wheel 01…06" presets.
// Full-reset-on-switch then produces the preset look for free.
export function variant(
  base: Template,
  id: string,
  name: string,
  patch: Record<string, any> = {},
  // The curve is part of a preset, not decoration: the reference ships members
  // of one family on different curves on purpose, and for anything that steps
  // per item the curve is what separates a smooth glide from a settle. It lives
  // on meta rather than in `patch` because it is not a control, so without this
  // every variant silently inherited the family's default and the presets all
  // moved alike.
  easing?: EasingSpec,
  // Anything else on meta that is genuinely per-preset. `cardAspect` is the
  // case that forced this: the reference picks a card shape per preset — square
  // for most of its rings, portrait for some, 9:16 for one — and a shape is not
  // a control, so without this every variant inherited the family's and the
  // cards came out the wrong proportion in the ones that differ.
  meta?: Partial<Template['meta']>,
): Template {
  return {
    ...base,
    meta: { ...base.meta, id, name, ...(easing ? { defaultEasing: easing } : {}), ...(meta ?? {}) },
    controls: base.controls.map((c) =>
      patch[c.key] !== undefined ? { ...c, default: patch[c.key] } : c
    ),
    transform: base.transform,
    // `transform3d` has to come along too. `meta` is spread wholesale, so a
    // variant of a webgl template inherits engine: 'webgl' — but without the 3D
    // pose the renderer silently falls back to projecting the 2D transform, and
    // the variant renders flat while its base renders in 3D. That is what was
    // happening to Orbit 3D 02 and 03.
    transform3d: base.transform3d,
    // Same trap, same shape: a variant that loses `layerCount` silently falls
    // back to reading a `count` control the lattice families no longer have, so
    // every preset but the base rendered a 6-card wall.
    layerCount: base.layerCount,
    camera: base.camera,
  };
}
