import type { Template } from '@/lib/types';
import { clamp, loopCycles, stepHold } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;
const DEG = Math.PI / 180;

// ============================================================
//  REVOLVE — one full-frame image turning on the spot, handing the
//  frame to the next one every half turn
//
//  The reference calls this family Spin; the name is taken here by an
//  unrelated ellipse-orbit mechanic (templates/spin.ts, "Spin 01-03" inside
//  the Orbit group), so the family ships under its own name. That collision is
//  the reason to read the CONTROLS rather than the label: the reference's Spin
//  has no radius and no path — nothing orbits. A single card sits dead centre
//  and rotates about its own vertical or horizontal axis, and the image swaps
//  at the instant the card is edge-on, so a half turn is one hand-off.
//
//  Read out of the reference's own renderer rather than measured, so the
//  numbers below are its arithmetic, not a fit:
//
//  · A step is `duration / count` seconds long and turns exactly 180°. With
//    `count` cards the clip is one full pass of the pool, which is why the loop
//    closes on its own. Here that is `stepTime`, the unit the presets were
//    authored in (their four run 2, 1.75, 3 and 2.5 s per step).
//  · `delay` holds the card still at the start of each step and the turn
//    squeezes into what is left — a beat on each image, not a slower spin.
//  · Which image shows is floor((angle + 90) / 180): the swap happens while the
//    card is edge-on and invisible, so it is never seen.
//  · The card is the image at COVER size for the frame, times `imageScale`. At
//    100 it fills the frame; the presets sit at 60-65, so it reads as a plate
//    floating on the background.
//
//  The turn is projective, not a squash. A plane turned by θ about its centre
//  and seen from D away has its receding edge SHORTER than its near one —
//  D/(D ± sinθ·halfWidth) at the two edges — and no affine pose can say that
//  (scale, skew and rotation all keep opposite edges parallel and equal). So
//  the pose carries `taper`, which the renderer draws through a PerspectiveMesh;
//  the same route templates/flip.ts takes for its fold. The two edge factors
//  also magnify the near edge above 1, which is why `scaleY` can exceed 1 and
//  the card drifts off centre mid-turn — both are in the reference's projection
//  and dropping them makes the turn read as a windscreen wiper.
//
//  D itself comes from the reference's `perspective` slider as
//  D = longestCardEdge × (100 / perspective), so 50 is two card-lengths away
//  and 0 is orthographic. That is a strength dial, not a camera distance: it
//  gets SHORTER as the number goes up.
// ============================================================

/** Screen-space projection of one edge of a plane turned by θ about its centre. */
function edgeFactors(theta: number, halfExtent: number, camera: number) {
  const s = Math.sin(theta);
  // Guard the pole: at |θ| = 90° with the camera inside the swept radius the
  // denominator crosses zero. The card is edge-on and culled by then anyway.
  const near = camera / Math.max(1e-3, camera - s * halfExtent);
  const far = camera / Math.max(1e-3, camera + s * halfExtent);
  return { near, far };
}

