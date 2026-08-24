# Motion Studio

A **studio for quick videos, GIFs and device mockups** that runs on your own
machine. Drop in images or video, pick one of **224 motion presets**, tweak live
controls, stack motion tracks on one timeline, and export MP4 / WebM / GIF —
encoded in the browser, no upload, no account.

![UI — light mode](ui-light.png)

![UI — dark mode](ui-dark.png)

## Try it live

**https://appariciojunior.github.io/motion-studio-open/**

The hosted demo is a static build (auto-deployed from `main` via GitHub Pages).
Every section, template, control and preview works in the browser — and so does
export, because MP4/WebM/GIF are now encoded client-side through WebCodecs. Only
the optional server-side ffmpeg route is absent there.

## Sections

The editor is one shell over six routed sections (`lib/navSections.ts`). They
share a single `EditorShell`, so switching sections swaps panels without tearing
down the WebGL context.

| Route | Section | What it is |
|---|---|---|
| `/library` | **Library** | The motion catalogue: 224 presets, search, favourites, saved custom presets. The default landing section. |
| `/mockup` | **Mockup** | Your artwork on a real 3D device (PBR materials, studio rig, room-environment reflections), with 16 camera/lighting animations. |
| `/projects` | **Projects** | Many named projects, each autosaved to its own storage key. |
| `/3d` | **3D** *(experimental)* | Whole-scene stylised shaders over an uploaded `.glb` — currently the Painted Shader. |
| `/web` | **Web** *(experimental)* | Paste your own React component, click elements to make them motion layers, export baked CSS `@keyframes`. |
| `/board` | **Boards** *(experimental)* | A DOM board of arranged cards with hover interaction layers, exportable as a drop-in React component. |

There is a separate touch layout (`components/MobileEditor.tsx`), a first-run
welcome dialog, and spotlight tours for the Library and Mockup sections.

## Stack

- **Next.js 16** (App Router, TypeScript, React 19)
- **PixiJS v8** — the 2D backend: sprites are image layers, filters are effects
- **three.js** — the 3D backend: real perspective for the WebGL template
  families, the device mockups, and the stylised shaders
- **Zustand** — one live state, read every frame by the render loop
- **WebCodecs + mp4-muxer / mediabunny / gifenc** — in-browser encoding
- **native ffmpeg** — optional server fallback (`/api/export`)

## Run

```bash
npm install
npm run dev          # → http://localhost:3000
```

That is all you need: export runs in the browser. Install ffmpeg only if you
also want the server route.

```bash
npm run dev:network  # serve on the LAN, to test on a phone
npm test             # the verification suites (see below)
npx tsc --noEmit     # the only required check before a PR
```

### Notifications: GitHub Updates locally, Vercel News when hosted

The bell above the theme button has two deployment-specific modes. A downloaded
checkout opened through `localhost` shows **Updates** from the official GitHub
`main` branch and offers an explicitly confirmed, fast-forward-only Git update.
The hosted Vercel application shows only the read-only **News** feed. It never
offers a Git action or exposes the local update endpoint.

Pull requests and branch pushes create Vercel Preview deployments but do not
alert production users. Editorial News is published only after the change
reaches the Vercel Production Branch and its Production deployment succeeds.
Open clients check `/api/news` every five minutes, compare item IDs with those
already seen in that browser, and show the red dot and panel when something
changes.

Editorial **News** items are maintained in `content/news.json`, newest first,
and are published with the next successful Production deployment. Each item
uses this shape (keep `id` stable and unique, and all customer-facing copy in
English):

```json
{
  "id": "new-feature-slug",
  "title": "A short customer-facing title",
  "body": "Optional detail shown inside the notification panel.",
  "url": "https://example.com/optional-details"
}
```

The Vercel News endpoint has no write operation or GitHub token. The local
Update endpoint is blocked on hosted deployments, LAN/public hostnames and
cross-site requests; it also refuses dirty, detached, diverged or non-`main`
checkouts. It never installs dependencies or restarts a process. Users can turn
alerts off (and back on) in their browser; the preference remains local to that
browser.

Because the experimental Web section runs pasted code in the same origin, only
paste code you trust: same-origin code can make the same local requests as the
editor UI. The Git updater still accepts only a clean fast-forward from the
configured repository, but the Web preview should be sandboxed before treating
hostile pasted components as safe.

The static GitHub Pages build omits the bell and API routes. Vercel's local
`.vercel/` project metadata is ignored by Git.

