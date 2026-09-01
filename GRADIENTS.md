# Unified gradient system

The 2D canvas, WebGL canvas, Cartoon background, Mockup background and 3D part
fills all consume `GradientSpec` from `lib/gradient.ts`. Renderers may use a
native canvas gradient for Basic mode or the shared procedural rasterizer for
Advanced mode, but they must not define their own gradient document shape.

## Document contract

- Version: `2`.
- Modes: `basic`, `advanced`.
- Shapes: `linear`, `radial`, `conic`, `mesh`, `warped-field`, `twin-radial`.
- Stops: sorted for rendering, minimum 2, maximum 8, stable IDs.
- Angle convention: `0deg` runs left to right and increases clockwise in screen
  space. Renderer-specific angle conventions are converted at the boundary.
- Center, radius and 3D coordinates are normalized to `0..1`.
- 3D mappings: UV, object and screen. Object currently falls back to normalized
  object bounds; screen uses that same stable fallback for baked vertex fills.

Advanced ranges mirror the researched Pryzm controls:

| Control | Range | Meaning |
| --- | ---: | --- |
| Warp | 0–2 | Domain distortion |
| Flow | 0–1 | Seamless orbital drift over one clip |
| Scale | 0.4–4 | Procedural texture zoom |
| Detail | 0–6 | Noise octaves / fine structure |
| Contrast | 0.5–3 | Color transition sharpness |

## Backward compatibility

Old 2D scenes keep `background.gradient`, `color` and `color2`. Old 3D scenes
keep `FillSpec.type`, `c1` and `c2`. Hydration converts those fields into a v2
gradient in memory. Every v2 editor write mirrors its first/last stops and
linear/radial type back into the legacy fields, so older preview and project
code can still read a useful fallback.

No bulk rewrite runs when a project opens. The richer value is persisted only
through the normal autosave path after an edit.

## Editor behavior

- Basic exposes Linear and Radial.
- Advanced exposes every shape and the five procedural controls.
- Clicking the ramp adds an interpolated stop at that position.
- `+ Stop` splits the largest gap and interpolates its initial color.
- Stops drag horizontally, render in position order and retain their IDs.
- Reverse maps each stop position to `1 - position`.
- Presets replace the palette but never alter unrelated canvas/model settings.
- Part gradients stay collapsed until their preview swatch is opened; the
  background editor remains visible because it is the primary fill.

## Rendering and performance

Basic Linear/Radial uses native Canvas 2D interpolation at up to the logical
canvas resolution. Advanced fields use a 384px long-edge procedural texture and
are scaled by the GPU. Static gradients are signature-cached; only a non-zero
Flow value invalidates the texture as the timeline advances.

Flow follows a circular time path, so phase `0` and `1` are identical and video
loops do not jump. Grain remains a separate post-effect concern rather than a
field in the gradient document.

## Verification

`scripts/verify-gradients.cjs` pins legacy migration, stop bounds/order,
interpolation, radial endpoints, seamless Flow and legacy mirror fields. Run it
through `npm test`; production type/render integration is covered by
`npm run build` and browser checks on `/`, `/mockup` and `/3d`.
