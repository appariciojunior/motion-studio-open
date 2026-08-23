import type { Template } from '@/lib/types';
import { clamp } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;
const DEG = Math.PI / 180;

// ============================================================
//  MAGAZINE — an open book whose sheets turn one after another
//
//  A genuinely new family here: nothing in the catalogue turns a page. The
//  reference's own numbers, read out of its renderer rather than measured:
//
//  · Sheets hinge on a spine at the frame's centre. Sheet 0 always rests open
//    to the left and the last one always rests to the right, so the book reads
//    as a spread rather than a stack, and the ones between it turn through
//    180 degrees in index order, `stagger` seconds apart.
//  · Once they have all turned, the book closes again the same way, back to
//    front, so the loop is a full read-through and a rewind.
//  · A turning sheet bows. Its sag is `restCurve` while flat plus
//    `curveAmount * sin(turn)`, all of it scaled by `cos(turn)` — so the bow
//    peaks around 45 degrees and vanishes at both ends. In stage units that is
//    a share of the sheet's own width, which is exactly what LayerTransform3D's
//    `bend` takes.
//  · The camera is not a free choice: the reference projects through
//    `1000 / perspective` and then pushes the book back by `distance`, which
//    together are a fov and a dolly. `camera()` restates them as such, so a
//    preset's authored 70/2000 lands on the same framing here.
//
//  Three arrangements ship on that one mechanic, and they are the reference's
//  own three scenes rather than a slider it exposes:
//
//    spread — opens mid-book, both stacks visible from the first frame.
//    cover  — starts closed on the front cover, opens, reads, closes.
//    full   — the same, but every sheet turns, including the covers, and the
//             book recentres itself as it opens so it never drifts off frame.
//
//  Two sheets, two images. A sheet has a front and a back and they are
//  different pages, which no single card can be: the pose carries one texture.
//  So each sheet is TWO layers at the same place, the back one turned a further
//  180 degrees about the spine axis so its own front faces the other way, and
//  each shows whichever is pointing at the camera. That is also why the layer
//  count is twice the sheet count, and why the bow flips sign on the back —
//  the same physical curve, stated from the other side.
//
//  Not carried over: the reference shades each mesh vertex against a fixed
//  light and paints a gradient per quad. A pose cannot say that — it gets one
//  `dim` for the whole sheet — so the shading here is the sheet's own flat
//  normal against the same light vector. The bow's own highlight is lost; the
//  page darkening as it swings edge-on, which is what the eye reads, is not.
// ============================================================

/** The reference's stage width. Its perspective constants live in this space. */
const REF_W = 1080;
/** Its per-sheet z separation, in stage px. Small: this is stacking, not depth. */
const SHEET_Z = 0.5;
/** The light it shades against, already normalized. */
const LIGHT: [number, number, number] = [0.25 / 1.0, -0.4 / 1.0, 0.88 / 1.0];

type Schedule = { flip: number; stagger: number; closeStagger: number; closeAt: number; sheets: number };

/** Turn timings, which the reference squeezes to fit whichever clip it is given. */
function schedule(v: Record<string, any>, n: number, clip: number): Schedule {
  const cover = v.style !== 'spread';
  const full = v.style === 'full';
  const pause = cover ? clamp(v.coverPause, 0, clip * 0.9) : 0;
  const span = Math.max(0.5, clip - pause);
  const sheets = full ? n : cover ? Math.max(0, n - 1) : Math.max(0, n - 2);
  const rest = full ? Math.min(0.5, span * 0.07) : cover ? Math.min(1, span * 0.15) : 0;

  if (full) {
    const closeStagger = 0.14;
    const others = Math.max(0, sheets - 1);
    const flip = Math.max(0.1, Math.min(v.flipDuration, (span - rest - others * closeStagger) / 2));
    const openEnd = Math.max(flip, span - rest - (others * closeStagger + flip));
    return {
      flip,
      stagger: others > 0 ? (openEnd - flip) / others : 0,
      closeStagger,
      closeAt: openEnd + rest,
      sheets,
    };
  }

  const usable = span - rest;
  const wanted = (Math.max(0, sheets - 1) * v.stagger + v.flipDuration) * 2;
  // The reference never lets the open-and-close cycle overrun the clip: it
  // scales flip and stagger together until it fits.
  const squeeze = wanted > usable * 0.95 ? (usable * 0.95) / wanted : 1;
  const flip = v.flipDuration * squeeze;
  const stagger = v.stagger * squeeze;
  const openEnd = Math.max(0, sheets - 1) * stagger + flip;
  const dwell = Math.max(0.05 * span, span - openEnd * 2);
  return {
    flip,
    stagger,
    closeStagger: cover ? 0.14 : stagger,
    closeAt: cover ? openEnd + rest : openEnd + dwell * 0.4,
    sheets,
  };
}

