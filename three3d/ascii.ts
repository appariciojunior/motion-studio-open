import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CHAR_SETS, asciiDefaults, isOn } from './asciiControls';
import { fitAndCenter } from './frame';
import { asset } from '@/lib/paths';
import type { CameraRig } from './cameraRig';

// ── ASCII 3D effect ─────────────────────────────────────────────────────────
// Port of 3D/ASCII/index.html, extended to read live control values. Loads a
// .glb, renders it to a small WebGL buffer, then re-draws each cell as a
// coloured monospace glyph. `getParams()` supplies the current control values
// every frame (character ramp, intensity, lights, animation). Post-processing
// (tint, scanlines, bloom, …) is applied in CSS by the 3D stage component.
// Returns dispose().

export interface ModelTransform {
  scale: number;
  rotX: number;
  rotY: number;
  rotZ?: number;
  offsetX: number;
  offsetY: number;
  offsetZ?: number;
  centerNonce: number;
}

export interface AsciiOptions {
  modelUrl?: string;
  getParams?: () => Record<string, any>;
  getModel?: () => ModelTransform;
  // per-part colouring — fill spec is { type, c1, c2 } (see store FillSpec)
  getPartFills?: () => Record<string, { type: string; c1: string; c2: string }>;
  getSelectedPart?: () => string | null;
  onParts?: (keys: string[]) => void;       // effect reports colourable groups
  onPickPart?: (key: string | null) => void; // click-to-pick result
  // background paint texture
  getBgFill?: () => { type: string; c1: string; c2: string };
  getTransparentBackground?: () => boolean;
  getBgTex?: () => { amount: number; scale: number };
  getSunShadow?: () => number;              // sun shadow / hardness 0..100
  getSunlight?: () => number;               // window-light intensity 0..100
  getSunMask?: () => string | null;         // window gobo texture url
  getSunMaskTransform?: () => { scale: number; offX: number; offY: number };
  // effect hands out a camera handle (null on teardown) — drives the view gizmo
  onCamera?: (rig: CameraRig | null) => void;
  // Mockup mode — image/video composited onto the device's "Screen" mesh.
  getScreenMedia?: () => { kind: 'image' | 'video'; url: string } | null;
  // How that media is laid into the screen (fit mode, zoom, 0..100 anchor).
  getScreenTransform?: () => { fit: 'cover' | 'width' | 'contain'; zoom: number; offsetX: number; offsetY: number };
  getScreenStatus?: () => {
    mode: 'off' | 'light' | 'dark';
    time: string;
    battery: number;
    signal: number;
  };
  // Effect hands out a deterministic render handle (null on teardown) — lets a
  // caller seek to an exact frame and capture it, independent of the rAF loop.
  onRenderer?: (handle: {
    renderFrame: (frame: number) => void;
    captureFrame: (frame: number, mimeType?: 'image/jpeg' | 'image/png') => string;
    setCaptureScale: (k: number) => void;
  } | null) => void;
}

// ── Value noise (fBm) — the background "height map" that drives BG glyphs ─────
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, seed: number): number {
  let f = 0, amp = 0.5, freq = 1;
  for (let o = 0; o < 4; o++) { f += amp * vnoise(x * freq, y * freq, seed + o * 17); freq *= 2; amp *= 0.5; }
  return f;   // ~0..1
}

