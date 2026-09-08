// Catalogue thumbnails for the 2D presets, rendered with the real Pixi.
//
// WHY PIXI AND NOT three. The 2D pose is defined BY Pixi: `skewX`/`skewY` mean
// what a Pixi Container means by them, the corner radius and the wipe are a
// Graphics mask, and `taper` is a PerspectiveMesh. The repo already learned this
// the hard way in the div path — mapping the pose onto CSS `rotate() skewX()`
// was off by 157px on Spinner 01 and inverted entirely past 90 degrees, and the
// fix was to hand Pixi's own 2x2 straight to matrix(). Rebuilding that in three
// would re-open exactly that gap. So: same library, same semantics, no mapping.
//
// WHY ONE APPLICATION. Same reason as the three thumbnails: a browser gives out
// few GL contexts and the catalogue has 271 cards. One Application, one canvas,
// moved into whichever card is previewing; idle cards hold a still taken from
// it. Two contexts total for the whole catalogue (this one and the three one).
import * as PIXI from 'pixi.js';
import type { LayerTransform, Template } from '@/lib/types';
import { clamp } from '@/lib/motion';
import { defaultsFor, easingFor, layerCountFor } from '@/templates';
import { resolveEasing } from '@/lib/easing';
import { stillFrom } from '@/lib/thumbStill';
import { waitForThumbQueue } from '@/lib/thumbQueue';

export const THUMB_W = 180;
export const THUMB_H = 240;
export const CTX_BASE = { fps: 30, width: 810, height: 1080, duration: 8, totalFrames: 240 };
const TEX_LONG = 600;
const SPRITE_BASE = 340;
const DRAW_BUDGET = 40;

interface Slot {
  sprite: PIXI.Sprite;
  mask: PIXI.Graphics;
  mesh?: PIXI.PerspectiveMesh;
  meshMask?: PIXI.Graphics;
  tapered: boolean;
  maskKey: string;
  taperKey: string;
}

interface Shared {
  app: PIXI.Application;
  canvas: HTMLCanvasElement;
  stage: PIXI.Container;
  slots: Slot[];
}

let shared: Shared | null = null;
let booting: Promise<Shared> | null = null;

// One WHITE texture at the card's real size, tinted per card.
//
// The size matters and I got it wrong first: the tone was baked into an 8x8
// texture and then scaled by norm (340/600), which presupposes a 600px texture.
// A Pixi sprite takes its size FROM its texture, so the cards came out 4.5px
// across and 148 of the 271 thumbnails rendered empty. Drawing white at the
// card size and tinting is also what the stage renderer does for placeholders,
// so the mask coordinates below line up with it.
const whiteCache = new Map<string, PIXI.Texture>();

function whiteTexture(app: PIXI.Application, w: number, h: number): PIXI.Texture {
  const key = `${Math.round(w)}x${Math.round(h)}`;
  const hit = whiteCache.get(key);
  if (hit) return hit;
  const g = new PIXI.Graphics();
  g.rect(0, 0, Math.round(w), Math.round(h)).fill(0xffffff);
  const tex = app.renderer.generateTexture(g);
  whiteCache.set(key, tex);
  return tex;
}

// Neutral greys, one per card index. Walked by the golden ratio so NEIGHBOURING
// cards differ — a plain ramp gives adjacent cards near-identical values and a
// stack of them reads as one blob. No photographs: at 180px they are noise
// competing with the geometry.
const TONE_COUNT = 12;

function toneColor(index: number): number {
  const t = (index * 0.6180339887) % 1;
  const level = Math.round((0.42 + t * 0.46) * 255);
  return (level << 16) | (level << 8) | level;
}

