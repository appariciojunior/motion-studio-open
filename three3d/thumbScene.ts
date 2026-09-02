// Catalogue thumbnails for the webgl presets, rendered with real three.
//
// WHY NOT CSS. The thumbnail used to run a template's 2D `transform` and pose
// plain divs — for the 119 webgl presets that is the wrong function entirely,
// and projecting their `transform3d` through CSS instead (which I tried) still
// cannot work: a fifth of them are DEFINED by mesh deformation. Measured over
// the catalogue, `bend` appears in 461 sampled cards, the sticker roll in 68,
// `curl` and `cornerPeel` in 6 each, `backfaceColor` in 260 and
// `materialExposure` in 172. A CSS matrix moves a rigid rectangle: the Sticker's
// paper does not fold, the card has no back of its own and no light. So this
// renders the same geometry the stage renders, out of the same module
// (three3d/cardMesh).
//
// WHY ONE RENDERER. A catalogue page shows hundreds of presets and a browser
// gives you a handful of WebGL contexts. This follows the pattern MockupThumb
// already established here: ONE renderer, ONE canvas, and the canvas is moved
// into whichever card is being previewed. Idle cards show a still image taken
// from that same renderer, so the catalogue costs one context no matter how long
// the list gets.
import * as THREE from 'three';
import type { CameraPose, LayerTransform3D, Template } from '@/lib/types';
import { clamp } from '@/lib/motion';
import { defaultsFor, easingFor, layerCountFor } from '@/templates';
import { resolveEasing } from '@/lib/easing';
import { stillFrom } from '@/lib/thumbStill';
import {
  makeBentPlaneGeometry,
  makeCornerPeelGeometry,
  makeCurlPlaneGeometry,
  makeStickerRollGeometry,
} from '@/three3d/cardMesh';

// 3:4, matching the thumbnail box and MockupThumb's own size.
export const THUMB_W = 180;
export const THUMB_H = 240;
// The preview space the templates pose in — the same numbers TemplateThumb used,
// so a preset lays out here exactly as it laid out there.
export const CTX_BASE = { fps: 30, width: 810, height: 1080, duration: 8, totalFrames: 240 };
const TEX_LONG = 600;
const SPRITE_BASE = 340;
// A thumbnail is ~180px across; past this many cards the extra ones land inside
// a pixel of each other and cost geometry for nothing.
const DRAW_BUDGET = 40;

interface CardSlot {
  root: THREE.Group;
  front: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  back: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}

interface Shared {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  group: THREE.Group;
  slots: CardSlot[];
  plane: THREE.PlaneGeometry;
  geomCache: Map<string, THREE.BufferGeometry>;
  tones: THREE.Texture[];
}

let shared: Shared | null = null;

// The card faces: neutral greys, one tone per card index.
//
// Deliberately NOT the demo photographs. A thumbnail is ~180px across and its
// job is to show the MOTION — where the cards go, how they turn, how the paper
// folds. Real images at that size are noise competing with the geometry, and
// they also make every preset look like whatever happens to be in the demo set.
//
// Walking the tone by the golden ratio spreads it so NEIGHBOURING cards differ,
// which is the case that needs separating: a plain ramp gives adjacent cards
// near-identical values and a stack of them reads as one blob. Deterministic, so
// a previewing thumbnail does not shimmer, and neutral, because the palette has
// no accent colour to borrow.
const TONE_COUNT = 12;