/** How far sheet `i` has turned at clip time `t`, in degrees, 0 = shut right. */
function sheetTurn(
  i: number, n: number, t: number, s: Schedule,
  v: Record<string, any>, ease: (x: number) => number,
): number {
  const cover = v.style !== 'spread';
  const full = v.style === 'full';

  let slot: number;
  if (cover) {
    // The back cover only turns in `full`; otherwise it is the thing the book
    // rests on.
    if (!full && i === n - 1) return 0;
    slot = i;
  } else {
    if (i === 0) return 180;        // already turned, resting left
    if (i === n - 1) return 0;      // never turns, resting right
    slot = i - 1;
  }

  const openAt = slot * s.stagger;
  const openEnd = openAt + s.flip;
  const shutAt = s.closeAt + (s.sheets - 1 - slot) * s.closeStagger;
  const shutEnd = shutAt + s.flip;

  if (t < openAt) return 0;
  if (t < openEnd) return ease(clamp((t - openAt) / Math.max(1e-4, s.flip), 0, 1)) * 180;
  if (t < shutAt) return 180;
  if (t < shutEnd) return 180 - ease(clamp((t - shutAt) / Math.max(1e-4, s.flip), 0, 1)) * 180;
  return 0;
}

/** Where sheet `i` sits in the stack, in reference px along z. */
function sheetStack(i: number, n: number, turn: number, cover: boolean): number {
  const lift = Math.sin(turn * DEG) * (n + 2) * SHEET_Z;
  if (cover) {
    if (i === n - 1) return -(n - 1) * SHEET_Z;
    return turn >= 90 ? -(n - 1 - i) * SHEET_Z + lift : -i * SHEET_Z + lift;
  }
  if (i === 0 || i === n - 1) return -(n - 1) * SHEET_Z;
  return turn >= 90 ? -(n - 1 - i) * SHEET_Z + lift : -(i - 1) * SHEET_Z + lift;
}