export function initAscii(
  stage: HTMLElement,
  asciiCanvas: HTMLCanvasElement,
  opts: AsciiOptions = {},
): () => void {
  const MODEL_URL = asset(opts.modelUrl ?? '/3d/clouds.glb');
  const DEFAULTS = asciiDefaults();
  const P = () => ({ ...DEFAULTS, ...(opts.getParams?.() ?? {}) });

  let animId = 0;
  let disposed = false;
  let lastCenterNonce = 0;

  // ─── THREE SETUP ──────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, stage.clientWidth / stage.clientHeight, 0.01, 1000);
  camera.position.set(0, 0, 4);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.domElement.style.display = 'none';
  stage.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 3.0); key.position.set(3, 6, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.2); fill.position.set(-4, 2, -3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(0, -3, -5); scene.add(rim);

  // ─── ASCII CANVAS ─────────────────────────────────────────────────────────
  // PITCH = grid spacing (driven by Density → chars across the whole screen).
  // GLYPH = drawn font size (driven by Font Size). Decoupled so Density can add
  // characters without shrinking the glyphs.
  let CHARS = CHAR_SETS.Detailed;
  let PITCH = 8;
  let GLYPH = 8;
  const ac = asciiCanvas.getContext('2d')!;

  const readCanvas: HTMLCanvasElement | OffscreenCanvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas');
  const rc = (readCanvas as any).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;

  const MAX_COLS = 4096;
  const charOverrides = new Map<number, { ch: string; expiresAt: number }>();
  const OVERRIDE_FRAC = 0.20;
  const OVERRIDE_MS = 1000;

  let visibleBuf = new Int32Array(0);
  let visibleCount = 0;
  const V_STRIDE = 6;

  const PIXEL_READ_INTERVAL = 3;
  let pixelFrame = 0;
  let cachedPixels: Uint8ClampedArray | null = null;

  function currentChars(p: Record<string, any>): string {
    const c = String(p.charSetCustom ?? '');
    return c.length >= 2 ? c : CHAR_SETS.Standard;
  }

  // ─── RESIZE ───────────────────────────────────────────────────────────────
  function resize() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    if (W === 0 || H === 0) return;
    const cols = Math.floor(W / PITCH);
    const rows = Math.floor(H / PITCH);

    renderer.setSize(cols, rows);
    readCanvas.width = cols;
    readCanvas.height = rows;
    asciiCanvas.width = W;
    asciiCanvas.height = H;

    camera.aspect = W / H;
    camera.updateProjectionMatrix();

    visibleBuf = new Int32Array(cols * rows * V_STRIDE);
    visibleCount = 0;
    cachedPixels = null;
  }

  // ─── THEME / COLOR ────────────────────────────────────────────────────────
  const themeRGB = { r: 0, g: 255, b: 65 };
  const COLOR_TABLE: string[] = new Array(256);
  function rebuildColorTable() {
    const { r, g, b } = themeRGB;
    for (let br = 0; br < 256; br++) {
      const t = br / 255;
      const cr = Math.round(r * t);
      const cg = Math.round(Math.min(255, g * t + 60 * t));
      const cb = Math.round(b * t * 0.5);
      COLOR_TABLE[br] = `rgb(${cr},${cg},${cb})`;
    }
  }
  rebuildColorTable();

  // ─── AMBIENT CHARS ──────────────────────────────────────────────────────────
  // Static scatter of glyphs around the model. Fixed positions/chars/alpha,
  // seeded once — no spawning or growth over time. The Background Noise slider
  // (`amt`, 0..1) is a hard threshold on each cell's stored random value, so the
  // on-screen quantity is constant for a given slider position.

  // ─── ASCII RENDER ─────────────────────────────────────────────────────────
  function renderASCII() {
    const p = P();
    const now = performance.now();
    const cols = readCanvas.width;
    const rows = readCanvas.height;
    if (cols === 0 || rows === 0) return;

    CHARS = currentChars(p);
    const charsLen = CHARS.length - 1;
    const invert = isOn(p.invertMapping);
    const animated = isOn(p.animated);
    const randomize = isOn(p.randomize);
    const bright01 = Number(p.brightness) / 100;
    const contrast = Number(p.contrast) / 100;
    const coverageCut = Math.max(0.04, (1 - Number(p.coverage) / 100) * 0.5);
    const keepFrac = 0.4 + 0.6 * (Number(p.density) / 100);
    const edge = Number(p.edgeEmphasis) / 100;
    const charAlpha = Math.max(0, Math.min(1, Number(p.charOpacity) / 100));
    // Line/threshold mode — keep only cells on the model's edges.
    const edges = isOn(p.edges);
    const thr01 = Number(p.threshold) / 100;
    const edgeCut = (1 - thr01) * 0.42 + 0.02;   // higher threshold → more detail
    const levels = Math.max(2, Math.round(Number(p.levels) || 10));   // posterize bands
    const postDiv = levels - 1;
    // Background value-noise texture (fills empty BG; model draws on top)
    const bgTexture = isOn(p.bgTexture);
    const bgSeed = Math.round(Number(p.bgSeed) || 0);
    const bgScale = Math.max(1, Number(p.bgScale) || 30);
    const bgNf = 1 / (bgScale * 0.5 + 2);        // larger scale → bigger features
    const bgThr = 1 - Math.max(0, Math.min(100, Number(p.bgCoverage))) / 100;

    pixelFrame++;
    const doRead = (pixelFrame % PIXEL_READ_INTERVAL === 0 || cachedPixels === null);

    if (doRead) {
      rc.drawImage(renderer.domElement, 0, 0);
      cachedPixels = rc.getImageData(0, 0, cols, rows).data;
      visibleCount = 0;
      const px = cachedPixels;
      const lumAt = (i: number) => (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const pi = (row * cols + col) * 4;
          const rawLum = lumAt(pi);
          const modelPresent = rawLum > 0.02;   // WebGL model occupies this cell
          let lum: number;

          if (modelPresent) {
            // ── MODEL (drawn on top; occludes the background) ──
            lum = rawLum;
            let grad = 0;
            if (edges || edge > 0) {
              const rp = col + 1 < cols ? pi + 4 : pi;
              const dp = row + 1 < rows ? pi + cols * 4 : pi;
              grad = Math.abs(lum - lumAt(rp)) + Math.abs(lum - lumAt(dp));
            }
            if (edges) {
              if (grad < edgeCut) continue;               // contour lines only
              lum = Math.min(1, grad * 1.8 + 0.12);
            } else if (edge > 0) {
              lum += grad * edge * 2.0;                   // edge emphasis over fill
            }
            lum = (lum - 0.5) * contrast + 0.5 + bright01;
            if (!edges && lum < coverageCut) continue;    // coverage = fill only
            lum = Math.max(0, Math.min(1, lum));
            if (!edges) {                                  // fill only
              lum = Math.round(lum * postDiv) / postDiv;   // posterize → volume steps
              const hash = ((col * 73856093) ^ (row * 19349663)) >>> 0;
              if ((hash % 1000) / 1000 > keepFrac) continue;
            }
          } else {
            // ── BACKGROUND (value-noise ASCII texture) ──
            if (!bgTexture) continue;
            const n = fbm(col * bgNf, row * bgNf, bgSeed);
            if (n <= bgThr) continue;
            lum = Math.max(0, Math.min(1, (n - bgThr) / (1 - bgThr)));
            lum = Math.round(lum * postDiv) / postDiv;     // posterize BG too
          }

          let charIdx = Math.floor(lum * charsLen);
          if (invert) charIdx = charsLen - charIdx;
          if (CHARS[charIdx] === ' ' || CHARS[charIdx] === undefined) continue;
          const sx = col * PITCH, sy = row * PITCH;
          const brightByte = Math.floor(lum * 255);
          const base = visibleCount * V_STRIDE;
          visibleBuf[base] = col;
          visibleBuf[base + 1] = row;
          visibleBuf[base + 2] = sx;
          visibleBuf[base + 3] = sy;
          visibleBuf[base + 4] = brightByte;
          visibleBuf[base + 5] = charIdx;
          visibleCount++;
        }
      }
    }

    for (const [k, val] of charOverrides)
      if (now >= val.expiresAt) charOverrides.delete(k);

    if (animated && randomize) {
      const toSpawn = Math.floor(visibleCount * OVERRIDE_FRAC * (1 / 60));
      for (let i = 0; i < toSpawn; i++) {
        const idx = Math.floor(Math.random() * visibleCount) * V_STRIDE;
        const col = visibleBuf[idx], row = visibleBuf[idx + 1];
        const k = col * MAX_COLS + row;
        if (!charOverrides.has(k)) {
          const natural = CHARS[visibleBuf[idx + 5]];
          let ch: string; let guard = 0;
          do { ch = CHARS[Math.floor(Math.random() * CHARS.length)]; } while ((ch === natural || ch === ' ') && guard++ < 8);
          charOverrides.set(k, { ch, expiresAt: now + OVERRIDE_MS + Math.random() * 400 - 200 });
        }
      }
    }

    ac.clearRect(0, 0, asciiCanvas.width, asciiCanvas.height);
    ac.font = `bold ${GLYPH}px 'Share Tech Mono',monospace`;
    ac.textBaseline = 'top';
    ac.globalAlpha = charAlpha;

    const byColor = new Map<number, number[]>();
    for (let i = 0; i < visibleCount; i++) {
      const bright = visibleBuf[i * V_STRIDE + 4];
      if (!byColor.has(bright)) byColor.set(bright, []);
      byColor.get(bright)!.push(i);
    }
    for (const [bright, indices] of byColor) {
      ac.fillStyle = COLOR_TABLE[bright];
      for (const i of indices) {
        const base = i * V_STRIDE;
        const col = visibleBuf[base], row = visibleBuf[base + 1];
        const over = charOverrides.get(col * MAX_COLS + row);
        const ch = over ? over.ch : CHARS[visibleBuf[base + 5]];
        ac.fillText(ch ?? '', visibleBuf[base + 2], visibleBuf[base + 3]);
      }
    }

    ac.globalAlpha = 1;
  }

  // ─── MODEL LOAD ───────────────────────────────────────────────────────────
  const controls = new OrbitControls(camera, asciiCanvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 0.5;
  controls.maxDistance = 12;
  const INIT_TARGET = new THREE.Vector3(0, 0, 0);   // model sits at world origin
  const INIT_CAM = new THREE.Vector3(0, 0, 4);
  controls.target.copy(INIT_TARGET);

  const MODEL_SIZE = 2.4;                             // fitted world size (max dim)
  let modelHalf = MODEL_SIZE / 2;

  // Place camera dead-centre on the model, distance chosen so it fits the
  // current aspect (width-limited on portrait canvases). Updates INIT_CAM so
  // "Center" restores exactly this framing.
  function frameCamera() {
    const halfV = Math.tan((45 * Math.PI / 180) / 2);
    const halfH = halfV * camera.aspect;
    const dist = Math.max(modelHalf / halfV, modelHalf / halfH) * 1.25;
    INIT_CAM.set(0, 0, dist);
    camera.position.copy(INIT_CAM);
    controls.target.copy(INIT_TARGET);
    controls.update();
  }

  // Pivot wraps the auto-fitted model so user scale/rotation apply cleanly.
  const pivot = new THREE.Group();
  scene.add(pivot);
  let model: THREE.Object3D | null = null;

  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      if (disposed) return;
      model = gltf.scene;
      modelHalf = fitAndCenter(model, MODEL_SIZE);      // centroid-centred + fit
      pivot.add(model);
      frameCamera();
    },
    () => {},
    (err) => { console.error('GLB load failed:', err); },
  );

  // ─── SIZE + LOOP ────────────────────────────────────────────────────────────
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  function loop() {
    if (disposed) return;
    animId = requestAnimationFrame(loop);
    const p = P();

    // Density drives grid pitch (chars across the whole screen); higher = more.
    const dens = Math.max(0, Math.min(100, Number(p.gridDensity ?? 67)));
    const wantPitch = Math.max(3, Math.min(16, Math.round(16 - dens / 100 * 12)));
    GLYPH = Math.max(3, Math.min(16, Math.round(Number(p.fontSize) || 8)));
    if (wantPitch !== PITCH) { PITCH = wantPitch; resize(); }

    // lights toggle
    const lightsOn = isOn(p.enableLights);
    key.visible = fill.visible = rim.visible = lightsOn;

    // model transform (scale / rotation) + recenter command
    const m = opts.getModel?.();
    if (m) {
      pivot.scale.setScalar(Math.max(0.05, m.scale));
      pivot.rotation.set(m.rotX, m.rotY, 0);
      pivot.position.set(m.offsetX ?? 0, m.offsetY ?? 0, 0);
      if (m.centerNonce !== lastCenterNonce) {
        lastCenterNonce = m.centerNonce;
        camera.position.copy(INIT_CAM);
        controls.target.copy(INIT_TARGET);
      }
    }

    controls.update();
    renderer.render(scene, camera);
    renderASCII();
  }
  loop();

  // ─── DISPOSE ─────────────────────────────────────────────────────────────
  return function dispose() {
    disposed = true;
    cancelAnimationFrame(animId);
    ro.disconnect();
    controls.dispose();
    if (model) {
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
    }
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  };
}
