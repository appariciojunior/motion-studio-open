import JSZip from 'jszip';
import { asset } from './paths';
import { getTemplate, defaultsFor } from '@/templates';
import type { TransformCtx } from '@/lib/types';
import type { DeviceDef } from '@/three3d/devices';
import type { ScreenTransform } from '@/three3d/screenImage';

const DEFAULT_SCREEN_TRANSFORM: ScreenTransform = { fit: 'cover', zoom: 1, offsetX: 50, offsetY: 50 };

// ── Web MVP export ────────────────────────────────────────────────────────
// Ships a real interactive 3D viewer, not a baked video: an index.html that
// loads three.js from a CDN via an import map, plus the device's own .glb
// (and, if one was set, a screen image) sitting next to it. No build step —
// the person receiving it just opens index.html.
//
// The rig here is a plain-JS re-statement of three3d/webMvpViewer.ts and
// three3d/webTemplateScene.ts. It has to be re-derived rather than imported:
// the exported page runs standalone, months or years after this app built
// it, against whatever three.js version the pinned CDN URL resolves to — it
// can't import this repo's own modules.

const THREE_VERSION = '0.185.1'; // matches package.json's three — keep in step

// Screen compositing — trimmed re-statement of three3d/screenImage.ts for the
// exported page: find the mesh named "Screen", fit the bundled image onto a
// canvas texture, clip to the device's own corner radius. `screenFileNames`
// is indexed by instance (cycled: files[i % files.length]) so a multi-device
// scene can show different screen content per clone from a handful of images.
function screenJsBlock(device: DeviceDef, screenFileNames: string[], transform: ScreenTransform): string {
  return `
function partKeyOf(mesh) {
  const mn = mesh.material && !Array.isArray(mesh.material) ? mesh.material.name : '';
  if (mn) return mn;
  return (mesh.name || 'mesh').replace(/[._-\\s]?\\d+$/, '') || mesh.name;
}
function findScreenMesh(root) {
  let found = null;
  root.traverse((o) => { if (!found && o.isMesh && partKeyOf(o) === 'Screen') found = o; });
  return found;
}
function ensureUVs(mesh) {
  const geo = mesh.geometry;
  if (geo.getAttribute('uv')) return;
  const pos = geo.getAttribute('position');
  if (!pos) return;
  geo.computeBoundingBox();
  const bb = geo.boundingBox, size = bb.getSize(new THREE.Vector3());
  const flat = size.x <= size.y && size.x <= size.z ? 'x' : size.y <= size.z ? 'y' : 'z';
  const axes = ['x', 'y', 'z'].filter((a) => a !== flat);
  const ua = axes[0], va = axes[1];
  const get = { x: 'getX', y: 'getY', z: 'getZ' };
  const uSpan = Math.max(1e-6, size[ua]), vSpan = Math.max(1e-6, size[va]);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos[get[ua]](i) - bb.min[ua]) / uSpan;
    uv[i * 2 + 1] = (pos[get[va]](i) - bb.min[va]) / vSpan;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
const SCREEN_FILES = ${JSON.stringify(screenFileNames)};
function applyScreenImage(instance, i) {
  if (!SCREEN_FILES.length) return;
  const screenFileName = SCREEN_FILES[i % SCREEN_FILES.length];
  const mesh = findScreenMesh(instance);
  if (!mesh) return;
  ensureUVs(mesh);
  const transpose = ${JSON.stringify(device.screenTextureTranspose ?? null)};
  const aspect = transpose ? 1 / ${device.screenAspect} : ${device.screenAspect};
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(1, Math.round(1024 / aspect));
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = ${device.screenTextureFlipY ?? true};
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, alphaTest: 0.001 });
  mat.polygonOffset = true; mat.polygonOffsetFactor = 0; mat.polygonOffsetUnits = -2;
  mesh.material = mat;
  mesh.renderOrder = 1000;
  const FIT = ${JSON.stringify(transform.fit)};
  const ZOOM = ${JSON.stringify(transform.zoom)};
  const OFFSET_X = ${JSON.stringify(transform.offsetX)};
  const OFFSET_Y = ${JSON.stringify(transform.offsetY)};
  const img = new Image();
  img.onload = () => {
    const W = canvas.width, H = canvas.height;
    const r = Math.min(W, H) * ${Math.max(0, device.screenCornerFrac)};
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (r > 0.5) { ctx.beginPath(); ctx.roundRect(0, 0, W, H, r); ctx.clip(); }
    const srcW = img.naturalWidth, srcH = img.naturalHeight;
    const byW = W / srcW, byH = H / srcH;
    const base = FIT === 'width' ? byW : FIT === 'contain' ? Math.min(byW, byH) : Math.max(byW, byH);
    const scale = base * Math.max(0.05, ZOOM);
    const dw = srcW * scale, dh = srcH * scale;
    const dx = (W - dw) * (OFFSET_X / 100);
    const dy = (H - dh) * (OFFSET_Y / 100);
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    tex.needsUpdate = true;
  };
  img.src = './' + screenFileName;
}
`;
}

