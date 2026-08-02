import type { Template } from '@/lib/types';
import { TAU, clamp, loopCycles, smooth, stepHold } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// Corner bleed. The derived apothem makes adjacent faces meet EXACTLY at the
// prism's edge — geometrically ideal, visually wrong: the shared edge is a line
// where two antialiased, transparent planes blend, so the background leaks
// through it and every corner reads as a seam. (The renderer's planes are
// `transparent: true, depthWrite: false`, so there is no depth-buffer occlusion
// to close the join.) Pulling the faces in by a fraction of a percent makes
// their edges cross instead of touch, and the overlap hides the seam. This is a
// rendering necessity, not a design choice, so it is not a user control.
const CORNER_BLEED = 0.997;
const BOX_ASPECT = 350 / 250;

// Positive modulo — `%` keeps the sign of the dividend, and `turns` goes negative
// when the prism spins in reverse.
const mod = (a: number, n: number) => ((a % n) + n) % n;

// A prism has `faces` sides but can carry more images than that, so each face
// hands its slot over to the next image while it is turned away.
//
// Ownership runs face → image, not image → face. Face p in its generation g
// shows image (g·F + p) mod N. Deriving it the other way — pinning image i to
// face i % F — leaves holes: with 10 images on 4 faces the last generation only
// has 2 images, so two faces would draw nothing and the prism would show gaps.
//
// `gens` is N / gcd(N, F), the smallest number of generations after which
// g·F ≡ 0 (mod N). That is what closes the loop: after that many turns every
// face is back on its starting image. It also guarantees full coverage — as g
// runs over one period, (g·F + p) reaches every image.
function prismGeo(count: number, v: Record<string, any>) {
  const faces = clamp(Math.round(v.faces ?? 4), 3, 12);
  const images = Math.max(faces, Math.round(count));
  return { faces, images };
}

function carouselFace(index: number, travel: number, geo: { faces: number; images: number }) {
  const step = Math.floor(travel);
  const progress = travel - step;
  let relative = mod(index - mod(step, geo.images), geo.images);
  if (relative > geo.images / 2) relative -= geo.images;
  const low = -Math.floor((geo.faces - 1) / 2);
  const high = Math.ceil((geo.faces - 1) / 2);
  return {
    theta: (relative - progress) * TAU / geo.faces,
    active: relative >= low && relative <= high,
  };
}

// Which face this slot occupies right now, or -1 when another image owns every
// face this frame.
//
// Each face keeps its OWN generation counter. Face p's angle is θ = TAU·u with
// u = turns + p/faces, so u is that face's rotation measured in whole turns, and
// floor(u + 0.5) increments exactly when frac(u) crosses 0.5 — the instant the
// face points straight away from the camera. Every handover therefore happens
// out of sight, and faces swap at their own moment rather than all at once.
// ============================================================
//  BOX — a real 3D prism, one image per face
//
//  This is a `webgl` template: `transform3d` places each face as an actual plane
//  in 3D space and the Three.js renderer views it through a perspective camera,
//  so the turn has genuine keystone — the receding edge of a face is shorter
//  than the near one.
//
//  That distinction is why the first version of this family was wrong.
//  LayerTransform (the Pixi seam) offers x, y, scale, rotation, skew and
//  scaleX/scaleY. Every one of those is AFFINE, and affine transforms map
//  parallel lines to parallel lines. Perspective is PROJECTIVE. No combination
//  of squash and shear can produce a keystone, so a sprite-only box can never
//  read as solid — it reads as flat panels sliding past each other, however the
//  numbers are tuned.
//
//  Geometry. Faces sit around a regular N-gon: face i's outward normal points
//  along θ = φ + i·(2π/N) and its centre sits `apothem` out along that normal.
//  A PlaneGeometry faces +Z, so rotationY = θ aims its normal along θ — position
//  and orientation agree, and the prism is closed.
//
//  The apothem is derived, not free. Adjacent faces meet exactly when the gap
//  between their centres equals the sum of their half-widths, which solves to
//  cardSize / (2·tan(π/N)). Any other value gaps or overlaps.
//
//  The prism is then pushed BACK by one apothem, so the front face lands on
//  z = 0 instead of the prism's centre. This is the CSS box's
//  `translateZ(-depth/2)`: there the box container is shifted back by half its
//  depth precisely so the front face sits in the container's own plane. It
//  matters here because renderer3d parks the camera at
//  D = (height/2)/tan(fov/2), which makes z = 0 the plane of exact preview-pixel
//  scale. Centring the prism instead leaves the front face an apothem closer to
//  the lens, so it renders magnified by D/(D−apothem) — 1.22× at the defaults,
//  and 3.1× at 12 faces, where the apothem outgrows the face itself. Anchored,
//  `Face Width` means the pixel width you actually get, and Faces/Girth change
//  the depth of the box behind that face rather than its size on screen.
//
//  `cardAspect: 1` because that apothem depends on the face dimension
//  perpendicular to the spin axis — width for a vertical axis, height for a
//  horizontal one. With the 4:5 default those differ and one axis would always
//  leave the prism open.
// ============================================================