function makeToneTexture(index: number): THREE.Texture {
  const t = (index * 0.6180339887) % 1;
  const level = Math.round((0.42 + t * 0.46) * 255);
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const g = c.getContext('2d')!;
  g.fillStyle = `rgb(${level},${level},${level})`;
  g.fillRect(0, 0, 4, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function getShared(): Shared {
  if (shared) return shared;

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  // Styled to fill the .tpl-thumb box it gets inserted into.
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    // Needed to read the canvas back for the idle still.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(THUMB_W, THUMB_H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // The stage's key light, in the stage's own units and direction — the whole
  // point of rendering for real is that `materialExposure` and the shading of a
  // bent card land the same way they do on the canvas. Shadow casting is off:
  // it needs a ground plane the thumbnail does not have, and a shadow map per
  // preset would cost more than it shows at 180px.
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-420, 560, 900);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));

  const camera = new THREE.PerspectiveCamera(50, THUMB_W / THUMB_H, 1, 40000);
  const group = new THREE.Group();
  scene.add(group);

  shared = {
    renderer, canvas, scene, camera, group,
    slots: [],
    plane: new THREE.PlaneGeometry(1, 1),
    geomCache: new Map(),
    tones: Array.from({ length: TONE_COUNT }, (_, i) => makeToneTexture(i)),
  };


  return shared;
}


function ensureSlots(ctx: Shared, count: number) {
  while (ctx.slots.length < count) {
    const root = new THREE.Group();
    const mk = () => new THREE.MeshStandardMaterial({
      transparent: true, roughness: 0.62, metalness: 0.02,
    });
    const front = new THREE.Mesh(ctx.plane, mk());
    const back = new THREE.Mesh(ctx.plane, mk());
    back.rotation.y = Math.PI;
    root.add(front, back);
    ctx.group.add(root);
    ctx.slots.push({ root, front, back });
  }
  for (let i = 0; i < ctx.slots.length; i++) ctx.slots[i].root.visible = i < count;
}

// The stage's own geometry choice, quantized the same way so the cache hits.
// Kept in one place because getting the ORDER wrong (sticker before peel before
// curl before bend) silently draws the wrong deformation for a pose that sets
// more than one field.
function geometryFor(ctx: Shared, t: LayerTransform3D): THREE.BufferGeometry {
  const bend = clamp(t.bend ?? 0, -0.45, 0.45);
  const curl = t.curl ?? 0;
  const cornerPeel = clamp(t.cornerPeel ?? 0, 0, 1);
  const stickerRolling = Number.isFinite(t.stickerPeelFront)
    && Number.isFinite(t.stickerCurlRadius)
    && (t.stickerCurlRadius ?? 0) > 0;

  if (stickerRolling) {
    const f = Math.round((t.stickerPeelFront ?? 0) * 180) / 180;
    const r = Math.round((t.stickerCurlRadius ?? 0.15) * 180) / 180;
    const d = Math.round((t.peelDirection ?? 50) * 2) / 2;
    const k = `sticker:${f.toFixed(4)}:${r.toFixed(4)}:${d.toFixed(1)}`;
    let g = ctx.geomCache.get(k);
    if (!g) { g = makeStickerRollGeometry(f, r, d); ctx.geomCache.set(k, g); }
    return g;
  }
  if (cornerPeel > 0.0001) {
    const p = Math.round(cornerPeel * 180) / 180;
    const a = Math.round((t.peelAngle ?? Math.PI * 0.78) * 64) / 64;
    const c = Math.round(curl * 64) / 64;
    const d = Math.round((t.peelDirection ?? 50) * 2) / 2;
    const s = Math.round(clamp(t.peelSoftness ?? 0, 0, 1) * 32) / 32;
    const k = `peel:${p.toFixed(3)}:${a.toFixed(3)}:${c.toFixed(3)}:${d.toFixed(1)}:${s.toFixed(3)}`;
    let g = ctx.geomCache.get(k);
    if (!g) { g = makeCornerPeelGeometry(p, a, c, d, s); ctx.geomCache.set(k, g); }
    return g;
  }
  if (Math.abs(curl) > 0.001) {
    const q = Math.round(curl * 60) / 60;
    const k = `curl:${q.toFixed(3)}`;
    let g = ctx.geomCache.get(k);
    if (!g) { g = makeCurlPlaneGeometry(q); ctx.geomCache.set(k, g); }
    return g;
  }
  if (Math.abs(bend) > 0.0001) {
    const k = `bend:${bend.toFixed(3)}`;
    let g = ctx.geomCache.get(k);
    if (!g) { g = makeBentPlaneGeometry(bend); ctx.geomCache.set(k, g); }
    return g;
  }
  return ctx.plane;
}

