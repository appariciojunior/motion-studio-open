# Remaining catalogue loop audit

Scope: Spiral Images, Ring/Globe, Carousel 3D, Dive and Gallery; 49 registered presets including legacy entries. Changes are local and preserve the earlier infinite-field fixes.

## Confirmed and corrected

- Dive 01-04: the visible crossfade window straddles wrapped phase zero. Zoom/spin previously reset at peak opacity. Unwrapped age now progresses continuously; stable draw ordering also removes the equal-opacity ordering switch. Anchor offsets scale with resolution.
- Dive Zoom/Recede: Edge Fade below 100 left an image visible while its exponential scale recycled. A short mandatory handoff envelope now reaches zero independently of the stylistic fade. Sizes and offsets scale with output resolution.
- Gallery: grow-in spawned a nonzero-sized opaque image; entry now starts at zero opacity. Hold Time 0 also skipped directly to the 15% drift endpoint; the exit now starts at the actual entry endpoint. Sizes, travel offsets and output offsets scale consistently.
- Ring/Globe/Carousel: fractional cycles ended at a different orientation. Full turns/tours are now enforced while preserving authored sub-turn beats when they already close (e.g. six 60-degree moves). Stepped globe motion completes the whole selected stop list.
- Carousel 3D: the lens was multiplied by output height on top of scene scaling. It now remains in fixed authoring units, calibrated to the prior 1080px canvas. Higher resolution keeps the same framing.
- Spiral Images: sizes and offsets now preserve composition when resolution changes. Small endpoint fades protect recycling even with zero Fade and zero Taper. This does not resolve the separate timeline policy below.

## Pending: Spiral timeline policy

The current low-speed contract intentionally uses a free-running rate. Speed 0.1 means 0.03 complete path traversals per second, so a distinct image requires about 33.33 seconds to return to its start. An 8-second clip cannot preserve that speed and also close the same image sequence. A follow-up decision is required: extend duration to preserve the requested rate, or quantize speed to the chosen duration. This PR deliberately preserves the existing slow-speed contract. The known timeline seam remains in these four Spiral IDs; do not describe the entire catalogue as loop-closed.

## Verification

- New `scripts/verify-catalogue-loops.cjs`: 49 presets, 79,972 assertions, fractional cycles, default/stressed settings, every lifecycle handoff including half steps, camera and geometry invariance at twice the resolution, zero-hold Gallery, plus Spiral low-speed preservation and path-end recycling. Spiral timeline closure is explicitly reported as pending rather than asserted as passing.
- Final TypeScript and production webpack build passed; the temporary QA route is absent from production.
- Complete existing `npm test` suite passed; the new suite was also run separately and is now appended to `npm test`.
- Browser used actual Pixi and Three renderers with numbered decoded image assets, 481 sampled boundaries per scene over two loops, deterministic repeated pixels and captures.
- Before correction: mean channel discontinuity (0-255) reached 7.57/14.65 in Dive 02/04, 75.74 in Dive Zoom with Fade 0, 28.85 in Ring, 25.10/34.81 in continuous/stepped Globe, and 11.54 in Carousel. Spiral default had a 9.35 timeline seam.
- After correction: all ten non-Spiral browser cases passed; maximum observed discontinuity was below 0.484 in Pixi and 0.217 in Three. Captures were visually inspected. The Gallery defects were additionally verified at exact per-card handoffs, including noninteger frames; a full-frame average alone can miss a small popping card.
- Pixel tests preserve logical portrait/4K landscape dimensions with reduced backing resolution. They do not test video encoding or sustained native 4K performance.

Reproduction fixture: `scripts/fixtures/catalogue-loops-renderer-page.tsx`. Temporarily copy to `app/loop-qa/page.tsx`, run the development server, open a fresh `/loop-qa` page (Pixi) or `/loop-qa?spatial` (Three), and click Run verification. Remove the route afterwards. The fixture uses isolated in-memory scenes and does not load or save user projects.

## PR integration validation

The changes were isolated onto `origin/main` at `0dc3da2` in a dedicated worktree. The complete current-main test command passed there, including documentation, gated-section, crop, eight-effect and all three new continuity suites. Prior browser results above were collected during implementation in the original editor checkout; the unchanged main-branch thumbnail lifecycle and unrelated updates are preserved in the PR.

The final production webpack build and its TypeScript check also passed in the isolated PR worktree; the initial font-fetch failure was resolved by the network-enabled retry.
