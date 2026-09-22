import * as THREE from 'three';
import type { DeviceDef } from './devices';

// ── Screen image compositing (Web MVP) ───────────────────────────────────
// A trimmed re-statement of three3d/mockup.ts's screen system: image only (no
// video, no status bar, no glass detection) — just enough to put a picture on
// a device's screen for a web session. Same mesh-lookup, UV-fallback and
// fit/zoom/anchor math (see mockup.ts's drawScreenFrame), so a device that
// works in Mockup works here identically, and components/ScreenContent.tsx's
// Fit/Zoom/Position controls carry over unchanged.

export interface ScreenTransform {
  fit: 'cover' | 'width' | 'contain';
  zoom: number;      // multiplier over the fitted size
  offsetX: number;   // 0..100, 0 = left/top edge, 50 = centred, 100 = right/bottom
  offsetY: number;
}

export const DEFAULT_SCREEN_TRANSFORM: ScreenTransform = { fit: 'cover', zoom: 1, offsetX: 50, offsetY: 50 };

function partKeyOf(mesh: THREE.Mesh): string {
  const mat = mesh.material as THREE.Material | undefined;
  const mn = mat && !Array.isArray(mat) && mat.name ? mat.name : '';
  if (mn) return mn;
  const nm = mesh.name || 'mesh';
  return nm.replace(/[._\-\s]?\d+$/, '') || nm;
}

export function findScreenMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (found) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (partKeyOf(mesh) === 'Screen') found = mesh;
  });
  return found;
}

// These GLBs ship their Screen mesh with position/normal/color only — no `uv`
// attribute — so a textured material samples an undefined varying and renders
// black. Project planar UVs from the mesh's own bounding box (see
// three3d/mockup.ts's ensureScreenUVs for the full reasoning).
function ensureUVs(mesh: THREE.Mesh) {
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

const SCREEN_RES = 1024;

export interface ScreenImageHandle {
  /** Re-draw with a new fit/zoom/anchor — cheap, no image re-fetch. */
  redraw(t: ScreenTransform): void;
  dispose(): void;
}

/** Composite `imageUrl` onto `mesh`'s Screen material. */
export function applyScreenImage(
  mesh: THREE.Mesh,
  imageUrl: string,
  device: DeviceDef,
  initial: ScreenTransform = DEFAULT_SCREEN_TRANSFORM,
): ScreenImageHandle {
  ensureUVs(mesh);
  let disposed = false;
  let loadedImg: HTMLImageElement | null = null;

  const transpose = device.screenTextureTranspose ?? null;
  const aspect = transpose ? 1 / device.screenAspect : device.screenAspect;
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_RES;
  canvas.height = Math.max(1, Math.round(SCREEN_RES / aspect));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = device.screenTextureFlipY ?? true;

  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, alphaTest: 0.001 });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 0;
  mat.polygonOffsetUnits = -2;
  const prevMaterial = mesh.material as THREE.Material;
  const prevRenderOrder = mesh.renderOrder;
  mesh.material = mat;
  mesh.renderOrder = 1000;

  // Same formula as three3d/mockup.ts's drawScreenFrame: a scaled destination
  // rect, not a source crop, so `contain`'s letterbox falls out of the same
  // expression as `cover`'s overflow — the anchor just changes sign.
  function draw(t: ScreenTransform) {
    if (!loadedImg) return;
    const W = canvas.width, H = canvas.height;
    const r = Math.min(W, H) * Math.max(0, device.screenCornerFrac);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (r > 0.5) { ctx.beginPath(); ctx.roundRect(0, 0, W, H, r); ctx.clip(); }
    const srcW = loadedImg.naturalWidth, srcH = loadedImg.naturalHeight;
    const byW = W / srcW, byH = H / srcH;
    const base = t.fit === 'width' ? byW : t.fit === 'contain' ? Math.min(byW, byH) : Math.max(byW, byH);
    const scale = base * Math.max(0.05, t.zoom);
    const dw = srcW * scale, dh = srcH * scale;
    const dx = (W - dw) * (t.offsetX / 100);
    const dy = (H - dh) * (t.offsetY / 100);
    ctx.drawImage(loadedImg, dx, dy, dw, dh);
    ctx.restore();
    tex.needsUpdate = true;
  }

  const img = new Image();
  img.onload = () => { if (disposed) return; loadedImg = img; draw(initial); };
  img.onerror = () => console.error('Screen image failed to load:', imageUrl);
  img.src = imageUrl;

  return {
    redraw: draw,
    dispose() {
      disposed = true;
      mesh.material = prevMaterial;
      mesh.renderOrder = prevRenderOrder;
      mat.dispose();
      tex.dispose();
    },
  };
}
