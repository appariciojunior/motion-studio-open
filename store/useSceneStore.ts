import { create } from 'zustand';
import { defaultsFor, easingFor, templates } from '@/templates';
import { carouselReferenceDurations } from '@/templates/carousel';
import type { EasingSpec } from '@/lib/easing';
import type { CropFocus } from '@/lib/crop';
import type { EffectScope } from '@/lib/types';
import { DEMO_ASSETS, demoSourceForSlot, isDemoAssetSource } from '@/lib/demoAssets';
import { idbPut, idbGet, idbDelete } from '@/lib/assetDb';
import { DEFAULT_TRACK_TRANSFORM, TRACK_END, type BlendMode, type MotionTrack } from '@/lib/tracks';
import { createGradientSpec, legacyColorsForGradient, normalizeGradientSpec, type GradientSpec } from '@/lib/gradient';

// ---------- canvas dimension helpers ----------
export const ASPECTS: Record<string, [number, number]> = {
  '3:4': [3, 4],
  '4:5': [4, 5],   // Instagram portrait
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:3': [4, 3],
  '16:9': [16, 9],
};

const BASE = 1080; // longest edge in export pixels
export function dimsFor(aspect: string): { width: number; height: number } {
  const [aw, ah] = ASPECTS[aspect] ?? ASPECTS['3:4'];
  if (aw >= ah) return { width: BASE, height: Math.round((BASE * ah) / aw) };
  return { width: Math.round((BASE * aw) / ah), height: BASE };
}

// ---------- store types ----------
export interface AssetItem {
  id: string;
  name: string;
  url: string;
  visible: boolean;
  kind?: 'image' | 'video'; // media type; undefined = image (backward compatible)
  origin?: 'demo' | 'remote' | 'upload'; // demos preview empty slots; upload bytes live in IndexedDB
  crop?: CropFocus; // cover-fit focal point 0..1 per axis; undefined = centre
}

// Upload actions accept the source Blob so its bytes can be stashed in
// IndexedDB for persistence; it is never kept in the store itself.
type AssetInput = Omit<AssetItem, 'id' | 'visible'> & { blob?: Blob };

export interface ActiveEffect {
  instanceId: string;
  effectId: string;
  enabled: boolean;
  values: Record<string, any>;
  // Opcional de proposito: cena salva antes deste campo nao tem `scope`, e le
  // como 'scene' — exatamente o comportamento que ela tinha.
  scope?: EffectScope;
}

export interface BackgroundSettings {
  source: 'color' | 'image' | 'card'; // solid/gradient · uploaded image · reflected from the featured card
  color: string;
  alpha: number;                      // overall background opacity, 0..100
  gradient: boolean;
  color2: string;
  gradientSpec?: GradientSpec;           // v2; legacy color/gradient fields remain readable
  imageUrl: string | null;            // for source: 'image'
  blur: number;                       // px blur for image/card backgrounds
  userSet?: boolean;                  // preserve an explicit choice across template switches
}

export interface LogoSettings {
  url: string | null;
  position: 'tl' | 'tr' | 'bl' | 'br';
  size: number; // px
}

// A named snapshot of a template's tweaked values + easing ("Save as custom").
export interface CustomPreset {
  id: string;
  name: string;
  templateId: string;
  values: Record<string, any>;
  easing: EasingSpec;
}

const PRESETS_KEY = 'motion-custom-presets';
function persistPresets(list: CustomPreset[]) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch { /* storage full/blocked */ }
}

// Hearted templates, in the order they were favourited. Stored as ids rather
// than templates so a catalogue edit can never resurrect a stale copy of one.
const FAVORITES_KEY = 'motion-favorite-templates';
function persistFavorites(ids: string[]) {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids)); } catch { /* storage full/blocked */ }
}

export interface SceneState {
  // ---- motion tracks: stacked motion layers, drawn in array order ----
  // The source of truth for what animates. See lib/tracks.ts.
  tracks: MotionTrack[];
  activeTrackId: string;

  // The active track's template / values / easing, mirrored to the top level.
  // These predate tracks and are still what 3D (renderer3d), web (WebStage),
  // board (BoardStage) and the zip export read, so they stay a first-class
  // projection of `tracks[active]` rather than being removed. Every mutator
  // goes through `projectActive` so the two can never drift.
  activeTemplateId: string;
  values: Record<string, any>;
  easing: EasingSpec;   // scene easing curve (seeded from the template default)

  // clock
  frame: number;
  fps: number;
  duration: number; // seconds
  playing: boolean;

  // canvas
  aspect: string;       // key of ASPECTS, or 'custom'
  width: number;        // logical/preview px (longest edge normalized to BASE)
  height: number;
  customW: number;      // exact export px when aspect === 'custom'
  customH: number;
  safeArea: boolean;
  background: BackgroundSettings;
  logo: LogoSettings;
  audioUrl: string | null;

  // assets → layer slots
  assets: AssetItem[];
  cardShape: string; // scene-level crop aspect for cards: 'auto' or a CARD_SHAPES key
  // when a card video is shorter than the clip: restart it ('loop') or freeze
  // on its final frame ('hold') — applies to preview and export alike
  videoEnd: 'loop' | 'hold';

  // effects (SEAM 2)
  effects: ActiveEffect[];

  // custom presets (saved template snapshots)
  customPresets: CustomPreset[];

  // template ids the user hearted, oldest first
  favoriteTemplateIds: string[];