const revolve: Template = {
  meta: {
    id: 'revolve-01',
    name: 'Revolve 01',
    group: 'Revolve',
    isNew: true,
    // The reference's own curve on this family's first two presets: a fast
    // launch, a fast landing, and a long float in between.
    defaultEasing: { id: 'custom', bezier: [0.7, 0.101, 0.3, 0.899] },
    // The reference draws the whole uncropped image at cover size, so the card
    // is the source's own shape. Its stage and its sample set are both 3:4, so
    // that is the shape the presets were authored against.
    cardAspect: 3 / 4,
    repeatAssets: true,
  },

  controls: [
    { key: 'axis',         label: 'Axis',          type: 'pills',  options: ['y','x'],                    default: 'y', section: 'Motion', description: 'y turns the card like a door; x tips it like a page.' },
    { key: 'direction',    label: 'Direction',     type: 'pills',  options: ['forward','reverse'],        default: 'forward', section: 'Motion' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 12, step: 1,              default: 4, description: 'Images in the pool. One half turn hands over to the next.' },
    { key: 'imageScale',   label: 'Image Scale',   type: 'slider', min: 20, max: 200, step: 1,            default: 65, unit: '%', description: 'Card size as a share of the frame-covering size. 100 fills the frame.' },
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 0, max: 100, step: 1,             default: 50, description: 'Strength of the turn’s foreshortening. 0 is orthographic; higher brings the camera in.' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 200, step: 1,             default: 0 },
    { key: 'stepTime',     label: 'Step Time',     type: 'slider', min: 0.3, max: 8, step: 0.05,          default: 2, unit: 's', precision: 2, section: 'Motion', description: 'Seconds one half turn takes, hold included.' },
    { key: 'hold',         label: 'Hold',          type: 'slider', min: 0, max: 2, step: 0.05,            default: 0, unit: 's', precision: 2, section: 'Motion', description: 'Beat the card rests on each image before turning.' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                         default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const n = clamp(Math.round(count), 2, 12);
    const step = Math.max(0.05, v.stepTime);

    // One phase unit per half turn. loopCycles snaps the clip to a whole number
    // of full passes of the pool, so frame totalFrames lands back on frame 0 —
    // the same guarantee the reference gets for free by defining its step as
    // duration/count.
    const holdFrac = clamp(v.hold / step, 0, 0.95);
    const turns = stepHold(
      (frame / ctx.totalFrames) * loopCycles(1 / step, ctx.duration, n),
      holdFrac,
      ctx.ease,
    );

    // Total angle, wrapped into the pool's own 180°-per-card span.
    const span = n * 180;
    const angle = (((turns * 180) % span) + span) % span;
    // The card on show is the one whose ±90° window the angle sits in, so the
    // hand-over happens while the plate is edge-on.
    const shown = Math.floor((angle + 90) / 180) % n;
    if (shown !== index % n) {
      return { x: 0, y: 0, scale: 0, rotation: 0, alpha: 0, depth: -1 };
    }

    const dir = v.direction === 'reverse' ? -1 : 1;
    const theta = (angle - shown * 180) * dir * DEG;
    const cos = Math.cos(theta);
    if (Math.abs(cos) < 1e-3) {
      return { x: 0, y: 0, scale: 0, rotation: 0, alpha: 0, depth: -1 };
    }

    // Cover the frame with the card's own shape, then take `imageScale` of it.
    // The renderer normalises a sprite's LONG edge to BASE, so a 3:4 card is
    // BASE tall and BASE*aspect wide before this scale lands.
    const aspect = Math.max(0.05, ctx.cardAspect ?? 3 / 4);
    const cover = Math.max(ctx.width / (BASE * aspect), ctx.height / BASE);
    const scale = cover * Math.max(0.1, v.imageScale / 100);
    const cardW = BASE * aspect * scale;
    const cardH = BASE * scale;

    // The reference measures its camera against the card's longest edge, so a
    // wide preset and a tall one distort by the same amount at the same slider
    // value. 0 means no perspective at all.
    const strength = clamp(v.perspective, 0, 100);
    const camera = strength > 1e-3 ? Math.max(cardW, cardH) * (100 / strength) : 1e9;

    const turningY = v.axis !== 'x';
    const halfExtent = (turningY ? cardW : cardH) / 2;
    const { near, far } = edgeFactors(theta, halfExtent, camera);

    // The box spans both edges; its centre is the midpoint between them, which
    // is NOT the axis once the two edges project differently.
    const along = cos * (near + far) / 2;             // squash along the turn
    const across = Math.max(near, far);               // the near edge magnifies
    const ratio = Math.min(near, far) / across;       // and the far one recedes
    const shift = cos * halfExtent * (near - far) / 2;

    // `near` is the edge at negative local coordinate — left for a y turn, top
    // for an x turn — whenever sinθ is positive, and the opposite when it is
    // not. The edge that RECEDES is the other one.
    const positiveTurn = Math.sin(theta) > 0;
    const receding = turningY
      ? (positiveTurn ? 'right' : 'left')
      : (positiveTurn ? 'bottom' : 'top');

    return {
      x: (turningY ? -shift : 0) + v.offset.x,
      y: (turningY ? 0 : -shift) + v.offset.y,
      scale,
      rotation: 0,
      alpha: 1,
      scaleX: turningY ? along : across,
      scaleY: turningY ? across : along,
      ...(ratio < 0.999
        ? { taper: { edge: receding as 'top' | 'bottom' | 'left' | 'right', ratio } }
        : {}),
      depth: 0,
    };
  },
};

// The reference's four presets, read live out of its own
// `paramsPerModeBaseline` on 2026-08-23. Only axis, direction, imageScale and
// the clip length differ between them; count is 4, perspective 50, delay 0 and
// cornerRadius 0 across all four. `duration / count` is restated as stepTime.
export const revolveVariants: Template[] = [
  revolve, // Spin 01 — y, forward, 65%, 8s / 4 steps
  variant(revolve, 'revolve-02', 'Revolve 02', {
    axis: 'x', direction: 'reverse', stepTime: 1.75,
  }),
  variant(revolve, 'revolve-03', 'Revolve 03', {
    direction: 'reverse', imageScale: 60, stepTime: 3,
  }, { id: 'linear' }),
  variant(revolve, 'revolve-04', 'Revolve 04', {
    axis: 'x', imageScale: 60, stepTime: 2.5,
  }, { id: 'linear' }),
];