// The stage's camera, verbatim: fov from the house `perspective` control unless
// the template names one, D as the distance at which z=0 is 1:1, and `distance`
// as a multiplier on D. Unlike the CSS attempt, an off-axis camera or a target
// away from the origin is no problem here — this is a real camera.
function applyCamera(ctx: Shared, template: Template, v: Record<string, any>, tctx: any) {
  let pose: CameraPose | undefined;
  try { pose = template.camera?.(v, tctx); } catch { pose = undefined; }
  const control = clamp(Number(v.perspective ?? 100), 0, 200);
  const fov = pose?.fov ?? (15 + (95 - 15) * (control / 200));
  const D = (CTX_BASE.height / 2) / Math.tan((fov * Math.PI) / 360);
  const position = pose?.position ?? { x: 0, y: 0, z: D * (pose?.distance ?? 1) };
  const target = pose?.target ?? { x: 0, y: 0, z: 0 };

  const cam = ctx.camera;
  cam.fov = fov;
  // The thumbnail is 3:4 and so is the preview space, so the frustum matches
  // without correction — but read it from the box rather than assume it.
  cam.aspect = CTX_BASE.width / CTX_BASE.height;
  cam.position.set(position.x, -position.y, position.z);
  cam.lookAt(target.x, -target.y, target.z);
  cam.near = pose?.near ?? 0.1;
  cam.far = pose?.far ?? Math.max(D * 8, Math.abs(position.z) * 8);
  cam.updateProjectionMatrix();
}

/**
 * Pose the shared scene for this preset at this frame and draw it.
 * Returns false when the template has no 3D path to draw.
 */
export function renderThumbFrame(template: Template, frame: number): boolean {
  if (!template.transform3d) return false;
  const ctx = getShared();

  const v = defaultsFor(template.meta.id);
  const texAspect = template.meta.cardAspect === 'canvas'
    ? CTX_BASE.width / CTX_BASE.height
    : template.meta.cardAspect ?? 4 / 5;
  const texW = TEX_LONG * Math.min(1, texAspect);
  const texH = TEX_LONG * Math.min(1, 1 / texAspect);
  const norm = SPRITE_BASE / TEX_LONG;
  const ease = resolveEasing(easingFor(template.meta.id));
  const tctx = {
    ...CTX_BASE,
    ease,
    easedPhase: (p: number) => { const b = Math.floor(p); return b + ease(p - b); },
    cardAspect: texAspect,
  };
  // The REAL count: lattice families derive columns and wrap period from it, so
  // clamping it here would lay out a different scene. The budget below drops
  // cards instead.
  const count = layerCountFor(template.meta.id, v,
    { width: CTX_BASE.width, height: CTX_BASE.height, cardAspect: texAspect });

  applyCamera(ctx, template, v, tctx);

  const poses: LayerTransform3D[] = [];
  for (let i = 0; i < count; i++) {
    try { poses.push(template.transform3d(frame, i, count, v, tctx)); } catch { /* skip */ }
  }
  // Keep the visible ones when there are more cards than budget.
  const drawn = poses.length <= DRAW_BUDGET
    ? poses.map((t, i) => ({ t, i }))
    : poses.map((t, i) => ({ t, i }))
      .sort((a, b) => (a.t.alpha < 0.02 ? 1 : 0) - (b.t.alpha < 0.02 ? 1 : 0)
        || Math.hypot(a.t.x, a.t.y) - Math.hypot(b.t.x, b.t.y))
      .slice(0, DRAW_BUDGET);

  ensureSlots(ctx, drawn.length);

  drawn.forEach(({ t, i }, slotIndex) => {
    const slot = ctx.slots[slotIndex];
    const geometry = geometryFor(ctx, t);
    slot.front.geometry = geometry;
    slot.back.geometry = geometry;

    slot.root.position.set(t.x, -t.y, t.z);
    if (t.quaternion) {
      slot.root.quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w).normalize();
    } else {
      slot.root.rotation.set(t.rotationX ?? 0, t.rotationY ?? 0, t.rotationZ ?? 0);
    }
    const cardWidth = texW * norm * t.scale;
    slot.root.scale.set(cardWidth, texH * norm * t.scale, cardWidth);

    const tex = ctx.tones[i % TONE_COUNT];
    const alpha = clamp(t.alpha, 0, 1);
    // `dim` darkens a card that is merely far; it must not become see-through,
    // or a ring reads as glass instead of as depth.
    const lit = 1 - clamp(t.dim ?? 0, 0, 1);
    const exposure = clamp(t.materialExposure ?? 1, 0.25, 2.5);
    const shade = lit * exposure;

    slot.front.material.map = tex;
    slot.front.material.color.setScalar(shade);
    slot.front.material.opacity = alpha;
    slot.front.material.side = t.backfaceColor ? THREE.FrontSide : THREE.DoubleSide;
    slot.front.material.needsUpdate = true;

    // The preset's own reverse side, when it declares one. Without this a
    // rolled sticker shows its front image mirrored through the curl.
    const showBack = !!t.backfaceColor;
    slot.back.visible = showBack;
    if (showBack) {
      slot.back.material.map = null;
      slot.back.material.color.set(t.backfaceColor!).multiplyScalar(lit);
      slot.back.material.opacity = alpha;
      slot.back.material.needsUpdate = true;
    }
  });

  ctx.renderer.render(ctx.scene, ctx.camera);
  return true;
}