  // ---- actions ----
  // These four act on the ACTIVE track (and mirror to the legacy fields), so
  // every existing control panel keeps working untouched.
  setValue: (key: string, val: any) => void;
  setActiveTemplate: (id: string) => void;
  setEasing: (easing: EasingSpec) => void;
  resetValues: () => void;

  // ---- track actions ----
  setActiveTrack: (id: string) => void;
  addTrack: (templateId?: string) => void;
  duplicateTrack: (id: string) => void;
  removeTrack: (id: string) => void;
  reorderTracks: (from: number, to: number) => void;
  renameTrack: (id: string, name: string) => void;
  toggleTrackVisible: (id: string) => void;
  // Patch any non-motion field of a track (window, blend, opacity, transform…).
  patchTrack: (id: string, patch: Partial<MotionTrack>) => void;
  setTrackBlend: (id: string, blend: BlendMode) => void;
  toggleTrackAsset: (id: string, assetId: string) => void;
  setFrame: (frame: number) => void;
  setPlaying: (p: boolean) => void;
  setFps: (fps: number) => void;
  setAspect: (aspect: string) => void;
  setCustomDims: (w: number, h: number) => void;
  setDuration: (d: number) => void;
  toggleSafeArea: () => void;
  setBackground: (patch: Partial<BackgroundSettings>) => void;
  setLogo: (patch: Partial<LogoSettings>) => void;
  setAudioUrl: (url: string | null) => void;

  addAssets: (items: AssetInput[]) => void;
  replaceAssetAt: (index: number, item: AssetInput) => void;
  removeAsset: (id: string) => void;
  toggleAsset: (id: string) => void;
  reorderAssets: (from: number, to: number) => void;
  clearAssets: () => void;
  setAssetCrop: (id: string, crop: CropFocus) => void;
  setAllAssetCrops: (crop: CropFocus) => void;
  setCardShape: (shape: string) => void;
  setVideoEnd: (mode: 'loop' | 'hold') => void;

  // persistence (see lib/scenePersist)
  hydrate: (partial: Partial<SceneState>) => void;   // apply a loaded scene
  resetScene: () => void;                            // back to the app defaults (demo scene)
  blankScene: () => void;                            // back to defaults with NO layers (new project)
  rehydrateUploads: () => Promise<void>;             // rebuild upload urls from IndexedDB

  loadCustomPresets: () => void;
  saveCustomPreset: (name: string) => void;
  applyCustomPreset: (id: string) => void;
  deleteCustomPreset: (id: string) => void;

  loadFavorites: () => void;
  toggleFavorite: (templateId: string) => void;

  addEffect: (effectId: string, values: Record<string, any>, scope?: EffectScope) => void;
  removeEffect: (instanceId: string) => void;
  toggleEffect: (instanceId: string) => void;
  reorderEffects: (from: number, to: number) => void;
  setEffectValue: (instanceId: string, key: string, val: any) => void;
  setEffectScope: (instanceId: string, scope: EffectScope) => void;

  get totalFrames(): number;
}

// simple id generator (no Date.now/Math.random constraints in app runtime, but keep it counter-based for determinism)
let _idc = 0;
const nid = (prefix: string) => `${prefix}_${++_idc}`;

// After restoring persisted assets, advance the counter past any restored ids so
// freshly-generated ids can never collide with rehydrated ones.
function seedIdCounter(assets: { id: string }[]) {
  for (const a of assets) {
    const m = /_(\d+)$/.exec(a.id);
    if (m) _idc = Math.max(_idc, Number(m[1]));
  }
}

// ---------- track helpers ----------

// A fresh track spans the whole clip, inherits the template's own defaults and
// easing curve, and draws every asset — so adding one immediately shows real
// motion over the existing stack.
export function makeTrack(templateId: string, name: string, patch: Partial<MotionTrack> = {}): MotionTrack {
  return {
    id: nid('track'),
    name,
    templateId,
    values: defaultsFor(templateId),
    easing: easingFor(templateId),
    assetIds: [],
    visible: true,
    opacity: 1,
    blend: 'normal',
    inFrame: 0,
    outFrame: TRACK_END,
    offset: 0,
    timeScale: 1,
    fade: 0,
    transform: { ...DEFAULT_TRACK_TRANSFORM },
    ...patch,
  };
}

// The ONE place the legacy top-level motion fields are derived. Every action
// that touches `tracks` or `activeTrackId` returns through here, which is what
// guarantees `values`/`easing`/`activeTemplateId` always describe the active
// track — the invariant 3D/web/board/persist depend on.
function projectActive(tracks: MotionTrack[], activeTrackId: string) {
  const active = tracks.find((t) => t.id === activeTrackId) ?? tracks[0];
  // A scene with NO layers is a real state: a new project starts blank so the
  // first template is chosen rather than inherited. Nothing downstream needs a
  // stand-in track — the renderer's forEach over an empty list draws just the
  // background, getTemplate('') falls back on its own, and setActiveTemplate
  // turns the first pick into the first layer.
  if (!active) {
    return { tracks, activeTrackId: '', activeTemplateId: '', values: {}, easing: easingFor('') };
  }
  return {
    tracks,
    activeTrackId: active.id,
    activeTemplateId: active.templateId,
    values: active.values,
    easing: active.easing,
  };
}

// Apply a patch to one track and re-project. `patch` may replace values/easing/
// templateId, which is how setValue & friends reach the active track.
function withTrack(
  s: Pick<SceneState, 'tracks' | 'activeTrackId'>,
  id: string,
  patch: Partial<MotionTrack>,
) {
  const tracks = s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  return projectActive(tracks, s.activeTrackId);
}

