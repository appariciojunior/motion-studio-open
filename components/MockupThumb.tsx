'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { fitAndCenter } from '@/three3d/frame';
import type { DeviceDef } from '@/three3d/devices';

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED SINGLETON — one renderer, one scene, one camera, one env-map.
// The renderer's <canvas> is moved into whichever card is being hovered.
// At most ONE rAF loop runs at a time.
// ═══════════════════════════════════════════════════════════════════════════════

const THUMB_W = 180;
const THUMB_H = 240; // 3:4

interface SharedCtx {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pivot: THREE.Group;
}

let _ctx: SharedCtx | null = null;

function getShared(): SharedCtx {
  if (_ctx) return _ctx;

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  // Style the shared canvas so it fills the .tpl-thumb container when inserted
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(THUMB_W, THUMB_H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(42, THUMB_W / THUMB_H, 0.01, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3);
  keyLight.position.set(3, 6, 4);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 1.2);
  fillLight.position.set(-4, 2, -3);
  scene.add(fillLight);

  const pivot = new THREE.Group();
  scene.add(pivot);

  _ctx = { renderer, canvas, scene, camera, pivot };
  return _ctx;
}

// ── GLB cache ───────────────────────────────────────────────────────────────
const glbCache = new Map<string, THREE.Group>();
const glbLoading = new Map<string, Promise<THREE.Group>>();
const loader = new GLTFLoader();

function loadGLB(url: string): Promise<THREE.Group> {
  if (glbCache.has(url)) return Promise.resolve(glbCache.get(url)!.clone(true));
  if (glbLoading.has(url)) return glbLoading.get(url)!.then((g) => g.clone(true));
  const p = new Promise<THREE.Group>((resolve, reject) => {
    loader.load(url, (gltf) => {
      glbCache.set(url, gltf.scene.clone(true));
      resolve(gltf.scene.clone(true));
    }, undefined, reject);
  });
  glbLoading.set(url, p);
  return p;
}

// ── Render with the shared renderer (sets model, camera, draws) ─────────────
function renderToShared(
  model: THREE.Group,
  fitHeight: number,
  animKey: string,
  progress: number,
): void {
  const ctx = getShared();
  while (ctx.pivot.children.length) ctx.pivot.remove(ctx.pivot.children[0]);
  fitAndCenter(model, fitHeight);
  ctx.pivot.add(model);
  applyPose(ctx, animKey, progress, fitHeight);
  ctx.renderer.render(ctx.scene, ctx.camera);
}

// ── Render keeping the model already in the pivot (fast path for animation) ──
function renderAnimFrame(animKey: string, fitHeight: number, progress: number): void {
  const ctx = getShared();
  applyPose(ctx, animKey, progress, fitHeight);
  ctx.renderer.render(ctx.scene, ctx.camera);
}

function applyPose(ctx: SharedCtx, animKey: string, progress: number, fitHeight: number): void {
  const baseDist = (fitHeight / 2) * 2.5;
  const pose = computePose(animKey, progress, baseDist);
  const azRad = THREE.MathUtils.degToRad(pose.orbit);
  const elRad = THREE.MathUtils.degToRad(pose.elev);
  ctx.camera.position.set(
    pose.dist * Math.cos(elRad) * Math.sin(azRad),
    pose.dist * Math.sin(elRad),
    pose.dist * Math.cos(elRad) * Math.cos(azRad),
  );
  ctx.camera.lookAt(0, 0, 0);
  ctx.pivot.rotation.set(pose.pivotRx, pose.pivotRy, 0);
}

// ── Snapshot helper (used only once per idle frame) ──────────────────────────
function takeSnapshot(
  model: THREE.Group,
  fitHeight: number,
  animKey: string,
  progress: number,
): string {
  const ctx = getShared();
  // Temporarily enable preserveDrawingBuffer for toDataURL
  renderToShared(model, fitHeight, animKey, progress);
  // Read pixels synchronously (WebGL readback)
  const w = THUMB_W, h = THUMB_H;
  const offCanvas = document.createElement('canvas');
  offCanvas.width = w;
  offCanvas.height = h;
  const offCtx = offCanvas.getContext('2d')!;
  offCtx.drawImage(ctx.canvas, 0, 0);
  return offCanvas.toDataURL('image/png');
}

// ── Camera pose solver ──────────────────────────────────────────────────────
interface Pose { orbit: number; elev: number; dist: number; pivotRx: number; pivotRy: number; }