The experimental Web section intentionally executes the owner's pasted code in
the app's same-origin context. Only paste code you trust: like any same-origin
code, it shares the local app's browser privileges.

## Export

Everything below is captured from the same deterministic clock the preview uses,
so what you export is frame-for-frame what you saw.

| Format | Encoder | Container |
|---|---|---|
| **MP4** | WebCodecs `VideoEncoder`, H.264 High 5.1, hardware first | `mp4-muxer` |
| **WebM** | WebCodecs, VP9 profile 0 | `mediabunny` (MPL-2.0) |
| **GIF** | `gifenc`, per-frame 256-colour palette + Floyd–Steinberg dithering | — |

Resolutions: 720p, 1080p, 2K, 4K, or the exact pixel size of a custom canvas
(presets are defined by the **shortest** edge, so a vertical 1080p is
1080×1920). Both 3D sections export through the same dialog, because the Pixi
and three renderers implement one `IRenderer` capture contract.

### The server export route is off by default

`/api/export` needs a writable filesystem and a native ffmpeg, so on a
serverless host it fails at the first `mkdir` and never produced anything —
while still answering anonymous requests and reporting internal paths back. It
is therefore disabled unless a deployment opts in:

```bash
echo "ENABLE_EXPORT_API=1" >> .env.local   # local development
```

Before enabling it on anything reachable from the internet, note what it does
not have: no authentication, no rate limit, no cap on concurrent ffmpeg
processes, and no body-size limit on the frame upload — App Router route
handlers have no default, unlike the old 1 MB in Pages Router. It also feeds
uploaded bytes straight to the ffmpeg demuxer. Put it behind auth and a queue
first, and run ffmpeg as an unprivileged user with CPU and memory limits.

## Motion catalogue

**224 presets in 30 families**, all in `templates/` — one file per family, each
preset a bundle over the same pure transform (`templates/variant.ts`). 80 of them
render through the three.js backend with real perspective and a camera; 144
through Pixi. (The registry holds 253: the extra 29 stay addressable for saved
scenes but are withheld from the pickers until their look is ready.)

| Family | # | Motion |
|---|---|---|
| **Interactive Cards** | 3 | rings built from 13 curved image segments, adapted from `vogelino/three-interactive-cards` |
| **Spinner** | 14 | a belt of hinged paddles — Spinner, Hinge and Fan variants |
| **Stickers** | 9 | Poster peels a finite stack sheet by sheet from a corner; Stickers scatters them |
| **Runway** | 23 | cards glide past in a row; the featured card grows at centre |
| **Orbit** | 33 | cards circle an ellipse or a real ring — a drum you can film from the inside — plus in-plane Spin |
| **Orbit 3D** | 24 | true-3D rings: Pure, Carousel, Lightroom, Bloom, Stream, Showcase |
| **Shuffle** | 4 | a perspective deck — the front card lifts away, followers advance |
| **Ferris** | 14 | cards ride a rotating ellipse, a wheel that keeps them upright, or the crest of a very large arc |
| **Warp** | 4 | a starfield — cards drift out of depth toward the camera |
| **Takeover** | 7 | full-bleed images push in from an edge, hard-covering the last |
| **Wipe** | 4 | the image never moves; a straight edge uncovers it |
| **Spotlight** | 4 | one dominant featured card, neighbours peeking at the edges |
| **Pulse** | 12 | cards take turns at centre, cross-fading on a cycle |
| **Helix** | 4 | the camera corkscrews through a spiral staircase of cards |
| **Spiral** | 4 | a vortex — cards ride an Archimedean spiral into the centre |
| **Voyage** | 4 | a slow cinematic pan-and-zoom across a scattered collage |
| **Bounce** | 3 | cards drop and bounce on analytic physics (one-shot by design) |
| **Drift** | 6 | a multi-layer parallax wall, including the seeded Scatter field |
| **Parallax** | 3 | layered planes travelling at their own depth rates |
| **Dive** | 6 | Ken-Burns zoom slideshow, plus the infinite Zoom tunnel and Recede |
| **Bloom** | 4 | the image takes the frame by scale — no travel, no dissolve |
| **Frames** | 7 | a woven gallery wall: rows offset like brickwork, each drifting at its own rate |
| **Grid** | 5 | Frames' squared-off sibling — aligned columns stepping cell by cell |
| **Canvas** | 4 | a blank slate to build from, plus the Gallery spawn-settle-vanish ring |
| **Ticker** | 25 | a marquee band running edge to edge, including a WebGL Tilt and a stepped variant |
| **Isometric** | 3 | tiles on a 2:1 projected grid |
| **Coverflow** | 3 | a face-on centre card with the rest turned away into two packs |
| **Deck** | 3 | a depth conveyor whose cards turn as they pass through the centre |
| **Flip** | 6 | a stepped strip where the leaving card folds away on its hinge |
| **Box 3D** | 3 | cards on the faces of a prism — Box, Tumble, Drum |

