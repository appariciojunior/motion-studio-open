import { create } from 'zustand';
import { defaultsFor, easingFor, templates } from '@/templates';
import type { EasingSpec } from '@/lib/easing';
import type { CropFocus } from '@/lib/crop';
import { DEMO_ASSETS } from '@/lib/demoAssets';
import { idbPut, idbGet, idbDelete } from '@/lib/assetDb';
import { DEFAULT_TRACK_TRANSFORM, TRACK_END, type BlendMode, type MotionTrack } from '@/lib/tracks';

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
  origin?: 'remote' | 'upload'; // 'upload' bytes live in IndexedDB and restore on reload
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
}

export interface BackgroundSettings {
  source: 'color' | 'image' | 'card'; // solid/gradient · uploaded image · reflected from the featured card
  color: string;
  gradient: boolean;
  color2: string;
  imageUrl: string | null;            // for source: 'image'
  blur: number;                       // px blur for image/card backgrounds
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
  resetScene: () => void;                            // back to defaults (new project)
  rehydrateUploads: () => Promise<void>;             // rebuild upload urls from IndexedDB

  loadCustomPresets: () => void;
  saveCustomPreset: (name: string) => void;
  applyCustomPreset: (id: string) => void;
  deleteCustomPreset: (id: string) => void;

  addEffect: (effectId: string, values: Record<string, any>) => void;
  removeEffect: (instanceId: string) => void;
  toggleEffect: (instanceId: string) => void;
  reorderEffects: (from: number, to: number) => void;
  setEffectValue: (instanceId: string, key: string, val: any) => void;

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
 * Deliberately excludes `customPresets`: saved presets are a user-wide library,
 * not per-project, so creating a project must not wipe them.
 */
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
    background: { source: 'color' as const, color: '#0d0d0d', gradient: false, color2: '#1f1f1f', imageUrl: null, blur: 28 },
    logo: { url: null, position: 'br' as const, size: 96 },
    audioUrl: null,

    // start populated with the bundled demo set so every template shows real motion
    assets: DEMO_ASSETS.map((a) => ({ ...a, id: nid('asset'), visible: true, origin: 'remote' as const })),
    cardShape: 'auto',
    videoEnd: 'loop' as const,
    effects: [],
  };
}

export const useSceneStore = create<SceneState>((set, get) => ({
  ...initialSceneState(),
  customPresets: [],

  setValue: (key, val) =>
    set((s) => withTrack(s, s.activeTrackId, { values: { ...s.values, [key]: val } })),

  // full reset on template switch: wipe bag, refill from declared defaults,
  // and seed the track easing from the template's default curve. Only the
  // ACTIVE track switches — the other layers keep their own motion.
  setActiveTemplate: (id) =>
    set((s) => ({
      ...withTrack(s, s.activeTrackId, { templateId: id, values: defaultsFor(id), easing: easingFor(id) }),
      frame: 0,
    })),

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
      const current = t.assetIds.length > 0 ? t.assetIds : s.assets.map((a) => a.id);
      const next = current.includes(assetId)
        ? current.filter((x) => x !== assetId)
        : [...current, assetId];
      return withTrack(s, id, { assetIds: next.length === 0 ? [] : next });
    }),

  setFrame: (frame) => set(() => ({ frame })),
  setPlaying: (p) => set(() => ({ playing: p })),

  setFps: (fps) => set(() => ({ fps })),
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
  setBackground: (patch) => set((s) => ({ background: { ...s.background, ...patch } })),
  setLogo: (patch) => set((s) => ({ logo: { ...s.logo, ...patch } })),
  setAudioUrl: (url) => set(() => ({ audioUrl: url })),

  addAssets: (items) => {
    const added: AssetItem[] = items.map(({ blob, ...it }) => {
      const id = nid('asset');
      const origin: 'remote' | 'upload' = blob || it.url.startsWith('blob:') ? 'upload' : (it.origin ?? 'remote');
      if (blob) idbPut(id, blob).catch(() => { /* quota — this upload won't persist */ });
      return { ...it, id, visible: true, origin };
    });
    set((s) => ({ assets: [...s.assets, ...added] }));
  },
  // Set the image at a specific slot; appends if the slot is the next empty one.
  // A new image gets a fresh (centre) crop — the old focal point rarely fits it.
  replaceAssetAt: (index, item) => {
    const { blob, ...it } = item;
    const origin: 'remote' | 'upload' = blob || it.url.startsWith('blob:') ? 'upload' : (it.origin ?? 'remote');
    set((s) => {
      const next = s.assets.slice();
      if (index < next.length) {
        const prev = next[index];
        if (prev.origin === 'upload') idbDelete(prev.id).catch(() => {}); // drop the replaced upload's bytes
        if (blob) idbPut(prev.id, blob).catch(() => {});                  // store new bytes under the kept id
        next[index] = { ...prev, name: it.name, url: it.url, kind: it.kind, origin, crop: undefined };
      } else {
        const id = nid('asset');
        if (blob) idbPut(id, blob).catch(() => {});
        next.push({ ...it, id, visible: true, origin });
      }
      return { assets: next };
    });
  },
  removeAsset: (id) => {
    const a = get().assets.find((x) => x.id === id);
    if (a?.origin === 'upload') idbDelete(id).catch(() => {});
    set((s) => ({ assets: s.assets.filter((x) => x.id !== id) }));
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
    for (const a of get().assets) if (a.origin === 'upload') idbDelete(a.id).catch(() => {});
    set(() => ({ assets: [] }));
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
      const assets = partial.assets ?? s.assets;
      seedIdCounter(assets);

      // Scenes saved before motion tracks existed carry only the flat
      // activeTemplateId/values/easing triple — fold it into a single track so
      // an old autosave still opens.
      const rawTracks: MotionTrack[] = partial.tracks?.length
        ? partial.tracks
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
        }));
      seedIdCounter(tracks);

      const safeTracks = tracks.length > 0 ? tracks : s.tracks;
      const activeId = safeTracks.some((t) => t.id === partial.activeTrackId)
        ? partial.activeTrackId!
        : safeTracks[0].id;

      return {
        ...s,
        ...partial,
        ...projectActive(safeTracks, activeId),
        frame: 0, // always start at the clip head
      };
    }),

  // Back to the built-in defaults, for "new project". Uploaded bytes in
  // IndexedDB are deliberately NOT deleted: they still belong to the scenes of
  // other projects, which reference them by asset id.
  resetScene: () => set(() => initialSceneState()),

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

  addEffect: (effectId, values) =>
    set((s) => ({
      effects: [
        ...s.effects,
        { instanceId: nid('fx'), effectId, enabled: true, values: { ...values } },
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

  get totalFrames() {
    return Math.max(1, Math.round(get().duration * get().fps));
  },
}));
