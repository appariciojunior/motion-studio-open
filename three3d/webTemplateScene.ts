import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { fitAndCenter } from './frame';
import { asset } from '@/lib/paths';
import { getTemplate, defaultsFor } from '@/templates';
import { findScreenMesh, applyScreenImage, DEFAULT_SCREEN_TRANSFORM, type ScreenImageHandle, type ScreenTransform } from './screenImage';
import type { DeviceDef } from './devices';
import type { TransformCtx, CameraPose } from '@/lib/types';

// ── Web MVP — device driven by an existing 2D/3D motion template ────────────
// The pitch: the GLB is static (no rig, no skinning) — every one of the 224
// motion catalogue presets is a PURE function of (frame, index, count, values,
// ctx), so instead of building a bespoke "session" animation system for
// devices, drive N cloned device instances with a template's own
// transform3d()+camera() (webgl families — the direct, correct fit) or its 2D
// transform() projected onto the z=0 plane (pixi-only families — flatter, but
// still real motion). Same conventions lib/renderer3d.ts uses for cards, so a
// preset looks the same whether it's animating an image plane or a device.
//
// BASE=340 matches templates/ring3dRef.ts and templates/spiral.ts's own
// internal reference: their `scale` output is already normalized against it,
// so fitting each device clone to exactly this size makes `t.scale` a
// straight multiplier — no extra conversion factor to get wrong.
const BASE = 340;

// Device clones are full GLB instances with their own screen texture (1024²
// canvas when an image is bound) — not cheap 2D cards. Motion presets default
// to 10-70 layers, way past what a device grid can carry, so instancing is
// hard-capped here regardless of what the template's own "count" asks for.
const MAX_INSTANCES = 12;

export interface WebTemplateSceneOptions {
  device: DeviceDef;
  templateId: string;
  canvasSize: { width: number; height: number };
  // Read every frame — a control drag updates the scene live without
  // re-loading the model, same as the editor's own live-values contract.
  getValues: () => Record<string, any>;
  // One image per instance, cycled by index (screenImageUrls[i % length]) —
  // lets each device clone show different screen content instead of every
  // instance repeating the same picture. A gap (null/undefined) skips that
  // instance's screen entirely.
  screenImageUrls?: (string | null | undefined)[];
  getScreenTransform?: () => ScreenTransform;
  durationSec?: number;
  fps?: number;
}