**Seamless loops.** Every template quantizes its speed to a whole number of
motif cycles per clip via `loopCycles()` (`lib/motion.ts`), so frame 0 ≡ frame
`totalFrames` and exported clips never pop. Conveyors use `period = count` so
textures land back on their own slots. Templates that are one-shot by design
(Bounce) simply skip the helper. `meta.repeatAssets` lets high-count fields
cycle a small image set across hundreds of layers — 147 presets use it.

**Fidelity, not guesswork.** The families ported from reference tools were
transcribed from measurement, not screenshots: hooking the reference's own
canvas or scene graph, reading transform matrices, clip paths and shipped
constants, then fitting each preset against the numbers. The most recent four
families went further and were transcribed from the reference's own shipped
modules — its formulas read as source, its preset tables executed, then every
number checked against its live scene graph. `npm test` re-checks 30 fitted
presets plus the authored tables of all four ported families (Spinner 14,
Orbit 24, Arc 3, Wheel 5) on every run.

## Tracks and timeline

A **motion track** is a self-contained mini-clip: its own template, control
values, easing curve, slice of the asset list, blend mode, and window on the
timeline. The renderer draws one container per track, in order, so tracks
composite over each other.

The scene clock stays single — tracks never keep their own time. Each track
receives its **window** length as `totalFrames`, so it loops seamlessly inside
its own window, and a track spanning the whole clip at scale 1 is bit-identical
to the single-template behaviour that predates tracks. Tracks are the source of
truth for values and easing; nothing writes those into the scene directly.

## Mockup studio

Seven devices in four screen slots, each with its own finishes and native screen
resolution:

| Slot | Device | Finishes | Screen |
|---|---|---|---|
| Phone | iPhone 17 Pro | 3 | 1206 × 2622 |
| Phone | iPhone Air | 1 | 1260 × 2736 |
| Laptop | MacBook Pro 14" | 2 | 3024 × 1964 |
| Tablet | iPad Pro | 2 | 2752 × 2064 |
| Tablet | iPad Air | 1 | 2732 × 2048 |
| Display | Pro Display XDR | 1 | 6016 × 3384 |
| Display | Studio Display | 1 | 5120 × 2880 |

Screen content is your own image or video, fitted Cover / Fit width / Contain,
with zoom and position, plus a synthetic status bar (time, battery, signal).
**16 animation presets** across five categories — studio (4), turntable (2),
cinematic (5), dynamic (2) and product (3) — drive camera, lighting and the
laptop lid on a keyframed pose timeline, each previewed by a live 3D thumbnail.
A Mockup studio is stored with the project from an explicit **Save** button, not
by autosave.

## Canvas, assets and easing

- **Canvas**: 6 aspect presets (3:4, 4:5, 9:16, 1:1, 4:3, 16:9) plus a custom
  pixel size, safe-area guides, a logo slot, and a background that can be a
  colour, a gradient, an uploaded image, or the featured card reflected and
  blurred.
- **Assets**: images and video — a video card is uploaded to the GPU as a live
  texture in both backends. Drag to reorder, per-card crop focus, 6 card shapes
  plus `auto`, and uploaded blobs kept in IndexedDB so a reload restores them.
- **Easing**: 28 presets (`lib/easing.ts`) — the signature curves, the standard
  Sine/Quad/Cubic/Quart/Expo families, physics curves (Bounce, Spring, Wiggle,
  Overshoot) — plus hand-dragged custom beziers. The renderer resolves the curve
  once per frame and reshapes each motion's cyclic phase while keeping loops
  seamless.
- **Effects**: an ordered Pixi filter stack (`effects/`). One effect ships today
  (Pixelate); the pattern is the same self-declaring one templates use.
- **History**: undo/redo that coalesces a whole gesture — a drag, a typed
  number, a template pick — into one step.
- **Projects**: each project is its own `localStorage` key with a 500 ms
  autosave, so writing one project never re-serializes the others. The
  pre-projects scene is migrated by copy, never moved.

## Architecture

