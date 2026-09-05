import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { getTemplate, layerCountFor } from '@/templates';
import { useSceneStore } from '@/store/useSceneStore';
import { getEffect } from '@/effects';
import { applyThreeUniforms, disposeThreeMaterials, threeMaterialFor } from '@/effects/adapters/three';
import { resolveEasing } from '@/lib/easing';
import { assetIndexForSlot, clamp, lerp } from '@/lib/motion';
import { loadImage } from '@/lib/textureLoad';
import { cardAspectFor, coverCrop, cropKey, type CropFocus } from '@/lib/crop';
import { advanceVideoForExport, createCardVideo, isVideoSource, prepareVideoForSequentialExport, useVideoProxies } from '@/lib/videoTexture';
import { BASE_PATH, IS_STATIC_EXPORT } from '@/lib/paths';
import type { IRenderer } from '@/lib/rendererTypes';
import type { CameraPose, LayerTransform3D } from '@/lib/types';
import { resolveTrackTime, trackAssetIndices, type MotionTrack } from '@/lib/tracks';
import type { SceneState } from '@/store/useSceneStore';
import { advancedRasterSize, gradientRasterMaxEdge, gradientSignature, normalizeGradientSpec, paintGradientCanvas } from '@/lib/gradient';

// Shared with the Pixi renderer so control values read identically in px.
const SPRITE_BASE = 340;
const PLACEHOLDER_FILL = '#242424';
const PLACEHOLDER_LABEL = '#555555';

export interface Slot3D {
  // Legacy alias retained while old single-track fallback code remains
  // unreachable below getFrameState's multicamera dispatch.
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  root: THREE.Group;
  front: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  back: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  body: THREE.Mesh<RoundedBoxGeometry, THREE.MeshStandardMaterial>;
  texW: number;
  texH: number;
  cornerR: number; // cached rounded-corner fraction (-1 = unset)
  bindKey: string;
}

interface TrackRT3D {
  scene: THREE.Scene;
  group: THREE.Group;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  target: THREE.WebGLRenderTarget;
  slots: Slot3D[];
  countSig: number;
  assetSig: string;
  active: boolean;
  opacity: number;
  blend: MotionTrack['blend'];
  keyLight: THREE.DirectionalLight;
  r3fManaged: boolean;
  r3fVersion: number;
}

// The card meshes and their deformations live in three3d/cardMesh, shared with
// the catalogue thumbnail so both build the same geometry from the same code.
import {
  makeBentPlaneGeometry,
  makeCornerAlphaMap,
  makeCornerPeelGeometry,
  makeCurlPlaneGeometry,
  makePlaceholderTexture,
  makeStickerRollGeometry,
} from '@/three3d/cardMesh';