/** Draw one frame and read it back as a still, for the idle thumbnail. */
export function snapshotThumb(template: Template, frame: number): string | null {
  if (!renderThumbFrame(template, frame)) return null;
  return stillFrom(getShared().canvas, THUMB_W, THUMB_H);
}

/** Move the shared canvas into this container (previewing starts). */
export function attachCanvas(host: HTMLElement) {
  const ctx = getShared();
  if (ctx.canvas.parentElement !== host) host.appendChild(ctx.canvas);
}

/** Take it back out (previewing stops), so only one card ever holds it. */
export function detachCanvas() {
  const ctx = shared;
  if (ctx?.canvas.parentElement) ctx.canvas.parentElement.removeChild(ctx.canvas);
}

// ---- ciclo de vida do contexto ----
//
// Mesmo motivo do lado Pixi: este modulo tomava um contexto GL e nunca o
// devolvia, e com os dois somados o PALCO ficava sem. Medido: o canvas do palco
// existia com zero contexto e `app.renderer` vinha null, derrubando o editor em
// makePlaceholderTexture.
//
// Contagem de referencias, nao ordem de inicializacao: cada miniatura montada
// retem, cada desmontada solta, e a ultima a sair devolve o contexto.
let refs = 0;

export function retainThumb3d(): () => void {
  refs++;
  let solto = false;
  return () => {
    if (solto) return;
    solto = true;
    refs = Math.max(0, refs - 1);
    if (refs === 0) disposeShared3d();
  };
}

function disposeShared3d() {
  const ctx = shared;
  shared = null;
  if (!ctx) return;
  try {
    detachCanvas();
    ctx.geomCache.forEach((g) => g.dispose());
    ctx.geomCache.clear();
    ctx.plane.dispose();
    ctx.tones.forEach((t) => t.dispose());
    ctx.slots.forEach((s) => { s.front.material.dispose(); s.back.material.dispose(); });
    ctx.slots.length = 0;
    ctx.renderer.dispose();
    // dispose() solta os recursos mas NAO o contexto; sem isto o navegador
    // segue contando este canvas contra o limite.
    ctx.renderer.forceContextLoss();
  } catch { /* um contexto que já foi não precisa ir de novo */ }
}