const magazine: Template = {
  meta: {
    id: 'magazine-01',
    name: 'Magazine 01',
    group: 'Magazine',
    engine: 'webgl',
    isNew: true,
    // The reference's own curve on this family: a slow start, a quick middle
    // and a settle — a page falling rather than sliding.
    defaultEasing: { id: 'custom', bezier: [0.333, 0, 0.571, 1] },
    cardAspect: 3 / 4,
    repeatAssets: true,
  },

  controls: [
    { key: 'style',          label: 'Arrangement',   type: 'pills',  options: ['spread','cover','full'], default: 'spread', section: 'Layout', description: 'spread opens mid-book; cover starts shut; full turns the covers too.' },
    { key: 'count',          label: 'Sheets',        type: 'slider', min: 3, max: 20, step: 1,      default: 6, section: 'Layout' },
    { key: 'pageSize',       label: 'Page Size',     type: 'slider', min: 10, max: 200, step: 1,    default: 90, unit: '%', section: 'Layout', description: 'Sheet height as a share of the frame.' },
    { key: 'curveAmount',    label: 'Turn Curve',    type: 'slider', min: 0, max: 30, step: 1,      default: 15, unit: '%', section: 'Layout', description: 'How far a sheet bows while it is turning.' },
    { key: 'restCurve',      label: 'Rest Curve',    type: 'slider', min: 0, max: 15, step: 1,      default: 4, unit: '%', section: 'Layout', description: 'The bow a sheet keeps when it is lying flat.' },
    { key: 'flipDuration',   label: 'Turn Time',     type: 'slider', min: 0.3, max: 8, step: 0.1,   default: 2, unit: 's', precision: 1, section: 'Motion', description: 'Seconds one sheet takes to go over.' },
    { key: 'stagger',        label: 'Stagger',       type: 'slider', min: 0, max: 3, step: 0.02,    default: 0.72, unit: 's', precision: 2, section: 'Motion', description: 'Gap between one sheet starting and the next.' },
    { key: 'coverPause',     label: 'Cover Pause',   type: 'slider', min: 0, max: 15, step: 0.1,    default: 0.5, unit: 's', precision: 1, section: 'Motion', visibleWhen: { key: 'style', not: 'spread' }, description: 'Beat the shut book holds before it opens.' },
    { key: 'perspective',    label: 'Perspective',   type: 'slider', min: 10, max: 300, step: 5,    default: 70, section: 'Depth', description: 'Lens: lower is wider and bends the turn harder.' },
    { key: 'distance',       label: 'Distance',      type: 'slider', min: -3000, max: 3000, step: 50, default: 2000, section: 'Depth', description: 'Dolly the book away from the lens.' },
    { key: 'lightIntensity', label: 'Light',         type: 'slider', min: 0, max: 200, step: 5,     default: 100, unit: '%', section: 'Finish' },
    { key: 'lightAmbient',   label: 'Ambient',       type: 'slider', min: 0, max: 100, step: 1,     default: 51, unit: '%', section: 'Finish', description: 'Floor under the shading, so a sheet edge-on never goes black.' },
    { key: 'offset',         label: 'Offset',        type: 'xypad',                                 default: { x: 0, y: 0 } },
  ],

  // Two layers per sheet: the page you are reading and the one on its back.
  layerCount: (v) => 2 * clamp(Math.round(v.count ?? 6), 3, 20),

  transform: (frame, index, count, v, ctx) => {
    const p = pose(frame, index, v, ctx);
    // The 2D fallback (thumbnails, the pixi path) gets the same pose flattened:
    // the turn becomes a horizontal squash about the spine, which is what a
    // page turn looks like once the bow and the depth are gone.
    return {
      x: p.x,
      y: p.y,
      scale: p.scale,
      rotation: 0,
      alpha: p.alpha,
      scaleX: Math.abs(Math.cos(p.turn * DEG)),
      dim: p.dim,
      depth: p.depth,
    };
  },

  transform3d: (frame, index, count, v, ctx) => {
    const p = pose(frame, index, v, ctx);
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      rotationY: p.rotY,
      bend: p.bend,
      dim: p.dim,
      scale: p.scale,
      alpha: p.alpha,
    };
  },

  camera: (v, ctx) => {
    const k = ctx.width / REF_W;
    const lens = Math.max(1e-3, (1e5 / Math.max(10, v.perspective)) * k);
    const dolly = Math.max(lens * 0.05, lens + v.distance * k);
    return {
      // The reference projects with a fixed focal length and then dollies; a
      // fov that puts the fit distance exactly at its focal length is the same
      // statement, and then `distance` is a pure multiplier on top.
      fov: (2 * Math.atan((ctx.height / 2) / lens)) / DEG,
      distance: dolly / lens,
    };
  },
};

type Ctx = {
  width: number; height: number; duration: number; totalFrames: number;
  cardAspect?: number; ease: (t: number) => number;
};

/**
 * One sheet-face's pose, shared by the 2D and 3D paths. Everything below is in
 * SECONDS, because that is the unit the reference authors its turn timings in —
 * which is also why the clip length is pinned per preset in
 * store/useSceneStore: the same 2s turn is a different share of a 6s clip.
 */
