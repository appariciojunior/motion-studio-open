# Infinite canvas continuity fix

## Changes

- Frames and Grid now distinguish the image motif from offscreen render copies. Increasing output dimensions no longer changes the motif or its timing.
- Authored sizes, gaps and offsets use a 1080px long edge. Rendering at twice the resolution preserves the composition.
- Coverage includes card bounds, tilt, offset and minimum Breath scale. The renderer culls offscreen copies without changing the requested gap.
- Repeated copies retain the same media, crop, placeholder label and depth tie-break. The Assets panel counts authored media slots, not renderer copies. Preset variants inherit these hooks.
- Frames stops at Speed 0.
- Helix 01–04 repeat the authored vertical structure outside the viewport instead of exposing a partially transparent end. Count and Pitch retain their spacing relationship.
- Helix 05–13 round the combined Cycles × Cycle Turn to whole revolutions, preventing a jump with fractional saved settings.
- Grid's existing zoom is labelled **Zoom Pulse**: it approaches and returns. It is deliberately still a pulse, not an endless zoom into nested images.

## Timing contract

A finite exported clip with distinct images must close a whole image motif. Frames/Helix Speed and Grid Steps therefore still select complete motif repetitions; the controls describe this quantization. Output resolution and viewport coverage do not participate in this rounding. Changing the image motif (e.g. card geometry) can still change the nearest supported repeat rate.

## Validation

- `npm test`: passed, including all existing suites and the new `scripts/verify-infinite.cjs`.
- TypeScript and `npm run build -- --webpack`: passed. The first sandboxed build could not fetch Google Fonts; the network-enabled retry completed successfully.
- New regression suite: 16 presets, portrait/landscape/square resolutions, large/small cards, offsets, reverse, Breath/Zoom, two cycles, zero speed, unchanged gaps and fractional 3D rotation settings.
- 17,158,390 numerical assertions; 6,308 visible recycling events matched to the correct replacement media.
- Browser: actual Pixi renderer, eight scenes, 481 boundary samples per scene covering two cycles. Subframe pixel changes stayed below 0.075 mean channel levels (0–255). Identical frames rendered identical pixels; captures were nonempty.
- Browser: actual Three renderer, Helix 05/09/13 with fractional rotation controls, three scenes. Boundary pixel changes stayed below 0.017 mean channel levels. Decoded coloured test images were present.
- Browser: Grid and flat Helix also passed through the Three fallback renderer used by mixed scenes (two additional cases).
- Browser measurements use reduced backing resolution while preserving the tested logical canvas dimensions, including 3840×2160. These are continuity tests, not a claim of full-resolution 4K real-time performance.

The manual renderer harness is saved with the test fixtures; it uses an isolated in-memory scene and does not load or save user projects. Video encoding itself is not exercised by the pixel harness; the deterministic capture path shared with export is exercised.

## Reproduce the browser check

Temporarily copy `scripts/fixtures/infinite-renderer-page.tsx` to `app/loop-qa/page.tsx` and run the development server. Open `/loop-qa` and click **Run verification**. Repeat with `?spatial` (Helix 3D) and `?mixed` (2D templates rendered through Three). The page shows numbered captures and machine-readable results. Remove the temporary route afterwards. The fixture uses generated image assets and does not require accounts or uploads.

## Extension: Parallax, Proximity and continuous fields

- Parallax 01-03 and Drift 01-04 now repeat their seeded image motif beyond the viewport. Camera travel is no longer clamped to a finite field; card sizes and offsets follow the output resolution.
- Proximity 01-05 repeat the field while preserving each image's scale, brightness and media identity. Continuous playback is now the Proximity 01 default. Explicit saved Build In/Out settings are still honored; turn this option off on existing scenes to remove the authored collapse.
- Proximity 05 now shrinks cards continuously to zero instead of teleporting small visible plates to the origin.
- Drift Scatter's recycling margin includes the vertical offset; Scatter and Warp retain their composition at higher output resolution.
- All 25 Ticker presets repeat complete strips outside the viewport, including with two images and Outer Fade disabled. Authored image counts stay separate from rendering copies.
- Ticker Tilt's 3D orientation now matches the plane used for card centres. Stable per-image polygon depth bias prevents coplanar overlaps from flickering during recycling. Pixi culling also includes affine skew and axis scaling.

### Extension validation

- `scripts/verify-infinite-fields.cjs`: 43 presets; default portrait, landscape and stressed settings; two cycles; media replacement identity, output-resolution invariance and Speed 0. More than 27 million assertions and 78,718 visible recycling events checked.
- The complete existing test suite passed after the field changes. The final field regression passed 27,547,474 assertions, including Ticker 3D plane normals. TypeScript and the final production webpack build passed; the temporary QA route is absent from the production route list.
- Browser: eight Pixi field/strip scenes plus two Proximity 05 scenes passed. Maximum boundary mean-channel difference was 0.095/255. Two Ticker Tilt scenes passed through the actual Three renderer after the coplanar-depth fix, with maximum difference below 0.003/255. Each scene checks 481 boundaries across two loops, deterministic repeated pixels and image capture.
- The editor was also opened on Proximity 01 using the existing image assets; the continuous default and rendered field were visually inspected.
- Reproduce using `scripts/fixtures/infinite-fields-renderer-page.tsx` as the temporary `/loop-qa` route. Default runs the eight 2D cases; `?proximity` runs Proximity 05; `?spatial` runs Ticker Tilt through Three. Start each run with a fresh page because destroying the renderer releases its canvas context.
- As above, logical 4K dimensions are rendered at reduced backing resolution for these pixel tests. Video encoding and sustained full-resolution 4K performance are outside this check.