function viewerHtml(deviceLabel: string, glbFileName: string, device: DeviceDef, screenFileName: string | null, screenTransform: ScreenTransform): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${deviceLabel} — 3D viewer</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body { margin: 0; height: 100%; background: #f2f2f4; }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; }
</style>
</head>
<body>
<canvas id="stage"></canvas>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const canvas = document.getElementById('stage');
const FIT_HEIGHT = ${device.fitHeight};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
camera.position.set(0, 0, FIT_HEIGHT * 1.8);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x000000, 0);
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

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = FIT_HEIGHT * 0.6;
controls.maxDistance = FIT_HEIGHT * 4;

// Scale a loaded model to FIT_HEIGHT and centre it on its own bbox — same
// fit used in the editor (three3d/frame.ts's fitAndCenter).
function fitAndCenter(model, targetSize) {
  model.scale.set(1, 1, 1);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = targetSize / maxDim;
  model.scale.setScalar(s);
  model.position.copy(center).multiplyScalar(-s);
}
${screenFileName ? screenJsBlock(device, [screenFileName], screenTransform) : ''}
// The bundled model.glb is meshopt-compressed (see gltf-transform optimize in
// this app's scripts/optimize-web-devices.cjs) — the decoder is required or
// EXT_meshopt_compression primitives silently fail to load.
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.load('./${glbFileName}', (gltf) => {
  fitAndCenter(gltf.scene, FIT_HEIGHT);
  scene.add(gltf.scene);
  ${screenFileName ? 'applyScreenImage(gltf.scene, 0);' : ''}
}, undefined, (err) => console.error('3D viewer: model load failed:', err));

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
}
loop();
</script>
</body>
</html>
`;
}

/** Fetches `url` (may be a blob: URL) and returns its bytes + a short extension. */
async function fetchBytes(url: string): Promise<{ buf: ArrayBuffer; ext: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const blob = await res.blob();
  const ext = blob.type.split('/')[1]?.split('+')[0] || 'jpg';
  return { buf: await blob.arrayBuffer(), ext };
}

/** Build the export zip (index.html + the device's .glb [+ screen image]) as a Blob. */
export async function buildWebMvpZip(device: DeviceDef, deviceLabel: string, screenImageUrl?: string | null, screenTransform: ScreenTransform = DEFAULT_SCREEN_TRANSFORM): Promise<Blob> {
  const glbRes = await fetch(asset(device.modelUrl));
  if (!glbRes.ok) throw new Error(`Failed to fetch model: ${glbRes.status}`);
  const glbBuf = await glbRes.arrayBuffer();

  const glbFileName = 'model.glb';
  const zip = new JSZip();
  let screenFileName: string | null = null;
  if (screenImageUrl) {
    const { buf, ext } = await fetchBytes(screenImageUrl);
    screenFileName = `screen.${ext}`;
    zip.file(screenFileName, buf);
  }
  zip.file('index.html', viewerHtml(deviceLabel, glbFileName, device, screenFileName, screenTransform));
  zip.file(glbFileName, glbBuf);
  return zip.generateAsync({ type: 'blob' });
}

/** Build the zip and trigger a download. */
export async function downloadWebMvpZip(deviceKey: string, device: DeviceDef, deviceLabel: string, screenImageUrl?: string | null, screenTransform?: ScreenTransform): Promise<void> {
  const blob = await buildWebMvpZip(device, deviceLabel, screenImageUrl, screenTransform);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deviceKey}-3d-viewer.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Template-driven export ───────────────────────────────────────────────
// The motion catalogue's transform3d()/transform()/camera() are pure functions
// of (frame, index, count, values, ctx) — see templates/*.ts's own ground
// rules ("transforms stay pure and deterministic"). Rather than re-bundling a
// template's TS source (and its own imports) into a dependency-free exported
// page, this BAKES one full loop's worth of poses by calling those same
// functions here, once, and ships the resulting table as a small embedded
// JSON array. The exported page just indexes into it every frame — same
// numbers the live app produces, no reimplementation to drift out of sync.

const r3 = (n: number) => Math.round(n * 1000) / 1000; // trim JSON size, negligible visually

// Same cap as three3d/webTemplateScene.ts's MAX_INSTANCES — keeps the exported
// page's instance count identical to what was previewed live.
const MAX_INSTANCES = 12;

interface BakedInstance { x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number; a: number; }
interface BakedCamPose { fov: number; x: number; y: number; z: number; tx: number; ty: number; tz: number; near: number; far: number; }
interface BakedFrame { inst: BakedInstance[]; cam: BakedCamPose; }

function bakeTemplateFrames(
  templateId: string,
  canvasSize: { width: number; height: number },
  durationSec: number,
  fps: number,
  valuesOverride?: Record<string, any>,
): { frames: BakedFrame[]; count: number } {
  const template = getTemplate(templateId);
  const values = { ...defaultsFor(templateId), ...valuesOverride };
  const totalFrames = Math.max(1, Math.round(durationSec * fps));
  const linear = (t: number) => t;
  const ctx: TransformCtx = {
    fps, width: canvasSize.width, height: canvasSize.height,
    duration: durationSec, totalFrames,
    ease: linear,
    easedPhase: (p) => { const b = Math.floor(p); return b + linear(p - b); },
    cardAspect: template.meta.cardAspect === 'canvas' ? canvasSize.width / canvasSize.height : (typeof template.meta.cardAspect === 'number' ? template.meta.cardAspect : undefined),
  };
  // Reads count off the same merged `values` the live preview resizes with
  // (three3d/webTemplateScene.ts's syncInstanceCount) — the export matches
  // whatever instance count was on screen when Export was clicked.
  const rawCount = Math.max(1, Math.round(template.layerCount?.(values, ctx) ?? Number(values.count ?? 1)));
  const count = Math.min(MAX_INSTANCES, rawCount);

  const frames: BakedFrame[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const inst: BakedInstance[] = [];
    for (let i = 0; i < count; i++) {
      if (template.transform3d) {
        const t = template.transform3d(f, i, count, values, ctx);
        inst.push({ x: r3(t.x), y: r3(t.y), z: r3(t.z), rx: r3(t.rotationX ?? 0), ry: r3(t.rotationY ?? 0), rz: r3(t.rotationZ ?? 0), s: r3(t.scale), a: r3(t.alpha) });
      } else {
        const t = template.transform(f, i, count, values, ctx);
        inst.push({ x: r3(t.x), y: r3(t.y), z: r3(t.depth), rx: 0, ry: 0, rz: r3(-t.rotation), s: r3(t.scale), a: r3(t.alpha) });
      }
    }
    const pose = template.camera?.(values, ctx);
    const fov = pose?.fov ?? 50;
    const D = (ctx.height / 2) / Math.tan((fov * Math.PI) / 360);
    const position = pose?.position ?? { x: 0, y: 0, z: D * (pose?.distance ?? 1) };
    const target = pose?.target ?? { x: 0, y: 0, z: 0 };
    frames.push({
      inst,
      cam: {
        fov: r3(fov), x: r3(position.x), y: r3(position.y), z: r3(position.z),
        tx: r3(target.x), ty: r3(target.y), tz: r3(target.z),
        near: r3(pose?.near ?? 0.1), far: r3(pose?.far ?? Math.max(D * 8, Math.abs(position.z) * 8)),
      },
    });
  }
  return { frames, count };
}

function templateViewerHtml(
  deviceLabel: string, glbFileName: string, framesJson: string, count: number, fps: number,
  device: DeviceDef, screenFileNames: string[], screenTransform: ScreenTransform,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${deviceLabel} — 3D scene</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body { margin: 0; height: 100%; background: #f2f2f4; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<canvas id="stage"></canvas>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/"
  }
}
</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Baked once by this app from the same template that drives the live editor
// (templates/*.ts's transform3d()/transform()/camera()) — see
// lib/webMvpExport.ts's bakeTemplateFrames(). One value per frame per
// instance; this page only ever reads the table, it never recomputes motion.
const FRAMES = ${framesJson};
const COUNT = ${count};
const FPS = ${fps};
const BASE = 340; // matches templates/ring3dRef.ts & templates/spiral.ts's own reference

const canvas = document.getElementById('stage');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20000);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x000000, 0);
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

function fitAndCenter(model, targetSize) {
  model.scale.set(1, 1, 1);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = targetSize / maxDim;
  model.scale.setScalar(s);
  model.position.copy(center).multiplyScalar(-s);
}

function cloneWithOwnMaterials(root) {
  const clone = root.clone(true);
  clone.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });
  return clone;
}

const pivots = [];
function forEachMaterial(root, fn) {
  root.traverse((o) => { if (!o.isMesh) return; Array.isArray(o.material) ? o.material.forEach(fn) : fn(o.material); });
}
${screenFileNames.length ? screenJsBlock(device, screenFileNames, screenTransform) : ''}
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.load('./${glbFileName}', (gltf) => {
  const source = gltf.scene;
  fitAndCenter(source, BASE);
  for (let i = 0; i < COUNT; i++) {
    const instance = i === 0 ? source : cloneWithOwnMaterials(source);
    ${screenFileNames.length ? 'applyScreenImage(instance, i);' : ''}
    const pivot = new THREE.Group();
    pivot.add(instance);
    scene.add(pivot);
    pivots.push(pivot);
  }
}, undefined, (err) => console.error('3D scene: model load failed:', err));

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

let seconds = 0, last = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  seconds += dt;
  const frame = Math.floor(seconds * FPS) % FRAMES.length;
  const f = FRAMES[frame];

  for (let i = 0; i < pivots.length; i++) {
    const t = f.inst[i];
    const pivot = pivots[i];
    if (!t) { pivot.visible = false; continue; }
    pivot.position.set(t.x, -t.y, t.z);
    pivot.rotation.set(t.rx, t.ry, t.rz);
    pivot.scale.setScalar(Math.max(0.0001, t.s));
    pivot.visible = t.a > 0.001 && t.s > 0.0001;
    forEachMaterial(pivot, (m) => { m.opacity = t.a; m.transparent = t.a < 0.995; });
  }

  camera.fov = f.cam.fov;
  camera.position.set(f.cam.x, -f.cam.y, f.cam.z);
  camera.lookAt(f.cam.tx, -f.cam.ty, f.cam.tz);
  camera.near = f.cam.near;
  camera.far = f.cam.far;
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
}
loop(0);
</script>
</body>
</html>
`;
}