/** The shared Application. Async because Pixi 8 initialises asynchronously. */
export async function getShared2d(): Promise<Shared> {
  if (shared) return shared;
  if (booting) return booting;

  booting = (async () => {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';

    const app = new PIXI.Application();
    await app.init({
      canvas,
      width: THUMB_W,
      height: THUMB_H,
      backgroundAlpha: 0,
      antialias: true,
      autoStart: false,          // drawn on demand, never on a ticker
      preference: 'webgl',
      powerPreference: 'high-performance',
      resolution: 1,
      // Needed to read the canvas back for the idle still.
      preserveDrawingBuffer: true,
    });

    const stage = new PIXI.Container();
    stage.sortableChildren = true;
    // The preview space is 810x1080 and the canvas is 180x240 — one uniform
    // scale, applied once here, so every pose below stays in preview pixels and
    // reads the same as it does on the stage.
    stage.scale.set(THUMB_W / CTX_BASE.width);
    stage.position.set(THUMB_W / 2, THUMB_H / 2);
    app.stage.addChild(stage);

    shared = {
      app, canvas, stage,
      slots: [],
    };
    return shared;
  })();

  return booting;
}

function ensureSlots(ctx: Shared, count: number) {
  while (ctx.slots.length < count) {
    const sprite = new PIXI.Sprite();
    sprite.anchor.set(0.5);
    const mask = new PIXI.Graphics();
    sprite.addChild(mask);
    ctx.stage.addChild(sprite);
    ctx.slots.push({ sprite, mask, tapered: false, maskKey: '', taperKey: '' });
  }
  for (let i = 0; i < ctx.slots.length; i++) {
    const visible = i < count;
    ctx.slots[i].sprite.visible = visible && !ctx.slots[i].tapered;
    if (ctx.slots[i].mesh) ctx.slots[i].mesh!.visible = visible && ctx.slots[i].tapered;
  }
}

// The card's four corners with `edge` shortened to `ratio` of its opposite,
// clockwise from top-left — the order PerspectiveMesh takes. Same construction
// the stage renderer uses, so a tapered card reads identically.
function taperCorners(w: number, h: number, taper: NonNullable<LayerTransform['taper']>) {
  const r = Math.max(0.02, Math.min(1, taper.ratio));
  const hw = w / 2, hh = h / 2;
  const ix = hw * (1 - r), iy = hh * (1 - r);
  switch (taper.edge) {
    case 'top':    return [-hw + ix, -hh, hw - ix, -hh, hw, hh, -hw, hh];
    case 'bottom': return [-hw, -hh, hw, -hh, hw - ix, hh, -hw + ix, hh];
    case 'left':   return [-hw, -hh + iy, hw, -hh, hw, hh, -hw, hh - iy];
    default:       return [-hw, -hh, hw, -hh + iy, hw, hh - iy, -hw, hh]; // 'right'
  }
}