const box: Template = {
  meta: {
    id: 'box-01', name: 'Box 01', group: 'Box', isNew: true,
    // The reference component snaps each quarter turn with a spring of
    // stiffness 200 / damping 30 — ζ ≈ 1.06, so it is very slightly overdamped
    // and never overshoots. That is an ease-OUT, not the symmetric ease-in-out
    // `smooth` was giving; cubicOut is the closest curve in the house set
    // (within ~0.04 of the spring's normalized response across the step).
    cardAspect: BOX_ASPECT, engine: 'webgl', catalog3d: true, defaultEasing: { id: 'cubicOut' },
  },

  controls: [
    { key: 'axis',         label: 'Spin Axis',     type: 'pills',  options: ['vertical','horizontal'], default: 'vertical' },
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    // `count` is how many IMAGES ride the prism; `faces` is how many sides it
    // has. More images than faces is the point: each face hands its slot over to
    // the next image while it is turned away.
    { key: 'count',        label: 'Images',        type: 'slider', min: 4, max: 24, step: 1,     default: 7 },
    { key: 'faces',        label: 'Faces',         type: 'slider', min: 3, max: 12, step: 1,     default: 4 },
    { key: 'cardSize',     label: 'Face Width',    type: 'slider', min: 80, max: 600, step: 1,   default: 350 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,    default: 0 },
    { key: 'girth',        label: 'Girth',         type: 'slider', min: 0.5, max: 2, step: 0.05, default: 1 }, // ×apothem: <1 squeezes, >1 opens the prism
    // Not the house 0–200 lens control — this is the CSS `perspective` distance
    // in px, the same number and the same default the reference component takes
    // (`CSSBox` ships 600; the carousel example passes 800). See `camera` below.
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 200, max: 2400, step: 10, default: 600 },
    { key: 'shade',        label: 'Edge Shade',    type: 'slider', min: 0, max: 100, step: 1,    default: 12 }, // dims faces as they turn away
    { key: 'hold',         label: 'Hold',          type: 'slider', min: 0, max: 85, step: 1,     default: 42 },
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: -45, max: 45, step: 1,   default: 0 },  // rolls the whole prism in the view plane
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                default: { x: 0, y: 0 } },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.1,    default: 0.8 }, // face steps/sec
  ],

  // ---- Camera. This is what makes the box read as a box. ----
  //
  // CSS `perspective: Npx` on a wrapper puts the viewer exactly N px in front of
  // the element plane and projects with the factor N/(N−z). A Three perspective
  // camera does the same thing when it sits at z = N AND its fov subtends the
  // canvas at that distance — fov = 2·atan((height/2)/N). Deriving both from one
  // number is what makes `Perspective` here mean what it means in the reference
  // component, and it keeps z = 0 at exact preview-pixel scale, which the
  // front-face anchor above depends on.
  //
  // Without this the house 0–200 control ran the show, and its distance is a
  // function of the CANVAS, not the box: `D = (height/2)/tan(fov/2)`. On a
  // 1080-tall stage the old default landed at D = 954 px against a 350 px face —
  // a 2.7× lens. The reference is 600 px against a 400 px face, 1.5×. That gap
  // is the whole complaint: at 2.7× the keystone is so shallow the box reads as
  // two hinged flat panels, and no amount of correct geometry fixes it, because
  // the geometry was never what was wrong.
  camera: (v, ctx) => {
    const p = clamp(Number(v.perspective) || 600, 200, 2400);
    return {
      position: { x: 0, y: 0, z: p },
      target: { x: 0, y: 0, z: 0 },
      fov: (2 * Math.atan((ctx.height / 2) / p) * 180) / Math.PI,
    };
  },

  // ---- Real 3D pose. y is canvas-down; the renderer flips it. ----
  transform3d: (frame, index, count, v, ctx) => {
    const vertical = v.axis === 'vertical';
    const dir = v.direction === 'reverse' ? -1 : 1;

    const geo = prismGeo(count, v);

    const rawSteps = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, geo.images);
    const travel = stepHold(rawSteps, v.hold / 100, ctx.ease) * dir;
    const face = carouselFace(index, travel, geo);
    const theta = face.theta;
    const crossSize = vertical ? v.cardSize : v.cardSize / BOX_ASPECT;
    const apothem = (crossSize / (2 * Math.tan(Math.PI / geo.faces))) * v.girth * CORNER_BLEED;

    // Face centre on the prism surface, plus the orientation that aims its
    // normal outward. A plane's normal starts at +Z.
    let px: number, py: number, pz: number;
    let rotX = 0, rotY = 0;
    if (vertical) {
      px = Math.sin(theta) * apothem;
      py = 0;
      pz = Math.cos(theta) * apothem;
      rotY = theta;                       // normal → (sin θ, 0, cos θ)
    } else {
      px = 0;
      py = Math.sin(theta) * apothem;     // world-up offset
      pz = Math.cos(theta) * apothem;
      rotX = -theta;                      // normal → (0, sin θ, cos θ)
    }

    // Tilt rolls the whole prism in the view plane: the face centres rotate
    // about Z and each face takes the matching roll, so the drum leans as one
    // rigid body instead of the faces shearing off its surface.
    const roll = (v.tilt * Math.PI) / 180;
    if (roll !== 0) {
      const c = Math.cos(roll), s = Math.sin(roll);
      const rx = px * c - py * s;
      const ry = px * s + py * c;
      px = rx; py = ry;
    }

    // The material is DoubleSide, so nothing is back-face culled for us. A face
    // whose normal points away is on the far side of a CLOSED prism and must be
    // hidden, or the back of the drum shows through the front.
    const facing = smooth(clamp(Math.cos(theta) / 0.12, 0, 1));
    // Faces turning away also darken — the drum has no real lighting.
    const shaded = 1 - (v.shade / 100) * (1 - Math.max(0, Math.cos(theta)));
    const mine = face.active ? 1 : 0;

    return {
      x: px + v.offset.x,
      // The renderer negates y (canvas-down → three y-up), so a world-up offset
      // is handed over negated.
      y: -py + v.offset.y,
      // `translateZ(-depth/2)`. The roll above turns the prism about Z, which
      // leaves Z alone, so the shift is a plain world-space subtraction here.
      z: pz - apothem,
      rotationX: rotX,
      rotationY: rotY,
      rotationZ: roll,
      scale: v.cardSize / BASE,
      alpha: clamp(facing * shaded * mine, 0, 1),
      // The prism itself supplies the volume. Giving every face a separate
      // thick rounded body creates doubled corners and visible gaps.
      thickness: 0,
      shadowStrength: 0,
      materialExposure: shaded,
    };
  },

  // ---- Cheap 2D projection, for thumbnails and the non-webgl fallback. ----
  // Orthographic on purpose: it cannot express keystone, so it does not pretend
  // to. Scale is held constant across faces so the derived apothem still tiles
  // them exactly — an earlier version scaled faces by depth here, which changed
  // their width and reopened the prism the apothem exists to close.
  transform: (frame, index, count, v, ctx) => {
    const vertical = v.axis === 'vertical';
    const dir = v.direction === 'reverse' ? -1 : 1;

    const geo = prismGeo(count, v);
    const rawSteps = (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, geo.images);
    const travel = stepHold(rawSteps, v.hold / 100, ctx.ease) * dir;
    const face = carouselFace(index, travel, geo);
    const theta = face.theta;

    const cosT = Math.cos(theta);
    const crossSize = vertical ? v.cardSize : v.cardSize / BOX_ASPECT;
    const apothem = (crossSize / (2 * Math.tan(Math.PI / geo.faces))) * v.girth * CORNER_BLEED;
    const along = Math.sin(theta) * apothem;

    const facing = smooth(clamp(cosT / 0.12, 0, 1));
    const shaded = 1 - (v.shade / 100) * (1 - Math.max(0, cosT));
    const squash = Math.abs(cosT);
    const mine = face.active ? 1 : 0;

    return {
      x: (vertical ? along : 0) + v.offset.x,
      y: (vertical ? 0 : along) + v.offset.y,
      scale: v.cardSize / BASE,
      rotation: (v.tilt * Math.PI) / 180,
      alpha: clamp(facing * shaded * mine, 0, 1),
      scaleX: vertical ? squash : 1,
      scaleY: vertical ? 1 : squash,
      depth: cosT * apothem,
    };
  },
};

export const boxVariants: Template[] = [
  box,
  // Perspective is a px distance now, so each variant carries its own — the
  // number that matters is the ratio to the face, and the reference sits at
  // 1.5–2×. 520/300 = 1.7 here.
  variant(box, 'box-02', 'Box Tumble', {
    axis: 'horizontal', count: 4, faces: 4, cardSize: 300, perspective: 520, shade: 50, speed: 0.3,
  }),
  // A wide drum: every image gets its own side, so there is no handover at all.
  // Eight faces make the solid much deeper than it is wide, so this one takes a
  // longer lens (480/200 = 2.4) — at 1.5× the far side of the drum smears.
  variant(box, 'box-03', 'Box Drum', {
    count: 8, faces: 8, cardSize: 200, girth: 1.1, perspective: 480, shade: 45, tilt: -10, speed: 0.45,
  }),
];
