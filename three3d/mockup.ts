import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { AsciiOptions } from './ascii';
import { isOn } from './asciiControls';
import { fitAndCenter } from './frame';
import { asset } from '@/lib/paths';
import { makeCameraRig } from './cameraRig';
import { findDevice } from './devices';
import { use3DStore } from '../store/use3DStore';
import { useSceneStore } from '../store/useSceneStore';
import { apply3DAnimation } from './animations';
import { createCardVideo, seekVideoToTime } from '@/lib/videoTexture';
import { loadGLBSource } from './gltfCache';
import {
  advancedRasterSize,
  gradientFromFill,
  gradientRasterMaxEdge,
  gradientSignature,
  paintGradientCanvas,
  sampleGradientPoint,
} from '@/lib/gradient';

// ── Device Mockup 3D effect ─────────────────────────────────────────────────
// Realistic PBR render — the GLB's own materials (colour, metalness, roughness,
// textures) are kept as-is by default, lit with a 3-point studio rig plus a
// room-environment map for believable reflections (glass/metal/plastic). A
// ground plane catches a soft contact shadow. Same model-transform, per-part
// colouring, and sun/gobo accent-light plumbing as the Cartoon effect, so the
// existing Model Control / Model Colors / Background panels drive it live.

function partKeyOf(mesh: THREE.Mesh): string {
  const mat = mesh.material as THREE.Material | undefined;
  const mn = mat && !Array.isArray(mat) && mat.name ? mat.name : '';
  if (mn) return mn;
  const nm = mesh.name || 'mesh';
  return nm.replace(/[._\-\s]?\d+$/, '') || nm;
}