function pose(frame: number, index: number, v: Record<string, any>, ctx: Ctx) {
  const n = clamp(Math.round(v.count), 3, 20);
  const sheet = Math.floor(index / 2);
  const isBack = index % 2 === 1;
  const cover = v.style !== 'spread';
  const full = v.style === 'full';

  const gone = (turn: number) =>
    ({ x: 0, y: 0, z: 0, rotY: 0, bend: 0, dim: 0, scale: 0, alpha: 0, depth: -1, turn });
  if (sheet >= n) return gone(0);

  const clip = Math.max(0.5, ctx.duration);
  const s = schedule(v, n, clip);
  const pause = cover ? clamp(v.coverPause, 0, clip * 0.9) : 0;
  const t = Math.max(0, (frame / ctx.totalFrames) % 1 * clip - pause);

  const turn = sheetTurn(sheet, n, t, s, v, ctx.ease);
  const cos = Math.cos(turn * DEG);
  const facingFront = cos >= 0;

  // Each face only exists while it is the one pointing at the camera.
  if (facingFront === isBack) return gone(turn);
  if (Math.abs(cos) < (cover ? 0.004 : 0.02)) return gone(turn);

  const aspect = Math.max(0.05, ctx.cardAspect ?? 3 / 4);
  const pageH = ctx.height * Math.max(0.01, v.pageSize / 100);
  const pageW = pageH * aspect;
  const k = ctx.width / REF_W;

  // Bow: rest curve while flat plus turn curve at the swing, the whole thing
  // folded down by cos so it is gone at both ends of the turn.
  const openness = cover ? Math.min(1, sheetTurn(0, n, t, s, v, ctx.ease) / 20) : 1;
  const sag = ((v.restCurve / 100) * openness + (v.curveAmount / 100) * Math.sin(turn * DEG)) * cos;

  // Where the spine sits. A book that starts shut has to walk sideways as it
  // opens or the spread ends up half off frame.
  const lens = Math.max(1e-3, (1e5 / Math.max(10, v.perspective)) * k);
  const dolly = Math.max(lens * 0.05, lens + v.distance * k);
  let spine = 0;
  if (cover) {
    const shrink = dolly > 1 ? Math.min(1.2, lens / dolly) : 1;
    const first = sheetTurn(0, n, t, s, v, ctx.ease);
    const last = full ? sheetTurn(n - 1, n, t, s, v, ctx.ease) : 0;
    const openFrac = full
      ? Math.max(0, Math.cos(first * DEG)) + Math.min(0, Math.cos(last * DEG))
      : 1 - Math.min(1, first / 90);
    spine = -(pageW * shrink / 2) * openFrac;
  }

  const sin = Math.sin(turn * DEG);
  const stackZ = sheetStack(sheet, n, turn, cover) * k;

  // Sheets are hinged AT the spine, so the card's centre swings on a half-width
  // radius rather than staying put.
  const cx = spine + cos * pageW / 2;
  const cz = sin * pageW / 2 + stackZ;

  // Flat-normal shading against the reference's own light.
  const nx = -sin, nz = cos;
  const ndotl = Math.max(0, nx * LIGHT[0] + nz * LIGHT[2]);
  const ambient = clamp(v.lightAmbient / 100, 0, 1);
  const shade = Math.min(1, ambient + (1 - ambient) * ndotl * Math.max(0, v.lightIntensity / 100));

  return {
    x: cx + v.offset.x,
    y: v.offset.y,
    z: cz,
    // The back face is the same sheet stated from behind: turned a further half
    // turn so its own front points the other way, with the bow flipped to match.
    rotY: -turn * DEG + (isBack ? Math.PI : 0),
    bend: clamp(isBack ? -sag : sag, -0.45, 0.45),
    dim: clamp(1 - shade, 0, 1),
    scale: pageH / BASE,
    alpha: 1,
    depth: cz,
    turn,
  };
}

// The reference's four page-turning presets, read live out of its own
// `paramsPerModeBaseline` on 2026-08-23. Its Magazine 03-07 are a different
// scene — a shut magazine with real thickness spinning in space — and are not
// part of this family. Clip lengths (10, 12, 10, 10s) are pinned in
// store/useSceneStore, since the whole read-and-rewind is one clip.
export const magazineVariants: Template[] = [
  magazine, // Magazine 01 — spread, 6 sheets, 2s turns, 0.72s apart
  variant(magazine, 'magazine-02', 'Magazine 02', {
    stagger: 1, flipDuration: 4,
  }, { id: 'custom', bezier: [0.33, 0, 0, 1] }),
  variant(magazine, 'magazine-03', 'Magazine 03', {
    style: 'cover', coverPause: 0.5,
  }),
  variant(magazine, 'magazine-04', 'Magazine 04', {
    style: 'full', coverPause: 0.5,
  }),
];