const INITIAL_TEMPLATE = 'carousel';
const initDims = dimsFor('3:4');

/**
 * The scene a fresh project starts from. Factored out (rather than inlined into
 * create()) because "new project" has to restore exactly this — one definition,
 * so the app's defaults and a new project's defaults can never disagree.
 *
 * Deliberately excludes `customPresets` and `favoriteTemplateIds`: saved presets
 * and hearted templates are a user-wide library, not per-project, so creating a
 * project must not wipe them.
 */
/**
 * What an explicitly CREATED project starts from: the same canvas, assets and
 * clock as `initialSceneState`, with no layers at all.
 *
 * A new project used to open on the app's default template (`carousel`, which
 * the UI calls "Runway") with the demo set already animating — so every new
 * project was a copy of the last one and the list read as two of the same thing.
 * Blank means the first template pick is the user's.
 *
 * First run still gets the demo scene: the store's own defaults are what boots,
 * and a first-time visitor with an empty stage would have nothing to look at.
 */
export function blankSceneState() {
  return { ...initialSceneState(), ...projectActive([], '') };
}

function initialSceneState() {
  const tracks = [makeTrack(INITIAL_TEMPLATE, 'Layer 1')];
  return {
    ...projectActive(tracks, tracks[0].id),

    frame: 0,
    fps: 30,
    duration: 8,
    playing: true, // autoplay loop by default

    aspect: '3:4',
    width: initDims.width,
    height: initDims.height,
    customW: initDims.width,
    customH: initDims.height,
    safeArea: false,
    background: {
      source: 'color' as const,
      color: '#0d0d0d',
      alpha: 100,
      gradient: false,
      color2: '#1f1f1f',
      gradientSpec: createGradientSpec('#0d0d0d', '#1f1f1f'),
      imageUrl: null,
      blur: 28,
    },
    logo: { url: null, position: 'br' as const, size: 96 },
    audioUrl: null,

    // start populated with the bundled demo set so every template shows real motion
    assets: DEMO_ASSETS.map((a) => ({ ...a, id: nid('asset'), visible: true, origin: 'demo' as const })),
    cardShape: 'auto',
    videoEnd: 'loop' as const,
    effects: [],
  };
}