export function initMockup(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  opts: AsciiOptions = {},
): () => void {
  // No bundled fallback for this effect — an empty modelUrl means the user
  // hasn't uploaded a device .glb yet, so the stage just stays empty (lit,
  // orbitable) instead of loading one of the project's own demo assets.
  const MODEL_URL = opts.modelUrl ? asset(opts.modelUrl) : '';
  const P = () => opts.getParams?.() ?? {};

  let animId = 0;
  let disposed = false;
  let exportMode = false;
  let lastCenterNonce = 0;
  delete canvas.dataset.modelReady;

  const scene = new THREE.Scene();
  // near 0.1 / far 100, NOT 0.01 / 1000. These device meshes stack several
  // near-coplanar shells across the whole back (measured on the iPhone Air: five
  // meshes sharing a 0.073 x 0.154 footprint, only 0.003-0.005 apart), and the
  // Apple-logo decal is one of them. A 100,000:1 depth range leaves too little
  // buffer precision to separate them, so they z-fight and the logo renders as
  // speckle. OrbitControls clamps the camera to minDistance 0.5, so a 0.1 near
  // plane can never clip the model.
  const camera = new THREE.PerspectiveCamera(45, stage.clientWidth / stage.clientHeight, 0.1, 100);
  camera.position.set(0, 0, 4);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  // 1, not devicePixelRatio: resize() already sizes the backing store to the
  // scene's full export resolution, which oversamples the on-screen box on its
  // own. Multiplying by DPR on top would square that cost for no visible gain.
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ── Stage background, baked into the scene ──────────────────────────────
  // The backdrop used to live only in CSS on the stage div, with the canvas
  // left transparent on top. That reads fine on screen and exports black: a
  // capture reads the CANVAS, the CSS behind it isn't part of it, and JPEG has
  // no alpha channel to preserve — every transparent pixel flattens to black.
  // Painting it as scene.background fixes both export paths at once (the JPEG
  // frames and the WebCodecs path, which copies the live canvas), and keeps
  // preview and export showing the same pixels.
  //
  // Mirrors the CSS in ThreeStage3D exactly: `linear-gradient(to top, c1, c2)`
  // puts c1 at the BOTTOM, and the radial ends at 130% of the box.
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = bgCanvas.height = 2;
  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;
  let bgKey = '';
  function paintBackground(spec: { type: string; c1: string; c2: string; gradient?: any }) {
    const sceneState = useSceneStore.getState();
    const phase = ((sceneState.frame / Math.max(1, sceneState.duration * sceneState.fps)) % 1 + 1) % 1;
    const gradient = gradientFromFill(spec);
    const [rw, rh] = advancedRasterSize(sceneState.width, sceneState.height, gradientRasterMaxEdge(gradient));
    const key = spec.type === 'solid'
      ? `solid|${spec.c1}`
      : `${rw}x${rh}|${gradientSignature(gradient, phase)}`;
    if (key === bgKey) return;
    bgKey = key;
    if (spec.type === 'solid') {
      if (bgCanvas.width !== 2) bgCanvas.width = 2;
      if (bgCanvas.height !== 2) bgCanvas.height = 2;
      const ctx = bgCanvas.getContext('2d')!;
      ctx.fillStyle = spec.c1;
      ctx.fillRect(0, 0, 2, 2);
    } else {
      paintGradientCanvas(bgCanvas, gradient, rw, rh, phase);
    }
    bgTex.needsUpdate = true;
  }
  paintBackground(opts.getBgFill?.() ?? { type: 'linear', c1: '#fbfbfc', c2: '#e6e8eb' });

  // Room-environment map → soft, believable reflections without a real HDRI.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  (scene as any).environmentIntensity = 1.6;

  // Deliberately neutral and independent of the stage Background: the backdrop
  // is a framing choice, and a device's finish must not shift colour when it
  // changes. (An earlier build bounced the backdrop colour in here; it made a
  // light background wash the whole render out.)
  const ambient = new THREE.AmbientLight(0xffffff, 0.7); scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 4.2); key.position.set(3, 6, 4); key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.near = 0.3; key.shadow.camera.far = 20;
  key.shadow.bias = -0.0005; key.shadow.radius = 1.5;
  // normalBias, not just bias: these device meshes stack several near-coplanar
  // shells across the back and triangulate the Apple-logo cutout as a fan of
  // slivers, so the panel shadow-maps onto ITSELF and speckles. A constant
  // `bias` can't clear that — the depth error scales with how obliquely the
  // surface faces the light — whereas normalBias offsets the sample along the
  // surface normal and does. Invisible on the dark iPhone 17 Pro; obvious on
  // the pale iPhone Air, which is where this was caught.
  key.shadow.normalBias = 0.03;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.8); fill.position.set(-4, 2, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 2.5); rim.position.set(-2, 4, -4); scene.add(rim);

  // Accent "window" light — same gobo-mask pattern as the Cartoon effect, so
  // the Background panel's Sunlight/Sun Shadow/Sun Mask controls stay live.
  const sun = new THREE.SpotLight(0xffffff, 0.0, 0, 0.62, 0.18, 0.0);
  sun.position.set(2.6, 2.6, 3.6);
  sun.target.position.set(0, 0, 0); scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.3; sun.shadow.camera.far = 20;
  sun.shadow.bias = -0.0016; sun.shadow.radius = 3;
  sun.shadow.normalBias = 0.03;   // same self-shadow speckle as the key light
  scene.add(sun);

  const goboCanvas = document.createElement('canvas'); goboCanvas.width = goboCanvas.height = 512;
  const goboCtx = goboCanvas.getContext('2d')!;
  const goboTex = new THREE.CanvasTexture(goboCanvas);
  goboTex.colorSpace = THREE.SRGBColorSpace;
  let goboImg: HTMLImageElement | null = null;
  let goboUrl = '';
  let goboKey = '';
  function loadGobo(url: string) {
    goboUrl = url; goboImg = null;
    const img = new Image();
    img.onload = () => { goboImg = img; goboKey = ''; };
    img.src = asset(url);
  }
  function drawGobo(scale: number, offX: number, offY: number) {
    if (!goboImg) return;
    goboCtx.clearRect(0, 0, 512, 512);
    goboCtx.filter = 'blur(6px)';
    const sz = 512 * scale;
    goboCtx.drawImage(goboImg, (512 - sz) / 2 + offX * 512, (512 - sz) / 2 + offY * 512, sz, sz);
    goboCtx.filter = 'none';
    const d = goboCtx.getImageData(0, 0, 512, 512);
    let hasAlpha = false;
    for (let i = 3; i < d.data.length; i += 4) if (d.data[i] < 250) { hasAlpha = true; break; }
    for (let i = 0; i < d.data.length; i += 4) {
      const v = hasAlpha ? d.data[i + 3]
        : 255 - (d.data[i] * 0.299 + d.data[i + 1] * 0.587 + d.data[i + 2] * 0.114);
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    goboCtx.putImageData(d, 0, 0);
    goboTex.needsUpdate = true;
  }

  // Ground plane — a pure shadow-catcher (invisible except where a shadow
  // falls), so the stage's CSS gradient shows through everywhere else.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 0.5;
  controls.maxDistance = 12;
  const INIT_TARGET = new THREE.Vector3(0, 0, 0);
  const INIT_CAM = new THREE.Vector3(0, 0, 4);
  controls.target.copy(INIT_TARGET);

  const rig = makeCameraRig(camera, controls);
  opts.onCamera?.(rig);

  // The reference's own tuned camera-fit size (and screen aspect/corner radius) for
  // this exact mesh, when it's one of the bundled devices — falls back to a
  // generic size/aspect for a user upload.
  const DEV = findDevice(opts.modelUrl);
  const MODEL_SIZE = DEV?.fitHeight ?? 2.4;
  let modelHalf = MODEL_SIZE / 2;
  let modelBottom = -modelHalf;
  let groundBaseY = -modelHalf;   // shadow-catcher height at the model's resting base
  // Default view — a slight 3/4 turn to the right + a touch of elevation
  // (classic product-shot angle) instead of a flat, dead-on front view.
  const INIT_AZIMUTH = THREE.MathUtils.degToRad(28);
  const INIT_ELEVATION = THREE.MathUtils.degToRad(8);
  function frameCamera() {
    const halfV = Math.tan((45 * Math.PI / 180) / 2);
    const halfH = halfV * camera.aspect;
    const dist = Math.max(modelHalf / halfV, modelHalf / halfH) * 1.25;
    INIT_CAM.set(
      dist * Math.sin(INIT_AZIMUTH) * Math.cos(INIT_ELEVATION),
      dist * Math.sin(INIT_ELEVATION),
      dist * Math.cos(INIT_AZIMUTH) * Math.cos(INIT_ELEVATION),
    );
    camera.position.copy(INIT_CAM);
    controls.target.copy(INIT_TARGET);
    controls.update();
    groundBaseY = modelBottom;
    ground.position.set(0, groundBaseY, 0);
    const gs = dist * 3;
    ground.scale.set(gs, gs, 1);
  }

  // The contact shadow's catcher plane sits at the model's resting base. That
  // holds while the model stays put — but the floating animations drive the
  // pivot DOWN (float_hover reaches posY -0.12), and a plane at the resting
  // base then slices through the device: everything below it is still drawn,
  // darkened by the ShadowMaterial, so the lower chassis appears as a dark band
  // cutting straight across the screen — a straight edge that ignores the
  // panel's rounded corners, which is how it tells itself apart from a depth
  // fight. Measured: absent at posY >= 0, and at posY -0.6 it swallowed a
  // quarter of the display.
  //
  // So the plane follows the model DOWN and never rises above its resting
  // height: a device that floats up still casts its shadow on the floor, and a
  // device that dips can no longer be cut by it. Pivot rotation is not folded
  // in — these animations tilt by single-digit degrees, far less than the gap
  // this keeps.
  function settleGroundUnderModel() {
    const bottomNow = pivot.position.y + modelBottom * pivot.scale.y;
    ground.position.y = Math.min(groundBaseY, bottomNow);
  }

  // The editor only needs enough pixels for the visible stage. Rendering every
  // live frame at export resolution made a tall project shade 3M+ pixels at
  // 60fps while the GLB was still parsing. Keep a modest supersample for a
  // crisp preview; setCaptureScale still switches to exact export dimensions.
  // `updateStyle = false` keeps the canvas' CSS box owned by the stylesheet.
  let lastW = 0, lastH = 0;
  function resize() {
    if (exportMode || !stage.clientWidth || !stage.clientHeight) return;
    const st = useSceneStore.getState();
    const displayScale = Math.min(stage.clientWidth / st.width, stage.clientHeight / st.height);
    const previewDensity = Math.min(2, Math.max(1.5, window.devicePixelRatio || 1));
    const previewScale = Math.min(1, displayScale * previewDensity);
    const W = Math.max(2, Math.round(st.width * previewScale));
    const H = Math.max(2, Math.round(st.height * previewScale));
    if (W === lastW && H === lastH) return;
    lastW = W; lastH = H;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }

  const materials: THREE.Material[] = [];
  const meshList: THREE.Mesh[] = [];
  const groupData = new Map<string, { box: THREE.Box3; center: THREE.Vector3; radius: number }>();

  function computeGroupData() {
    if (!model) return;
    model.updateWorldMatrix(true, true);
    const modelInv = model.matrixWorld.clone().invert();
    const corner = new THREE.Vector3();
    for (const mesh of meshList) {
      const m2m = modelInv.clone().multiply(mesh.matrixWorld);
      mesh.userData.m2m = m2m;
      const key = (mesh.material as THREE.Material).userData.partKey as string;
      const geo = mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      let gd = groupData.get(key);
      if (!gd) { gd = { box: new THREE.Box3(), center: new THREE.Vector3(), radius: 1 }; groupData.set(key, gd); }
      for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) {
        corner.set(xi ? bb.max.x : bb.min.x, yi ? bb.max.y : bb.min.y, zi ? bb.max.z : bb.min.z).applyMatrix4(m2m);
        gd.box.expandByPoint(corner);
      }
    }
    for (const gd of groupData.values()) {
      gd.box.getCenter(gd.center);
      gd.radius = Math.max(1e-4, gd.box.getSize(new THREE.Vector3()).length() / 2);
    }
  }

  const _v = new THREE.Vector3();
  const _co = new THREE.Color();
  function applyFill(mesh: THREE.Mesh, spec: { type: string; c1: string; c2: string; gradient?: any }, phase = 0) {
    const mat = mesh.material as any;
    if (spec.type === 'solid') {
      if (mat.vertexColors) { mat.vertexColors = false; mat.needsUpdate = true; }
      mat.color.set(spec.c1);
      return;
    }
    const gd = groupData.get(mat.userData.partKey as string);
    const m2m = mesh.userData.m2m as THREE.Matrix4 | undefined;
    if (!gd || !m2m) { mat.color.set(spec.c1); return; }
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    let colAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!colAttr || colAttr.count !== n) { colAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3); geo.setAttribute('color', colAttr); }
    const gradient = gradientFromFill(spec);
    const spanX = Math.max(1e-4, gd.box.max.x - gd.box.min.x);
    const spanY = Math.max(1e-4, gd.box.max.y - gd.box.min.y);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m2m);
      const gx = gradient.mapping3d === 'uv' && uv ? uv.getX(i) : (_v.x - gd.box.min.x) / spanX;
      const gy = gradient.mapping3d === 'uv' && uv ? 1 - uv.getY(i) : (_v.y - gd.box.min.y) / spanY;
      const sampled = sampleGradientPoint(gradient, gx, gy, phase);
      _co.setRGB(sampled[0] / 255, sampled[1] / 255, sampled[2] / 255).convertSRGBToLinear();
      colAttr.setXYZ(i, _co.r, _co.g, _co.b);
    }
    colAttr.needsUpdate = true;
    if (!mat.vertexColors) { mat.vertexColors = true; mat.needsUpdate = true; }
    mat.color.setRGB(1, 1, 1);
  }

  // ── Screen content — image/video composited onto the device's "Screen"
  // mesh. Cover-fit into its own aspect (like CSS object-fit: cover), masked
  // to the device's real screen corner radius so it reads as a live display.
  //
  // Baked into pixels via 2D canvas compositing (same technique as the sun-mask
  // gobo above) rather than a UV/shader mask: an earlier shader-based corner
  // mask relied on the mesh's raw `vUv` varying, which didn't hold for these
  // GLBs and discarded every fragment. Canvas clipping has no such dependency.
  let screenMesh: THREE.Mesh | null = null;
  let screenKey = '';
  let screenVideoEl: HTMLVideoElement | null = null;
  let screenImageEl: HTMLImageElement | null = null;
  let screenXformKey = '';
  // While an export is capturing, the clip is stepped by seekScreenVideo() and
  // the live sync below must keep its hands off it — advanceVideoForExport()
  // decodes forward and watches for presented frames, so a stray currentTime
  // write from the rAF loop would derail the pass.
  let screenVideoExporting = false;
  // Composite at the panel's real native pixels (1206 x 2622 on an iPhone 17
  // Pro — the same buffer size the reference tool reports), capped on the long
  // edge so a 6K Pro Display XDR doesn't allocate a 6016px texture per frame.
  const SCREEN_MAX_EDGE = 2732;
  const SCREEN_RES = (() => {
    const [pw, ph] = DEV?.screenPx ?? [1206, 2622];
    const k = Math.min(1, SCREEN_MAX_EDGE / Math.max(pw, ph));
    return Math.max(64, Math.round(pw * k));
  })();
  let screenCanvas: HTMLCanvasElement | null = null;
  let screenCtx: CanvasRenderingContext2D | null = null;
  let screenCanvasTex: THREE.CanvasTexture | null = null;

  // A mesh whose screen UVs were authored with the axes swapped needs the
  // composite laid out TRANSPOSED — the canvas is portrait where the panel is
  // landscape, and the swap turns it back. Everything downstream keeps working
  // in the panel's own (visual) orientation; only this allocation and the
  // transform in beginScreenSpace know about the swap.
  const SCREEN_TRANSPOSE = DEV?.screenTextureTranspose ?? null;

  function ensureScreenCanvas(screenAspect: number) {
    const aspect = SCREEN_TRANSPOSE ? 1 / screenAspect : screenAspect;
    const h = Math.max(1, Math.round(SCREEN_RES / aspect));
    if (!screenCanvas) { screenCanvas = document.createElement('canvas'); screenCtx = screenCanvas.getContext('2d'); }
    if (screenCanvas.width !== SCREEN_RES || screenCanvas.height !== h) { screenCanvas.width = SCREEN_RES; screenCanvas.height = h; }
  }

  // Enters the panel's visual coordinate space and returns its size. Callers
  // draw as if the canvas were the panel, right way up; the transform lands it
  // in whatever orientation the mesh actually wants. Pair with ctx.restore().
  //
  // Both swaps are REFLECTIONS (a diagonal mirror), not rotations, which is why
  // a swapped screen came out sideways AND mirrored. A reflection is its own
  // inverse, so re-applying the measured one cancels it exactly.
  function beginScreenSpace(ctx: CanvasRenderingContext2D): { W: number; H: number } {
    const cw = screenCanvas!.width, ch = screenCanvas!.height;
    ctx.save();
    if (!SCREEN_TRANSPOSE) return { W: cw, H: ch };
    // Visual space is the canvas with its axes swapped back.
    const W = ch, H = cw;
    if (SCREEN_TRANSPOSE === 'main') ctx.setTransform(0, 1, 1, 0, 0, 0);              // (x,y) -> (y,x)
    else ctx.setTransform(0, -1, -1, 0, cw, ch);                                      // (x,y) -> (W-y, H-x)
    return { W, H };
  }

  // Lays `source` into the screen under the chosen fit/zoom/anchor, then clips
  // to the device's own screen corner radius.
  //
  // Drawn as a scaled destination rect rather than a source crop so all three
  // fit modes and the overflow scroll fall out of one formula: `contain` needs
  // to letterbox (destination smaller than the screen), which a source crop
  // cannot express.
  function drawScreenFrame(source: HTMLImageElement | HTMLVideoElement, screenAspect: number, cornerFrac: number) {
    if (!screenCanvas || !screenCtx) return;
    const ctx = screenCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
    const { W, H } = beginScreenSpace(ctx);
    const r = Math.min(W, H) * Math.max(0, cornerFrac);
    if (r > 0.5) { ctx.beginPath(); ctx.roundRect(0, 0, W, H, r); ctx.clip(); }

    const isVideo = source instanceof HTMLVideoElement;
    const srcW = (isVideo ? source.videoWidth : source.naturalWidth) || 1;
    const srcH = (isVideo ? source.videoHeight : source.naturalHeight) || 1;

    const t = opts.getScreenTransform?.() ?? { fit: 'cover' as const, zoom: 1, offsetX: 50, offsetY: 50 };
    const byW = W / srcW, byH = H / srcH;
    const base = t.fit === 'width' ? byW : t.fit === 'contain' ? Math.min(byW, byH) : Math.max(byW, byH);
    const scale = base * Math.max(0.05, t.zoom);
    const dw = srcW * scale, dh = srcH * scale;
    // One expression for both directions: when the image overflows, (W-dw) is
    // negative and the anchor scrolls it; when it under-fills, (W-dw) is
    // positive and the same anchor positions it inside the letterbox.
    const dx = (W - dw) * (t.offsetX / 100);
    const dy = (H - dh) * (t.offsetY / 100);
    ctx.drawImage(source, dx, dy, dw, dh);

    if (DEV?.slot === 'phone') drawIPhoneStatusBar(ctx, W, H);

    ctx.restore();
    if (screenCanvasTex) screenCanvasTex.needsUpdate = true;
  }

  function drawEmptyScreenFrame() {
    if (!screenCanvas || !screenCtx) return;
    const ctx = screenCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
    const { W, H } = beginScreenSpace(ctx);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    drawIPhoneStatusBar(ctx, W, H);
    ctx.restore();
    if (screenCanvasTex) screenCanvasTex.needsUpdate = true;
  }

  function drawIPhoneStatusBar(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const status = opts.getScreenStatus?.();
    if (!status || status.mode === 'off') return;
    const color = status.mode === 'light' ? '#ffffff' : '#050505';
    // iOS lays the two status clusters around the Dynamic Island, not against
    // the display edges. Keep both clusters optically centred in their side
    // areas so the layout stays balanced on every phone texture resolution.
    const y = H * 0.036;
    ctx.save();
    const scaleX = DEV?.statusBarScaleX ?? 1;
    if (scaleX !== 1) {
      ctx.translate(W * 0.5, 0);
      ctx.scale(scaleX, 1);
      ctx.translate(W * -0.5, 0);
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.font = `600 ${Math.round(H * 0.0175)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(status.time.trim() || '9:41', W * 0.165, y);

    const signal = Math.max(0, Math.min(4, Math.round(status.signal)));
    const barW = W * 0.008;
    const gap = W * 0.004;
    const sx = W * 0.744;
    const signalBottom = y + W * 0.012;
    const signalHeights = [0.009, 0.014, 0.019, 0.024].map((v) => W * v);
    for (let i = 0; i < 4; i++) {
      const h = signalHeights[i];
      ctx.globalAlpha = i < signal ? 1 : 0.25;
      ctx.beginPath();
      ctx.roundRect(sx + i * (barW + gap), signalBottom - h, barW, h, barW * 0.42);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const wx = W * 0.829;
    const wy = y + W * 0.008;
    ctx.lineWidth = Math.max(2, W * 0.005);
    ctx.beginPath(); ctx.arc(wx, wy, W * 0.027, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke();
    ctx.beginPath(); ctx.arc(wx, wy + W * 0.006, W * 0.0155, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
    ctx.beginPath(); ctx.arc(wx, wy + W * 0.014, W * 0.004, 0, Math.PI * 2); ctx.fill();

    const bx = W * 0.877;
    const bw = W * 0.058;
    const bh = W * 0.026;
    const by = y - bh * 0.5;
    const radius = Math.max(2, W * 0.0065);
    ctx.lineWidth = Math.max(2, W * 0.0035);
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, radius); ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(bx + bw + W * 0.004, by + bh * 0.29, W * 0.005, bh * 0.42, W * 0.002);
    ctx.fill();
    ctx.globalAlpha = 1;
    const level = Math.max(0, Math.min(100, status.battery)) / 100;
    if (level > 0) {
      ctx.beginPath();
      const inset = W * 0.005;
      ctx.roundRect(bx + inset, by + inset, Math.max(1, (bw - inset * 2) * level), bh - inset * 2, radius * 0.55);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Screen playback clock ───────────────────────────────────────────────
  // A <video> element plays on wall-clock. Left to itself it runs while the
  // preview is paused, ignores the transport, and never returns to its start
  // when the timeline wraps — and an export, which only steps a frame counter,
  // captures whatever the clip happened to be showing. So the TIMELINE drives
  // the clip: scene time is the single source of truth for which video frame is
  // on the screen, exactly as it is for video cards (lib/videoTexture.ts).
  //
  // While playing, the element plays natively and is only nudged once it has
  // drifted past DRIFT — seeking every tick would stall the decoder and stutter.
  const SCREEN_VIDEO_DRIFT = 0.25;   // seconds of slack before a corrective seek
  let screenVideoSeekTarget = -1;    // last time sought while paused (-1 = none)

  function syncScreenVideoToTimeline() {
    const v = screenVideoEl;
    if (!v || screenVideoExporting) return;
    if (!v.duration || !isFinite(v.duration) || v.duration <= 0) return;
    const st = useSceneStore.getState();
    const target = (st.frame / Math.max(1, st.fps)) % v.duration;
    if (st.playing) {
      screenVideoSeekTarget = -1;
      if (v.paused) v.play().catch(() => {});
      // This covers the loop seam as well: at the wrap `target` drops back to
      // ~0 while the clip still sits near its end, so the gap trips the seek and
      // the screen restarts WITH the scene instead of running a loop behind it.
      if (Math.abs(v.currentTime - target) > SCREEN_VIDEO_DRIFT) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      // Paused means scrubbing — land on the frame the playhead is actually on.
      // Compared against the last REQUESTED time, not against currentTime: a
      // seek snaps to a decodable boundary, so comparing the landed position
      // would re-seek every tick and never settle.
      if (Math.abs(screenVideoSeekTarget - target) > 1e-4) {
        screenVideoSeekTarget = target;
        v.currentTime = target;
      }
    }
  }

  // Paints whatever the screen currently shows. Called from the rAF loop AND
  // from renderFrameAt(), because the export path renders without the loop:
  // before this was shared, an exported frame reused whatever screen texture
  // the loop had last painted on wall-clock — which is why video screens came
  // out frozen or jumping in the MP4.
  function paintScreenContent() {
    const status = opts.getScreenStatus?.();
    const emptyStatusScreen = DEV?.slot === 'phone' && status?.mode !== 'off';
    const t = opts.getScreenTransform?.() ?? { fit: 'cover' as const, zoom: 1, offsetX: 50, offsetY: 50 };
    const look = `${t.fit}|${t.zoom}|${t.offsetX}|${t.offsetY}|${status?.mode}|${status?.time}|${status?.battery}|${status?.signal}`;
    // Both media kinds redraw on the same rule: only when the composite would
    // actually differ. For a video that means a new source time — which, now
    // that the timeline owns the clip, does NOT change on a paused preview, so
    // the old unconditional redraw was recompositing an identical frame up to
    // 60x a second onto a canvas as large as 2732px.
    if (screenVideoEl && screenVideoEl.readyState >= 2) {
      const vkey = `${screenVideoEl.currentTime}|${look}`;
      if (vkey !== screenXformKey) {
        screenXformKey = vkey;
        drawScreenFrame(screenVideoEl, DEV?.screenAspect ?? 16 / 9, DEV?.screenCornerFrac ?? 0);
      }
    } else if (screenImageEl) {
      if (look !== screenXformKey) {
        screenXformKey = look;
        drawScreenFrame(screenImageEl, DEV?.screenAspect ?? 16 / 9, DEV?.screenCornerFrac ?? 0);
      }
    } else if (emptyStatusScreen) {
      const xkey = `empty|${status?.mode}|${status?.time}|${status?.battery}|${status?.signal}`;
      if (xkey !== screenXformKey) {
        screenXformKey = xkey;
        drawEmptyScreenFrame();
      }
    }
  }

  // ── The cover glass over the display ────────────────────────────────────
  // The Screen mesh itself is only the panel. Sitting a hair in front of it is
  // a near-mirror glass shell, and THAT is what returns RoomEnvironment's
  // rectangular studio panels as a hard-edged softbox across the display — the
  // reflection the reference tool's screens don't have.
  //
  // Found by geometry, not by material name (these GLBs name everything with
  // random hashes): it's the mesh whose footprint sits inside the Screen's own,
  // in the same plane. Flagging it lets the render loop damp its environment
  // reflection alone and leave every other reflective part of the device — the
  // rails, the camera rings, the back — exactly as authored.
  function markScreenGlass(screen: THREE.Mesh) {
    const sBox = new THREE.Box3().setFromObject(screen);
    const sSize = sBox.getSize(new THREE.Vector3());
    const sCenter = sBox.getCenter(new THREE.Vector3());
    const area = (v: THREE.Vector3) => {
      const d = [v.x, v.y, v.z].sort((a, b) => b - a);
      return d[0] * d[1];                 // the two long axes = the face
    };
    const sArea = Math.max(1e-9, area(sSize));

    for (let i = 0; i < meshList.length; i++) {
      const mesh = meshList[i];
      const mat = materials[i] as any;
      if (mesh === screen) { mat.userData.isScreenGlass = true; continue; }
      const b = new THREE.Box3().setFromObject(mesh);
      const size = b.getSize(new THREE.Vector3());
      const c = b.getCenter(new THREE.Vector3());
      // same face, within 20% of the screen's area, and centred on it — a shell
      // laid over the display rather than some unrelated panel elsewhere.
      const ratio = area(size) / sArea;
      const offset = c.distanceTo(sCenter);
      if (ratio > 0.8 && ratio < 1.25 && offset < Math.max(sSize.x, sSize.y) * 0.12) {
        mat.userData.isScreenGlass = true;
      }
    }
  }

  // These GLBs ship their Screen mesh with position/normal/color only — no `uv`
  // attribute at all (verified on the iPhone 17 Pro mesh). A material `map` then
  // samples an undefined varying and the panel renders black, which is why
  // screen content never appeared. Project planar UVs from the mesh's own
  // bounding box: the thinnest axis is the screen's normal, the other two are
  // its plane, so u runs across the panel and v up it.
  function ensureScreenUVs(mesh: THREE.Mesh) {
    const geo = mesh.geometry;
    if (geo.getAttribute('uv')) return;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!pos) return;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const size = bb.getSize(new THREE.Vector3());
    const flat = size.x <= size.y && size.x <= size.z ? 'x' : size.y <= size.z ? 'y' : 'z';
    const [ua, va] = (['x', 'y', 'z'] as const).filter((a) => a !== flat);
    const uSpan = Math.max(1e-6, size[ua]);
    const vSpan = Math.max(1e-6, size[va]);
    const get = { x: 'getX', y: 'getY', z: 'getZ' } as const;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = ((pos as any)[get[ua]](i) - bb.min[ua]) / uSpan;
      uv[i * 2 + 1] = ((pos as any)[get[va]](i) - bb.min[va]) / vSpan;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  // Unlit textured plane. `transparent: true` so the rounded corners (cleared,
  // never drawn into) show whatever sits behind the Screen mesh — the device's
  // own bezel — instead of solid black.
  function makeScreenMaterial(tex: THREE.Texture): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      map: tex,
      toneMapped: false,
      transparent: true,
      alphaTest: 0.001,
    });
  }

  // ArqÃ© composes the display as an unlit image layer above the product render,
  // rather than letting a PBR glass layer relight it. Pulling only this surface
  // forward in depth reproduces that composition without touching any light,
  // exposure, finish material, roughness or environment parameter.
  //
  // The offset is units-only, deliberately. glPolygonOffset biases depth by
  // `factor * m + units * r`, where m is the polygon's maximum depth slope in
  // window space. A factor pulls the surface forward in proportion to how
  // steeply it is tilted away from the camera, so a value tuned to look right
  // head-on grows without bound as the device turns: past a certain rotation
  // the display wins the depth test against the bezel and the near shell,
  // appears to detach from the body, and shows the inside of the case through
  // it. Head-on it looked correct, which is why it survived — the fault only
  // exists at an angle, and rotation used to be hard to reach.
  //
  // With factor 0 the bias is a constant few depth units: still enough to beat
  // the coplanar z-fighting this exists for, and now the same at every angle.
  function configureScreenComposite(mat: THREE.MeshBasicMaterial) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 0;
    mat.polygonOffsetUnits = -2;
    mat.depthTest = true;
    mat.depthWrite = true;
    if (screenMesh) screenMesh.renderOrder = 1000;
  }

  function setScreenMaterial(mat: THREE.MeshBasicMaterial) {
    if (!screenMesh) { mat.dispose(); return; }
    const old = screenMesh.material as THREE.Material;
    if (old && old !== screenMesh.userData.origMaterial) old.dispose();
    configureScreenComposite(mat);
    screenMesh.material = mat;
  }

  function restoreScreenMaterial() {
    if (!screenMesh || !screenMesh.userData.origMaterial) return;
    const old = screenMesh.material as THREE.Material;
    if (old && old !== screenMesh.userData.origMaterial) old.dispose();
    const source = screenMesh.userData.origMaterial as THREE.MeshStandardMaterial;
    const fallback = new THREE.MeshBasicMaterial({
      color: source.color?.clone() ?? new THREE.Color(0x000000),
      map: source.map ?? null,
      toneMapped: false,
      transparent: true,
      alphaTest: 0.001,
    });
    configureScreenComposite(fallback);
    screenMesh.material = fallback;
  }

  // ── Which materials the Finish repaints ─────────────────────────────────
  // A device finish is the colour of the ENCLOSURE only: the reference tool
  // recolours the frame and leaves the black bezel, the glass, the camera
  // rings and the buttons alone. Repainting every material (the earlier
  // behaviour) flattened the whole handset into one plastic-looking block.
  //
  // These GLBs have machine-generated material names, so the enclosure can't
  // be found by name. It can be found by COLOUR: each mesh ships painted in
  // the finish it was authored in, which is the device's first listed finish.
  // Everything within a small distance of that colour is the enclosure.
  // Matched on HUE, not on an exact colour: the iPhone mesh spends 25 of its 82
  // materials on the enclosure alone, spread across a whole family of oranges
  // (#db6018, #fb7c4a, #ed754a, …) that bake in its shading. Matching one exact
  // value catches a single sliver of trim; matching the family catches the body.
  const HUE_TOL = 0.055;        // ±20° around the shipped hue
  const MIN_SAT = 0.12;         // below this a colour has no meaningful hue
  const NEUTRAL_L_TOL = 0.35;   // lightness band for silver-bodied devices
  const shippedHSL = { h: 0, s: 0, l: 0 };

  function markEnclosureMaterials() {
    const shipped = DEV?.finishes?.[0]?.hex;
    if (!shipped) return;
    // `new THREE.Color(hex)` already decodes sRGB into the working space — the
    // earlier code also called convertSRGBToLinear(), decoding twice and
    // leaving the target far darker than any material on the mesh.
    new THREE.Color(shipped).getHSL(shippedHSL);
    const neutral = shippedHSL.s < 0.1;
    const hsl = { h: 0, s: 0, l: 0 };

    for (const m of materials as any[]) {
      if (m.userData.partKey === 'Screen') continue;
      (m.userData.origColor as THREE.Color).getHSL(hsl);
      m.userData.origL = hsl.l;
      m.userData.origS = hsl.s;
      const dh = Math.min(Math.abs(hsl.h - shippedHSL.h), 1 - Math.abs(hsl.h - shippedHSL.h));
      m.userData.isEnclosure = neutral
        // A silver body has no hue to match on, so match "unsaturated, and about
        // as light as the shipped finish" instead.
        ? hsl.s < 0.15 && Math.abs(hsl.l - shippedHSL.l) <= NEUTRAL_L_TOL
        : hsl.s >= MIN_SAT && dh <= HUE_TOL;
    }
  }

  function markIPhoneAirRearPanelAsEnclosure() {
    if (DEV?.key !== 'iphoneair') return;
    for (let i = 0; i < meshList.length; i++) {
      const mesh = meshList[i];
      if (!mesh.visible) continue;
      const geo = mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (!geo.boundingBox) continue;
      const size = geo.boundingBox.getSize(new THREE.Vector3());
      const isStableRearPanel = size.x >= 0.065
        && size.y >= 0.14
        && geo.boundingBox.max.z <= 0.001;
      if (isStableRearPanel) (materials[i] as any).userData.isEnclosure = true;
    }
  }

  function isIPhoneAirSurfaceLayer(mesh: THREE.Mesh): boolean {
    if (DEV?.key !== 'iphoneair') return false;
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (!geo.boundingBox) return false;
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
    // The Air GLB contains several display/decal shells with a zero-to-0.5 mm
    // local thickness and a phone-sized face. Letting those layers cast onto
    // and receive from each other produces unstable shadow stripes in motion.
    return dims[0] <= 0.0006 && dims[1] >= 0.005 && dims[2] >= 0.02;
  }

  function isIPhoneAirRedundantRearGlass(mesh: THREE.Mesh, mat: THREE.Material & { userData: Record<string, any> }): boolean {
    if (DEV?.key !== 'iphoneair') return false;
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (!geo.boundingBox) return false;
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    const fullRearPanel = size.x >= 0.065 && size.y >= 0.14 && geo.boundingBox.max.z <= 0.001;
    const metallicOverlay = 'metalness' in mat && Number((mat as THREE.MeshStandardMaterial).metalness) > 0.05;
    // The Air ships one stable opaque backing plus two full-size overlays: a
    // metallic shell and a transparent BLEND shell. Both overlays expose their
    // triangulation over the backing. Smaller transparent/metallic meshes are
    // camera and sensor parts and therefore do not match `fullRearPanel`.
    // Keep one authored transparent coat above the metallic enclosure so the
    // Air retains its glass depth and highlights. Its depth writes are disabled
    // below, so it cannot fight the enclosure surface. Only the redundant
    // opaque, non-metallic backing is removed.
    return fullRearPanel && !mat.userData.origTransparent && !metallicOverlay;
  }

  function isIPhoneAirRedundantLogoOverlay(mesh: THREE.Mesh, mat: THREE.Material & { userData: Record<string, any> }): boolean {
    if (DEV?.key !== 'iphoneair' || mat.userData.origTransparent) return false;
    const geo = mesh.geometry;
    const positions = geo.getAttribute('position');
    // The Air GLB contains two identical Apple-logo silhouettes. Keep the
    // upper BLEND copy (now rendered without depth writes) and remove the lower
    // opaque duplicate that sits beneath the recolourable rear panel.
    return positions?.count === 169 && geo.index?.count === 498;
  }

  function stabilizeIPhoneAirLogo(mesh: THREE.Mesh, mat: THREE.MeshStandardMaterial & { userData: Record<string, any> }) {
    if (DEV?.key !== 'iphoneair') return;
    const geo = mesh.geometry;
    const positions = geo.getAttribute('position');
    const isAppleLogo = positions?.count === 169 && geo.index?.count === 498;
    if (!isAppleLogo || !mat.userData.origTransparent) return;

    // Reuse the Air's correctly positioned logo geometry, but give it the
    // stable dark metallic treatment used by the 17-style finish. Copying the
    // 17 mesh itself would also copy incompatible model-space transforms.
    mat.color.set('#202328');
    mat.metalness = 0.58;
    mat.roughness = 0.34;
    mat.transparent = true;
    mat.opacity = 0.96;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    mat.userData.origColor = mat.color.clone();
    mat.userData.origOpacity = 0.96;
    mat.userData.origTransparent = true;
    mat.userData.origDepthWrite = false;
    mat.userData.isEnclosure = false;
    mesh.renderOrder = 50;
  }

  const pivot = new THREE.Group();
  scene.add(pivot);
  let model: THREE.Object3D | null = null;

  if (MODEL_URL) loadGLBSource(MODEL_URL).then(
    (source) => {
      if (disposed) return;
      // Keep the cached source pristine: this renderer fits the root and owns
      // per-instance material state, while thumbnail rendering has its own clone.
      model = source.clone(true);
      const keys: string[] = [];
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const orig = mesh.material as THREE.MeshStandardMaterial;
        const mat = (orig && !Array.isArray(orig) ? orig.clone() : new THREE.MeshStandardMaterial({ color: 0xd8d8dc })) as any;
        const key = partKeyOf(mesh);
        mat.userData.origColor = mat.color ? mat.color.clone() : new THREE.Color(0xd8d8dc);
        mat.userData.hasMap = !!mat.map;
        mat.userData.srcMap = mat.map ?? null;
        // Baseline for the micro-roughness noise, which multiplies rather than
        // replaces — a mirror-smooth face (roughness ~0) would stay mirror
        // smooth, so the noise is mixed toward a floor instead.
        mat.userData.origRoughness = typeof mat.roughness === 'number' ? mat.roughness : 1;
        mat.userData.srcRoughnessMap = mat.roughnessMap ?? null;
        mat.userData.origOpacity = typeof mat.opacity === 'number' ? mat.opacity : 1;
        mat.userData.origTransparent = !!mat.transparent;
        mat.userData.origDepthWrite = mat.depthWrite;
        // Deliberately NOT raising these textures' anisotropy. Doing so was
        // tried and reverted: the device's own baked maps (the Apple logo most
        // visibly) are small, and sharpening them against the supersampled
        // render resolved their compression noise into visible speckle. Only
        // the screen-content canvas — which is authored at the panel's native
        // size — gets max anisotropy.
        mat.userData.partKey = key;
        mesh.material = mat;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Resolve the authored duplicate before tuning the retained logo so
        // the selection always uses the GLB's original transparency metadata.
        const hideLogoDuplicate = isIPhoneAirRedundantLogoOverlay(mesh, mat);
        stabilizeIPhoneAirLogo(mesh, mat);
        if (isIPhoneAirRedundantRearGlass(mesh, mat)) mesh.visible = false;
        if (hideLogoDuplicate) mesh.visible = false;
        if (isIPhoneAirSurfaceLayer(mesh)) {
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        }
        materials.push(mat);
        meshList.push(mesh);
        if (!keys.includes(key)) keys.push(key);
      });
      markEnclosureMaterials();
      markIPhoneAirRearPanelAsEnclosure();
      modelHalf = fitAndCenter(model, MODEL_SIZE);
      const box = new THREE.Box3().setFromObject(model);
      modelBottom = box.min.y;
      pivot.add(model);
      computeGroupData();
      frameCamera();
      screenMesh = meshList.find((_, i) => materials[i].userData.partKey === 'Screen') ?? null;
      if (screenMesh) {
        screenMesh.userData.origMaterial = screenMesh.material;
        ensureScreenUVs(screenMesh);
        markScreenGlass(screenMesh);
        restoreScreenMaterial();
      }
      opts.onParts?.(keys);
      canvas.dataset.modelReady = 'true';
    },
    (err) => { console.error('GLB load failed:', err); },
  );

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0, downY = 0;
  const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
  const onUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(meshList, false);
    const key = hits.length ? ((hits[0].object as THREE.Mesh).material as any)?.userData?.partKey ?? null : null;
    opts.onPickPart?.(key);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  const tmpColor = new THREE.Color();
  const WHITE = new THREE.Color(0xffffff);
  const finishHSL = { h: 0, s: 0, l: 0 };
  let lastFinishHex = '';
  function loop() {
    if (disposed) return;
    animId = requestAnimationFrame(loop);
    const p = P();

    key.intensity = Number(p.keyLight ?? 3);
    fill.intensity = Number(p.fillLight ?? 1.2);
    ambient.intensity = Number(p.ambient ?? 0.6);
    const envIntensity = Number(p.envIntensity ?? 1);
    renderer.toneMappingExposure = Number(p.exposure ?? 0.7);


    const useTex = isOn(p.useModelColor);
    const wire = isOn(p.wireframe);
    const flat = isOn(p.flatShading);
    const op = Math.max(0, Math.min(1, Number(p.opacity ?? 100) / 100));
    tmpColor.set(String(p.color ?? '#d8d8dc'));
    const partFills = opts.getPartFills?.() ?? {};
    const gradientPhase = ((useSceneStore.getState().frame / Math.max(1, useSceneStore.getState().duration * useSceneStore.getState().fps)) % 1 + 1) % 1;
    const selected = opts.getSelectedPart?.() ?? null;
    const emissiveHex = String(p.emissive ?? '#000000');
    const emissiveIntensity = Number(p.emissiveIntensity ?? 1);
    const screenGlare = Math.max(0, Math.min(1, Number(p.screenGlare ?? 0) / 100));
    // Empty (or the shipped finish) means "leave the mesh's own materials be".
    const finishHex = String(p.finish ?? '');
    const isFinished = !!finishHex && finishHex.toLowerCase() !== String(DEV?.finishes?.[0]?.hex ?? '').toLowerCase();
    if (isFinished && finishHex !== lastFinishHex) {
      lastFinishHex = finishHex;
      new THREE.Color(finishHex).getHSL(finishHSL);
    }

    for (let i = 0; i < materials.length; i++) {
      const m = materials[i] as any;
      const mesh = meshList[i];
      const mkey = m.userData.partKey as string;
      if (mkey === 'Screen') continue;   // user content — own material, not device-tinted
      const partFill = partFills[mkey];
      // A phone's global colour represents its enclosure finish, not every
      // component in the GLB. Camera lenses, microphones, sensors, buttons and
      // glass must retain their authored material even when Model Materials is
      // disabled. Explicit per-part fills remain available as an intentional
      // override.
      const preservePhoneDetail = DEV?.slot === 'phone' && !m.userData.isEnclosure && !partFill;

      if (partFill) {
        const gradient = gradientFromFill(partFill);
        const hash = `${partFill.type}|${gradientSignature(gradient, gradientPhase)}`;
        if (m.userData.fillHash !== hash) { applyFill(mesh, partFill, gradientPhase); m.userData.fillHash = hash; }
      } else {
        if (m.userData.fillHash !== undefined) {
          if (m.vertexColors) { m.vertexColors = false; m.needsUpdate = true; }
          m.userData.fillHash = undefined;
        }
        if (isFinished && m.userData.isEnclosure) {
          // Re-hue rather than flood-fill: each enclosure material keeps its own
          // lightness (scaled to the new finish's), so the machined edges and
          // highlights baked into those 25 shades survive the repaint instead of
          // collapsing into one flat slab of colour.
          const lScale = finishHSL.l / Math.max(0.001, shippedHSL.l);
          const sScale = shippedHSL.s > 0.05 ? m.userData.origS / shippedHSL.s : 1;
          m.color.setHSL(
            finishHSL.h,
            Math.min(1, finishHSL.s * sScale),
            Math.min(1, Math.max(0, m.userData.origL * lScale)),
          );
        }
        else if (preservePhoneDetail) m.color.copy(m.userData.origColor);
        else if (useTex) m.color.copy(m.userData.hasMap ? WHITE : m.userData.origColor);
        else m.color.copy(tmpColor);
      }

      // A repainted enclosure drops its baked map: that texture carries the
      // shipped finish's own colour, so keeping it would tint the new finish
      // towards the old one instead of replacing it.
      const repainted = isFinished && m.userData.isEnclosure && !partFill;
      const desiredMap = (partFill || repainted)
        ? null
        : ((useTex || preservePhoneDetail) && m.userData.hasMap ? m.userData.srcMap : null);
      if (m.map !== desiredMap) { m.map = desiredMap; m.needsUpdate = true; }

      if (selected && mkey === selected) { m.emissive.setRGB(0.12, 0.35, 0.6); m.emissiveIntensity = 1; }
      else if (m.emissive) { m.emissive.set(emissiveHex); m.emissiveIntensity = emissiveIntensity; }

      // The cover glass gets its own, much weaker environment reflection — at
      // Screen Glare 0 it reflects nothing, so the display reads as a display
      // instead of a mirror. Roughness is lifted along with it: dropping the
      // reflection while leaving the surface mirror-smooth would still catch
      // the key light as a hard specular blob in the same spot.
      if ('envMapIntensity' in m) {
        m.envMapIntensity = m.userData.isScreenGlass ? envIntensity * screenGlare : envIntensity;
      }
      if ('roughness' in m && m.userData.isScreenGlass) {
        const base = m.userData.origRoughness as number;
        m.roughness = base + (0.6 - base) * (1 - screenGlare);
      }

      m.wireframe = wire;
      // Preserve authored alpha materials (most visibly the iPhone Air rear
      // glass). Replacing GLB `BLEND` with an opaque, depth-writing material on
      // every frame made its stacked rear shells fight in the depth buffer.
      const authoredOpacity = Number(m.userData.origOpacity ?? 1);
      const authoredTransparent = !!m.userData.origTransparent;
      m.opacity = authoredOpacity * op;
      m.transparent = authoredTransparent || m.opacity < 0.999;
      m.depthWrite = authoredTransparent
        ? false
        : (m.userData.origDepthWrite !== false && m.opacity >= 0.999);
      if (m.flatShading !== flat) { m.flatShading = flat; m.needsUpdate = true; }
    }

    // screen content — only re-touch when the media identity actually changes
    // An empty url is a slot whose bytes are gone (quota eviction, cleared
    // storage): rehydrateScreenMedia leaves the entry in place with url ''. It
    // is still a truthy object, so without this the screen would try to load a
    // <video>/<img> with no source and come up dead instead of blank.
    const mediaEntry = opts.getScreenMedia?.() ?? null;
    const media = mediaEntry?.url ? mediaEntry : null;
    const screenStatus = opts.getScreenStatus?.();
    const hasEmptyStatusScreen = DEV?.slot === 'phone' && screenStatus?.mode !== 'off';
    const mkey2 = media ? `${media.kind}|${media.url}` : hasEmptyStatusScreen ? 'empty-status-screen' : '';
    if (screenMesh && mkey2 !== screenKey) {
      screenKey = mkey2;
      if (screenVideoEl) { screenVideoEl.pause(); screenVideoEl.removeAttribute('src'); screenVideoEl.load(); screenVideoEl = null; }
      if (media || hasEmptyStatusScreen) {
        const aspect = DEV?.screenAspect ?? 16 / 9;
        ensureScreenCanvas(aspect);
        if (!screenCanvasTex) {
          screenCanvasTex = new THREE.CanvasTexture(screenCanvas!);
          screenCanvasTex.colorSpace = THREE.SRGBColorSpace;
          // Generated UVs use the default bottom-up direction. The iPhone Air
          // ships with the opposite authored V axis, so its device definition
          // opts out instead of flipping every other screen.
          screenCanvasTex.flipY = DEV?.screenTextureFlipY ?? true;
          // Default filtering left this soft at the screen's steep viewing
          // angle — anisotropic filtering is what actually sharpens minified
          // detail at a grazing angle (mip bias alone doesn't fix it).
          screenCanvasTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
        setScreenMaterial(makeScreenMaterial(screenCanvasTex));
        if (!media) {
          screenImageEl = null;
          screenXformKey = '';
          drawEmptyScreenFrame();
        } else if (media.kind === 'video') {
          // Built by the same helper the video CARDS use, so the screen clip
          // gets the settings that actually matter: crossOrigin before src (set
          // after, the fetch has already started without CORS), preload 'auto'
          // for a detached element, and defaultMuted so muted autoplay holds.
          // Playback itself is driven by syncScreenVideoToTimeline() below —
          // NOT by an autoplay here, which is what put the clip on wall-clock.
          screenVideoEl = createCardVideo(media.url);
          screenXformKey = '';   // force the first paint for this clip
        } else {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            if (disposed || mkey2 !== screenKey) return;
            screenImageEl = img;
            screenXformKey = '';        // force the redraw below to run
          };
          img.src = media.url;
        }
      } else {
        screenImageEl = null;
        restoreScreenMaterial();
      }
    }
    syncScreenVideoToTimeline();
    paintScreenContent();
    // Screen Brightness — the display is unlit (MeshBasicMaterial), so no light
    // reaches it; scaling the material colour is what dims/boosts the panel.
    if (screenMesh && screenMesh.material !== screenMesh.userData.origMaterial) {
      const sb = Math.max(0, Number(p.screenBrightness ?? 1));
      (screenMesh.material as THREE.MeshBasicMaterial).color.setScalar(sb);
    }

    const md = opts.getModel?.();
    if (md) {
      pivot.scale.setScalar(Math.max(0.05, md.scale));
      pivot.rotation.set(md.rotX, md.rotY, md.rotZ ?? 0);
      pivot.position.set(md.offsetX ?? 0, md.offsetY ?? 0, md.offsetZ ?? 0);
      sun.target.position.set(md.offsetX ?? 0, md.offsetY ?? 0, 0);
      sun.target.updateMatrixWorld();
      if (md.centerNonce !== lastCenterNonce) {
        lastCenterNonce = md.centerNonce;
        camera.position.copy(INIT_CAM);
        controls.target.copy(INIT_TARGET);
      }
    }

    const animState = use3DStore.getState();
    const sceneState = useSceneStore.getState();
    const duration = Math.max(0.1, sceneState.duration);
    const fps = Math.max(1, sceneState.fps);
    const progress = ((sceneState.frame / (duration * fps)) * (animState.mockupSpeed || 1)) % 1;
    const lightState = apply3DAnimation(
      animState.mockupAnimation || 'static',
      progress,
      camera,
      controls,
      pivot,
      INIT_CAM,
      INIT_TARGET,
      INIT_AZIMUTH,
      INIT_ELEVATION,
      modelHalf,
      md?.rotX ?? 0,
      md?.rotY ?? 0,
      md?.offsetX ?? 0,
      md?.offsetY ?? 0,
      md?.scale ?? 1.0,
      animState.mockupEasing,
      animState.mockupMotionStrength,
      md?.rotZ ?? 0,
      md?.offsetZ ?? 0,
      Number(p.fieldOfView ?? 42),
      Number(p.lidAngle ?? 112),
    );

    // Dynamic studio lighting choreography synced with camera animation
    // The animation preset's own light choreography, PLUS the user's Light
    // Direction — added as an offset rather than replacing it, so dragging the
    // direction still works while an animated preset is playing.
    const kAz = THREE.MathUtils.degToRad(lightState.keyLightAzimuth + Number(p.lightAzimuth ?? 0));
    const kEl = THREE.MathUtils.degToRad(lightState.keyLightElevation + Number(p.lightElevation ?? 0));
    const kDist = 8;
    key.position.set(
      kDist * Math.cos(kEl) * Math.sin(kAz),
      kDist * Math.sin(kEl),
      kDist * Math.cos(kEl) * Math.cos(kAz)
    );
    // Multiply the user's own Key/Fill sliders by the preset's choreography —
    // multiplying a hardcoded base here (as before) made those two sliders do
    // nothing, since this assignment runs after (and overwrote) the one above.
    key.intensity = Number(p.keyLight ?? 3) * lightState.keyLightIntensity;
    fill.intensity = Number(p.fillLight ?? 1.2) * lightState.fillLightIntensity;
    rim.intensity = Number(p.keyLight ?? 3) * (2.5 / 4.2) * lightState.keyLightIntensity;
    if ((scene as any).environmentRotation) {
      (scene as any).environmentRotation.y = THREE.MathUtils.degToRad(lightState.envRotation);
    }

    // Repaints only when the Background panel actually changes (keyed on the
    // fill spec), so this is a string compare per frame, not a canvas redraw.
    const bgSpec = opts.getBgFill?.();
    if (bgSpec) paintBackground(bgSpec);

    const shadowMat = ground.material as THREE.ShadowMaterial;
    shadowMat.opacity = Math.max(0, Math.min(1, Number(p.shadowOpacity ?? 35) / 100));

    const sunlight = opts.getSunlight?.() ?? 0;
    const sunShadow = opts.getSunShadow?.() ?? 0;
    sun.intensity = (sunlight / 100) * 14;
    sun.penumbra = 0.5 - (sunShadow / 100) * 0.46;
    const maskUrl = opts.getSunMask?.() ?? null;
    if (maskUrl) {
      if (maskUrl !== goboUrl) loadGobo(maskUrl);
      sun.map = goboTex;
      const mt = opts.getSunMaskTransform?.() ?? { scale: 16, offX: 0, offY: 0 };
      const gkey = `${goboUrl}|${mt.scale}|${mt.offX}|${mt.offY}`;
      if (gkey !== goboKey) { drawGobo(mt.scale / 100, mt.offX / 100, mt.offY / 100); goboKey = gkey; }
    } else if (sun.map) { sun.map = null; }

    settleGroundUnderModel();   // after the animation has posed the pivot
    rig.update();
    if (controls.enabled) controls.update();
    renderer.render(scene, camera);
  }

  const renderFrameAt = (frame: number) => {
    if (disposed) return;
    const p = P();
    const sceneState = useSceneStore.getState();
    sceneState.setFrame(frame);
    // The screen is composited on a 2D canvas by the rAF loop, which does not
    // run in lockstep with this deterministic path. Repaint it here or the
    // captured frame carries a stale screen.
    paintScreenContent();
    const animState = use3DStore.getState();
    const duration = Math.max(0.1, sceneState.duration);
    const fps = Math.max(1, sceneState.fps);
    const progress = ((frame / (duration * fps)) * (animState.mockupSpeed || 1)) % 1;
    const md = opts.getModel?.() ?? { scale: 1, rotX: 0, rotY: 0, rotZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0, centerNonce: 0 };
    const lightState = apply3DAnimation(
      animState.mockupAnimation || 'static',
      progress,
      camera,
      controls,
      pivot,
      INIT_CAM,
      INIT_TARGET,
      INIT_AZIMUTH,
      INIT_ELEVATION,
      modelHalf,
      md?.rotX ?? 0,
      md?.rotY ?? 0,
      md?.offsetX ?? 0,
      md?.offsetY ?? 0,
      md?.scale ?? 1.0,
      animState.mockupEasing,
      animState.mockupMotionStrength,
      md?.rotZ ?? 0,
      md?.offsetZ ?? 0,
      Number(p.fieldOfView ?? 42),
      Number(p.lidAngle ?? 112),
    );
    // The animation preset's own light choreography, PLUS the user's Light
    // Direction — added as an offset rather than replacing it, so dragging the
    // direction still works while an animated preset is playing.
    const kAz = THREE.MathUtils.degToRad(lightState.keyLightAzimuth + Number(p.lightAzimuth ?? 0));
    const kEl = THREE.MathUtils.degToRad(lightState.keyLightElevation + Number(p.lightElevation ?? 0));
    const kDist = 8;
    key.position.set(
      kDist * Math.cos(kEl) * Math.sin(kAz),
      kDist * Math.sin(kEl),
      kDist * Math.cos(kEl) * Math.cos(kAz)
    );
    key.intensity = Number(p.keyLight ?? 3) * lightState.keyLightIntensity;
    fill.intensity = Number(p.fillLight ?? 1.2) * lightState.fillLightIntensity;
    if ((scene as any).environmentRotation) {
      (scene as any).environmentRotation.y = THREE.MathUtils.degToRad(lightState.envRotation);
    }
    settleGroundUnderModel();   // after the animation has posed the pivot
    rig.update();
    if (controls.enabled) controls.update();
    renderer.render(scene, camera);
  };

  const captureFrameAt = (frame: number): string => {
    renderFrameAt(frame);
    return renderer.domElement.toDataURL('image/jpeg', 0.92);
  };

  const setCaptureScale = (k: number): void => {
    // ExportDialog calls endVideoExport before restoring scale 1. At that point
    // return to the lightweight editor backing store rather than leaving the
    // live preview at full export cost.
    if (!exportMode && k === 1) {
      lastW = 0;
      lastH = 0;
      resize();
      return;
    }
    const st = useSceneStore.getState();
    renderer.setSize(Math.round(st.width * k), Math.round(st.height * k), false);
    // Invalidate resize()'s cache, or it would see the scene dims unchanged and
    // leave the backing store at the export scale after the capture finishes.
    lastW = 0; lastH = 0;
  };

  // ── Export-time screen video ────────────────────────────────────────────
  // Every captured frame gets an explicit seek. `screenVideoExporting` parks the
  // live sync for the duration so the two clocks never fight.
  //
  // Deliberately NOT the sequential forward-decode pass the video CARDS use
  // (prepareVideoForSequentialExport + advanceVideoForExport). That pass rewinds
  // by playing the element and waiting on requestVideoFrameCallback, which never
  // fires in a page that has stopped compositing: measured here, the rewind
  // timed out with the clip parked at 0.93 s, and the forward-only advance then
  // saw every target as already passed and did nothing — 30 exported frames all
  // showed the same source frame. seekVideoToTime() is random-access and settles
  // on 'seeked', so it holds with or without a compositor. The sequential pass
  // exists to amortise GOP decodes across MANY card videos; a screen has one.
  const beginVideoExport = async (): Promise<void> => {
    exportMode = true;
    const v = screenVideoEl;
    if (!v) return;
    screenVideoExporting = true;
    screenVideoSeekTarget = -1;
    v.pause();
    v.loop = false;                  // wrapping is decided per frame by the seek
    await seekVideoToTime(v, 0);
  };

  const seekVideos = async (frame: number): Promise<void> => {
    const v = screenVideoEl;
    if (!v) return;
    const st = useSceneStore.getState();
    await seekVideoToTime(v, frame / Math.max(1, st.fps), st.videoEnd);
  };

  const endVideoExport = (): void => {
    exportMode = false;
    screenVideoExporting = false;
    screenVideoSeekTarget = -1;
    if (screenVideoEl) screenVideoEl.loop = true;
  };

  opts.onRenderer?.({
    renderFrame: renderFrameAt,
    captureFrame: captureFrameAt,
    setCaptureScale: setCaptureScale,
    beginVideoExport,
    seekVideos,
    endVideoExport,
  });

  loop();

  return function dispose() {
    disposed = true;
    opts.onRenderer?.(null);
    opts.onCamera?.(null);
    cancelAnimationFrame(animId);
    ro.disconnect();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    controls.dispose();
    pmrem.dispose();
    envRT.texture.dispose();
    bgTex.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    if (screenVideoEl) { screenVideoEl.pause(); screenVideoEl.removeAttribute('src'); screenVideoEl.load(); }
    if (screenCanvasTex) screenCanvasTex.dispose();
    if (screenMesh) {
      const sm = screenMesh.material as THREE.Material;
      if (sm && sm !== screenMesh.userData.origMaterial) sm.dispose();
    }
    for (const m of materials) m.dispose();
    // Geometry belongs to the shared parsed GLB cache. Materials are cloned
    // above and disposed here; shared geometry remains reusable on navigation.
    renderer.dispose();
  };
}