/** Build the export zip (index.html + baked motion table + the device's .glb [+ screen image]) as a Blob. */
export async function buildWebMvpTemplateZip(
  device: DeviceDef,
  deviceLabel: string,
  templateId: string,
  canvasSize: { width: number; height: number },
  valuesOverride?: Record<string, any>,
  screenImageUrls?: (string | null | undefined)[],
  durationSec = 8,
  fps = 30,
  screenTransform: ScreenTransform = DEFAULT_SCREEN_TRANSFORM,
): Promise<Blob> {
  const glbRes = await fetch(asset(device.modelUrl));
  if (!glbRes.ok) throw new Error(`Failed to fetch model: ${glbRes.status}`);
  const glbBuf = await glbRes.arrayBuffer();

  const { frames, count } = bakeTemplateFrames(templateId, canvasSize, durationSec, fps, valuesOverride);
  const glbFileName = 'model.glb';
  const zip = new JSZip();
  // One zipped file per distinct image, indexed in the same order the
  // exported page cycles them (screenFileNames[i % length]) — a gap in the
  // source array is dropped, not zipped as an empty slot.
  const screenFileNames: string[] = [];
  const urls = (screenImageUrls ?? []).filter((u): u is string => !!u);
  for (let i = 0; i < urls.length; i++) {
    const { buf, ext } = await fetchBytes(urls[i]);
    const name = `screen-${i}.${ext}`;
    zip.file(name, buf);
    screenFileNames.push(name);
  }
  zip.file('index.html', templateViewerHtml(deviceLabel, glbFileName, JSON.stringify(frames), count, fps, device, screenFileNames, screenTransform));
  zip.file(glbFileName, glbBuf);
  return zip.generateAsync({ type: 'blob' });
}

/** Build the template-driven zip and trigger a download. */
export async function downloadWebMvpTemplateZip(
  deviceKey: string,
  device: DeviceDef,
  deviceLabel: string,
  templateId: string,
  canvasSize: { width: number; height: number },
  valuesOverride?: Record<string, any>,
  screenImageUrls?: (string | null | undefined)[],
  screenTransform?: ScreenTransform,
): Promise<void> {
  const blob = await buildWebMvpTemplateZip(device, deviceLabel, templateId, canvasSize, valuesOverride, screenImageUrls, undefined, undefined, screenTransform);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${deviceKey}-${templateId}-3d-scene.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
