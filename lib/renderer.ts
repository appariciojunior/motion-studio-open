import * as PIXI from 'pixi.js';
import type { LayerTransform } from '@/lib/types';
import { getTemplate, layerCountFor } from '@/templates';
import { getEffect } from '@/effects';
import { applyPixiUniforms, dropPixiFilters, pixiFiltersFor } from '@/effects/adapters/pixi';
import { useSceneStore, type SceneState } from '@/store/useSceneStore';
import { resolveEasing } from '@/lib/easing';
import { assetIndexForSlot, clamp } from '@/lib/motion';
import { resolveTrackTime, trackAssetIndices, type MotionTrack } from '@/lib/tracks';
import { cardAspectFor, coverCrop, cropKey, type CropFocus } from '@/lib/crop';
import { advanceVideoForExport, createCardVideo, isVideoSource, prepareVideoForSequentialExport, useVideoProxies, whenVideoReady } from '@/lib/videoTexture';
import { BASE_PATH, IS_STATIC_EXPORT } from '@/lib/paths';
import { advancedRasterSize, gradientRasterMaxEdge, gradientSignature, normalizeGradientSpec, paintGradientCanvas } from '@/lib/gradient';

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
  // Projective path, for poses that carry `taper` (see LayerTransform.taper).
  // Built lazily and per slot, so a catalogue where almost nothing tapers pays
  // nothing: the mesh only exists once a template has actually asked for one.
  mesh?: PIXI.PerspectiveMesh;
  meshMask?: PIXI.Graphics;
  tapered: boolean;   // which node is currently the visible one
  taperKey: string;   // last-applied corner set, so the geometry rebuilds only on change
}

