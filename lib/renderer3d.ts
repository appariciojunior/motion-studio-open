import * as THREE from 'three';
import { getTemplate } from '@/templates';
import { useSceneStore } from '@/store/useSceneStore';
import { resolveEasing } from '@/lib/easing';
import { assetIndexForSlot, clamp, lerp } from '@/lib/motion';
import { loadImage } from '@/lib/textureLoad';
import { cardAspectFor, coverCrop, cropKey } from '@/lib/crop';
import { advanceVideoForExport, createCardVideo, isVideoSource, prepareVideoForSequentialExport } from '@/lib/videoTexture';
import type { IRenderer } from '@/lib/rendererTypes';

// Shared with the Pixi renderer so control values read identically in px.
const SPRITE_BASE = 340;
const PLACEHOLDER_FILL = '#242424';
const PLACEHOLDER_LABEL = '#555555';

interface Slot3D {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  texW: number;
  texH: number;
  cornerR: number; // cached rounded-corner fraction (-1 = unset)
}

// Rounded-rectangle alpha mask (white on black) for cornerRadius; cached by
// (fraction, aspect) so corners stay circular on non-square cards.
function makeCornerAlphaMap(fracR: number, aspect: number): THREE.CanvasTexture {
  const W = 512;
  const H = Math.max(2, Math.round(W / aspect));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  const r = (Math.min(W, H) / 2) * fracR;
  g.beginPath();
  g.roundRect(0, 0, W, H, r);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

// 2-stop vertical gradient texture for the scene backdrop.
function makeGradientTexture(c1: string, c2: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Numbered placeholder card as a CanvasTexture (mirrors the Pixi placeholder).
function makePlaceholderTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 480; c.height = 600;
  const g = c.getContext('2d')!;
  g.fillStyle = PLACEHOLDER_FILL;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = PLACEHOLDER_LABEL;
  g.font = '600 130px Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Real-3D renderer for templates with meta.engine === 'webgl'. Implements the
// same IRenderer contract as the Pixi SceneRenderer, so preview and export are
// engine-agnostic. M1 scope: cards + solid/gradient-as-solid background; no
// effects, image/card backgrounds, logo, safe-area, or cornerRadius yet.
export class SceneRenderer3D implements IRenderer {
  onDirty?: () => void;   // preview loop hooks this to redraw once after async loads
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 1, 40000);
  private slots: Slot3D[] = [];
  private textureCache = new Map<string, THREE.Texture>();
  private croppedCache = new Map<string, THREE.Texture>(); // cover-crop clones (repeat/offset) of cached bases
  private videoEls = new Map<string, HTMLVideoElement>();   // live <video> per url, for playback + cleanup
  private exportVideoFrames = new Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture }>();
  private placeholders = new Map<number, THREE.CanvasTexture>();
  private cornerMaps = new Map<string, THREE.CanvasTexture>();
  private gradientTex: THREE.CanvasTexture | null = null;
  private gradientSig = '';
  // HUD overlay (logo + safe-area) rendered orthographically on top.
  private hud = new THREE.Scene();
  private hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  private logoMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private logoUrl = '';
  private safeLine: THREE.LineLoop | null = null;
  private width = 810;
  private height = 1080;
  private lastCountSig = -1;
  private lastAssetSig = '';
  ready = false;

  async init(canvas: HTMLCanvasElement) {
    const s = useSceneStore.getState();
    this.width = s.width;
    this.height = s.height;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true, // required for toDataURL export capture
      powerPreference: 'high-performance', // hint the browser to use the discrete GPU
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    this.ready = true;
    this.syncAssets();
  }

  resize(width: number, height: number, resolution = 1) {
    if (!this.ready) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(resolution);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setCaptureScale(k: number) {
    const { width, height } = useSceneStore.getState();
    this.resize(width, height, k);
  }

  // Map the house `perspective` control (0–200) onto the camera: low values =
  // long lens (near-ortho), high = wide-angle. Camera distance keeps the z=0
  // plane at exact preview-pixel scale for any fov.
  private updateCamera(perspective: number) {
    const fov = lerp(15, 95, clamp(perspective, 0, 200) / 200);
    this.camera.fov = fov;
    this.camera.aspect = this.width / this.height;
    const D = (this.height / 2) / Math.tan((fov * Math.PI) / 360);
    this.camera.position.set(0, 0, D);
    this.camera.lookAt(0, 0, 0);
    this.camera.far = D * 8;
    this.camera.updateProjectionMatrix();
  }

  // Cover-fit via UV window (repeat/offset) on a clone sharing the decoded
  // image — mirrors the Pixi renderer's frame-cropped texture views.
  private croppedView(url: string, base: THREE.Texture, aspect: number, crop?: { x: number; y: number }): { tex: THREE.Texture; fw: number; fh: number } {
    const img = base.image as HTMLImageElement;
    const { fx, fy, fw, fh } = coverCrop(img.width, img.height, aspect, crop);
    const key = cropKey(url, aspect, crop);
    let tex = this.croppedCache.get(key);
    if (!tex) {
      tex = base.clone();
      tex.repeat.set(fw / img.width, fh / img.height);
      tex.offset.set(fx / img.width, 1 - (fy + fh) / img.height); // three's V origin is bottom
      tex.needsUpdate = true;
      this.croppedCache.set(key, tex);
    }
    return { tex, fw, fh };
  }

  syncAssets() {
    if (!this.ready) return;
    const s = useSceneStore.getState();
    const count = Math.max(1, Math.round(s.values.count ?? 6));
    const meta = getTemplate(s.activeTemplateId).meta;
    const repeat = meta.repeatAssets === true;
    const aspect = cardAspectFor(meta, s.width, s.height, s.cardShape);
    const assetSig = (repeat ? 'R|' : '') + 'A' + aspect.toFixed(4) + '|' +
      s.assets.map((a) => a.id + ':' + a.url + ':' + a.visible + ':' + (a.crop ? a.crop.x + ',' + a.crop.y : 'c')).join('|');
    if (count === this.lastCountSig && assetSig === this.lastAssetSig) return;
    this.lastCountSig = count;
    this.lastAssetSig = assetSig;

    while (this.slots.length < count) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        toneMapped: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      this.scene.add(mesh);
      this.slots.push({ mesh, texW: 480, texH: 600, cornerR: -1 });
    }
    while (this.slots.length > count) {
      const slot = this.slots.pop()!;
      this.scene.remove(slot.mesh);
      slot.mesh.geometry.dispose();
      slot.mesh.material.dispose();
    }

    this.slots.forEach((slot, i) => {
      let asset = s.assets[assetIndexForSlot(i, s.assets.length, repeat)];
      if (!asset && s.assets.length > 0) asset = s.assets[i % s.assets.length];
      if (!asset || !asset.visible) {
        let ph = this.placeholders.get(i);
        if (!ph) { ph = makePlaceholderTexture(String(i + 1)); this.placeholders.set(i, ph); }
        slot.mesh.material.map = ph;
        slot.mesh.material.needsUpdate = true;
        slot.texW = 480; slot.texH = 600;
      } else if (isVideoSource(asset.url, asset.kind)) {
        const { url, crop } = asset;
        const frozen = this.exportVideoFrames.get(url);
        if (frozen) {
          const { tex, fw, fh } = this.croppedView(url, frozen.texture, aspect, crop);
          slot.mesh.material.map = tex;
          slot.mesh.material.needsUpdate = true;
          slot.texW = fw; slot.texH = fh;
          slot.cornerR = -1;
          return;
        }
        // Live video card: cover-crop via a per-(url,crop) VideoTexture that
        // wraps a shared <video>. A dedicated VideoTexture (not a clone) keeps
        // three's auto-update (requestVideoFrameCallback) working per slot.
        let video = this.videoEls.get(url);
        if (!video) {
          video = createCardVideo(url);
          this.videoEls.set(url, video);
          video.play().catch(() => { /* autoplay blocked — first frame only */ });
        }
        const applyVid = (v: HTMLVideoElement) => {
          const vw = v.videoWidth, vh = v.videoHeight;
          if (!vw || !vh || !this.ready) return;
          const { fx, fy, fw, fh } = coverCrop(vw, vh, aspect, crop);
          const key = cropKey(url, aspect, crop);
          let tex = this.croppedCache.get(key);
          if (!tex) {
            const vt = new THREE.VideoTexture(v);
            vt.colorSpace = THREE.SRGBColorSpace;
            vt.repeat.set(fw / vw, fh / vh);
            vt.offset.set(fx / vw, 1 - (fy + fh) / vh); // three's V origin is bottom
            tex = vt;
            this.croppedCache.set(key, tex);
          }
          slot.mesh.material.map = tex;
          slot.mesh.material.needsUpdate = true;
          slot.texW = fw; slot.texH = fh;
          slot.cornerR = -1; // aspect changed → rebuild the corner mask
          this.onDirty?.();
        };
        if (video.videoWidth) applyVid(video);
        else video.addEventListener('loadeddata', () => applyVid(video!), { once: true });
      } else {
        const { url, crop } = asset;
        const applyCropped = (base: THREE.Texture) => {
          const { tex, fw, fh } = this.croppedView(url, base, aspect, crop);
          slot.mesh.material.map = tex;
          slot.mesh.material.needsUpdate = true;
          slot.texW = fw; slot.texH = fh;
          slot.cornerR = -1; // aspect changed → rebuild the corner mask
          this.onDirty?.();
        };
        const cached = this.textureCache.get(url);
        if (cached) {
          applyCropped(cached);
        } else {
          loadImage(url).then((img) => {
            if (!img || !this.ready) return;
            const tex = new THREE.Texture(img);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.needsUpdate = true;
            this.textureCache.set(url, tex);
            applyCropped(tex);
          });
        }
      }
    });
  }

  // Rounded corners via a cached alpha mask (Pixi uses a stencil mask).
  private applyCorner(slot: Slot3D, cornerRadiusPct: number) {
    const fracR = clamp(cornerRadiusPct / 100, 0, 1);
    if (slot.cornerR === fracR) return;
    slot.cornerR = fracR;
    if (fracR === 0) {
      slot.mesh.material.alphaMap = null;
      slot.mesh.material.needsUpdate = true;
      return;
    }
    const aspect = slot.texW / slot.texH;
    const key = `${fracR.toFixed(2)}|${aspect.toFixed(2)}`;
    let map = this.cornerMaps.get(key);
    if (!map) { map = makeCornerAlphaMap(fracR, aspect); this.cornerMaps.set(key, map); }
    slot.mesh.material.alphaMap = map;
    slot.mesh.material.needsUpdate = true;
  }

  // Backdrop + HUD (logo, safe-area) sync from the store.
  private syncScenery() {
    const s = useSceneStore.getState();

    // background: solid or 2-stop gradient (image/card sources fall back)
    if (s.background.source === 'color' && s.background.gradient) {
      const sig = s.background.color + '|' + s.background.color2;
      if (this.gradientSig !== sig) {
        this.gradientTex?.dispose();
        this.gradientTex = makeGradientTexture(s.background.color, s.background.color2);
        this.gradientSig = sig;
      }
      this.scene.background = this.gradientTex;
    } else {
      this.scene.background = new THREE.Color(s.background.color);
    }

    // HUD ortho camera matches the logical canvas (y up; positions flipped)
    this.hudCam.left = -this.width / 2;
    this.hudCam.right = this.width / 2;
    this.hudCam.top = this.height / 2;
    this.hudCam.bottom = -this.height / 2;
    this.hudCam.updateProjectionMatrix();

    // safe-area guide (5% inset, cyan) — mirrors the Pixi overlay
    if (s.safeArea) {
      if (!this.safeLine) {
        const geo = new THREE.BufferGeometry();
        const mat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.6 });
        this.safeLine = new THREE.LineLoop(geo, mat);
        this.hud.add(this.safeLine);
      }
      const mx = this.width * 0.05, my = this.height * 0.05;
      const w2 = this.width / 2 - mx, h2 = this.height / 2 - my;
      this.safeLine.geometry.setFromPoints([
        new THREE.Vector3(-w2, -h2, 0), new THREE.Vector3(w2, -h2, 0),
        new THREE.Vector3(w2, h2, 0), new THREE.Vector3(-w2, h2, 0),
      ]);
      this.safeLine.visible = true;
    } else if (this.safeLine) {
      this.safeLine.visible = false;
    }

    // logo overlay in the chosen corner
    if (s.logo.url) {
      if (!this.logoMesh) {
        this.logoMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false })
        );
        this.hud.add(this.logoMesh);
      }
      if (this.logoUrl !== s.logo.url) {
        this.logoUrl = s.logo.url;
        loadImage(s.logo.url).then((img) => {
          if (!img || !this.ready || !this.logoMesh) return;
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          this.logoMesh.material.map = tex;
          this.logoMesh.material.needsUpdate = true;
          this.logoMesh.userData.aspect = img.width / img.height;
          this.onDirty?.();
        });
      }
      const aspect: number = this.logoMesh.userData.aspect ?? 1;
      const size = s.logo.size;
      const w = aspect >= 1 ? size : size * aspect;
      const h = aspect >= 1 ? size / aspect : size;
      const pad = 24;
      const px = s.logo.position.includes('r') ? this.width / 2 - pad - w / 2 : -this.width / 2 + pad + w / 2;
      const py = s.logo.position.startsWith('t') ? this.height / 2 - pad - h / 2 : -this.height / 2 + pad + h / 2;
      this.logoMesh.position.set(px, py, 0);
      this.logoMesh.scale.set(w, h, 1);
      this.logoMesh.visible = !!this.logoMesh.material.map;
    } else if (this.logoMesh) {
      this.logoMesh.visible = false;
    }
  }

  getFrameState(frame: number) {
    if (!this.ready) return;
    const s = useSceneStore.getState();
    this.syncAssets();
    // live loop/hold behaviour follows the scene setting
    this.videoEls.forEach((v) => { v.loop = s.videoEnd !== 'hold'; });
    this.syncScenery();

    this.updateCamera(Number(s.values.perspective ?? 100));

    const template = getTemplate(s.activeTemplateId);
    const count = this.slots.length;
    const ease = resolveEasing(s.easing);
    const easedPhase = (phase: number) => {
      const base = Math.floor(phase);
      return base + ease(phase - base);
    };
    const ctx = {
      fps: s.fps, width: s.width, height: s.height,
      duration: s.duration,
      totalFrames: Math.max(1, Math.round(s.duration * s.fps)),
      ease, easedPhase,
    };

    for (let i = 0; i < count; i++) {
      const slot = this.slots[i];
      const norm = SPRITE_BASE / Math.max(slot.texW, slot.texH);
      this.applyCorner(slot, Number(s.values.cornerRadius ?? 0));
      if (template.transform3d) {
        const t = template.transform3d(frame, i, count, s.values, ctx);
        slot.mesh.position.set(t.x, -t.y, t.z); // canvas y-down → three y-up
        slot.mesh.rotation.set(t.rotationX ?? 0, t.rotationY ?? 0, t.rotationZ ?? 0);
        slot.mesh.scale.set(slot.texW * norm * t.scale, slot.texH * norm * t.scale, 1);
        slot.mesh.material.opacity = t.alpha;
        // A fully opaque plane writes depth, so it genuinely OCCLUDES what sits
        // behind it. The material is created with depthWrite: false — correct for
        // blended planes, since a translucent card must not mask its neighbours —
        // but with it off nothing ever occludes anything, and a closed solid (the
        // Box family's prism) has no way to hide its own far side. Gating on full
        // opacity gives real occlusion where it is unambiguous and keeps correct
        // blending everywhere else.
        slot.mesh.material.depthWrite = t.alpha > 0.995;
        slot.mesh.visible = t.alpha > 0.001 && t.scale > 0.0001;
      } else {
        // fallback: project the 2D transform onto the z=0 plane
        const t = template.transform(frame, i, count, s.values, ctx);
        slot.mesh.position.set(t.x, -t.y, t.depth);
        slot.mesh.rotation.set(0, 0, -t.rotation);
        slot.mesh.scale.set(slot.texW * norm * t.scale * (t.scaleX ?? 1), slot.texH * norm * t.scale * (t.scaleY ?? 1), 1);
        slot.mesh.material.opacity = t.alpha;
        slot.mesh.visible = t.alpha > 0.001 && t.scale > 0.0001;
      }
    }
  }

  // ---- video export sync ---- (see the Pixi renderer for the rationale)
  async beginVideoExport() {
    if (this.videoEls.size === 0) return;
    await Promise.all([...this.videoEls.values()].map(prepareVideoForSequentialExport));
    this.videoEls.forEach((video, url) => {
      if (!video.videoWidth || !video.videoHeight) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.exportVideoFrames.set(url, { canvas, ctx, texture });
    });
    this.croppedCache.forEach((tex) => tex.dispose());
    this.croppedCache.clear();
    this.lastAssetSig = '';
    this.syncAssets();
  }

  endVideoExport() {
    this.croppedCache.forEach((tex) => tex.dispose());
    this.croppedCache.clear();
    this.exportVideoFrames.forEach(({ texture }) => texture.dispose());
    this.exportVideoFrames.clear();
    this.lastAssetSig = '';
    this.syncAssets();
  }

  async seekVideos(frame: number) {
    if (this.videoEls.size === 0) return;
    const s = useSceneStore.getState();
    const t = frame / Math.max(1, s.fps);
    await Promise.all([...this.videoEls.values()].map((v) => advanceVideoForExport(v, t, s.fps, s.videoEnd)));
    this.videoEls.forEach((video, url) => {
      const snapshot = this.exportVideoFrames.get(url);
      if (snapshot) {
        snapshot.ctx.drawImage(video, 0, 0);
        snapshot.texture.needsUpdate = true;
      }
    });
  }

  resumeVideos() {
    this.videoEls.forEach((v) => { v.play().catch(() => { /* noop */ }); });
  }

  pauseVideos() {
    this.videoEls.forEach((v) => { try { v.pause(); } catch { /* noop */ } });
  }

  restartVideos() {
    this.videoEls.forEach((v) => {
      // Looping videos keep their own continuous playback clock. Only videos
      // frozen by the "hold" mode need to restart with the scene timeline.
      if (v.loop) return;
      try { v.currentTime = 0; v.play().catch(() => { /* noop */ }); } catch { /* noop */ }
    });
  }

  renderFrame(frame: number) {
    if (!this.ready) return;
    this.getFrameState(frame);
    this.renderer.render(this.scene, this.camera);
    // HUD pass (logo + safe-area) drawn on top without clearing
    this.renderer.autoClear = false;
    this.renderer.render(this.hud, this.hudCam);
    this.renderer.autoClear = true;
  }

  captureFrame(frame: number): string {
    this.renderFrame(frame);
    // JPEG (q0.92) — see the Pixi renderer's captureFrame for the rationale.
    return this.renderer.domElement.toDataURL('image/jpeg', 0.92);
  }

  extractCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  destroy() {
    this.ready = false;
    for (const slot of this.slots) {
      this.scene.remove(slot.mesh);
      slot.mesh.geometry.dispose();
      slot.mesh.material.dispose();
    }
    this.slots = [];
    this.textureCache.forEach((t) => t.dispose());
    this.textureCache.clear();
    this.croppedCache.forEach((t) => t.dispose());
    this.croppedCache.clear();
    this.videoEls.forEach((v) => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* noop */ } });
    this.videoEls.clear();
    this.placeholders.forEach((t) => t.dispose());
    this.placeholders.clear();
    this.cornerMaps.forEach((t) => t.dispose());
    this.cornerMaps.clear();
    this.gradientTex?.dispose();
    if (this.logoMesh) { this.logoMesh.geometry.dispose(); this.logoMesh.material.map?.dispose(); this.logoMesh.material.dispose(); }
    if (this.safeLine) { this.safeLine.geometry.dispose(); (this.safeLine.material as THREE.Material).dispose(); }
    try {
      this.renderer.dispose();
      this.renderer.forceContextLoss(); // avoid WebGL context accumulation on engine swaps
    } catch { /* already lost */ }
  }
}
