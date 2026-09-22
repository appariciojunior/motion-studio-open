import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { fitAndCenter } from './frame';
import { asset } from '@/lib/paths';
import { findScreenMesh, applyScreenImage, DEFAULT_SCREEN_TRANSFORM, type ScreenImageHandle, type ScreenTransform } from './screenImage';
import type { DeviceDef } from './devices';

// ── Web MVP device viewer ────────────────────────────────────────────────────
// A minimal, standalone three.js scene — NOT the Mockup studio (three3d/
// mockup.ts). Renders a device's OWN authored PBR materials as-is (no studio
// lighting choreography, no per-part fill), because the export this feeds is
// meant to be dropped into someone else's page: the simplest scene that still
// looks like a real device is also the one that's cheapest to reproduce in
// the exported HTML (see lib/webMvpExport.ts, which re-derives this exact rig
// in a plain <script type="module">). Screen compositing (three3d/
// screenImage.ts) is the one addition shared with Mockup's own system.
export function initWebMvpViewer(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  device: DeviceDef,
  screenImageUrl?: string | null,
  getScreenTransform?: () => ScreenTransform,
): () => void {
  const fitHeight = device.fitHeight;
  let disposed = false;
  let animId = 0;
  let model: THREE.Object3D | null = null;
  let screenHandle: ScreenImageHandle | null = null;
  let lastScreenTransformKey = '';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  camera.position.set(0, 0, fitHeight * 1.8);

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

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = fitHeight * 0.6;
  controls.maxDistance = fitHeight * 4;

  // The web-devices GLBs are run through `gltf-transform optimize` (meshopt
  // geometry compression + quantization — see scripts/optimize-web-devices.cjs),
  // so the loader needs the matching decoder or EXT_meshopt_compression
  // primitives silently fail to load.
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    asset(device.modelUrl),
    (gltf) => {
      if (disposed) return;
      model = gltf.scene;
      fitAndCenter(model, fitHeight);
      scene.add(model);
      if (screenImageUrl) {
        const screenMesh = findScreenMesh(model);
        if (screenMesh) screenHandle = applyScreenImage(screenMesh, screenImageUrl, device, getScreenTransform?.() ?? DEFAULT_SCREEN_TRANSFORM);
      }
    },
    undefined,
    (err) => { console.error('Web MVP: model load failed:', err); },
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

  function loop() {
    if (disposed) return;
    animId = requestAnimationFrame(loop);
    if (screenHandle && getScreenTransform) {
      const t = getScreenTransform();
      const key = `${t.fit}|${t.zoom}|${t.offsetX}|${t.offsetY}`;
      if (key !== lastScreenTransformKey) { lastScreenTransformKey = key; screenHandle.redraw(t); }
    }
    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  return function dispose() {
    disposed = true;
    cancelAnimationFrame(animId);
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
    screenHandle?.dispose();
    if (model) model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  };
}