function scaleTint(tint: number, k: number): number {
  const r = Math.round(((tint >> 16) & 0xff) * k);
  const g = Math.round(((tint >> 8) & 0xff) * k);
  const b = Math.round((tint & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

// Corner radius plus the wipe band, as the stage draws them: the radius applies
// to the visible BAND, so a half-revealed card does not round the wipe edge.
function applyMask(slot: Slot, node: PIXI.Container, w: number, h: number, radiusPct: number, clip?: LayerTransform['clip']) {
  const frac = clamp(radiusPct / 100, 0, 1);
  const c = clip
    ? { x0: clamp(clip.x0, 0, 1), y0: clamp(clip.y0, 0, 1), x1: clamp(clip.x1, 0, 1), y1: clamp(clip.y1, 0, 1) }
    : null;
  const partial = !!c && (c.x0 > 0 || c.y0 > 0 || c.x1 < 1 || c.y1 < 1);
  const key = partial ? `${frac}|${c!.x0}|${c!.y0}|${c!.x1}|${c!.y1}|${w}x${h}` : `${frac}|${w}x${h}`;
  if (slot.maskKey === key) return;
  slot.maskKey = key;

  if (frac === 0 && !partial) {
    node.mask = null;
    slot.mask.visible = false;
    slot.mask.clear();
    return;
  }
  node.mask = slot.mask;
  slot.mask.visible = true;
  slot.mask.clear();
  if (!partial) {
    slot.mask.roundRect(-w / 2, -h / 2, w, h, (Math.min(w, h) / 2) * frac).fill(0xffffff);
    return;
  }
  const bx = -w / 2 + c!.x0 * w, by = -h / 2 + c!.y0 * h;
  const bw = Math.max(0, (c!.x1 - c!.x0) * w), bh = Math.max(0, (c!.y1 - c!.y0) * h);
  if (bw <= 0 || bh <= 0) { slot.mask.rect(0, 0, 0, 0).fill(0xffffff); return; }
  const r = Math.min((Math.min(w, h) / 2) * frac, Math.min(bw, bh) / 2);
  slot.mask.roundRect(bx, by, bw, bh, r).fill(0xffffff);
}

/** Pose the shared 2D scene for this preset at this frame and draw it. */
export function renderThumbFrame2d(ctx: Shared, template: Template, frame: number): void {
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
  // clamping it here would lay out a different grid than the stage.
  const count = layerCountFor(template.meta.id, v,
    { width: CTX_BASE.width, height: CTX_BASE.height, cardAspect: texAspect });

  const poses: { t: LayerTransform; i: number }[] = [];
  for (let i = 0; i < count; i++) {
    try { poses.push({ t: template.transform(frame, i, count, v, tctx), i }); } catch { /* skip */ }
  }
  // Keep the visible, on-canvas ones when over budget.
  const drawn = poses.length <= DRAW_BUDGET
    ? poses
    : poses
      .slice()
      .sort((a, b) => (a.t.alpha < 0.02 ? 1 : 0) - (b.t.alpha < 0.02 ? 1 : 0)
        || Math.hypot(a.t.x, a.t.y) - Math.hypot(b.t.x, b.t.y))
      .slice(0, DRAW_BUDGET)
      .sort((a, b) => a.i - b.i);

  ensureSlots(ctx, drawn.length);
  const radius = Number(v.cornerRadius ?? 0);

  drawn.forEach(({ t, i }, slotIndex) => {
    const slot = ctx.slots[slotIndex];
    const taper = t.taper && t.taper.ratio < 0.999 ? t.taper : null;

    // Projective path, built lazily: a catalogue where almost nothing tapers
    // pays nothing for it.
    if (taper && !slot.mesh) {
      const mesh = new PIXI.PerspectiveMesh({
        texture: slot.sprite.texture,
        verticesX: 10, verticesY: 10,
        x0: 0, y0: 0, x1: 1, y1: 0, x2: 1, y2: 1, x3: 0, y3: 1,
      });
      const mm = new PIXI.Graphics();
      mesh.addChild(mm);
      slot.mesh = mesh;
      slot.meshMask = mm;
      ctx.stage.addChild(mesh);
    }
    const node: PIXI.Container = taper ? slot.mesh! : slot.sprite;
    if (slot.tapered !== !!taper) {
      slot.tapered = !!taper;
      slot.maskKey = '';
      slot.sprite.visible = !taper;
      if (slot.mesh) slot.mesh.visible = !!taper;
    }
    if (taper && slot.mesh) {
      const key = `${taper.edge}|${taper.ratio.toFixed(4)}`;
      if (slot.taperKey !== key) {
        slot.taperKey = key;
        const c = taperCorners(texW, texH, taper);
        slot.mesh.setCorners(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
      }
    }

    node.position.set(t.x, t.y);
    node.scale.set(
      norm * t.scale * (t.scaleX ?? 1),
      norm * t.scale * (t.scaleY ?? 1),
    );
    node.rotation = t.rotation;
    node.alpha = t.alpha;
    // `dim` darkens toward black rather than going see-through, so a receding
    // card occludes what is behind it instead of ghosting it.
    const dim = clamp(t.dim ?? 0, 0, 1);
    const white = whiteTexture(ctx.app, texW, texH);
    if (!taper) slot.sprite.texture = white;
    else if (slot.mesh) slot.mesh.texture = white;
    // The card's own grey, darkened by  — which darkens rather than fading,
    // so a receding card still occludes what is behind it.
    (node as PIXI.Sprite).tint = scaleTint(toneColor((template.mediaIndex?.(i, count, v, tctx) ?? i) % TONE_COUNT), 1 - dim);
    if ('skew' in node) (node as PIXI.Sprite).skew.set(t.skewX ?? 0, t.skewY ?? 0);
    node.zIndex = Math.round(t.depth * 1000 + (template.mediaIndex?.(i, count, v, tctx) ?? i));
    applyMask(slot, node, texW, texH, radius, taper ? undefined : t.clip);
  });

  ctx.app.renderer.render(ctx.app.stage);
}

/** Draw one frame and read it back as a still, for the idle thumbnail. */
export async function snapshotThumb2d(template: Template, frame: number): Promise<string | null> {
  const ctx = await getShared2d();
  // Initialising Pixi is asynchronous. A hover may have claimed the canvas
  // while that await was in flight, so wait again immediately before drawing.
  await waitForThumbQueue();
  renderThumbFrame2d(ctx, template, frame);
  return stillFrom(ctx.canvas, THUMB_W, THUMB_H);
}

export async function attachCanvas2d(host: HTMLElement) {
  const ctx = await getShared2d();
  if (ctx.canvas.parentElement !== host) host.appendChild(ctx.canvas);
  return ctx;
}

export function detachCanvas2d() {
  if (shared?.canvas.parentElement) shared.canvas.parentElement.removeChild(shared.canvas);
}

// ---- ciclo de vida do contexto ----
//
// UMA Application, criada na primeira miniatura e mantida pela vida da pagina.
// O porque completo esta em `three3d/thumbScene.ts`, e vale igual aqui: `refs`
// passa por zero em toda troca de grupo do acordeao, e destruir a Application
// ali derruba o contexto uma vez por troca. O Chrome soma perdas causadas pela
// pagina e depois recusa criar contexto — "Web page caused context loss and was
// blocked". Aqui o `destroy(true)` nao chama loseContext explicitamente, mas
// derruba o contexto do mesmo jeito, entao o ciclo tinha de sair dos dois lados:
// consertar so um deixa a troca de grupo derrubando contexto pelo outro.
//
// Com o singleton mantido, a pagina fica em tres contextos (palco, miniatura 2D,
// miniatura 3D) — medido — contra o limite de ~16 do navegador.
//
// A contagem de referencias fica porque a ultima miniatura a sair ainda solta o
// canvas de onde ele estava. Adiada, para nao fazer isso a cada troca de grupo.
const CARENCIA_MS = 10_000;
let refs = 0;
let agendado: ReturnType<typeof setTimeout> | null = null;

function cancelarLimpeza2d() {
  if (agendado === null) return;
  clearTimeout(agendado);
  agendado = null;
}

export function retainThumb2d(): () => void {
  refs++;
  cancelarLimpeza2d();
  let solto = false;
  return () => {
    if (solto) return;
    solto = true;
    refs = Math.max(0, refs - 1);
    if (refs > 0) return;
    cancelarLimpeza2d();
    agendado = setTimeout(() => {
      agendado = null;
      if (refs === 0) limparShared2d();
    }, CARENCIA_MS);
  };
}

// Limpeza, nao destruicao: a Application, o contexto e o cache de texturas
// brancas ficam. O cache e limitado (uma entrada por tamanho de card), entao
// nao ha o que crescer.
function limparShared2d() {
  if (!shared) return;
  try {
    detachCanvas2d();
  } catch { /* nada aqui e essencial: falhar em limpar nao pode quebrar a pagina */ }
}