export const useSceneStore = create<SceneState>((set, get) => ({
  ...initialSceneState(),
  customPresets: [],
  favoriteTemplateIds: [],

  setValue: (key, val) =>
    set((s) => withTrack(s, s.activeTrackId, { values: { ...s.values, [key]: val } })),

  // full reset on template switch: wipe bag, refill from declared defaults,
  // and seed the track easing from the template's default curve. Only the
  // ACTIVE track switches — the other layers keep their own motion.
  setActiveTemplate: (id) =>
    set((s) => {
      const group = templates[id]?.meta.group;
      const isStickerPreset = id.startsWith('stickers-');
      const isPosterPreset = id.startsWith('poster-');
      const isSpinnerPreset = group === 'Spinner';
      const posterDuration = id === 'poster-04' || id === 'poster-05' ? 13
        : id === 'poster-06' ? 22 : 21;
      const stickerDuration = id === 'stickers-01' ? 36 : id === 'stickers-02' ? 5 : 13;
      // The reference authors a Duration per spinner preset, and what that
      // really pins is the SECONDS PER CARD: its belt advances one slot per
      // step, so the cadence is duration/count and the same 18s clip is a third
      // slower on a 6-card belt than on a 9-card one. These are its authored
      // numbers — 2s per card everywhere except the Hinge subfamily, which runs
      // 1.33s (1s at count 12, 1.25s on Hinge 05).
      const spinnerDuration = id === 'spinner-06' ? 80
        : id === 'spinner-03' || id === 'spinner-05' ? 64
          : id === 'spinner-04' ? 36
            : id === 'fan-01' ? 24
              : id === 'fan-03' ? 18
                : id === 'hinge-05' ? 15
                  // Hinge 01-04 at count 9/12, and Spinner 01/02 + Fan 02 at count 6.
                  : 12;
      // Flicker/Pulse 03-12 (`flicker-r01..r10`) each bake a cards/sec `speed`
      // computed from the reference's own clip length (see templates/flicker.ts
      // refFlicker). That rate only lands on the intended lap count when the
      // scene duration matches the length it was measured at — left at
      // whatever duration the previous template used, most of them drift off
      // their authored cadence, and the short ones (3-4s) can end up repeating
      // extra laps in a still-short clip and read as "too fast". Pin it, same
      // as Spinner/Sticker/Poster do above.
      const isPulseRefPreset = id.startsWith('flicker-r');
      const pulseDuration = id === 'flicker-r02' ? 4 : id === 'flicker-r10' ? 3
        : (id === 'flicker-r06' || id === 'flicker-r07' || id === 'flicker-r08' || id === 'flicker-r09') ? 8
          : 6; // flicker-r01, r03, r04, r05
      // Flip advances one card every `stepTime` seconds, but `loopCycles` snaps
      // the clip to a whole number of passes through the pool — so the authored
      // 2s step only survives when the clip is a multiple of count * stepTime.
      // At the app's default 8s, all six presets would silently run their step
      // in 1.33s instead. The reference's own clip is 12s for exactly this
      // reason (6 cards x 2s), so pin it, as Pulse above does.
      const isFlipPreset = group === 'Flip';
      // Orbit 3D's ported presets, same story as Spinner's: the reference
      // authors a Duration per preset and what it pins is the SECONDS PER CARD,
      // because its ring advances one slot per step. Left at whatever duration
      // the previous template used, every one of them reads at the wrong
      // cadence — and the ones that step (a curve plus a Hold) stop landing on
      // their own beat, which is the whole character of the Carousel and
      // Lightroom subfamilies. Its own numbers, off its preset table:
      const ORBIT_3D_DURATION: Record<string, number> = {
        'orbit-3d-04': 20, 'orbit-3d-05': 20, 'orbit-3d-06': 18, 'orbit-3d-07': 36,
        'orbit-3d-08': 36, 'orbit-3d-09': 36,
        'orbit-3d-10': 20, 'orbit-3d-11': 20, 'orbit-3d-12': 11.25, 'orbit-3d-13': 25,
        'orbit-3d-14': 7.5,
        'orbit-3d-15': 20, 'orbit-3d-16': 20, 'orbit-3d-17': 20, 'orbit-3d-18': 30,
        'orbit-3d-19': 18, 'orbit-3d-20': 18, 'orbit-3d-21': 36, 'orbit-3d-22': 36,
        'orbit-3d-23': 20, 'orbit-3d-24': 10, 'orbit-3d-25': 10, 'orbit-3d-26': 10,
        'orbit-3d-27': 12,
      };
      // Its artboard is per preset too — square for five of the six Pure
      // presets, 4:5 for the rest — and the ring is framed against the frame's
      // half-HEIGHT, so the canvas ratio decides how much of the ring the
      // sides show. Only the ported presets pin it; orbit-3d-01..03 are ours
      // and leave the user's canvas alone.
      const ORBIT_3D_SQUARE = new Set(['orbit-3d-04', 'orbit-3d-05', 'orbit-3d-07', 'orbit-3d-08', 'orbit-3d-09']);
      const orbitDuration = ORBIT_3D_DURATION[id];
      const isOrbit3dPreset = orbitDuration !== undefined;
      // The Arc is the reference's other ported engine (its Wheel category, our
      // Ferris group): a row of cards on the rim of a very large wheel. Its
      // Pause and Stagger are authored in SECONDS against a specific clip
      // length, so the clip is what has to be pinned — at another duration the
      // pause eats a different share of each step and Arc 01's settle turns
      // into a drift.
      const ARC_DURATION: Record<string, number> = {
        'arc-01': 4.2, 'arc-02': 13.5, 'arc-03': 13.5,
      };
      const arcDuration = ARC_DURATION[id];
      const isArcPreset = arcDuration !== undefined;
      // The reference's Wheel, same reasoning again: its ring advances one slot
      // per step, so what its Duration pins is the seconds per card. Its own
      // artboard for the family is 1:1 (the family default, which none of the
      // five presets overrides).
      const WHEEL_R_DURATION: Record<string, number> = {
        'wheel-r01': 20, 'wheel-r02': 12, 'wheel-r03': 12, 'wheel-r04': 10, 'wheel-r05': 12,
      };
      // Revolve and Proximity, the reference's Spin and Proximity families.
      // Both author their cadence as a CLIP LENGTH: Revolve turns 180 degrees
      // every duration/count seconds, and Proximity walks its whole path once
      // per duration. Left at whatever the previous template used, Revolve's
      // step lands on the wrong beat and Proximity laps its tour at the wrong
      // speed — the same reason Pulse and Flip are pinned above.
      const REF_2D_DURATION: Record<string, number> = {
        'revolve-01': 8, 'revolve-02': 7, 'revolve-03': 12, 'revolve-04': 10,
        'field-prox-01': 14.3, 'field-prox-02': 12, 'field-prox-03': 16,
        'field-prox-04': 15, 'field-prox-05': 14,
        'magazine-01': 10, 'magazine-02': 12, 'magazine-03': 10, 'magazine-04': 10,
        'magazine-05': 10, 'magazine-06': 10, 'magazine-07': 8, 'magazine-08': 10, 'magazine-09': 10,
      };
      const ref2dDuration = REF_2D_DURATION[id];
      const isRef2dPreset = ref2dDuration !== undefined;
      const wheelRefDuration = WHEEL_R_DURATION[id];
      const isWheelRefPreset = wheelRefDuration !== undefined;
      // The reference's Globe: its continuous presets run one CYCLE per
      // its own Duration, so the clip is duration * cycles; the stepped ones
      // author the clip outright. Same reasoning as Pulse and Flip above.
      const GLOBE_R_DURATION: Record<string, number> = {
        'globe-r01': 7, 'globe-r02': 6, 'globe-r03': 15, 'globe-r04': 10,
        'globe-r05': 10, 'globe-r06': 15, 'globe-r07': 15, 'globe-r08': 10,
        'globe-r09': 10, 'globe-r10': 9, 'globe-r11': 15, 'globe-r12': 15,
        'globe-r13': 15, 'globe-r14': 15, 'globe-r15': 12, 'globe-r16': 10,
      };
      const globeRefDuration = GLOBE_R_DURATION[id];
      const isGlobeRefPreset = globeRefDuration !== undefined;
      // The reference's one 3D scene, three of its branches. Coil and
      // Carousel 3D run its continuous model, so their clip is
      // duration * cycles; the Ring steps per CARD, so its Duration is what
      // fixes the seconds per slot. Same reasoning as Spinner and Orbit 3D.
      const REF_3D_DURATION: Record<string, number> = {
        'ring-r01': 12.8, 'ring-r02': 16, 'ring-r03': 12.8, 'ring-r04': 15, 'ring-r05': 15,
        'ring-r06': 12.8, 'ring-r07': 12.8, 'ring-r08': 12.8, 'ring-r09': 12.8, 'ring-r10': 16,
        'ring-r11': 12.8, 'ring-r12': 20, 'ring-r13': 12.8, 'ring-r14': 12.8, 'ring-r15': 20,
        'coil-01': 10, 'coil-02': 10, 'coil-03': 10, 'coil-04': 15, 'coil-05': 12,
        'coil-06': 12, 'coil-07': 20, 'coil-08': 15, 'coil-09': 24,
        'carousel3d-01': 8, 'carousel3d-02': 9,
        'carousel3d-03': 8, 'carousel3d-04': 12, 'carousel3d-05': 20,
        'deck-r01': 7, 'deck-r02': 7, 'deck-r03': 7, 'deck-r04': 7, 'deck-r05': 10,
        'deck-r06': 7, 'deck-r07': 7, 'deck-r08': 7, 'deck-r09': 10, 'deck-r10': 10,
        'deck-r11': 10, 'deck-r12': 10,
      };
      const ref3dDuration = REF_3D_DURATION[id];
      const isRef3dPreset = ref3dDuration !== undefined;
      const runwayRefDuration = carouselReferenceDurations[id];
      const isRunwayRefPreset = runwayRefDuration !== undefined;
      const referenceAspect = (isSpinnerPreset || isStickerPreset || isPosterPreset || isArcPreset) ? '4:5'
        : isOrbit3dPreset ? (ORBIT_3D_SQUARE.has(id) ? '1:1' : '4:5')
          : isWheelRefPreset ? '1:1'
            : isRunwayRefPreset || isRef2dPreset || isGlobeRefPreset || isRef3dPreset ? '3:4'
              : null;
      const referenceCanvas = referenceAspect ? dimsFor(referenceAspect) : null;
      // A blank scene has no track to patch, so the first pick BECOMES Layer 1.
      // Without this the click would land on nothing and picking a template in a
      // new project would look broken.
      const layers = s.tracks.length === 0
        ? (() => { const first = makeTrack(id, 'Layer 1'); return projectActive([first], first.id); })()
        : withTrack(s, s.activeTrackId, { templateId: id, values: defaultsFor(id), easing: easingFor(id) });
      return {
        ...layers,
        // These reconstructed families have an intrinsic source ratio, just as
        // their reference presets do. Users can still change it afterwards.
        // Spinner takes 'auto' rather than one ratio for the whole family: the
        // reference authors the card shape PER PRESET — square for Spinner 01-05
        // and every Hinge, 4:3 for Spinner 06, 4:5 for all three Fans — and
        // 'auto' is what defers to each template's own declared cardAspect.
        // Pinning the family to 4:3 made every square preset a wide slab.
        // Orbit 3D takes 'auto' for the same reason Spinner does: the reference
        // authors the card shape per preset (square for most, 4:5 for the
        // Lightroom drums, 9:16 for Bloom 05), and 'auto' is what defers to each
        // template's own declared cardAspect. Any fixed shape here overrides it
        // and every preset comes out the same proportion.
        cardShape: group === 'Spinner' || isOrbit3dPreset || isArcPreset || isWheelRefPreset ? 'auto' : isStickerPreset ? '1:1' : isPosterPreset ? '4:5' : s.cardShape,
        duration: isSpinnerPreset ? spinnerDuration : isStickerPreset ? stickerDuration : isPosterPreset ? posterDuration
          : isPulseRefPreset ? pulseDuration : isFlipPreset ? 12 : isOrbit3dPreset ? orbitDuration
            : isArcPreset ? arcDuration : isWheelRefPreset ? wheelRefDuration
              : isRunwayRefPreset ? runwayRefDuration
                : isRef2dPreset ? ref2dDuration : isGlobeRefPreset ? globeRefDuration
                  : isRef3dPreset ? ref3dDuration : s.duration,
        ...((isSpinnerPreset || isStickerPreset || isPosterPreset) && !s.background.userSet ? {
          background: { ...s.background, source: 'color' as const, color: '#FFFFFF', gradient: false },
        } : {}),
        ...(referenceCanvas && referenceAspect ? { aspect: referenceAspect, ...referenceCanvas } : {}),
        frame: 0,
      };
    }),

  setEasing: (easing) => set((s) => withTrack(s, s.activeTrackId, { easing })),

  // "Reset all values": restore the active track template's declared defaults + easing.
  resetValues: () =>
    set((s) => withTrack(s, s.activeTrackId, {
      values: defaultsFor(s.activeTemplateId),
      easing: easingFor(s.activeTemplateId),
    })),

  // ---- track actions ----
  setActiveTrack: (id) => set((s) => projectActive(s.tracks, id)),

  // New layers start on a template that contrasts with what's already stacked,
  // so the very first "add layer" reads as two distinct animations rather than
  // one doubled up. Both ids must be REAL registry ids — getTemplate falls back
  // to carousel silently, so a typo here would look like a duplicated layer.
  addTrack: (templateId) =>
    set((s) => {
      const id = templateId ?? (s.activeTemplateId === 'parallax-01' ? 'carousel' : 'parallax-01');
      const track = makeTrack(id, `Layer ${s.tracks.length + 1}`);
      return projectActive([...s.tracks, track], track.id);
    }),

  // Duplicate + slip half a window: the copy reads as an echo of the original
  // instead of hiding exactly behind it.
  duplicateTrack: (id) =>
    set((s) => {
      const i = s.tracks.findIndex((t) => t.id === id);
      if (i < 0) return {};
      const src = s.tracks[i];
      const copy: MotionTrack = {
        ...src,
        id: nid('track'),
        name: `${src.name} copy`,
        values: { ...src.values },
        assetIds: [...src.assetIds],
        transform: { ...src.transform },
        offset: (src.offset + 50) % 100,
      };
      const tracks = s.tracks.slice();
      tracks.splice(i + 1, 0, copy);
      return projectActive(tracks, copy.id);
    }),

  // The last track is never removed — the scene would have nothing to animate
  // and every panel reads through the active track.
  removeTrack: (id) =>
    set((s) => {
      if (s.tracks.length <= 1) return {};
      const tracks = s.tracks.filter((t) => t.id !== id);
      const nextActive = s.activeTrackId === id ? tracks[tracks.length - 1].id : s.activeTrackId;
      return projectActive(tracks, nextActive);
    }),

  // Array order IS stacking order: later = drawn on top.
  reorderTracks: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || from >= s.tracks.length) return {};
      const tracks = s.tracks.slice();
      const [moved] = tracks.splice(from, 1);
      tracks.splice(Math.max(0, Math.min(tracks.length, to)), 0, moved);
      return projectActive(tracks, s.activeTrackId);
    }),

  renameTrack: (id, name) => set((s) => withTrack(s, id, { name })),

  toggleTrackVisible: (id) =>
    set((s) => {
      const t = s.tracks.find((x) => x.id === id);
      return t ? withTrack(s, id, { visible: !t.visible }) : {};
    }),

  patchTrack: (id, patch) => set((s) => withTrack(s, id, patch)),

  setTrackBlend: (id, blend) => set((s) => withTrack(s, id, { blend })),

  // Toggle one asset in/out of a track's slice. Turning the last one off means
  // "all assets" again (assetIds: []), which is what the empty list encodes.
  toggleTrackAsset: (id, assetId) =>
    set((s) => {
      const t = s.tracks.find((x) => x.id === id);
      if (!t) return {};
      // An empty list means "all" — materialize it before removing one, or the
      // first click would read as adding to nothing.
      const current = t.assetIds.length > 0
        ? t.assetIds
        : s.assets.filter((asset) => asset.origin !== 'demo').map((asset) => asset.id);
      const next = current.includes(assetId)
        ? current.filter((x) => x !== assetId)
        : [...current, assetId];
      return withTrack(s, id, { assetIds: next.length === 0 ? [] : next });
    }),

  setFrame: (frame) => set(() => ({ frame })),
  setPlaying: (p) => set(() => ({ playing: p })),

  setFps: (fps) => set((s) => {
    const nextFps = Math.max(1, Math.round(fps));
    const currentTime = s.frame / Math.max(1, s.fps);
    const maxFrame = Math.max(0, Math.round(s.duration * nextFps) - 1);
    return {
      fps: nextFps,
      frame: Math.min(maxFrame, Math.round(currentTime * nextFps)),
    };
  }),
  setAspect: (aspect) =>
    set(() => ({ aspect, ...dimsFor(aspect) })),
  // Custom canvas: preview stays normalized to BASE on the longest edge so
  // template layout keeps its proportions; the exact pixels apply at export.
  setCustomDims: (w, h) =>
    set(() => {
      const cw = Math.min(8192, Math.max(16, Math.round(w) || 16));
      const ch = Math.min(8192, Math.max(16, Math.round(h) || 16));
      const k = BASE / Math.max(cw, ch);
      return {
        aspect: 'custom',
        customW: cw,
        customH: ch,
        width: Math.max(2, Math.round(cw * k)),
        height: Math.max(2, Math.round(ch * k)),
      };
    }),
  setDuration: (d) => set(() => ({ duration: d })),
  toggleSafeArea: () => set((s) => ({ safeArea: !s.safeArea })),
  setBackground: (patch) => set((s) => {
    if (patch.gradientSpec) {
      const gradientSpec = normalizeGradientSpec(patch.gradientSpec, s.background.color, s.background.color2);
      const legacy = legacyColorsForGradient(gradientSpec);
      // A gradient document is an applied background, not a detached draft.
      // Keep source + mode atomic so a hydrated legacy project cannot update
      // the ramp while the renderer still believes it should paint a solid,
      // uploaded image or reflected card.
      return {
        background: {
          ...s.background,
          ...patch,
          source: 'color',
          gradient: true,
          color: legacy.c1,
          color2: legacy.c2,
          gradientSpec,
          userSet: true,
        },
      };
    }
    return { background: { ...s.background, ...patch, userSet: true } };
  }),
  setLogo: (patch) => set((s) => ({ logo: { ...s.logo, ...patch } })),
  setAudioUrl: (url) => set(() => ({ audioUrl: url })),

  addAssets: (items) => set((s) => {
    const next = s.assets.slice();
    for (const { blob, ...item } of items) {
      const demoIndex = next.findIndex((asset) => asset.origin === 'demo');
      const origin: 'remote' | 'upload' = blob || item.url.startsWith('blob:') ? 'upload' : 'remote';
      if (demoIndex >= 0) {
        const previous = next[demoIndex];
        if (blob) idbPut(previous.id, blob).catch(() => { });
        next[demoIndex] = { ...previous, ...item, visible: true, origin, crop: undefined };
      } else {
        const id = nid('asset');
        if (blob) idbPut(id, blob).catch(() => { });
        next.push({ ...item, id, visible: true, origin });
      }
    }
    return { assets: next };
  }),
  // Set the image at a specific slot; appends if the slot is the next empty one.
  // A new image gets a fresh (centre) crop — the old focal point rarely fits it.
  replaceAssetAt: (index, item) => {
    const { blob, ...it } = item;
    const origin: 'remote' | 'upload' = blob || it.url.startsWith('blob:') ? 'upload' : 'remote';
    set((s) => {
      const next = s.assets.slice();
      while (next.length <= index) {
        next.push({ ...demoSourceForSlot(next.length), id: nid('asset'), visible: true, origin: 'demo' });
      }
      const prev = next[index];
      if (prev.origin === 'upload') idbDelete(prev.id).catch(() => { });
      if (blob) idbPut(prev.id, blob).catch(() => { });
      next[index] = { ...prev, name: it.name, url: it.url, kind: it.kind, origin, visible: true, crop: undefined };
      return { assets: next };
    });
  },
  removeAsset: (id) => {
    const current = get().assets;
    const index = current.findIndex((asset) => asset.id === id);
    const a = current[index];
    if (a?.origin === 'upload') idbDelete(id).catch(() => { });
    if (index < 0) return;
    // Removal must remove the media item itself. Replacing it with a demo asset
    // made the card look deleted while keeping a permanent, undeletable slot in
    // the list. The panel supplies empty rows up to the template's card count.
    set((s) => ({ assets: s.assets.filter((asset) => asset.id !== id) }));
  },
  toggleAsset: (id) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, visible: !a.visible } : a)),
    })),
  reorderAssets: (from, to) =>
    set((s) => {
      const next = s.assets.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { assets: next };
    }),
  clearAssets: () => {
    for (const a of get().assets) if (a.origin === 'upload') idbDelete(a.id).catch(() => { });
    set((s) => ({
      assets: Array.from({ length: Math.max(DEMO_ASSETS.length, s.assets.length) }, (_, index) => ({
        ...demoSourceForSlot(index),
        id: s.assets[index]?.id ?? nid('asset'),
        visible: true,
        origin: 'demo' as const,
      })),
    }));
  },
  setAssetCrop: (id, crop) =>
    set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, crop } : a)) })),
  setAllAssetCrops: (crop) =>
    set((s) => ({ assets: s.assets.map((a) => ({ ...a, crop })) })),
  setCardShape: (shape) => set(() => ({ cardShape: shape })),
  setVideoEnd: (mode) => set(() => ({ videoEnd: mode })),

  // Apply a persisted scene (from lib/scenePersist). Each track's `values` is
  // merged over its template's current defaults so a saved scene survives
  // added/removed controls.
  hydrate: (partial) =>
    set((s) => {
      // Demo slots are re-pointed at the CURRENT demo source rather than kept at
      // whatever URL the scene was saved with. A demo asset is a placeholder for
      // "slot n", not a specific file: a scene saved under one BASE_PATH and
      // opened under another (local vs the Pages build's path prefix) would
      // otherwise hold URLs that 404. Identity and crop survive; only the source
      // is refreshed.
      const assets = (partial.assets ?? s.assets).map((asset, index) => isDemoAssetSource(asset)
        ? { ...asset, ...demoSourceForSlot(index), origin: 'demo' as const, visible: true }
        : asset);
      const realAssetIds = new Set(assets.filter((asset) => asset.origin !== 'demo').map((asset) => asset.id));
      seedIdCounter(assets);

      // Scenes saved before motion tracks existed carry only the flat
      // activeTemplateId/values/easing triple — fold it into a single track so
      // an old autosave still opens.
      const hasTrackList = Array.isArray(partial.tracks);
      const explicitlyBlank = hasTrackList && partial.tracks!.length === 0;
      const rawTracks: MotionTrack[] = hasTrackList
        ? partial.tracks!
        : [makeTrack(partial.activeTemplateId ?? s.activeTemplateId, 'Layer 1', {
          values: partial.values,
          easing: partial.easing,
        })];

      // Drop tracks whose template no longer exists, and re-merge the rest over
      // live defaults. A scene that references only removed templates keeps the
      // current tracks rather than leaving nothing to animate.
      //
      // The check is registry membership, NOT a try/catch around defaultsFor:
      // getTemplate falls back to carousel for an unknown id, so defaultsFor
      // never throws and a catch would validate nothing. A stale id would then
      // silently animate as Runway under the wrong name.
      const tracks = rawTracks
        .filter((t) => typeof t.templateId === 'string' && t.templateId in templates)
        .map((t) => ({
          ...makeTrack(t.templateId, t.name),
          ...t,
          id: t.id || nid('track'),
          values: { ...defaultsFor(t.templateId), ...(t.values ?? {}) },
          easing: t.easing ?? easingFor(t.templateId),
          transform: { ...DEFAULT_TRACK_TRANSFORM, ...(t.transform ?? {}) },
          assetIds: (t.assetIds ?? []).filter((id) => realAssetIds.has(id)),
        }));
      seedIdCounter(tracks);

      // An explicitly persisted empty list is the intentional blank-project
      // state. Only a non-empty list made invalid by removed templates falls
      // back to the currently loaded scene.
      const safeTracks = tracks.length > 0 ? tracks : explicitlyBlank ? [] : s.tracks;
      const activeId = safeTracks.length === 0
        ? ''
        : safeTracks.some((t) => t.id === partial.activeTrackId)
          ? partial.activeTrackId!
          : safeTracks[0].id;

      const rawBackground = partial.background ?? s.background;
      const background = {
        // A persisted project may predate source, blur, imageUrl or the v2
        // gradient document. Keep today's complete background contract and
        // layer the saved values over it instead of replacing it wholesale.
        // Without this merge, an old project hydrates `source` as undefined;
        // the renderer's colour-background guard then rejects a gradient even
        // though the editor shows it as selected.
        ...s.background,
        ...rawBackground,
        gradientSpec: normalizeGradientSpec(
          rawBackground.gradientSpec,
          rawBackground.color,
          rawBackground.color2,
        ),
      };

      return {
        ...s,
        ...partial,
        background,
        assets,
        ...projectActive(safeTracks, activeId),
        frame: 0, // always start at the clip head
      };
    }),

  // Back to the built-in defaults, for "new project". Uploaded bytes in
  // IndexedDB are deliberately NOT deleted: they still belong to the scenes of
  // other projects, which reference them by asset id.
  resetScene: () => set(() => initialSceneState()),
  blankScene: () => set(() => blankSceneState()),

  // Rebuild object URLs for uploaded assets from their IndexedDB bytes. Runs after
  // hydrate; assets whose bytes are gone (evicted/quota) keep an empty url and
  // fall back to the numbered placeholder.
  rehydrateUploads: async () => {
    const uploads = get().assets.filter((a) => a.origin === 'upload' && !a.url);
    if (uploads.length === 0) return;
    const resolved = await Promise.all(
      uploads.map(async (a) => {
        const blob = await idbGet(a.id).catch(() => undefined);
        return { id: a.id, url: blob ? URL.createObjectURL(blob) : '' };
      }),
    );
    const urls = new Map(resolved.map((r) => [r.id, r.url]));
    set((s) => ({
      assets: s.assets.map((a) =>
        a.origin === 'upload' && urls.get(a.id) ? { ...a, url: urls.get(a.id)! } : a,
      ),
    }));
  },

  // Loaded lazily on the client (localStorage isn't available during SSR,
  // and seeding it at create() time would cause a hydration mismatch).
  loadCustomPresets: () =>
    set(() => {
      if (typeof window === 'undefined') return {};
      try {
        const raw = localStorage.getItem(PRESETS_KEY);
        return raw ? { customPresets: JSON.parse(raw) as CustomPreset[] } : {};
      } catch { return {}; }
    }),
  saveCustomPreset: (name) =>
    set((s) => {
      const preset: CustomPreset = {
        id: `custom_${Date.now().toString(36)}_${s.customPresets.length}`,
        name,
        templateId: s.activeTemplateId,
        values: { ...s.values },
        easing: s.easing,
      };
      const next = [...s.customPresets, preset];
      persistPresets(next);
      return { customPresets: next };
    }),
  // A preset lands on the ACTIVE track, like picking a template does — the
  // other layers keep their own motion.
  applyCustomPreset: (id) =>
    set((s) => {
      const p = s.customPresets.find((c) => c.id === id);
      if (!p) return {};
      // merge over current defaults so presets survive template control changes
      return {
        ...withTrack(s, s.activeTrackId, {
          templateId: p.templateId,
          values: { ...defaultsFor(p.templateId), ...p.values },
          easing: p.easing,
        }),
        frame: 0,
      };
    }),
  deleteCustomPreset: (id) =>
    set((s) => {
      const next = s.customPresets.filter((c) => c.id !== id);
      persistPresets(next);
      return { customPresets: next };
    }),

  // Same client-only lazy read as the presets above: localStorage is absent
  // during SSR, and seeding at create() time would desync the first render.
  loadFavorites: () =>
    set(() => {
      if (typeof window === 'undefined') return {};
      try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        // Storage is user-editable and survives across app versions, so accept
        // only what this build can actually render back.
        if (!Array.isArray(parsed)) return {};
        return { favoriteTemplateIds: parsed.filter((id): id is string => typeof id === 'string') };
      } catch { return {}; }
    }),
  toggleFavorite: (templateId) =>
    set((s) => {
      const on = s.favoriteTemplateIds.includes(templateId);
      const next = on
        ? s.favoriteTemplateIds.filter((id) => id !== templateId)
        : [...s.favoriteTemplateIds, templateId];
      persistFavorites(next);
      return { favoriteTemplateIds: next };
    }),

  addEffect: (effectId, values, scope) =>
    set((s) => ({
      effects: [
        ...s.effects,
        { instanceId: nid('fx'), effectId, enabled: true, values: { ...values }, scope: scope ?? 'scene' },
      ],
    })),
  removeEffect: (instanceId) =>
    set((s) => ({ effects: s.effects.filter((e) => e.instanceId !== instanceId) })),
  toggleEffect: (instanceId) =>
    set((s) => ({
      effects: s.effects.map((e) =>
        e.instanceId === instanceId ? { ...e, enabled: !e.enabled } : e
      ),
    })),
  reorderEffects: (from, to) =>
    set((s) => {
      const next = s.effects.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { effects: next };
    }),
  setEffectValue: (instanceId, key, val) =>
    set((s) => ({
      effects: s.effects.map((e) =>
        e.instanceId === instanceId
          ? { ...e, values: { ...e.values, [key]: val } }
          : e
      ),
    })),
  setEffectScope: (instanceId, scope) =>
    set((s) => ({
      effects: s.effects.map((e) =>
        e.instanceId === instanceId ? { ...e, scope } : e
      ),
    })),

  get totalFrames() {
    return Math.max(1, Math.round(get().duration * get().fps));
  },
}));