function computePose(animKey: string, progress: number, baseDist: number): Pose {
  const p: Pose = { orbit: -25, elev: 18, dist: baseDist, pivotRx: 0, pivotRy: 0 };
  switch (animKey) {
    case 'orbit360':           p.orbit = progress * 360; break;
    case 'orbit180_return':    p.orbit = Math.sin(progress * Math.PI * 2) * 90; p.elev = 16; break;
    case 'hero_reveal':        p.orbit = -30 + progress * 20; p.elev = 55 - progress * 40; p.dist = baseDist * (1.4 - progress * 0.35); break;
    case 'hero_reveal_dolly':  p.orbit = -20; p.elev = 45 - progress * 30; p.dist = baseDist * (1.6 - progress * 0.55); break;
    case 'float_hover':        p.orbit = -20 + Math.sin(progress * Math.PI * 2) * 12; p.pivotRy = Math.sin(progress * Math.PI * 2) * 0.08; break;
    case 'float_rotate':       p.orbit = progress * 360; p.elev = 16; break;
    case 'showcase_sweep':     p.orbit = Math.sin(progress * Math.PI * 2) * 65; p.elev = 14 + Math.sin(progress * Math.PI * 4) * 10; break;
    case 'screen_flip_180':    p.orbit = -20; p.pivotRy = progress * Math.PI; break;
    case 'dolly_zoom_vertigo': p.dist = baseDist * (0.7 + Math.sin(progress * Math.PI * 2) * 0.35); break;
    case 'dolly_pan_diagonal': p.orbit = -35 + Math.sin(progress * Math.PI * 2) * 25; p.elev = 18 + Math.sin(progress * Math.PI * 2) * 10; break;
    case 'laptop_lid_open':    p.orbit = -30; p.elev = 22; p.pivotRx = (Math.sin(progress * Math.PI * 2) * 0.5 + 0.5) * -0.3; break;
    case 'studio_glide_left':  p.orbit = -55 + progress * 50; p.elev = 14; break;
    case 'studio_glide_right': p.orbit = 55 - progress * 50; p.elev = 14; break;
    case 'topdown_crane_down': p.orbit = -20; p.elev = 75 - progress * 55; break;
    case 'isometric_pulse':    p.orbit = 45; p.elev = 35; p.dist = baseDist * (0.95 + Math.sin(progress * Math.PI * 2) * 0.08); break;
    default: break;
  }
  return p;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Global animation controller — only ONE card animates at a time.
// The shared canvas is physically moved into the hovered card's .tpl-thumb div.
// ═══════════════════════════════════════════════════════════════════════════════
let activeAnim: { stop: () => void } | null = null;

// ═══════════════════════════════════════════════════════════════════════════════
// DeviceThumb — static 3D snapshot (rendered once, displayed as <img>)
// ═══════════════════════════════════════════════════════════════════════════════
export function DeviceThumb({ device }: { device: DeviceDef }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGLB(device.modelUrl).then((model) => {
      if (cancelled) return;
      setSrc(takeSnapshot(model, device.fitHeight, 'static', 0.3));
    });
    return () => { cancelled = true; };
  }, [device.modelUrl, device.fitHeight]);

  return (
    <div className="tpl-thumb" aria-hidden="true">
      {src && (
        <img
          src={src} alt="" draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MockupAnimThumb — static <img> idle → shared <canvas> on hover (60 fps)
// ═══════════════════════════════════════════════════════════════════════════════
export function MockupAnimThumb({
  animKey,
  deviceKey,
}: {
  animKey: string;
  deviceKey?: string;
}) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const modelRef = useRef<THREE.Group | null>(null);
  const fitHeightRef = useRef(2.077);

  const getDeviceInfo = useCallback((): { url: string; fitHeight: number } => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DEVICES } = require('@/three3d/devices');
    const dk = deviceKey ?? 'iphone17pro';
    const dev = DEVICES.find((d: DeviceDef) => d.key === dk) ?? DEVICES[0];
    return { url: dev?.modelUrl ?? '/3d/devices/iphone17pro-clean.glb', fitHeight: dev?.fitHeight ?? 2.077 };
  }, [deviceKey]);

  // Generate static idle snapshot (once)
  useEffect(() => {
    let cancelled = false;
    const info = getDeviceInfo();
    fitHeightRef.current = info.fitHeight;
    loadGLB(info.url).then((model) => {
      if (cancelled) return;
      modelRef.current = model;
      setSrc(takeSnapshot(model, info.fitHeight, animKey, 0.3));
    });
    return () => { cancelled = true; };
  }, [animKey, deviceKey, getDeviceInfo]);

  // Hover → move shared canvas in, run animation loop. Leave → remove canvas.
  useEffect(() => {
    const thumb = thumbRef.current;
    const card = thumb?.closest<HTMLElement>('.tpl-card');
    if (!card) return;

    let raf = 0;
    let running = false;
    let startedAt = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const tick = (now: number) => {
      if (!running) return;
      const elapsed = (now - startedAt) / 1000;
      const progress = (elapsed * 0.15) % 1;
      renderAnimFrame(animKey, fitHeightRef.current, progress);
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running || reducedMotion.matches || !modelRef.current) return;
      // Stop any other card's animation
      if (activeAnim) activeAnim.stop();

      running = true;
      startedAt = performance.now();
      setIsPreviewing(true);
      activeAnim = { stop };

      // Hide the static <img>, insert the shared <canvas> into this thumb
      if (imgRef.current) imgRef.current.style.display = 'none';
      const ctx = getShared();
      // Set model into shared scene
      renderToShared(modelRef.current, fitHeightRef.current, animKey, 0);
      thumb!.appendChild(ctx.canvas);

      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      setIsPreviewing(false);
      if (activeAnim?.stop === stop) activeAnim = null;

      // Remove shared canvas from this thumb, show static <img> again
      const ctx = getShared();
      if (ctx.canvas.parentElement === thumb) thumb!.removeChild(ctx.canvas);
      if (imgRef.current) imgRef.current.style.display = '';
    };

    const stopAfterFocus = (event: FocusEvent) => {
      if (!card.contains(event.relatedTarget as Node | null)) stop();
    };

    card.addEventListener('pointerenter', start);
    card.addEventListener('pointerleave', stop);
    card.addEventListener('focusin', start);
    card.addEventListener('focusout', stopAfterFocus);
    return () => {
      if (running) stop();
      card.removeEventListener('pointerenter', start);
      card.removeEventListener('pointerleave', stop);
      card.removeEventListener('focusin', start);
      card.removeEventListener('focusout', stopAfterFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey, src]);

  return (
    <div ref={thumbRef} className={`tpl-thumb ${isPreviewing ? 'is-previewing' : ''}`} aria-hidden="true">
      {src && (
        <img
          ref={imgRef} src={src} alt="" draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}
