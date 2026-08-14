import * as PIXI from 'pixi.js';
import { PixelateFilter } from 'pixi-filters';
import type { LayerTransform } from '@/lib/types';
import { getTemplate, layerCountFor } from '@/templates';
import { getEffect } from '@/effects';
import { useSceneStore, type SceneState } from '@/store/useSceneStore';
import { resolveEasing } from '@/lib/easing';
import { assetIndexForSlot, clamp } from '@/lib/motion';
import { resolveTrackTime, trackAssetIndices, type MotionTrack } from '@/lib/tracks';
import { cardAspectFor, coverCrop, cropKey } from '@/lib/crop';
import { advanceVideoForExport, createCardVideo, isVideoSource, prepareVideoForSequentialExport, whenVideoReady } from '@/lib/videoTexture';

// Reference base long-edge (px) shared with templates (carousel BASE = 340),
// so control values read directly in on-screen pixels.
const SPRITE_BASE = 340;

// Monochrome placeholder card colour (a touch above --card-inset for contrast
// against the --frame backdrop) and its faint index label colour.
const PLACEHOLDER_FILL = 0x242424;
const PLACEHOLDER_LABEL = 0x6a6a6a;

interface Slot {
  sprite: PIXI.Sprite;
  mask: PIXI.Graphics;
  label: PIXI.Text;
  texW: number;
  texH: number;
  maskKey: string; // last-applied corner radius + clip, so the mask redraws only on change
  bindKey: string; // guards async image/video loads from overwriting a newer slot
  // The slot's undimmed tint (white for a real image, grey for a placeholder).
  // Kept because the per-frame loop multiplies it by the pose's `dim`, and
  // would otherwise erase the placeholder's own tint.
  baseTint: number;
}

// The GPU-side realization of one motion track. Each track owns its own sprite
// pool and its own container, so tracks composite over each other (container
// order = stacking order) and can carry independent alpha / blend modes.
interface TrackRT {
  container: PIXI.Container;
  slots: Slot[];
  assetSig: string;
  countSig: number;
}