// The card's four corners in texture space with `edge` shortened to `ratio` of
// the edge opposite it, clockwise from top-left — the order PerspectiveMesh
// takes. The un-narrowed edge keeps its full length, so it stays exactly where
// the affine pose put it and only the far edge moves.
function taperCorners(w: number, h: number, taper: NonNullable<LayerTransform['taper']>) {
  const r = Math.max(0.02, Math.min(1, taper.ratio));
  const hw = w / 2, hh = h / 2;
  const ix = hw * (1 - r), iy = hh * (1 - r);
  switch (taper.edge) {
    case 'top': return [-hw + ix, -hh, hw - ix, -hh, hw, hh, -hw, hh];
    case 'bottom': return [-hw, -hh, hw, -hh, hw - ix, hh, -hw + ix, hh];
    case 'left': return [-hw, -hh + iy, hw, -hh, hw, hh, -hw, hh - iy];
    default: return [-hw, -hh, hw, -hh + iy, hw, hh - iy, -hw, hh]; // 'right'
  }
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
//
// `app.renderer` can be null, and being explicit about it matters: a browser
// hands out a finite number of GL contexts, and when they run out `app.init()`
// resolves with no renderer at all. This then threw "Cannot read properties of
// null (reading 'clear')" from inside generateTexture — a message that says
// nothing about the real cause and took the whole editor down with it.
function makePlaceholderTexture(app: PIXI.Application): PIXI.Texture | null {
  if (!app.renderer) return null;
  const g = new PIXI.Graphics();
  g.roundRect(0, 0, 480, 600, 8).fill(0xffffff);
  return app.renderer.generateTexture(g);
}

export class SceneRenderer {
  app: PIXI.Application;
  onDirty?: () => void;   // preview loop hooks this to redraw once after async loads
  private content = new PIXI.Container();       // bg + motion (effects applied here)
  private bg = new PIXI.Graphics();
  private gradientSprite = new PIXI.Sprite();
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
  private restoreVideoSources: (() => void) | null = null; // undo the export proxy swap
  // One runtime per motion track, keyed by track id. `motion` holds their
  // containers; zIndex mirrors the store's track order.
  private trackRTs = new Map<string, TrackRT>();
  private ready = false;
  private destroyed = false;

  private lastFxSig = '';
  private bgImageUrl = '';                        // last-loaded uploaded bg url
  private bgImageTex: PIXI.Texture | null = null;
  private gradientCanvas: HTMLCanvasElement | null = null;
  private gradientTexture: PIXI.Texture | null = null;
  private gradientKey = '';

  constructor() {
    this.app = new PIXI.Application();
  }

  async init(canvas: HTMLCanvasElement) {
    if (this.destroyed) return;
    const { width, height } = useSceneStore.getState();
    try {
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
    } catch {
      return;
    }

    if (this.destroyed || !this.app?.renderer) return;

    this.motion.sortableChildren = true;
    this.bgSprite.anchor.set(0.5);
    this.gradientSprite.anchor.set(0.5);
    this.gradientSprite.visible = false;
    this.bgSprite.visible = false;
    this.bgSprite.filters = [this.bgBlur];
    this.content.addChild(this.bg, this.gradientSprite, this.bgSprite, this.motion);
    this.app.stage.addChild(this.content, this.overlay);
    this.overlay.addChild(this.safeGfx);

    const placeholder = makePlaceholderTexture(this.app);
    if (!placeholder) {
      // Sem contexto GL nao ha o que renderizar. Falhar aqui, alto e claro, e
      // melhor do que seguir com um renderer meio construido e estourar depois
      // num ponto que nao explica a causa.
      this.ready = false;
      throw new Error(
        'SceneRenderer: o navegador nao concedeu contexto WebGL '
        + '(provavelmente esgotado por outros canvas na pagina).',
      );
    }
    this.placeholder = placeholder;
    this.ready = true;
    this.resize(width, height);
    this.syncAssets();
  }

  resize(width: number, height: number, resolution = 1) {
    if (!this.ready || this.destroyed || !this.app?.renderer) return;
    try {
      this.app.renderer.resize(width, height, resolution);
      this.motion.position.set(width / 2, height / 2);
      this.bgSprite.position.set(width / 2, height / 2);
      this.gradientSprite.position.set(width / 2, height / 2);
      this.content.filterArea = new PIXI.Rectangle(0, 0, width, height);
      this.overlay.position.set(0, 0);
    } catch { /* noop */ }
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
  private croppedView(url: string, base: PIXI.Texture, aspect: number, crop?: CropFocus): PIXI.Texture {
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
      pool.map((a) => a.id + ':' + a.url + ':' + a.visible + ':' + cropKey(a.url, aspect, a.crop)).join('|');

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
      rt.slots.push({ sprite, mask, label, texW: 480, texH: 600, maskKey: '', bindKey: '', baseTint: 0xffffff, tapered: false, taperKey: '' });
    }
    while (rt.slots.length > count) {
      const slot = rt.slots.pop()!;
      // The label may currently be parented to the mesh, so drop the mesh
      // first and let the sprite's own destroy take whatever is still under it.
      slot.mesh?.destroy({ children: true });
      slot.sprite.destroy({ children: true });
    }

    // assign textures — slot i ↔ pool asset i (or i % pool.length when
    // repeating); slots past the list cycle the set; hidden → placeholder
    rt.slots.forEach((slot, i) => {
      let asset = pool[assetIndexForSlot(i, pool.length, repeat)];
      if (!asset && pool.length > 0) asset = pool[i % pool.length];
      const binding = asset
        ? `${asset.id}|${cropKey(asset.url, aspect, asset.crop)}`
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

  // Returns whichever node should carry this frame's pose, swapping the sprite
  // for a perspective mesh (and back) only when the pose crosses into or out of
  // being tapered. The label rides along so a placeholder keeps its number, and
  // the mask cache is invalidated because the mask belongs to the other node.
  private selectNode(
    slot: Slot,
    container: PIXI.Container,
    taper: LayerTransform['taper'] | null,
  ): PIXI.Sprite | PIXI.PerspectiveMesh {
    if (!taper) {
      if (slot.tapered) {
        slot.tapered = false;
        slot.sprite.visible = true;
        if (slot.mesh) slot.mesh.visible = false;
        slot.sprite.addChild(slot.label);
        slot.maskKey = '';
      }
      return slot.sprite;
    }
    if (!slot.mesh) {
      // 10x10 vertices is far more than this needs — the projection is smooth
      // and a card is a few hundred px at most — while staying cheap enough to
      // build mid-animation.
      const mesh = new PIXI.PerspectiveMesh({
        texture: slot.sprite.texture,
        verticesX: 10, verticesY: 10,
        x0: 0, y0: 0, x1: 1, y1: 0, x2: 1, y2: 1, x3: 0, y3: 1,
      });
      const mm = new PIXI.Graphics();
      mesh.addChild(mm);
      slot.mesh = mesh;
      slot.meshMask = mm;
      container.addChild(mesh);
    }
    const mesh = slot.mesh;
    if (mesh.texture !== slot.sprite.texture) { mesh.texture = slot.sprite.texture; slot.taperKey = ''; }
    // Keyed on the texture size too: a crop arriving late changes the corners.
    const key = `${taper.edge}|${taper.ratio.toFixed(4)}|${slot.texW}x${slot.texH}`;
    if (slot.taperKey !== key) {
      slot.taperKey = key;
      const c = taperCorners(slot.texW, slot.texH, taper);
      mesh.setCorners(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
    }
    if (!slot.tapered) {
      slot.tapered = true;
      slot.sprite.visible = false;
      mesh.visible = true;
      mesh.addChild(slot.label);
      slot.maskKey = '';
    }
    return mesh;
  }

  private applyMask(
    slot: Slot,
    cornerRadiusPct: number,
    clip?: LayerTransform['clip'],
    taper?: LayerTransform['taper'] | null,
  ) {
    if (taper) {
      // Under a taper the card is a trapezoid, so a rectangular mask would
      // round the wrong outline entirely. Stencil the actual quad instead.
      // `clip` is deliberately not combined with this: nothing asks for both,
      // and guessing at the intersection would be worse than ignoring it.
      const frac = Math.max(0, Math.min(1, cornerRadiusPct / 100));
      const key = `T|${frac}|${slot.taperKey}`;
      if (slot.maskKey === key) return;
      slot.maskKey = key;
      const mesh = slot.mesh!, mm = slot.meshMask!;
      if (frac === 0) { mesh.mask = null; mm.visible = false; mm.clear(); return; }
      mesh.mask = mm;
      mm.visible = true;
      mm.clear();
      const c = taperCorners(slot.texW, slot.texH, taper);
      const r = (Math.min(slot.texW, slot.texH) / 2) * frac;
      mm.roundShape(
        [{ x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] }],
        r,
      ).fill(0xffffff);
      return;
    }
    return this.applySpriteMask(slot, cornerRadiusPct, clip);
  }

  private applySpriteMask(slot: Slot, cornerRadiusPct: number, clip?: LayerTransform['clip']) {
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
  // Two different rates, deliberately separated.
  //
  // The FILTER LIST only changes when an effect is added, removed, reordered or
  // toggled — so it is rebuilt against a signature of exactly that, and the
  // programs behind it are compiled once and cached by effect id.
  //
  // The UNIFORMS change every frame (uTime advances even when nothing else
  // does), so they are written unconditionally, and writing them is just moving
  // floats. The old code lumped the two together and rebuilt filters whenever
  // any VALUE changed, which under the old contract cost nothing and under this
  // one would recompile a shader on every pixel of a dragged slider.
  // O ESCOPO decide em qual container o filtro entra:
  //   'scene'       `content`, que tem o fundo dentro (addChild(bg, ..., motion))
  //   'artwork'     `motion`, so os cards — o fundo passa intacto
  //   'track:<id>'  o container daquela camada
  //
  // `filterArea` e obrigatorio nos alvos que nao sao `content`. Sem ela o Pixi
  // usa os limites do container, e ai `uInputSize` passa a descrever aquele
  // retangulo em vez do quadro — um efeito medido a partir do centro (vinheta)
  // se centraria no aglomerado de cards, e nao no canvas. A area e LOCAL ao
  // container, e `motion` esta transladado para o centro, entao o retangulo
  // comeca em -w/2,-h/2.
  private targetFor(scope: string | undefined): PIXI.Container | null {
    if (!scope || scope === 'scene') return this.content;
    if (scope === 'artwork') return this.motion;
    if (scope.startsWith('track:')) {
      return this.trackRTs.get(scope.slice(6))?.container ?? null;
    }
    return this.content;
  }

  private syncEffects(frame: number) {
    const s = useSceneStore.getState();
    const active = s.effects.filter((e) => e.enabled);

    // O escopo entra na assinatura: mudar de alvo troca a lista dos DOIS
    // containers envolvidos, e sem isso a mudanca so apareceria no proximo
    // add/remove.
    const sig = active.map((e) => e.instanceId + ':' + e.effectId + '@' + (e.scope ?? 'scene')).join('|');
    if (sig !== this.lastFxSig) {
      this.lastFxSig = sig;
      const porAlvo = new Map<PIXI.Container, PIXI.Filter[]>();
      for (const e of active) {
        const def = getEffect(e.effectId);
        if (!def) continue;
        const alvo = this.targetFor(e.scope);
        if (!alvo) continue;   // camada removida: o efeito fica sem alvo, e sem efeito
        try {
          const lista = porAlvo.get(alvo) ?? [];
          // Um efeito pode ser mais de um passe (blur separavel). O Pixi
          // encadeia uma lista de filtros sozinho, entao os passes entram em
          // sequencia na mesma lista.
          lista.push(...pixiFiltersFor(def, e.instanceId));
          porAlvo.set(alvo, lista);
        } catch { /* a shader that will not compile must not take the scene down */ }
      }
      // Limpar TODOS os alvos possiveis antes de aplicar: um efeito que saiu de
      // 'artwork' para 'scene' deixaria o filtro velho pendurado em `motion`.
      const alvos: PIXI.Container[] = [this.content, this.motion];
      for (const rt of this.trackRTs.values()) alvos.push(rt.container);
      for (const alvo of alvos) {
        const lista = porAlvo.get(alvo) ?? [];
        alvo.filters = lista.length ? lista : [];
      }
      // Instancias que sairam da cena nao precisam segurar filtro.
      dropPixiFilters(new Set(active.map((e) => e.instanceId)));
    }

    // A area de filtro acompanha o canvas, e e reavaliada todo frame porque uma
    // camada pode ter acabado de nascer.
    const area = new PIXI.Rectangle(-s.width / 2, -s.height / 2, s.width, s.height);
    if (this.motion.filters && (this.motion.filters as PIXI.Filter[]).length) this.motion.filterArea = area;
    for (const rt of this.trackRTs.values()) {
      if (rt.container.filters && (rt.container.filters as PIXI.Filter[]).length) rt.container.filterArea = area;
    }

    // Time comes from the FRAME, never from the clock: an animated effect has to
    // land on the same phase every time a given frame is rendered, or the same
    // clip would export differently twice.
    const ctx = { width: s.width, height: s.height, time: frame / Math.max(1, s.fps) };
    for (const e of active) {
      const def = getEffect(e.effectId);
      if (!def) continue;
      try {
        applyPixiUniforms(pixiFiltersFor(def, e.instanceId), def, e.values, ctx);
      } catch { /* a bad uniform must not take the scene down either */ }
    }
  }

  // ---- overlays ----
  private drawOverlays(s: SceneState) {
    const { width, height } = s;
    const rawAlpha = s.background.alpha ?? 100;
    const alphaPct = (rawAlpha > 0 && rawAlpha <= 1) ? rawAlpha * 100 : rawAlpha;
    const backgroundAlpha = Math.max(0, Math.min(1, alphaPct / 100));

    // background
    this.bg.clear();
    this.bg.alpha = backgroundAlpha;
    this.gradientSprite.alpha = backgroundAlpha;

    if (backgroundAlpha === 0) {
      this.bg.visible = false;
      this.gradientSprite.visible = false;
      this.bgSprite.visible = false;
    } else if (s.background.source === 'color' && s.background.gradient) {
      this.bg.visible = false;
      this.bgSprite.visible = false;
      const spec = normalizeGradientSpec(s.background.gradientSpec, s.background.color, s.background.color2);
      const phase = ((s.frame / Math.max(1, s.duration * s.fps)) % 1 + 1) % 1;
      const [rw, rh] = advancedRasterSize(width, height, gradientRasterMaxEdge(spec));
      const key = `${rw}x${rh}|${gradientSignature(spec, phase)}`;
      if (key !== this.gradientKey) {
        this.gradientKey = key;
        const resized = !this.gradientCanvas || this.gradientCanvas.width !== rw || this.gradientCanvas.height !== rh;
        // Texture.from(canvas) caches by the canvas object's identity. Resizing
        // that same object from a Basic full-resolution ramp to an Advanced
        // raster leaves Pixi's production texture source at the old bounds;
        // the smaller image then appears as a tile in the bottom-left corner.
        // A fresh resource identity forces Pixi to allocate matching bounds.
        let gradientCanvas = this.gradientCanvas;
        if (!gradientCanvas || resized) {
          gradientCanvas = document.createElement('canvas');
          this.gradientCanvas = gradientCanvas;
        }
        paintGradientCanvas(gradientCanvas, spec, rw, rh, phase);
        if (!this.gradientTexture || resized) {
          this.gradientTexture?.destroy(true);
          this.gradientTexture = PIXI.Texture.from(gradientCanvas);
          this.gradientSprite.texture = this.gradientTexture;
        } else {
          this.gradientTexture.source.update();
        }
      }
      this.gradientSprite.visible = true;
      this.gradientSprite.scale.set(width / rw, height / rh);
    } else if (s.background.source === 'color') {
      this.gradientSprite.visible = false;
      this.bgSprite.visible = false;
      this.bg.visible = true;
      this.bg.rect(0, 0, width, height).fill(s.background.color);
    } else {
      this.bg.visible = false;
      this.gradientSprite.visible = false;
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

    const rawAlpha = bg.alpha ?? 100;
    const alphaPct = (rawAlpha > 0 && rawAlpha <= 1) ? rawAlpha * 100 : rawAlpha;
    const backgroundAlpha = Math.max(0, Math.min(1, alphaPct / 100));

    if (!tex || backgroundAlpha === 0) { this.bgSprite.visible = false; return; }

    this.bgSprite.visible = true;
    this.bgSprite.alpha = backgroundAlpha;
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
    this.syncEffects(frame);
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
        // A pose only leaves the sprite path when it is actually tilting out of
        // plane; a ratio of 1 is the same picture a sprite already draws, and
        // switching for it would cost a node swap every frame of a flat card.
        const taper = t.taper && t.taper.ratio < 0.999 ? t.taper : null;
        const node = this.selectNode(slot, rt.container, taper);
        node.position.set(t.x, t.y);
        node.scale.set(norm * t.scale * (t.scaleX ?? 1), norm * t.scale * (t.scaleY ?? 1));
        node.rotation = t.rotation;
        node.alpha = t.alpha;
        // `dim` darkens toward black rather than going see-through, so a
        // receding card occludes what is behind it instead of ghosting it.
        const dim = clamp(t.dim ?? 0, 0, 1);
        node.tint = dim > 0 ? scaleTint(slot.baseTint, 1 - dim) : slot.baseTint;
        node.skew.set(t.skewX ?? 0, t.skewY ?? 0);
        node.zIndex = t.depth * 1000 + i; // stable tiebreak
        this.applyMask(slot, track.values.cornerRadius ?? 0, t.clip, taper);

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
    // Swap every card to its all-intra proxy first: that is what makes a
    // per-frame seek cheap, and a cheap seek is what lets each captured frame
    // hold the exact video time it asks for. Without it (no server / no
    // ffmpeg) the forward-decode path below still runs, at coarser accuracy.
    if (!IS_STATIC_EXPORT) {
      this.restoreVideoSources = await useVideoProxies(this.videoEls, BASE_PATH);
    }
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
    this.restoreVideoSources?.();
    this.restoreVideoSources = null;
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
    if (!this.ready || this.destroyed || !this.app?.renderer) return;
    try {
      if ((this.app.renderer as any).background) {
        (this.app.renderer as any).background.alpha = 0;
      }
      this.getFrameState(frame);
      if (!this.ready || this.destroyed || !this.app?.renderer) return;
      this.app.renderer.render(this.app.stage);
    } catch {
      // guard against renderer being destroyed mid-frame or WebGL context lost
    }
  }

  // Deterministic capture: realize frame, render, read pixels as a data URL.
  // PNG when background has transparency (alpha < 100) so the alpha channel is preserved.
  // JPEG (q0.92) when opaque: ~5–10× smaller + far faster to encode.
  captureFrame(frame: number): string {
    if (!this.ready || this.destroyed || !this.app?.renderer) return '';
    this.renderFrame(frame);
    const canvas = this.app.canvas as HTMLCanvasElement;
    const s = useSceneStore.getState();
    const rawAlpha = s.background.alpha ?? 100;
    const alphaPct = (rawAlpha > 0 && rawAlpha <= 1) ? rawAlpha * 100 : rawAlpha;
    if (alphaPct < 100) {
      return canvas?.toDataURL?.('image/png') ?? '';
    }
    return canvas?.toDataURL?.('image/jpeg', 0.92) ?? '';
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
    this.destroyed = true;
    this.texturePromises.clear();
    this.videoEls.forEach((v) => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* noop */ } });
    this.videoEls.clear();
    this.gradientTexture?.destroy(true);
    this.gradientTexture = null;
    try { this.app.destroy(true, { children: true, texture: false }); } catch { /* noop */ }
  }
}