// Hybrid 2D/3D renderer. Every timeline track owns an isolated scene, camera,
// depth buffer and RGBA render target; a full-screen compositor then applies
// timeline order, opacity, fades and blend modes before the HUD/export pass.
export class SceneRenderer3D implements IRenderer {
  onDirty?: () => void;   // preview loop hooks this to redraw once after async loads
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 1, 40000);
  private trackRTs = new Map<string, TrackRT3D>();
  private textureCache = new Map<string, THREE.Texture>();
  private texturePromises = new Map<string, Promise<THREE.Texture | null>>();
  private croppedCache = new Map<string, THREE.Texture>(); // cover-crop clones (repeat/offset) of cached bases
  private videoEls = new Map<string, HTMLVideoElement>();   // live <video> per url, for playback + cleanup
  private exportVideoFrames = new Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture }>();
  private restoreVideoSources: (() => void) | null = null; // undo the export proxy swap
  private placeholders = new Map<number, THREE.CanvasTexture>();
  private cornerMaps = new Map<string, THREE.CanvasTexture>();
  private gradientTex: THREE.CanvasTexture | null = null;
  private gradientCanvas: HTMLCanvasElement | null = null;
  private gradientSig = '';
  private backgroundTex: THREE.CanvasTexture | null = null;
  private backgroundSig = '';
  private backgroundGeneration = 0;
  // HUD overlay (logo + safe-area) rendered orthographically on top.
  private hud = new THREE.Scene();
  private hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  private logoMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private logoUrl = '';
  private safeLine: THREE.LineLoop | null = null;
  private composeA!: THREE.WebGLRenderTarget;
  private composeB!: THREE.WebGLRenderTarget;
  private composeScene = new THREE.Scene();
  private composeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private composeQuad!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private outputScene = new THREE.Scene();
  private fxScene = new THREE.Scene();
  private outputQuad!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private fxQuad!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private cardPlaneGeometry = new THREE.PlaneGeometry(1, 1);
  private cardBodyGeometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.055);
  private bentCardGeometries = new Map<string, THREE.BufferGeometry>();
  private resolution = 1;
  private r3f: import('@/lib/r3fSceneBridge').R3FSceneBridge | null = null;
  private width = 810;
  private height = 1080;
  ready = false;
  private destroyed = false;

  async init(canvas: HTMLCanvasElement) {
    if (this.destroyed) return;
    const s = useSceneStore.getState();
    this.width = s.width;
    this.height = s.height;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true, // required for toDataURL export capture
      powerPreference: 'high-performance', // hint the browser to use the discrete GPU
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    const { R3FSceneBridge } = await import('@/lib/r3fSceneBridge');
    if (this.destroyed) return;
    this.r3f = new R3FSceneBridge();
    await this.r3f.init(canvas, this.renderer, this.scene, this.camera, this.width, this.height);
    if (this.destroyed) return;
    this.createCompositor();
    this.ready = true;
    this.syncAssets();
  }

  resize(width: number, height: number, resolution = 1) {
    if (!this.ready) return;
    this.width = width;
    this.height = height;
    this.resolution = resolution;
    this.renderer.setPixelRatio(resolution);
    this.renderer.setSize(width, height, false);
    // R3F is only the Box scene-graph reconciler. It must never own the CSS
    // size of this canvas, otherwise a later Aspect change updates pixels but
    // leaves the visible frame pinned to the initial dimensions.
    this.renderer.domElement.style.removeProperty('width');
    this.renderer.domElement.style.removeProperty('height');
    const rw = Math.max(1, Math.round(width * resolution));
    const rh = Math.max(1, Math.round(height * resolution));
    this.composeA?.setSize(rw, rh);
    this.composeB?.setSize(rw, rh);
    this.trackRTs.forEach((rt) => rt.target.setSize(rw, rh));
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
  private updateTrackCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, perspective: number, pose?: CameraPose) {
    if (camera instanceof THREE.OrthographicCamera) {
      camera.left = -this.width / 2;
      camera.right = this.width / 2;
      camera.top = this.height / 2;
      camera.bottom = -this.height / 2;
      camera.near = -20000;
      camera.far = 20000;
      camera.position.set(0, 0, 1000);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      return;
    }
    const fov = pose?.fov ?? lerp(15, 95, clamp(perspective, 0, 200) / 200);
    camera.fov = fov;
    camera.aspect = this.width / this.height;
    const D = (this.height / 2) / Math.tan((fov * Math.PI) / 360);
    // `distance` is a multiplier on D, not a replacement for it — the same
    // "camDistance, 1.0 = default fit" convention three3d/animations.ts uses.
    // Below 1 moves the camera physically closer (the subject fills more of
    // the frame at the SAME fov, so the keystone/perspective feel is
    // unchanged — a different move than widening the lens). Templates that
    // set an explicit `position` bypass this entirely, same as before.
    const position = pose?.position ?? { x: 0, y: 0, z: D * (pose?.distance ?? 1) };
    const target = pose?.target ?? { x: 0, y: 0, z: 0 };
    camera.position.set(position.x, -position.y, position.z);
    camera.lookAt(target.x, -target.y, target.z);
    camera.near = pose?.near ?? 0.1;
    camera.far = pose?.far ?? Math.max(D * 8, Math.abs(position.z) * 8);
    camera.updateProjectionMatrix();
  }

  private makeTarget(depthBuffer: boolean) {
    const target = new THREE.WebGLRenderTarget(
      Math.max(1, Math.round(this.width * this.resolution)),
      Math.max(1, Math.round(this.height * this.resolution)),
      { depthBuffer, stencilBuffer: false },
    );
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    target.texture.generateMipmaps = false;
    // Tracks are rendered off-screen before composition. Antialiasing on the
    // WebGLRenderer does not cover those intermediate buffers, so diagonal
    // silhouettes (most visibly Poster 01's moving peel tip) arrived at the
    // final canvas already jagged. Three resolves this multisampled target
    // automatically when its texture is sampled by the compositor.
    target.samples = Math.max(1, Math.min(8, this.renderer.capabilities.maxSamples));
    return target;
  }

  private createCompositor() {
    this.composeA = this.makeTarget(false);
    this.composeB = this.makeTarget(false);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const composeMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        baseMap: { value: null },
        layerMap: { value: null },
        opacity: { value: 1 },
        blendMode: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
      fragmentShader: `
        uniform sampler2D baseMap;
        uniform sampler2D layerMap;
        uniform float opacity;
        uniform int blendMode;
        varying vec2 vUv;
        void main(){
          vec4 base = texture2D(baseMap, vUv);
          vec4 layer = texture2D(layerMap, vUv);
          float a = clamp(layer.a * opacity, 0.0, 1.0);
          vec3 straight = layer.a > 0.00001 ? layer.rgb / layer.a : vec3(0.0);
          vec3 blend = straight;
          if (blendMode == 1) blend = min(vec3(1.0), base.rgb + straight);
          else if (blendMode == 2) blend = vec3(1.0) - (vec3(1.0) - base.rgb) * (vec3(1.0) - straight);
          else if (blendMode == 3) blend = base.rgb * straight;
          float outA = clamp(base.a + a * (1.0 - base.a), 0.0, 1.0);
          vec3 outRgb = mix(base.rgb, blend, a);
          gl_FragColor = vec4(outRgb, outA);
        }
      `,
    });
    this.composeQuad = new THREE.Mesh(geometry, composeMaterial);
    this.composeScene.add(this.composeQuad);

    // The output pass is now a plain copy to the canvas. It used to carry the
    // pixelate maths itself — that moved into effects/pixelate.ts, where both
    // engines read it from one place.
    const outputMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      transparent: true,
      uniforms: { map: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main(){
          gl_FragColor = texture2D(map, vUv);
          #include <colorspace_fragment>
        }
      `,
    });
    this.outputQuad = new THREE.Mesh(geometry.clone(), outputMaterial);
    this.outputScene.add(this.outputQuad);

    // The quad every effect pass renders through. Its material is swapped per
    // effect; the geometry and the scene are built once.
    this.fxQuad = new THREE.Mesh(geometry.clone(), outputMaterial);
    this.fxScene.add(this.fxQuad);
  }

  // Cover-fit via UV window (repeat/offset) on a clone sharing the decoded
  // image — mirrors the Pixi renderer's frame-cropped texture views.
  private croppedView(url: string, base: THREE.Texture, aspect: number, crop?: CropFocus): { tex: THREE.Texture; fw: number; fh: number } {
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

  private loadTexture(url: string): Promise<THREE.Texture | null> {
    const cached = this.textureCache.get(url);
    if (cached) return Promise.resolve(cached);
    const pending = this.texturePromises.get(url);
    if (pending) return pending;
    const promise = loadImage(url)
      .then((img) => {
        if (!img || !this.ready) return null;
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        // Every card can end up viewed near edge-on — a Card Tunnel wall close to
        // the vanishing point, a Surface curve's far edge, any face turned away
        // in Box or Orbit. Mipmapping alone still aliases badly at a grazing
        // angle because it picks ONE isotropic mip level for a footprint that is
        // actually long and thin; anisotropic filtering samples along that
        // footprint instead, which is what removes the fine horizontal banding
        // those views showed. Applied once here because cropped views (below)
        // are `.clone()`d from this texture and inherit it.
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        tex.needsUpdate = true;
        this.textureCache.set(url, tex);
        return tex;
      })
      .finally(() => { this.texturePromises.delete(url); });
    this.texturePromises.set(url, promise);
    return promise;
  }

  syncAssets() {
    if (!this.ready) return;
    const s = useSceneStore.getState();
    for (const [id, rt] of this.trackRTs) {
      if (!s.tracks.some((track) => track.id === id)) {
        this.r3f?.remove(id);
        this.destroyTrack(rt);
        this.trackRTs.delete(id);
      }
    }
    s.tracks.forEach((track) => {
      let rt = this.trackRTs.get(track.id);
      if (!rt) {
        const scene = new THREE.Scene();
        const group = new THREE.Group();
        scene.add(group);
        const hemi = new THREE.HemisphereLight(0xffffff, 0x202028, 1.65);
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
        keyLight.position.set(-420, 560, 900);
        keyLight.castShadow = true;
        keyLight.shadow.bias = -0.00025;
        keyLight.shadow.normalBias = 0.025;
        keyLight.shadow.camera.near = 10;
        keyLight.shadow.camera.far = 5000;
        keyLight.shadow.camera.left = -1400;
        keyLight.shadow.camera.right = 1400;
        keyLight.shadow.camera.top = 1400;
        keyLight.shadow.camera.bottom = -1400;
        scene.add(hemi, keyLight, keyLight.target);
        const is3d = getTemplate(track.templateId).meta.engine === 'webgl';
        rt = {
          scene, group,
          camera: is3d ? new THREE.PerspectiveCamera(50, 1, 1, 40000) : new THREE.OrthographicCamera(),
          target: this.makeTarget(true),
          slots: [], countSig: -1, assetSig: '', active: false, opacity: 1, blend: 'normal', keyLight,
          r3fManaged: false,
          r3fVersion: 0,
        };
        this.trackRTs.set(track.id, rt);
      }
      const is3d = getTemplate(track.templateId).meta.engine === 'webgl';
      if (is3d !== (rt.camera instanceof THREE.PerspectiveCamera)) {
        rt.camera = is3d ? new THREE.PerspectiveCamera(50, 1, 1, 40000) : new THREE.OrthographicCamera();
      }
      this.syncTrackSlots(track, rt, s);
    });
  }

  private syncTrackSlots(track: MotionTrack, rt: TrackRT3D, s: SceneState) {
    const meta = getTemplate(track.templateId).meta;
    const r3fManaged = meta.id.startsWith('box-');
    const repeat = meta.repeatAssets === true;
    const aspect = cardAspectFor(meta, s.width, s.height, s.cardShape);
    // Asked of the template — see the same call in lib/renderer.ts.
    const count = layerCountFor(track.templateId, track.values,
      { width: s.width, height: s.height, cardAspect: aspect });
    const pool = trackAssetIndices(track, s.assets).map((i) => s.assets[i]).filter(Boolean);
    const assetSig = (repeat ? 'R|' : '') + 'A' + aspect.toFixed(4) + '|' +
      pool.map((a) => a.id + ':' + a.url + ':' + a.visible + ':' + cropKey(a.url, aspect, a.crop)).join('|');
    if (!rt.r3fManaged && r3fManaged) {
      // Entering the R3F-managed Box from another WebGL template keeps the
      // same renderer and track runtime. Remove the previous native meshes
      // before mounting the portal, otherwise both effects remain in the
      // scene and look like duplicated/glitching images behind the box.
      rt.slots.forEach((slot) => {
        rt.group.remove(slot.root);
        slot.front.material.dispose();
        slot.back.material.dispose();
        slot.body.material.dispose();
      });
      rt.slots = [];
      rt.countSig = -1;
      rt.assetSig = '';
    }
    if (rt.r3fManaged && !r3fManaged) {
      rt.r3fVersion++;
      this.r3f?.remove(track.id);
      rt.slots = [];
      rt.countSig = -1;
    }
    rt.r3fManaged = r3fManaged;
    if (r3fManaged && count !== rt.countSig) {
      const version = ++rt.r3fVersion;
      const slots: Array<Slot3D | undefined> = new Array(count);
      this.r3f?.upsertBox({
        id: track.id,
        container: rt.group,
        count,
        planeGeometry: this.cardPlaneGeometry,
        bodyGeometry: this.cardBodyGeometry,
        register: (index, slot) => {
          if (rt.r3fVersion !== version || !rt.r3fManaged) return;
          slots[index] = slot ?? undefined;
          rt.slots = slots.filter((item): item is Slot3D => Boolean(item));
          // The first React commit can happen after this sync pass. Force the
          // next pass to bind textures to the newly materialized cards.
          queueMicrotask(() => {
            if (rt.r3fVersion !== version || !slot) return;
            rt.assetSig = '';
            this.onDirty?.();
          });
        },
      });
    }
    if (count === rt.countSig && assetSig === rt.assetSig) return;
    rt.countSig = count;
    rt.assetSig = assetSig;
    const shadowSize = count <= 24 ? 1024 : 512;
    rt.keyLight.shadow.mapSize.set(shadowSize, shadowSize);
    rt.keyLight.shadow.map?.dispose();

    while (!r3fManaged && rt.slots.length < count) {
      const frontMaterial = new THREE.MeshStandardMaterial({
        transparent: true,
        roughness: 0.82,
        metalness: 0,
        emissive: 0xffffff,
        emissiveIntensity: 0.28,
        depthWrite: true,
        side: THREE.DoubleSide,
      });
      const backMaterial = new THREE.MeshStandardMaterial({
        color: 0x17171b,
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        // Render the underside of the same deformed surface. Rotating a copy
        // of the mesh by 180 degrees mirrors the peel geometry, making the
        // coloured reverse appear on the opposite corner.
        side: THREE.BackSide,
      });
      frontMaterial.alphaToCoverage = true;
      backMaterial.alphaToCoverage = true;
      const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x24242a, roughness: 0.88, metalness: 0, transparent: true });
      const root = new THREE.Group();
      const body = new THREE.Mesh(this.cardBodyGeometry, bodyMaterial);
      const front = new THREE.Mesh(this.cardPlaneGeometry, frontMaterial);
      const back = new THREE.Mesh(this.cardPlaneGeometry, backMaterial);
      front.position.z = 0.501;
      back.position.z = -0.501;
      front.castShadow = front.receiveShadow = true;
      back.castShadow = back.receiveShadow = true;
      body.castShadow = body.receiveShadow = true;
      root.add(body, front, back);
      rt.group.add(root);
      rt.slots.push({ mesh: front, root, front, back, body, texW: 480, texH: 600, cornerR: -1, bindKey: '' });
    }
    while (!r3fManaged && rt.slots.length > count) {
      const slot = rt.slots.pop()!;
      rt.group.remove(slot.root);
      slot.front.material.dispose();
      slot.back.material.dispose();
      slot.body.material.dispose();
    }

    const placeholderLongEdge = 600;
    const placeholderW = placeholderLongEdge * Math.min(1, aspect);
    const placeholderH = placeholderLongEdge * Math.min(1, 1 / aspect);

    rt.slots.forEach((slot, i) => {
      let asset = pool[assetIndexForSlot(i, pool.length, repeat)];
      if (!asset && pool.length > 0) asset = pool[i % pool.length];
      const binding = asset
        ? `${asset.id}|${cropKey(asset.url, aspect, asset.crop)}`
        : `placeholder|${i}`;
      const bindingChanged = slot.bindKey !== binding;
      slot.bindKey = binding;
      if (bindingChanged) {
        // Never keep the previous slot's image visible while a new async
        // image/video is loading. A numbered placeholder is deterministic and
        // is replaced immediately when a cached source is available.
        let ph = this.placeholders.get(i);
        if (!ph) { ph = makePlaceholderTexture(String(i + 1)); this.placeholders.set(i, ph); }
        slot.front.material.map = ph;
        slot.front.material.emissiveMap = ph;
        slot.front.material.needsUpdate = true;
        // Keep the temporary plane at the newly selected shape. Using the old
        // fixed 4:5 dimensions here produced one visibly open/deformed Box
        // frame while the cropped texture was being rebuilt.
        slot.texW = placeholderW;
        slot.texH = placeholderH;
        slot.cornerR = -1;
      }
      if (!asset || !asset.visible) {
        let ph = this.placeholders.get(i);
        if (!ph) { ph = makePlaceholderTexture(String(i + 1)); this.placeholders.set(i, ph); }
        slot.front.material.map = ph;
        slot.front.material.emissiveMap = ph;
        slot.front.material.needsUpdate = true;
        slot.texW = placeholderW; slot.texH = placeholderH;
      } else if (isVideoSource(asset.url, asset.kind)) {
        const { url, crop } = asset;
        const frozen = this.exportVideoFrames.get(url);
        if (frozen) {
          const { tex, fw, fh } = this.croppedView(url, frozen.texture, aspect, crop);
          slot.front.material.map = tex;
          slot.front.material.emissiveMap = tex;
          slot.front.material.needsUpdate = true;
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
          if (slot.bindKey !== binding) return;
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
          slot.front.material.map = tex;
          slot.front.material.emissiveMap = tex;
          slot.front.material.needsUpdate = true;
          slot.texW = fw; slot.texH = fh;
          slot.cornerR = -1; // aspect changed → rebuild the corner mask
          this.onDirty?.();
        };
        if (video.videoWidth) applyVid(video);
        else video.addEventListener('loadeddata', () => applyVid(video!), { once: true });
      } else {
        const { url, crop } = asset;
        const applyCropped = (base: THREE.Texture) => {
          if (slot.bindKey !== binding) return;
          const { tex, fw, fh } = this.croppedView(url, base, aspect, crop);
          slot.front.material.map = tex;
          slot.front.material.emissiveMap = tex;
          slot.front.material.needsUpdate = true;
          slot.texW = fw; slot.texH = fh;
          slot.cornerR = -1; // aspect changed → rebuild the corner mask
          this.onDirty?.();
        };
        this.loadTexture(url).then((tex) => {
          if (!tex || !this.ready || slot.bindKey !== binding) return;
          applyCropped(tex);
        });
      }
      if (bindingChanged) slot.cornerR = -1;
    });
  }

  private invalidateTracks() {
    this.trackRTs.forEach((rt) => { rt.countSig = -1; rt.assetSig = ''; });
  }

  private destroyTrack(rt: TrackRT3D) {
    rt.slots.forEach((slot) => {
      rt.group.remove(slot.root);
      if (!rt.r3fManaged) {
        slot.front.material.dispose();
        slot.back.material.dispose();
        slot.body.material.dispose();
      }
    });
    rt.slots = [];
    rt.target.dispose();
  }

  // Rounded corners via a cached alpha mask (Pixi uses a stencil mask).
  private applyCorner(slot: Slot3D, cornerRadiusPct: number) {
    const fracR = clamp(cornerRadiusPct / 100, 0, 1);
    if (slot.cornerR === fracR) return;
    slot.cornerR = fracR;
    if (fracR === 0) {
      slot.front.material.alphaMap = null;
      slot.back.material.alphaMap = null;
      slot.front.material.needsUpdate = true;
      slot.back.material.needsUpdate = true;
      return;
    }
    const aspect = slot.texW / slot.texH;
    const key = `${fracR.toFixed(2)}|${aspect.toFixed(2)}`;
    let map = this.cornerMaps.get(key);
    if (!map) { map = makeCornerAlphaMap(fracR, aspect); this.cornerMaps.set(key, map); }
    slot.front.material.alphaMap = map;
    slot.back.material.alphaMap = map;
    slot.front.material.needsUpdate = true;
    slot.back.material.needsUpdate = true;
  }

  // Backdrop + HUD (logo, safe-area) sync from the store.
  private syncScenery() {
    const s = useSceneStore.getState();

    // Background parity with Pixi: solid, gradient, uploaded image, or an
    // asset reflected from the active motion layer, or transparent.
    const bgAlpha = Math.max(0, Math.min(1, (s.background.alpha ?? 100) / 100));
    if (bgAlpha === 0) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    } else if (s.background.source === 'color' && s.background.gradient) {
      const spec = normalizeGradientSpec(s.background.gradientSpec, s.background.color, s.background.color2);
      const phase = ((s.frame / Math.max(1, s.duration * s.fps)) % 1 + 1) % 1;
      const [rw, rh] = advancedRasterSize(this.width, this.height, gradientRasterMaxEdge(spec));
      const sig = `${rw}x${rh}|${gradientSignature(spec, phase)}`;
      if (this.gradientSig !== sig) {
        const resized = !this.gradientCanvas || this.gradientCanvas.width !== rw || this.gradientCanvas.height !== rh;
        let gradientCanvas = this.gradientCanvas;
        if (!gradientCanvas || resized) {
          gradientCanvas = document.createElement('canvas');
          this.gradientCanvas = gradientCanvas;
        }
        paintGradientCanvas(gradientCanvas, spec, rw, rh, phase);
        let gradientTex = this.gradientTex;
        if (!gradientTex || resized) {
          gradientTex?.dispose();
          gradientTex = new THREE.CanvasTexture(gradientCanvas);
          gradientTex.colorSpace = THREE.SRGBColorSpace;
          this.gradientTex = gradientTex;
        }
        gradientTex.needsUpdate = true;
        this.gradientSig = sig;
      }
      this.scene.background = this.gradientTex;
      this.renderer.setClearColor(0x000000, bgAlpha);
    } else if (s.background.source === 'image' && s.background.imageUrl) {
      this.syncBackgroundTexture(s.background.imageUrl, s.background.blur);
    } else if (s.background.source === 'card') {
      const active = s.tracks.find((track) => track.id === s.activeTrackId) ?? s.tracks.find((track) => track.visible);
      const assetIndex = active ? trackAssetIndices(active, s.assets)[0] : undefined;
      const url = assetIndex === undefined ? null : s.assets[assetIndex]?.url;
      if (url && !isVideoSource(url, s.assets[assetIndex!]?.kind)) this.syncBackgroundTexture(url, s.background.blur);
      else {
        this.scene.background = new THREE.Color(s.background.color);
        this.renderer.setClearColor(new THREE.Color(s.background.color), bgAlpha);
      }
    } else {
      if (bgAlpha < 1) {
        this.scene.background = null;
        this.renderer.setClearColor(new THREE.Color(s.background.color), bgAlpha);
      } else {
        this.scene.background = new THREE.Color(s.background.color);
        this.renderer.setClearColor(new THREE.Color(s.background.color), 1);
      }
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

    const sceneTotal = Math.max(1, Math.round(s.duration * s.fps));
    s.tracks.forEach((motionTrack) => {
      const runtime = this.trackRTs.get(motionTrack.id);
      if (runtime) this.updateTrackState(motionTrack, runtime, frame, sceneTotal, s);
    });
    return;

    const track = s.tracks.find((item) => item.id === s.activeTrackId) ?? s.tracks[0];
    if (!track) return;
    const rt = this.trackRTs.get(track.id);
    if (!rt) return;
    this.updateTrackCamera(rt!.camera, Number(track.values.perspective ?? 100));

    const template = getTemplate(track.templateId);
    const count = rt!.slots.length;
    const ease = resolveEasing(track.easing);
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
      const slot = rt!.slots[i];
      const norm = SPRITE_BASE / Math.max(slot.texW, slot.texH);
      this.applyCorner(slot, Number(track.values.cornerRadius ?? 0));
      if (template.transform3d) {
        const t = template.transform3d!(frame, i, count, track.values, ctx);
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
        const t = template.transform(frame, i, count, track.values, ctx);
        slot.mesh.position.set(t.x, -t.y, t.depth);
        slot.mesh.rotation.set(0, 0, -t.rotation);
        slot.mesh.scale.set(slot.texW * norm * t.scale * (t.scaleX ?? 1), slot.texH * norm * t.scale * (t.scaleY ?? 1), 1);
        slot.mesh.material.opacity = t.alpha;
        slot.mesh.visible = t.alpha > 0.001 && t.scale > 0.0001;
      }
    }
  }

  private syncBackgroundTexture(url: string, blur: number) {
    const sig = `${url}|${this.width}x${this.height}|${Math.max(0, blur)}`;
    if (sig === this.backgroundSig) {
      if (this.backgroundTex) this.scene.background = this.backgroundTex;
      return;
    }
    this.backgroundSig = sig;
    const generation = ++this.backgroundGeneration;
    loadImage(url).then((img) => {
      if (!img || !this.ready || generation !== this.backgroundGeneration) return;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, this.width);
      canvas.height = Math.max(2, this.height);
      const g = canvas.getContext('2d');
      if (!g) return;
      const cover = Math.max(canvas.width / img.width, canvas.height / img.height) * 1.08;
      const w = img.width * cover;
      const h = img.height * cover;
      g.filter = blur > 0 ? `blur(${Math.max(0, blur)}px)` : 'none';
      g.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.backgroundTex?.dispose();
      this.backgroundTex = texture;
      this.scene.background = texture;
      this.onDirty?.();
    });
  }

  private applyPhysicalPose(slot: Slot3D, t: LayerTransform3D, norm: number) {
    const alpha = clamp(t.alpha, 0, 1);
    const thickness = Math.max(0, t.thickness ?? 0);
    const bend = clamp(t.bend ?? 0, -0.45, 0.45);
    const bent = Math.abs(bend) > 0.0001;
    const curl = clamp(t.curl ?? 0, -Math.PI * 2.4, Math.PI * 2.4);
    const curled = Math.abs(curl) > 0.001;
    const cornerPeel = clamp(t.cornerPeel ?? 0, 0, 1);
    const peeling = cornerPeel > 0.0001;
    const stickerRolling = Number.isFinite(t.stickerPeelFront)
      && Number.isFinite(t.stickerCurlRadius)
      && (t.stickerCurlRadius ?? 0) > 0;
    const peelSoftness = clamp(t.peelSoftness ?? 0, 0, 1);
    const physical = thickness > 0.05 && !bent && !curled && !peeling && !stickerRolling;
    const exposure = clamp(t.materialExposure ?? 1, 0.25, 2.5);
    const shadow = (t.shadowStrength ?? 0) > 0.02;
    const customBackface = typeof t.backfaceColor === 'string' && t.backfaceColor.length > 0;

    slot.root.position.set(t.x, -t.y, t.z);
    if (t.quaternion) {
      slot.root.quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w).normalize();
    } else {
      slot.root.rotation.set(t.rotationX ?? 0, t.rotationY ?? 0, t.rotationZ ?? 0);
    }
    const cardWidth = slot.texW * norm * t.scale;
    slot.root.scale.set(
      cardWidth,
      slot.texH * norm * t.scale,
      (bent || curled || peeling || stickerRolling) ? cardWidth : physical ? thickness : 1,
    );
    if (stickerRolling) {
      const quantizedFront = Math.round((t.stickerPeelFront ?? 0) * 180) / 180;
      const quantizedRadius = Math.round((t.stickerCurlRadius ?? 0.15) * 180) / 180;
      const quantizedDirection = Math.round((t.peelDirection ?? 50) * 2) / 2;
      const key = `sticker-roll:${quantizedFront.toFixed(4)}:${quantizedRadius.toFixed(4)}:${quantizedDirection.toFixed(1)}`;
      let geometry = this.bentCardGeometries.get(key);
      if (!geometry) {
        geometry = makeStickerRollGeometry(quantizedFront, quantizedRadius, quantizedDirection);
        this.bentCardGeometries.set(key, geometry);
      }
      slot.front.geometry = geometry;
      slot.back.geometry = geometry;
    } else if (peeling) {
      const progressSteps = 180;
      const quantizedProgress = Math.round(cornerPeel * progressSteps) / progressSteps;
      const quantizedAngle = Math.round((t.peelAngle ?? Math.PI * 0.78) * 64) / 64;
      const quantizedCurl = Math.round(curl * 64) / 64;
      const quantizedDirection = Math.round((t.peelDirection ?? 50) * 2) / 2;
      const quantizedSoftness = Math.round(peelSoftness * 32) / 32;
      const key = `peel:${quantizedProgress.toFixed(3)}:${quantizedAngle.toFixed(3)}:${quantizedCurl.toFixed(3)}:${quantizedDirection.toFixed(1)}:${quantizedSoftness.toFixed(3)}`;
      let geometry = this.bentCardGeometries.get(key);
      if (!geometry) {
        geometry = makeCornerPeelGeometry(
          quantizedProgress,
          quantizedAngle,
          quantizedCurl,
          quantizedDirection,
          quantizedSoftness,
        );
        this.bentCardGeometries.set(key, geometry);
      }
      slot.front.geometry = geometry;
      slot.back.geometry = geometry;
    } else if (curled) {
      const quantized = Math.round(curl * 60) / 60;
      const key = `curl:${quantized.toFixed(3)}`;
      let geometry = this.bentCardGeometries.get(key);
      if (!geometry) {
        geometry = makeCurlPlaneGeometry(quantized);
        this.bentCardGeometries.set(key, geometry);
      }
      slot.front.geometry = geometry;
      slot.back.geometry = geometry;
    } else if (bent) {
      const key = bend.toFixed(3);
      let geometry = this.bentCardGeometries.get(key);
      if (!geometry) {
        geometry = makeBentPlaneGeometry(bend);
        this.bentCardGeometries.set(key, geometry);
      }
      slot.front.geometry = geometry;
      slot.back.geometry = geometry;
    } else {
      slot.front.geometry = this.cardPlaneGeometry;
      slot.back.geometry = this.cardPlaneGeometry;
    }
    slot.front.position.z = physical ? 0.501 : 0;
    slot.front.material.side = customBackface ? THREE.FrontSide : THREE.DoubleSide;
    slot.front.material.opacity = alpha;
    slot.front.material.depthWrite = alpha > 0.995;
    // `dim` darkens a card that is merely FAR, without touching its opacity —
    // fading such a card on alpha lets whatever is behind it show through, and
    // a ring then reads as glass rather than as depth. It is deliberately
    // separate from `exposure`: exposure is lighting, and the branch below
    // ignores lighting entirely to keep flat cards colour-accurate.
    const lit = 1 - clamp(t.dim ?? 0, 0, 1);
    if (physical) {
      const e = exposure * lit;
      slot.front.material.color.setRGB(e, e, e);
      slot.front.material.emissiveIntensity = (0.18 + exposure * 0.14) * lit;
    } else {
      // Match CSS 3D panels: the source image stays color-accurate while its
      // geometry supplies the perspective. Only cards with thickness are lit —
      // so here `dim` is the ONLY thing that may darken the image.
      slot.front.material.color.setRGB(0, 0, 0);
      slot.front.material.emissiveIntensity = lit;
    }
    slot.front.castShadow = shadow;
    slot.front.receiveShadow = shadow;

    // A physical card is THREE transparent meshes — front at +T/2, body, back at
    // -T/2. They only stack correctly while the card writes depth, and depth
    // writing is gated on alpha > 0.995 just above. Below that the three blend in
    // whatever order the scene graph happens to give, and the card renders as
    // interleaved stripes of itself: the front image shredded by its own body.
    // Measured across the library, this hit 100% of Depth Stack's cards, 86-94%
    // of Helix 3D's and 67% of Parallax Totem's — every template that combines
    // thickness with a depth/back fade, which is all of them.
    //
    // So the solid is shown on exactly the cards that can sort it. A faded card
    // falls back to its single front plane, which is the honest degradation:
    // you cannot see the edge of a translucent card anyway.
    const solid = physical && alpha > 0.995;
    slot.body.visible = solid;
    slot.back.visible = solid || (customBackface && alpha > 0.001);
    // A peeled reverse is the underside of the same sheet. Keep it flush with
    // the deformed front; the generic -0.02 plane offset is multiplied by the
    // card width on this path and visibly detached the colour as a second card.
    slot.back.position.z = physical ? -0.501 : (bent || curled || peeling || stickerRolling) ? -0.0005 : -0.02;
    if (customBackface) slot.back.material.color.set(t.backfaceColor!);
    slot.body.material.opacity = alpha;
    slot.back.material.opacity = alpha;
    slot.back.material.depthWrite = alpha > 0.995;
    slot.body.castShadow = slot.body.receiveShadow = shadow;
    slot.back.castShadow = slot.back.receiveShadow = shadow;
    slot.root.visible = alpha > 0.001 && t.scale > 0.0001;
  }

  private updateTrackState(track: MotionTrack, rt: TrackRT3D, frame: number, sceneTotal: number, s: SceneState) {
    const time = resolveTrackTime(track, frame, sceneTotal);
    rt.active = time.active;
    rt.group.visible = time.active;
    if (!time.active) return;
    const template = getTemplate(track.templateId);
    const count = rt.slots.length;
    const ease = resolveEasing(track.easing);
    const easedPhase = (phase: number) => {
      const base = Math.floor(phase);
      return base + ease(phase - base);
    };
    const ctx = {
      fps: s.fps, width: s.width, height: s.height,
      duration: time.localTotal / Math.max(1, s.fps),
      totalFrames: time.localTotal,
      ease, easedPhase,
      // The Box and other geometry-aware templates need the exact dimensions
      // that the renderer gives each cropped card. Without this, changing Card
      // shape updates the mesh but leaves the path geometry at its default.
      cardAspect: cardAspectFor(template.meta, s.width, s.height, s.cardShape),
    };
    this.updateTrackCamera(rt.camera, Number(track.values.perspective ?? 100), template.camera?.(track.values, ctx));
    rt.group.position.set(track.transform.x, -track.transform.y, 0);
    rt.group.scale.setScalar(track.transform.scale);
    rt.group.rotation.set(0, 0, -(track.transform.rotation * Math.PI) / 180);
    const layerAlpha = clamp(track.opacity, 0, 1) * time.envelope;
    rt.opacity = layerAlpha;
    rt.blend = track.blend;

    for (let i = 0; i < count; i++) {
      const slot = rt.slots[i];
      const norm = SPRITE_BASE / Math.max(slot.texW, slot.texH);
      this.applyCorner(slot, Number(track.values.cornerRadius ?? 0));
      // Blend mode and layer opacity are applied once to the completed render
      // target. Inside a track cards still use normal alpha + their own depth.
      if (template.transform3d) {
        const t = template.transform3d(time.localFrame, i, count, track.values, ctx);
        this.applyPhysicalPose(slot, t, norm);
      } else {
        const t = template.transform(time.localFrame, i, count, track.values, ctx);
        slot.front.geometry = this.cardPlaneGeometry;
        slot.root.position.set(t.x, -t.y, t.depth);
        slot.root.rotation.set(0, 0, -t.rotation);
        slot.root.scale.set(slot.texW * norm * t.scale * (t.scaleX ?? 1), slot.texH * norm * t.scale * (t.scaleY ?? 1), 1);
        slot.front.position.z = 0;
        slot.front.material.opacity = t.alpha;
        slot.front.material.depthWrite = false;
        slot.front.material.color.setRGB(0, 0, 0);
        slot.front.material.emissiveIntensity = 1;
        slot.front.castShadow = false;
        slot.front.receiveShadow = false;
        slot.body.visible = false;
        slot.back.visible = false;
        slot.root.visible = t.alpha > 0.001 && t.scale > 0.0001;
      }
    }
  }

  // ---- video export sync ---- (see the Pixi renderer for the rationale)
  async beginVideoExport() {
    if (this.videoEls.size === 0) return;
    if (!IS_STATIC_EXPORT) {
      this.restoreVideoSources = await useVideoProxies(this.videoEls, BASE_PATH);
    }
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
    this.invalidateTracks();
    this.syncAssets();
  }

  endVideoExport() {
    this.restoreVideoSources?.();
    this.restoreVideoSources = null;
    this.croppedCache.forEach((tex) => tex.dispose());
    this.croppedCache.clear();
    this.exportVideoFrames.forEach(({ texture }) => texture.dispose());
    this.exportVideoFrames.clear();
    this.invalidateTracks();
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
    if (!this.ready || this.destroyed || !this.renderer) return;
    try {
      this.getFrameState(frame);
      if (!this.ready || this.destroyed || !this.renderer) return;
      const s = useSceneStore.getState();

      // The accumulator begins with the scene background.
      const rawAlpha = s.background.alpha ?? 100;
      const alphaPct = (rawAlpha > 0 && rawAlpha <= 1) ? rawAlpha * 100 : rawAlpha;
      const bgAlpha = Math.max(0, Math.min(1, alphaPct / 100));

      this.renderer.setRenderTarget(this.composeA);
      this.renderer.setClearColor(new THREE.Color(s.background.color), bgAlpha);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.camera);

      let read = this.composeA;
      let write = this.composeB;
      const composeMaterial = this.composeQuad.material;
      s.tracks.forEach((track) => {
        const rt = this.trackRTs.get(track.id);
        if (!rt?.active) return;

        // A layer owns its depth buffer. Z can never leak into another layer.
        this.renderer.setRenderTarget(rt.target);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.clear(true, true, true);
        this.renderer.render(rt.scene, rt.camera);

        composeMaterial.uniforms.baseMap.value = read.texture;
        composeMaterial.uniforms.layerMap.value = rt.target.texture;
        composeMaterial.uniforms.opacity.value = rt.opacity;
        composeMaterial.uniforms.blendMode.value = rt.blend === 'add' ? 1
          : rt.blend === 'screen' ? 2
          : rt.blend === 'multiply' ? 3 : 0;
        this.renderer.setRenderTarget(write);
        this.renderer.clear(true, false, false);
        this.renderer.render(this.composeScene, this.composeCam);
        [read, write] = [write, read];
      });

      // Effects, as further passes on the SAME ping-pong the tracks just used.
      // Until now this pass looked pixelate up by id and folded it into the output
      // quad, so the other effects in effects/ simply did not exist for the webgl
      // presets. Each active effect is now a pass, applied in the order the panel
      // lists them — the same order the 2D path gives PIXI.Container.filters.
      //
      // The resolution handed to the shader is the RENDER TARGET's, not the
      // scene's: during export the whole chain runs supersampled, and an effect
      // measured in scene pixels would come out proportionally finer in the
      // exported frame than on screen.
      const fxCtx = {
        width: this.width * this.resolution,
        height: this.height * this.resolution,
        time: frame / Math.max(1, s.fps),
      };
      for (const active of s.effects) {
        if (!active.enabled) continue;
        const def = getEffect(active.effectId);
        if (!def) continue;
        try {
          const material = threeMaterialFor(def);
          applyThreeUniforms(material, def, active.values, fxCtx);
          material.uniforms.map.value = read.texture;
          this.fxQuad.material = material;
          this.renderer.setRenderTarget(write);
          this.renderer.clear(true, false, false);
          this.renderer.render(this.fxScene, this.composeCam);
          [read, write] = [write, read];
        } catch { /* a shader that will not compile must not take the scene down */ }
      }

      this.outputQuad.material.uniforms.map.value = read.texture;
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.outputScene, this.composeCam);

      // HUD pass (logo + safe-area) is deliberately outside global pixelation.
      this.renderer.autoClear = false;
      this.renderer.render(this.hud, this.hudCam);
      this.renderer.autoClear = true;
    } catch {
      // guard against renderer being disposed mid-frame or WebGL context lost
    }
  }

  captureFrame(frame: number): string {
    if (!this.ready || this.destroyed || !this.renderer) return '';
    this.renderFrame(frame);
    const s = useSceneStore.getState();
    const rawAlpha = s.background.alpha ?? 100;
    const alphaPct = (rawAlpha > 0 && rawAlpha <= 1) ? rawAlpha * 100 : rawAlpha;
    if (alphaPct < 100) {
      return this.renderer.domElement?.toDataURL?.('image/png') ?? '';
    }
    return this.renderer.domElement?.toDataURL?.('image/jpeg', 0.92) ?? '';
  }

  extractCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  destroy() {
    this.ready = false;
    this.destroyed = true;
    this.texturePromises.clear();
    this.r3f?.destroy();
    this.r3f = null;
    this.trackRTs.forEach((rt) => this.destroyTrack(rt));
    this.trackRTs.clear();
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
    this.backgroundTex?.dispose();
    this.backgroundGeneration++;
    this.composeA?.dispose();
    this.composeB?.dispose();
    this.composeQuad?.geometry.dispose();
    this.composeQuad?.material.dispose();
    this.outputQuad?.geometry.dispose();
    this.outputQuad?.material.dispose();
    disposeThreeMaterials();
    this.cardPlaneGeometry.dispose();
    this.cardBodyGeometry.dispose();
    this.bentCardGeometries.forEach((geometry) => geometry.dispose());
    this.bentCardGeometries.clear();
    if (this.logoMesh) { this.logoMesh.geometry.dispose(); this.logoMesh.material.map?.dispose(); this.logoMesh.material.dispose(); }
    if (this.safeLine) { this.safeLine.geometry.dispose(); (this.safeLine.material as THREE.Material).dispose(); }
    try {
      this.renderer.dispose();
    } catch { /* already lost */ }
  }
}