// Multiply every channel of a packed 0xRRGGBB tint, for `dim`.
function scaleTint(tint: number, k: number): number {
  const r = Math.round(((tint >> 16) & 0xff) * k);
  const g = Math.round(((tint >> 8) & 0xff) * k);
  const b = Math.round((tint & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

// A single white rounded texture, tinted per placeholder card.
function makePlaceholderTexture(app: PIXI.Application): PIXI.Texture {
  const g = new PIXI.Graphics();
  g.roundRect(0, 0, 480, 600, 8).fill(0xffffff);
  return app.renderer.generateTexture(g);
}

export class SceneRenderer {
  app: PIXI.Application;
  onDirty?: () => void;   // preview loop hooks this to redraw once after async loads
  private content = new PIXI.Container();       // bg + motion (effects applied here)
  private bg = new PIXI.Graphics();
  private bgSprite = new PIXI.Sprite();          // image / card-reflected background
  private bgBlur = new PIXI.BlurFilter({ strength: 28, quality: 4 });
  private motion = new PIXI.Container();         // card sprites
  private overlay = new PIXI.Container();        // logo/safe-area (unfiltered)
  private safeGfx = new PIXI.Graphics();
  private logoSprite: PIXI.Sprite | null = null;
  private placeholder!: PIXI.Texture;
  private textureCache = new Map<string, PIXI.Texture>();
  private texturePromises = new Map<string, Promise<PIXI.Texture | null>>();
  private croppedCache = new Map<string, PIXI.Texture>(); // cover-crop views over cached base textures
  private videoEls = new Map<string, HTMLVideoElement>();  // live <video> per url, for playback + cleanup
  private exportVideoFrames = new Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: PIXI.Texture }>();
  private liveVideoTextures = new Map<string, PIXI.Texture>();
  // One runtime per motion track, keyed by track id. `motion` holds their
  // containers; zIndex mirrors the store's track order.
  private trackRTs = new Map<string, TrackRT>();
  private ready = false;

  private lastFxSig = '';
  private bgImageUrl = '';                        // last-loaded uploaded bg url
  private bgImageTex: PIXI.Texture | null = null;

  constructor() {
    this.app = new PIXI.Application();
  }

  async init(canvas: HTMLCanvasElement) {
    const { width, height } = useSceneStore.getState();
    await this.app.init({
      canvas,
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      autoStart: false,          // we drive rendering ourselves
      preference: 'webgl',
      powerPreference: 'high-performance', // hint the browser to use the discrete GPU
      resolution: 1,
      preserveDrawingBuffer: true, // so toDataURL reads real pixels during export
    });

    this.motion.sortableChildren = true;
    this.bgSprite.anchor.set(0.5);
    this.bgSprite.visible = false;
    this.bgSprite.filters = [this.bgBlur];
    this.content.addChild(this.bg, this.bgSprite, this.motion);
    this.app.stage.addChild(this.content, this.overlay);
    this.overlay.addChild(this.safeGfx);

    this.placeholder = makePlaceholderTexture(this.app);
    this.ready = true;
    this.resize(width, height);
    this.syncAssets();
  }

  resize(width: number, height: number, resolution = 1) {
    if (!this.ready) return;
    this.app.renderer.resize(width, height, resolution);
    this.motion.position.set(width / 2, height / 2);
    this.bgSprite.position.set(width / 2, height / 2);
    this.content.filterArea = new PIXI.Rectangle(0, 0, width, height);
    this.overlay.position.set(0, 0);
  }

  // ---- asset / slot management ----
  // Loads via HTMLImageElement instead of PIXI.Assets: uploads are blob: URLs
  // with no file extension, which Assets can't route to a parser (resolves null).
  // Video assets decode into a VideoSource whose texture auto-updates each frame.
  private loadTexture(url: string, kind?: string): Promise<PIXI.Texture | null> {
    const cached = this.textureCache.get(url);
    if (cached) return Promise.resolve(cached);
    const pending = this.texturePromises.get(url);
    if (pending) return pending;
    const promise = this.decodeTexture(url, kind)
      .finally(() => { this.texturePromises.delete(url); });
    this.texturePromises.set(url, promise);
    return promise;
  }

  private async decodeTexture(url: string, kind?: string): Promise<PIXI.Texture | null> {
    const cached = this.textureCache.get(url);
    if (cached) return cached;
    try {
      if (isVideoSource(url, kind)) {
        const video = this.videoEls.get(url) ?? createCardVideo(url);
        this.videoEls.set(url, video);
        await whenVideoReady(video); // videoWidth/height valid past here
        if (!this.ready) return null;
        // updateFPS:0 → re-upload the frame on every render (Ticker-driven).
        const source = new PIXI.VideoSource({ resource: video, autoPlay: true, loop: true, muted: true, updateFPS: 0 });
        const tex = new PIXI.Texture({ source });
        this.textureCache.set(url, tex);
        video.play().catch(() => { /* autoplay blocked — stays on first frame */ });
        return tex;
      }
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!this.ready) return null;
      const tex = PIXI.Texture.from(img);
      this.textureCache.set(url, tex);
      return tex;
    } catch {
      return null; // unreadable/revoked URL — caller keeps the placeholder
    }
  }

  // Cover-fit a loaded texture into the template's card shape: a cropped view
  // (no stretch) anchored at the asset's focal point. Cached per url/aspect/focus.
  private croppedView(url: string, base: PIXI.Texture, aspect: number, crop?: { x: number; y: number }): PIXI.Texture {
    const key = cropKey(url, aspect, crop);
    const hit = this.croppedCache.get(key);
    if (hit) return hit;
    const { fx, fy, fw, fh } = coverCrop(base.width, base.height, aspect, crop);
    const tex = new PIXI.Texture({ source: base.source, frame: new PIXI.Rectangle(fx, fy, fw, fh) });
    this.croppedCache.set(key, tex);
    return tex;
  }

  // Reconcile the GPU track list against the store, then rebuild each track's
  // sprite pool. Container order inside `motion` is the stacking order, so a
  // track later in the array draws over the ones before it.
  syncAssets() {
    if (!this.ready) return;
    const s = useSceneStore.getState();

    // drop runtimes for tracks that no longer exist
    for (const [id, rt] of this.trackRTs) {
      if (!s.tracks.some((t) => t.id === id)) {
        rt.container.destroy({ children: true });
        this.trackRTs.delete(id);
      }
    }

    s.tracks.forEach((track, order) => {
      let rt = this.trackRTs.get(track.id);
      if (!rt) {
        const container = new PIXI.Container();
        container.sortableChildren = true; // per-track depth sorting
        this.motion.addChild(container);
        rt = { container, slots: [], assetSig: '', countSig: -1 };
        this.trackRTs.set(track.id, rt);
      }
      rt.container.zIndex = order;
      this.syncTrackSlots(track, rt, s);
    });
  }

  // Rebuild one track's sprite pool to match its count; slot i binds to the
  // i-th asset OF THIS TRACK'S SLICE (positional, 1:1 with the Assets panel
  // when the track takes everything), or to i % length when the template opts
  // into repeatAssets (high-count fields). Slots past the list cycle the
  // available images; numbered placeholders appear only with zero assets.
  private syncTrackSlots(track: MotionTrack, rt: TrackRT, s: SceneState) {
    const meta = getTemplate(track.templateId).meta;
    const repeat = meta.repeatAssets === true;
    const aspect = cardAspectFor(meta, s.width, s.height, s.cardShape);
    // Asked of the template, not read off its `count` control: a lattice family
    // derives how many cells the canvas needs, so its pool has to follow the
    // canvas. `countSig` below already keys the rebuild on this number, so a
    // resize or a card-size change re-pools on its own.
    const count = layerCountFor(track.templateId, track.values,
      { width: s.width, height: s.height, cardAspect: aspect });
    // Which scene assets feed this track, in track order.
    const indices = trackAssetIndices(track, s.assets);
    const pool = indices.map((i) => s.assets[i]).filter(Boolean);

    const assetSig = (repeat ? 'R|' : '') + 'A' + aspect.toFixed(4) + '|' +
      pool.map((a) => a.id + ':' + a.url + ':' + a.visible + ':' + (a.crop ? a.crop.x + ',' + a.crop.y : 'c')).join('|');

    if (count === rt.countSig && assetSig === rt.assetSig) return;
    rt.countSig = count;
    rt.assetSig = assetSig;

    // grow / shrink pool
    while (rt.slots.length < count) {
      const sprite = new PIXI.Sprite(this.placeholder);
      sprite.anchor.set(0.5);
      const mask = new PIXI.Graphics();
      sprite.addChild(mask);
      sprite.mask = mask;
      const label = new PIXI.Text({
        text: '',
        style: { fill: PLACEHOLDER_LABEL, fontSize: 130, fontWeight: '600', fontFamily: 'Inter, system-ui, sans-serif' },
      });
      label.anchor.set(0.5);
      sprite.addChild(label);
      rt.container.addChild(sprite);
      rt.slots.push({ sprite, mask, label, texW: 480, texH: 600, maskKey: '', bindKey: '', baseTint: 0xffffff });
    }
    while (rt.slots.length > count) {
      const slot = rt.slots.pop()!;
      slot.sprite.destroy({ children: true });
    }

    // assign textures — slot i ↔ pool asset i (or i % pool.length when
    // repeating); slots past the list cycle the set; hidden → placeholder
    rt.slots.forEach((slot, i) => {
      let asset = pool[assetIndexForSlot(i, pool.length, repeat)];
      if (!asset && pool.length > 0) asset = pool[i % pool.length];
      const binding = asset
        ? `${asset.id}|${asset.url}|${aspect.toFixed(4)}|${asset.crop?.x ?? 0.5},${asset.crop?.y ?? 0.5}`
        : `placeholder|${i}`;
      const bindingChanged = slot.bindKey !== binding;
      slot.bindKey = binding;
      if (!asset || !asset.visible) {
        slot.sprite.texture = this.placeholder;
        slot.baseTint = PLACEHOLDER_FILL;
        slot.sprite.tint = PLACEHOLDER_FILL;
        slot.label.text = String(i + 1);
        slot.label.visible = true;
        slot.texW = 480; slot.texH = 600; slot.maskKey = '';
      } else {
        if (bindingChanged) {
          // Never leave the previous template's image visible while a new crop
          // is decoding. Local/demo files replace this again in the same tick.
          slot.sprite.texture = this.placeholder;
          slot.baseTint = PLACEHOLDER_FILL;
          slot.sprite.tint = PLACEHOLDER_FILL;
          slot.label.text = String(i + 1);
          slot.label.visible = true;
        }
        slot.baseTint = 0xffffff;
        slot.sprite.tint = 0xffffff;
        const { url, crop, kind } = asset;
        this.loadTexture(url, kind).then((base) => {
          if (!base || slot.sprite.destroyed || slot.bindKey !== binding) return;
          const tex = this.croppedView(url, base, aspect, crop);
          slot.sprite.texture = tex;
          slot.label.visible = false;
          slot.texW = tex.width; slot.texH = tex.height; slot.maskKey = '';
          this.onDirty?.(); // texture arrived — an idle preview must redraw
        });
      }
    });
  }

  // Force every track to rebuild its pool on the next syncAssets — used when the
  // texture cache is swapped wholesale (video export begin/end).
  private invalidateTracks() {
    this.trackRTs.forEach((rt) => { rt.assetSig = ''; rt.countSig = -1; });
  }

  private applyMask(slot: Slot, cornerRadiusPct: number, clip?: LayerTransform['clip']) {
    const frac = Math.max(0, Math.min(1, cornerRadiusPct / 100));
    const c = clip
      ? {
          x0: Math.max(0, Math.min(1, clip.x0)), y0: Math.max(0, Math.min(1, clip.y0)),
          x1: Math.max(0, Math.min(1, clip.x1)), y1: Math.max(0, Math.min(1, clip.y1)),
        }
      : null;
    const partial = !!c && (c.x0 > 0 || c.y0 > 0 || c.x1 < 1 || c.y1 < 1);
    const key = partial ? `${frac}|${c!.x0}|${c!.y0}|${c!.x1}|${c!.y1}` : `${frac}`;
    if (slot.maskKey === key) return; // cached
    slot.maskKey = key;
    if (frac === 0 && !partial) {
      // nothing to stencil → drop the mask entirely (matters at high counts)
      slot.sprite.mask = null;
      slot.mask.visible = false;
      slot.mask.clear();
      return;
    }
    slot.sprite.mask = slot.mask;
    slot.mask.visible = true;
    const w = slot.texW, h = slot.texH;
    slot.mask.clear();
    if (!partial) {
      slot.mask.roundRect(-w / 2, -h / 2, w, h, (Math.min(w, h) / 2) * frac).fill(0xffffff);
      return;
    }
    // Only the uncovered band. Its own corner radius is capped by the band, so
    // a half-revealed rounded card does not round the wipe edge itself — the
    // radius applies to the band, which for the wipe presets (all corner
    // radius 0) is exactly a straight edge.
    const bx = -w / 2 + c!.x0 * w, by = -h / 2 + c!.y0 * h;
    const bw = Math.max(0, (c!.x1 - c!.x0) * w), bh = Math.max(0, (c!.y1 - c!.y0) * h);
    if (bw <= 0 || bh <= 0) { slot.mask.rect(0, 0, 0, 0).fill(0xffffff); return; }
    const r = Math.min((Math.min(w, h) / 2) * frac, Math.min(bw, bh) / 2);
    slot.mask.roundRect(bx, by, bw, bh, r).fill(0xffffff);
  }

  // ---- effects ----
  private syncEffects() {
    const s = useSceneStore.getState();
    const active = s.effects.filter((e) => e.enabled);
    const sig = active.map((e) => e.instanceId + ':' + e.effectId + ':' + JSON.stringify(e.values)).join('|');
    if (sig === this.lastFxSig) return;
    this.lastFxSig = sig;

    const filters: PIXI.Filter[] = [];
    for (const e of active) {
      const def = getEffect(e.effectId);
      if (!def) continue;
      try {
        filters.push(def.createFilter(e.values));
      } catch { /* skip bad filter */ }
    }
    this.content.filters = filters.length ? filters : [];
  }

  // ---- overlays ----
  private drawOverlays(s: SceneState) {
    const { width, height } = s;

    // background
    this.bg.clear();
    if (s.background.gradient) {
      const grad = new PIXI.FillGradient(0, 0, 0, height);
      grad.addColorStop(0, s.background.color);
      grad.addColorStop(1, s.background.color2);
      this.bg.rect(0, 0, width, height).fill(grad);
    } else {
      this.bg.rect(0, 0, width, height).fill(s.background.color);
    }

    // safe area guide
    this.safeGfx.clear();
    if (s.safeArea) {
      const mx = width * 0.05, my = height * 0.05;
      this.safeGfx
        .rect(mx, my, width - mx * 2, height - my * 2)
        .stroke({ width: 2, color: 0x00e5ff, alpha: 0.6 });
    }

    // logo
    if (s.logo.url) {
      if (!this.logoSprite) {
        this.logoSprite = new PIXI.Sprite();
        this.logoSprite.anchor.set(0.5);
        this.overlay.addChild(this.logoSprite);
      }
      this.loadTexture(s.logo.url).then((tex) => {
        if (!tex || !this.logoSprite || this.logoSprite.destroyed) return;
        this.logoSprite.texture = tex;
        const scale = s.logo.size / Math.max(tex.width, tex.height);
        this.logoSprite.scale.set(scale);
        this.onDirty?.();
      });
      const pad = 32;
      const half = s.logo.size / 2;
      const px = s.logo.position.includes('r') ? width - pad - half : pad + half;
      const py = s.logo.position.startsWith('t') ? pad + half : height - pad - half;
      this.logoSprite.position.set(px, py);
      this.logoSprite.visible = true;
    } else if (this.logoSprite) {
      this.logoSprite.visible = false;
    }
  }

  // Image / card-reflected background. Called after the motion loop so the
  // 'card' source can follow the featured card's live position.
  private updateBackground(
    s: SceneState,
    featured: { tex: PIXI.Texture; x: number; y: number } | null,
  ) {
    const bg = s.background;
    const { width, height } = s;

    let tex: PIXI.Texture | null = null;
    let follow = false;
    if (bg.source === 'image') {
      if (bg.imageUrl && bg.imageUrl !== this.bgImageUrl) {
        this.bgImageUrl = bg.imageUrl;
        this.bgImageTex = null;
        this.loadTexture(bg.imageUrl).then((t) => { if (t) { this.bgImageTex = t; this.onDirty?.(); } });
      }
      if (!bg.imageUrl) { this.bgImageUrl = ''; this.bgImageTex = null; }
      tex = this.bgImageTex;
    } else if (bg.source === 'card' && featured) {
      tex = featured.tex;
      follow = true;
    }

    if (!tex) { this.bgSprite.visible = false; return; }

    this.bgSprite.visible = true;
    this.bgSprite.texture = tex;
    const cover = Math.max(width / tex.width, height / tex.height) * 1.4; // headroom for drift
    this.bgSprite.scale.set(cover);
    // 'card' bg drifts with the featured card so the background reacts to motion
    const k = follow ? 0.18 : 0;
    this.bgSprite.position.set(width / 2 + (featured?.x ?? 0) * k, height / 2 + (featured?.y ?? 0) * k);
    this.bgBlur.strength = Math.max(0, bg.blur);
  }

  /**
   * THE single clock. Realizes the full scene onto the stage for `frame`.
   * Both live preview and export capture call this — WYSIWYG guarantee.
   * Reads the live store every call (principle 1).
   */
  getFrameState(frame: number) {
    if (!this.ready) return;
    const s = useSceneStore.getState();

    this.syncAssets();
    // live loop/hold behaviour follows the scene setting (non-loop <video>
    // naturally freezes on its last frame when it ends)
    this.videoEls.forEach((v) => { v.loop = s.videoEnd !== 'hold'; });
    this.syncEffects();
    this.drawOverlays(s);

    const totalFrames = Math.max(1, Math.round(s.duration * s.fps));

    // Track the featured (front-most) card so a 'card' background can reflect
    // it. Later tracks draw on top, so their cards win ties — the background
    // reflects what the viewer actually sees in front.
    let featured: { tex: PIXI.Texture; x: number; y: number } | null = null;
    let featuredScore = -Infinity;

    s.tracks.forEach((track, order) => {
      const rt = this.trackRTs.get(track.id);
      if (!rt) return;

      // Map the scene frame onto this track's own window. Outside it, the whole
      // container is hidden — no per-slot work at all.
      const time = resolveTrackTime(track, frame, totalFrames);
      if (!time.active) { rt.container.visible = false; return; }

      rt.container.visible = true;
      rt.container.alpha = clamp(track.opacity, 0, 1) * time.envelope;
      rt.container.blendMode = track.blend;
      // Track-level transform, on top of whatever the template poses.
      rt.container.position.set(track.transform.x, track.transform.y);
      rt.container.scale.set(track.transform.scale);
      rt.container.rotation = (track.transform.rotation * Math.PI) / 180;

      const template = getTemplate(track.templateId);
      const count = rt.slots.length;

      // Resolve this track's easing once per frame; shape cyclic phases so each
      // unit step follows the curve while the loop stays seamless (ease(0)=0,
      // ease(1)=1 ⇒ continuous at every integer boundary).
      const ease = resolveEasing(track.easing);
      const easedPhase = (phase: number) => {
        const base = Math.floor(phase);
        return base + ease(phase - base);
      };
      // The track's WINDOW is its clip: templates quantize against
      // ctx.totalFrames, so each track loops seamlessly inside its own window.
      const ctx = {
        fps: s.fps, width: s.width, height: s.height,
        duration: time.localTotal / Math.max(1, s.fps),
        totalFrames: time.localTotal,
        ease, easedPhase,
        // Resolved the same way the sprites themselves are cropped, so a
        // lattice template spaces cards by the shape actually on screen.
        cardAspect: cardAspectFor(template.meta, s.width, s.height, s.cardShape),
      };

      for (let i = 0; i < count; i++) {
        const slot = rt.slots[i];
        const t = template.transform(time.localFrame, i, count, track.values, ctx);
        const norm = SPRITE_BASE / Math.max(slot.texW, slot.texH);
        slot.sprite.position.set(t.x, t.y);
        slot.sprite.scale.set(norm * t.scale * (t.scaleX ?? 1), norm * t.scale * (t.scaleY ?? 1));
        slot.sprite.rotation = t.rotation;
        slot.sprite.alpha = t.alpha;
        // `dim` darkens toward black rather than going see-through, so a
        // receding card occludes what is behind it instead of ghosting it.
        const dim = clamp(t.dim ?? 0, 0, 1);
        slot.sprite.tint = dim > 0 ? scaleTint(slot.baseTint, 1 - dim) : slot.baseTint;
        slot.sprite.skew.set(t.skewX ?? 0, t.skewY ?? 0);
        slot.sprite.zIndex = t.depth * 1000 + i; // stable tiebreak
        this.applyMask(slot, track.values.cornerRadius ?? 0, t.clip);

        // Rank across tracks: stacking order dominates, card depth breaks ties.
        const score = order * 1e6 + t.depth;
        if (score > featuredScore && t.alpha > 0.15) {
          featuredScore = score;
          featured = { tex: slot.sprite.texture, x: t.x, y: t.y };
        }
      }
    });

    this.updateBackground(s, featured);
  }

  // ---- video export sync ----
  async beginVideoExport() {
    if (this.videoEls.size === 0) return;
    await Promise.all([...this.videoEls.values()].map(prepareVideoForSequentialExport));

    // A live VideoSource can upload an older presented frame while repeated
    // seeks are happening. Export through canvas snapshots instead, so every
    // captured scene reads immutable pixels from the completed seek.
    this.videoEls.forEach((video, url) => {
      const live = this.textureCache.get(url);
      if (!live || !video.videoWidth || !video.videoHeight) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const texture = PIXI.Texture.from(canvas);
      this.liveVideoTextures.set(url, live);
      this.exportVideoFrames.set(url, { canvas, ctx, texture });
      this.textureCache.set(url, texture);
    });
    this.croppedCache.forEach((tex) => tex.destroy(false));
    this.croppedCache.clear();
    this.invalidateTracks();
    this.syncAssets();
    await Promise.resolve();
  }

  endVideoExport() {
    this.liveVideoTextures.forEach((texture, url) => this.textureCache.set(url, texture));
    this.liveVideoTextures.clear();
    this.croppedCache.forEach((tex) => tex.destroy(false));
    this.croppedCache.clear();
    this.exportVideoFrames.forEach(({ texture }) => texture.destroy(true));
    this.exportVideoFrames.clear();
    this.invalidateTracks();
    this.syncAssets();
  }

  // Live preview plays videos on wall-clock; export is frame-indexed. Seek every
  // video card to the export time for `frame`, wait for the frame to decode, and
  // mark its GPU texture dirty so the next render uploads exactly that frame.
  async seekVideos(frame: number) {
    if (this.videoEls.size === 0) return;
    const s = useSceneStore.getState();
    const t = frame / Math.max(1, s.fps);
    await Promise.all([...this.videoEls.values()].map((v) => advanceVideoForExport(v, t, s.fps, s.videoEnd)));
    // Copy decoded pixels before touching the renderer. This isolates export
    // from the live VideoSource callback queue and makes GPU uploads ordered.
    this.videoEls.forEach((video, url) => {
      const snapshot = this.exportVideoFrames.get(url);
      if (snapshot) {
        snapshot.ctx.drawImage(video, 0, 0);
        snapshot.texture.source.update();
      } else {
        (this.textureCache.get(url)?.source as PIXI.TextureSource | undefined)?.update();
      }
    });
  }

  // Resume live playback (export finished, or preview un-paused).
  resumeVideos() {
    this.videoEls.forEach((v) => { v.play().catch(() => { /* noop */ }); });
  }

  // Freeze video decoding while the preview is paused — no point spending CPU/GPU
  // decoding frames nothing is advancing.
  pauseVideos() {
    this.videoEls.forEach((v) => { try { v.pause(); } catch { /* noop */ } });
  }

  // Timeline wrapped to 0 — restart 'hold' videos together with the clip.
  restartVideos() {
    this.videoEls.forEach((v) => {
      // Looping videos keep their own continuous playback clock. Resetting them
      // at every scene wrap makes longer clips visibly jump backwards inside
      // otherwise smoothly looping cards.
      if (v.loop) return;
      try { v.currentTime = 0; v.play().catch(() => { /* noop */ }); } catch { /* noop */ }
    });
  }

  // Realize + render a frame synchronously (used by export).
  renderFrame(frame: number) {
    this.getFrameState(frame);
    this.app.renderer.render(this.app.stage);
  }

  // Deterministic capture: realize frame, render, read pixels as a JPEG data URL.
  // JPEG (q0.92) over PNG: ~5–10× smaller + far faster to encode at 2K/4K, and
  // the scene always paints a background so the missing alpha channel is moot.
  // ffmpeg re-encodes to h264/gif downstream, so there's no visible quality loss.
  captureFrame(frame: number): string {
    this.renderFrame(frame);
    return (this.app.canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.92);
  }

  // Multiply the backing-store resolution for export capture. Logical
  // coordinates stay at store width/height, so template layout is untouched;
  // only the pixel density of the rendered output changes.
  setCaptureScale(k: number) {
    const { width, height } = useSceneStore.getState();
    this.resize(width, height, k);
  }

  extractCanvas(): HTMLCanvasElement {
    return this.app.canvas as HTMLCanvasElement;
  }

  destroy() {
    this.ready = false;
    this.texturePromises.clear();
    this.videoEls.forEach((v) => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* noop */ } });
    this.videoEls.clear();
    try { this.app.destroy(true, { children: true, texture: false }); } catch { /* noop */ }
  }
}