export function initWebTemplateScene(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  opts: WebTemplateSceneOptions,
): () => void {
  const { device, templateId, canvasSize, getValues, screenImageUrls, getScreenTransform, durationSec = 8, fps = 30 } = opts;
  let disposed = false;
  let animId = 0;
  const clock = { seconds: 0, last: 0 };

  const template = getTemplate(templateId);
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  const linear = (t: number) => t;
  const ctx: TransformCtx = {
    fps, width: canvasSize.width, height: canvasSize.height,
    duration: durationSec, totalFrames,
    ease: linear,
    easedPhase: (p) => { const b = Math.floor(p); return b + linear(p - b); },
    cardAspect: template.meta.cardAspect === 'canvas' ? canvasSize.width / canvasSize.height : (typeof template.meta.cardAspect === 'number' ? template.meta.cardAspect : undefined),
  };
  const defaults = defaultsFor(templateId);
  const initialCount = Math.min(MAX_INSTANCES, Math.max(1, Math.round(template.layerCount?.(defaults, ctx) ?? Number(defaults.count ?? 1))));
  // Live-resizable only when the template exposes its own "count" — read
  // every frame off the same `values` the poses use, so the Count slider
  // adds/removes device clones without a full model reload.
  const liveResizable = 'count' in defaults;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20000);
  camera.position.set(0, 0, 1000);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0xffffff, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(-4, 1, -2);
  scene.add(fill);

  // Deep-clone the node hierarchy AND its materials (geometry stays shared —
  // it's static and read-only) so each instance can carry its own opacity/
  // visibility without fighting its siblings.
  function cloneWithOwnMaterials(root: THREE.Object3D): THREE.Object3D {
    const clone = root.clone(true);
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material | THREE.Material[];
      mesh.material = Array.isArray(mat) ? mat.map((m) => m.clone()) : mat.clone();
    });
    return clone;
  }

  // Parallel arrays, one entry per live instance — index i's pivot, its
  // model instance and its (possibly absent) screen handle all move
  // together on add/remove, same as growing/shrinking a single list.
  const pivots: THREE.Group[] = [];
  const instances: THREE.Object3D[] = [];
  const screenHandles: (ScreenImageHandle | null)[] = [];
  let lastScreenTransformKey = '';
  let sourceModel: THREE.Object3D | null = null;

  function forEachMaterial(root: THREE.Object3D, fn: (m: THREE.Material) => void) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach(fn); else fn(mat);
    });
  }

  function addInstance() {
    if (!sourceModel) return;
    const i = pivots.length;
    // Index 0 reuses the loaded scene directly (never removed — count never
    // drops below 1); every later index gets its own cloned hierarchy so its
    // opacity/screen texture don't fight its siblings.
    const instance = i === 0 ? sourceModel : cloneWithOwnMaterials(sourceModel);
    instances.push(instance);
    const url = screenImageUrls?.length ? screenImageUrls[i % screenImageUrls.length] : null;
    let handle: ScreenImageHandle | null = null;
    if (url) {
      const screenMesh = findScreenMesh(instance);
      if (screenMesh) handle = applyScreenImage(screenMesh, url, device, getScreenTransform?.() ?? DEFAULT_SCREEN_TRANSFORM);
    }
    screenHandles.push(handle);
    const pivot = new THREE.Group();
    pivot.add(instance);
    scene.add(pivot);
    pivots.push(pivot);
  }

  // Drops the LAST instance only (index 0 is the floor). Geometry is shared
  // with sourceModel (see cloneWithOwnMaterials) and stays alive — only this
  // instance's own cloned materials and screen texture are freed.
  function removeLastInstance() {
    if (pivots.length <= 1) return;
    const pivot = pivots.pop()!;
    const instance = instances.pop()!;
    const handle = screenHandles.pop();
    handle?.dispose();
    scene.remove(pivot);
    instance.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }

  function syncInstanceCount(target: number) {
    const n = Math.min(MAX_INSTANCES, Math.max(1, Math.round(target)));
    while (pivots.length < n) addInstance();
    while (pivots.length > n) removeLastInstance();
  }

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    asset(device.modelUrl),
    (gltf) => {
      if (disposed) return;
      sourceModel = gltf.scene;
      fitAndCenter(sourceModel, BASE); // bakes the BASE-normalized fit into the model once
      syncInstanceCount(initialCount);
    },
    undefined,
    (err) => { console.error('Web template scene: model load failed:', err); },
  );

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  // Same convention as lib/renderer3d.ts's updateTrackCamera — a template's
  // CameraPose is meaningless without it (fov/distance/position all interact).
  function applyCameraPose(pose: CameraPose | undefined) {
    const fov = pose?.fov ?? 50;
    camera.fov = fov;
    const D = (ctx.height / 2) / Math.tan((fov * Math.PI) / 360);
    const position = pose?.position ?? { x: 0, y: 0, z: D * (pose?.distance ?? 1) };
    const target = pose?.target ?? { x: 0, y: 0, z: 0 };
    camera.position.set(position.x, -position.y, position.z);
    camera.lookAt(target.x, -target.y, target.z);
    camera.near = pose?.near ?? 0.1;
    camera.far = pose?.far ?? Math.max(D * 8, Math.abs(position.z) * 8);
    camera.updateProjectionMatrix();
  }

  function loop(now: number) {
    if (disposed) return;
    animId = requestAnimationFrame(loop);
    const dt = clock.last ? Math.min(0.1, (now - clock.last) / 1000) : 0;
    clock.last = now;
    clock.seconds = (clock.seconds + dt) % durationSec;
    const frame = Math.floor(clock.seconds * fps);
    const values = getValues();

    if (sourceModel && liveResizable) {
      syncInstanceCount(Math.round(template.layerCount?.(values, ctx) ?? Number(values.count ?? initialCount)));
    }
    const count = pivots.length;

    if (screenHandles.some(Boolean) && getScreenTransform) {
      const t = getScreenTransform();
      const key = `${t.fit}|${t.zoom}|${t.offsetX}|${t.offsetY}`;
      if (key !== lastScreenTransformKey) {
        lastScreenTransformKey = key;
        for (const h of screenHandles) h?.redraw(t);
      }
    }

    for (let i = 0; i < pivots.length; i++) {
      const pivot = pivots[i];
      if (template.transform3d) {
        const t = template.transform3d(frame, i, count, values, ctx);
        pivot.position.set(t.x, -t.y, t.z);
        pivot.rotation.set(t.rotationX ?? 0, t.rotationY ?? 0, t.rotationZ ?? 0);
        pivot.scale.setScalar(Math.max(0.0001, t.scale));
        pivot.visible = t.alpha > 0.001 && t.scale > 0.0001;
        forEachMaterial(pivot, (m) => {
          (m as THREE.MeshStandardMaterial).opacity = t.alpha;
          m.transparent = t.alpha < 0.995;
        });
      } else {
        const t = template.transform(frame, i, count, values, ctx);
        pivot.position.set(t.x, -t.y, t.depth);
        pivot.rotation.set(0, 0, -t.rotation);
        pivot.scale.set(Math.max(0.0001, t.scale * (t.scaleX ?? 1)), Math.max(0.0001, t.scale * (t.scaleY ?? 1)), Math.max(0.0001, t.scale));
        pivot.visible = t.alpha > 0.001 && t.scale > 0.0001;
        forEachMaterial(pivot, (m) => {
          (m as THREE.MeshStandardMaterial).opacity = t.alpha;
          m.transparent = t.alpha < 0.995;
        });
      }
    }

    applyCameraPose(template.camera?.(values, ctx));
    renderer.render(scene, camera);
  }
  animId = requestAnimationFrame(loop);

  return function dispose() {
    disposed = true;
    cancelAnimationFrame(animId);
    ro.disconnect();
    renderer.dispose();
    for (const h of screenHandles) h?.dispose();
    // Every clone shares sourceModel's geometry (cloneWithOwnMaterials only
    // clones materials) — dispose each instance's own materials, then the
    // geometry exactly once via sourceModel itself.
    for (const instance of instances) {
      instance.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
    }
    sourceModel?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  };
}