```
Assets (images / video → sprites or textured planes, slots in order)
  → Tracks     lib/tracks.ts     scene frame → track-local frame         ← SEAM 0
  → Motion     templates/*.ts    transform(frame, i, count, values, ctx)  ← SEAM 1
               (+ transform3d / camera for the WebGL families)
  → Composite  depth-sorted stage (Pixi) or a real camera (three)
  → Effects    effects/*.ts      ordered Pixi filter stack                ← SEAM 2
  → getFrameState(frame) — ONE clock for live preview AND export
```

Principles: one live state read every frame · templates fully self-declare their
controls · full value reset on template switch · a fixed 8-type control
vocabulary (`slider`, `toggle`, `pills`, `select`, `color`, `xypad`, `upload`,
`text`) · shared `cardPath` helper (line / arc / ring / zwall) · every template
ships a default easing curve · a template's layer count comes from
`layerCountFor()`, never from `values.count`, because lattice families derive
their cell total from the canvas.

**Where things live**

```
templates/   one file per motion family + index.ts registry
three3d/     device mockups, stylised shaders, camera rig, animations
effects/     Pixi filter effects (same self-declaring pattern)
lib/         renderers, tracks, easing, loop math, card paths, export encoders
components/  panels, stages, timeline, dialogs
store/       the Zustand stores (scene, 3D, board, web, projects, history, UI)
styles/      tokens.css — the entire visual system
scripts/     verification suites and measurement harnesses
app/api/     the optional ffmpeg export route
```

## Verification

`npm test` runs four suites over every registered template — no browser, no
snapshots, just invariants. Current state, measured:

| Suite | What it proves | Assertions |
|---|---|---|
| `verify-tilt` | geometry is well-formed: coplanar, finite, seam-closed | 46,220 |
| `verify-catalogue` | every template holds in 6 canvas aspects × 7 card shapes (10,626 combinations) | 3,987,049 |
| `verify-contexts` | every render context is complete; thumbnails stay inside budget | 14,910 |
| `verify-reference` | the ported families still match the reference: 30 fitted presets, four authored preset tables, and six live scene captures | 1,698 |

All four pass. `verify-contexts` reports one known gap: four context builders
still omit `cardAspect`.

## Design system

Light, Figma-style UI: flat white panels separated by 1px hairlines on a soft
grey dotted stage, Tailwind-gray text scale, Inter, square corners. Every
colour, radius and type size lives in one token sheet — `styles/tokens.css` — so
restyling the whole app is a one-file edit. A dark theme ships under
`:root[data-theme="dark"]`. Components never hardcode colours.

## Contribute

The codebase is deliberately seam-oriented: most contributions touch exactly one
file.

**Add a motion template** (the most common one):

1. Copy the closest existing family in `templates/` to a new file.
2. Declare your controls (from the 8 fixed types) and give the family a `meta`
   block: id, name, group, `defaultEasing`, and `engine: 'webgl'` if it needs
   real perspective.
3. Write the pure transform `(frame, i, count, values, ctx)` → position, scale,
   alpha, rotation, depth. Route your phase through `ctx.easedPhase` so the
   scene's easing applies, and quantize speed with `loopCycles()` so the clip
   loops. WebGL families additionally provide `transform3d` and `camera`.
4. Register it in `templates/index.ts`. Done — sidebar group, control panel,
   easing block, thumbnail and export all pick it up automatically. Ship
   variants as preset bundles via `templates/variant.ts`.
5. `npm test && npx tsc --noEmit`.

Ground rules: transforms stay **pure and deterministic** (no `Math.random` — use
the seeded hash pattern in `field.ts` / `gravity.ts`), never read state outside
`values` / `ctx`, and keep template IDs stable once shipped (display names can
change freely; IDs are what saved projects reference).

**Restyle it**: edit `styles/tokens.css` only. **New effects**: same pattern as
templates, in `effects/`.

## Licence

Source-available under the **Elastic License 2.0** — use, copy, modify and
distribute freely, including commercially and in production. The one right
withheld is offering Motion Studio to third parties as a hosted or managed
service. See [LICENSE](LICENSE); third-party components and their licences are
listed in [NOTICE](NOTICE).

## Credits

Created and maintained by
[@appariciojunior](https://github.com/appariciojunior).

Major contributions by [@davicorrea0](https://github.com/davicorrea0): the
three.js backend and the WebGL template families, the Mockup studio, the motion
tracks, the in-browser MP4/WebM/GIF export pipeline, and the verification
suites.

Thanks also to [@quefreen](https://github.com/quefreen) and
[@milkatx](https://github.com/milkatx) for the help, support, and quick repo
edits.
