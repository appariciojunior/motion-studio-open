import type { Template, TransformCtx } from '@/lib/types';
import { TAU, clamp, loopCycles, smooth, stepHold } from '@/lib/motion';
import {
  DEG,
  depthDim,
  multiplyQuaternion,
  quaternionFromEuler,
  tiltNormalCanvas,
  tiltPointCanvas,
  velocityLean,
} from '@/lib/tilt3d';
import { variant } from './variant';

const BASE = 340;

// Every control added for the MOVO variations is read through this, never as a
// bare `v.key`. Scenes saved before they existed have no value for them, and a
// missing key would arrive as undefined, turn into NaN through the first
// multiply, and take the whole pose down with it — a card at NaN is not drawn
// at all, so an old project would simply open empty.
const num = (value: any, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const pick = (value: any, fallback: string) => (typeof value === 'string' ? value : fallback);

// The rig that orients the whole ring. tiltPointCanvas applies Ry(yaw)·Rx(pitch)
// ·Rz(roll), so the ORIENTATION quaternion has to be composed in that same
// order — build it as Rx·Ry·Rz and the card faces drift off the plane their own
// centres sit on, which reads as cards floating loose from the ring.
function ringRig(v: Record<string, any>) {
  return { pitch: num(v.tiltX), yaw: num(v.ringYaw), roll: num(v.ringRoll) };
}
function rigQuaternion(rig: { pitch: number; yaw: number; roll: number }) {
  return multiplyQuaternion(
    multiplyQuaternion(
      quaternionFromEuler(0, rig.yaw * DEG, 0),
      quaternionFromEuler(rig.pitch * DEG, 0, 0),
    ),
    quaternionFromEuler(0, 0, rig.roll * DEG),
  );
}

// How present a card is, given where its face points. Two independent effects,
// deliberately kept apart:
//
//   Back Fade      recedes the far arc. In `solid` it DARKENS (dim) and in
//                  `alpha` it goes see-through. Solid is the right default for
//                  a dense ring — on alpha the far cards show straight through
//                  the near ones and the whole thing reads as glass — but the
//                  reference tool ships both, and its airier presets do use
//                  alpha on purpose.
//   Hide Backface  removes the far half outright. Ramped over a narrow band
//                  around edge-on rather than switched, or cards pop in and out
//                  as they cross.
function cardShading(v: Record<string, any>, normalZ: number) {
  const shade = 1 - depthDim(normalZ, num(v.fade));
  const hidden = pick(v.backface, 'show') === 'hide' ? smooth(clamp(normalZ / 0.08, 0, 1)) : 1;
  const useAlpha = pick(v.fadeMode, 'solid') === 'alpha';
  return {
    alpha: hidden * (useAlpha ? 1 - shade : 1),
    dim: useAlpha ? 0 : shade,
  };
}

// Nearer cards read bigger. 0 keeps the ring honest to its own perspective;
// the reference tool's punchier presets push it to 200, where the near card is
// roughly twice its far twin and the ring becomes a foreground/background
// device rather than a wheel.
function contrastScale(v: Record<string, any>, depthN: number) {
  return Math.max(0.05, 1 + (num(v.scaleContrast) / 100) * 0.3 * (depthN * 2 - 1));
}

function ringMetrics(v: Record<string, any>, count: number, ctx: { width: number; height: number }) {
  const minDim = Math.min(ctx.width, ctx.height);
  const padding = clamp(v.padding / 100, 0, 0.2);
  const usable = minDim * (1 - padding * 2);
  // Opening is relative to the ring's own outer diameter. Previously it was
  // measured against the canvas, so opening and ring size fought each other.
  const outer = usable * clamp(v.ringSizePct / 100, 0.4, 0.98);
  const inner = outer * clamp(v.opening / 100, 0.15, 0.85);
  // Ring Offset pushes the whole ring outward from what Ring Size and Ring
  // Opening solved, which is the reference tool's "Diameter": a way to spread
  // the cards apart without also reshaping the ring's proportions. It grows the
  // slot too, so the cards grow with it and the gaps between them stay honest.
  const radius = (outer + inner) / 4 + minDim * clamp(num(v.ringOffset) / 100, 0, 0.6);

  // Card Size is a share of the card's OWN ANGULAR SLOT, not of the canvas.
  //
  // On a ring these quantities are over-determined: pick a radius and a count
  // and the card's absolute size is already decided, so a control for each
  // must have one of them quietly yield. Both ways round were measured on the
  // shipped preset and both left a dead slider:
  //
  //   card yields (min(requested, slot))  Card Size did nothing above 16%,
  //                                       71% of its range dead — and its own
  //                                       default of 18 already sat past that
  //   ring yields (max(requested, safe))  Ring Size AND Ring Opening went
  //                                       completely inert instead
  //
  // Making it a fraction of the slot removes the contest rather than picking a
  // loser: Ring Size, Ring Opening and Padding own the radius, Card Size owns
  // how much of its slot the card fills, and neither can starve the other.
  //
  // 100% is where a card exactly meets its neighbours. The range runs past it
  // on purpose: the reference tool parameterizes the same quantity as a GAP
  // that goes negative (its densest presets sit at -50, i.e. half a card of
  // overlap), and a ceiling at 100 could not express those at all. Overlap is
  // now a deliberate setting rather than something the layout falls into.
  const arcPerCard = (TAU * radius) / Math.max(4, count);
  return {
    radius,
    // Use the full long edge for the fill. Assets may be landscape or square
    // when Card shape is Auto; assuming 4:5 here made wide images touch.
    cardPx: arcPerCard * clamp(v.cardSizePct / 100, 0.05, 2),
  };
}

// The ring advances ONE SLOT PER STEP, each step shaped by the scene curve and
// optionally held at the end of it. All three of the reference's behaviours are
// this one expression:
//
//   linear curve, no hold    indistinguishable from a constant spin, because a
//                            linear shape makes floor(p)+shape(frac(p)) == p
//   shaped curve, no hold    accelerates and settles once per card
//   shaped curve + hold      steps to the next card and waits
//
// This corrects an earlier reading of my own. Measuring the shipped `flow`
// curve here showed instantaneous angular velocity swinging 23.5x between its
// slowest and fastest frame, and I concluded a turning ring must never route
// through a per-step shape at all. The measurement was right and the conclusion
// was too broad: what it actually establishes is that this family's DEFAULT
// curve has to be linear. Photographing the reference settles the rest — its
// Pure 02 (linear, no pause) changes by an identical amount between every
// sample, while its Pure 04 (natural, no pause) dips to zero on a regular
// beat. The lurch is a deliberate option there, not an accident.
//
// `hold` is the share of each step spent stationary. The reference states the
// same thing as an Action time plus a Pause time, and the two agree exactly:
// (Action + Pause) x count equals the clip length on both of its stepped
// presets, so hold = Pause / (Action + Pause).
//
// The seam survives all of it: loopCycles returns a whole multiple of `count`,
// and stepHold preserves floor(p), so at frame totalFrames the angle has still
// advanced by a whole multiple of TAU.
function ringPhaseAt(frame: number, v: Record<string, any>, count: number, ctx: TransformCtx) {
  const dir = v.direction === 'reverse' ? -1 : 1;
  const cycles = loopCycles(v.speed, ctx.duration, count);
  const raw = (frame / ctx.totalFrames) * cycles * dir;
  const hold = clamp(num(v.hold) / 100, 0, 0.9);
  return stepHold(raw, hold, ctx.ease);
}

function ringPhase(frame: number, v: Record<string, any>, count: number, ctx: TransformCtx) {
  const dir = v.direction === 'reverse' ? -1 : 1;
  const cycles = loopCycles(v.speed, ctx.duration, count);
  const phase = ringPhaseAt(frame, v, count, ctx);
  // Differenced rather than derived from cycles/duration. That average is only
  // the true rate while the phase is linear; the moment a curve or a hold
  // shapes the step it stops being, and this number is handed to the finish
  // pass as motion blur — so a held card would be blurred as if it were still
  // travelling. One extra phase evaluation buys an exact answer in every mode.
  const slotsPerSecond = (ringPhaseAt(frame + 1, v, count, ctx) - phase) * ctx.fps;
  return { dir, cycles, phase, slotsPerSecond };
}

const ringStream: Template = {
  meta: {
    id: 'orbit-3d-01', name: 'Ring Stream', group: 'Orbit', isNew: true,
    // Linear on purpose — see ringPhase above. The curve picker still works for
    // anyone who wants the stepped feel back.
    defaultEasing: { id: 'linear' }, engine: 'webgl', catalog3d: true, repeatAssets: true,
  },
  controls: [
    { key: 'style', label: 'Style', type: 'pills', options: ['stream','showcase','bloom'], default: 'stream', section: 'Layout', advanced: true },
    { key: 'direction', label: 'Direction', type: 'toggle', options: ['forward','reverse'], default: 'forward', section: 'Motion' },
    { key: 'count', label: 'Count', type: 'slider', min: 4, max: 24, step: 1, default: 12, section: 'Layout' },
    { key: 'padding', label: 'Padding', type: 'slider', min: 0, max: 20, step: 1, default: 6, section: 'Layout', unit: '%' },
    { key: 'ringSizePct', label: 'Ring Size', type: 'slider', min: 45, max: 95, step: 1, default: 94, section: 'Layout', unit: '%' },
    { key: 'opening', label: 'Ring Opening', type: 'slider', min: 15, max: 85, step: 1, default: 70, section: 'Layout', unit: '%', description: 'Controls the inner diameter while keeping the ring complete.' },
    { key: 'cardSizePct', label: 'Card Size', type: 'slider', min: 20, max: 200, step: 1, default: 72, section: 'Layout', unit: '%', description: 'How much of its slot on the ring each card fills. 100% means neighbours just touch; above that they overlap.' },
    { key: 'ringOffset', label: 'Ring Offset', type: 'slider', min: 0, max: 60, step: 1, default: 0, section: 'Layout', unit: '%', description: 'Pushes the ring outward without reshaping it — spreads the cards apart and grows them to match.' },
    { key: 'cardRotation', label: 'Card Rotation', type: 'slider', min: -180, max: 180, step: 1, default: 0, section: 'Layout', unit: '°', description: 'Spins each card in its own plane. At ±90 a ring of portraits becomes a ring of landscapes.' },
    { key: 'cardTilt', label: 'Card Tilt', type: 'slider', min: -90, max: 90, step: 1, default: 0, section: 'Depth', unit: '°', description: 'Leans every card out of the ring plane — positive fans them outward like a crown.' },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 20, step: 0.5, default: 3, section: 'Finish', unit: '%', precision: 1 },
    // Signed, so the slider sits at centre and reads as one axis: negative
    // cups each image inward toward the ring's centre, positive bows it
    // outward, 0 is flat. The 3D renderer flips the arc's centre by the sign
    // (lib/renderer3d makeBentPlaneGeometry).
    //
    // The range runs to that renderer's own ceiling: it clamps the sag to
    // +/-0.45 of the card's width and this control feeds it /100, so +/-45 is
    // exactly as far as the geometry goes. It first shipped stopping at 12,
    // barely a quarter of that — at 45 the surface wraps through about 168
    // degrees of arc, a deep curl rather than a gentle bow.
    { key: 'cardBend', label: 'Card Bend', type: 'slider', min: -45, max: 45, step: 0.5, default: 4, section: 'Depth', unit: '%', precision: 1, description: 'Curves each image surface around the ring — negative cups inward, positive bows outward.' },
    // The three rig axes. Only Tilt existed; the reference family's most
    // distinctive looks are Yaw and Roll — a ring turned edge-on and rolled
    // upright is what turns a wheel into a vertical conveyor, and no amount of
    // Tilt gets there. They cost nothing to add: tiltPointCanvas already takes
    // all three, and this template was passing it only pitch.
    { key: 'tiltX', label: 'Ring Tilt', type: 'slider', min: -120, max: 120, step: 1, default: -8, section: 'Depth', unit: '°', description: 'Rotates the complete physical ring without changing its radius.' },
    { key: 'ringYaw', label: 'Ring Yaw', type: 'slider', min: -90, max: 90, step: 1, default: 0, section: 'Depth', unit: '°', description: 'Turns the ring toward or away from the camera — at ±90 you look straight through it.' },
    { key: 'ringRoll', label: 'Ring Roll', type: 'slider', min: -180, max: 180, step: 1, default: 0, section: 'Depth', unit: '°', description: 'Spins the ring in the frame. At ±90 a horizontal drum becomes a vertical column.' },
    { key: 'perspective', label: 'Perspective', type: 'slider', min: 0, max: 100, step: 1, default: 18, section: 'Depth', unit: '%' },
    // 0.25 to 4, because that is the span the reference actually uses. It says
    // the same thing as a Zoom percentage, and the two are reciprocal —
    // measured on three presets, Zoom% = 247/distance x 100, so its 400% is
    // 0.25 here and its 25% is 4. At the old 0.5..2.5 both ends of its range
    // clamped, which is why three of the ported presets came out framed wrong.
    { key: 'camDistance', label: 'Camera Distance', type: 'slider', min: 0.25, max: 4, step: 0.05, default: 1, section: 'Depth', unit: '×', precision: 2,
      description: 'Moves the camera itself closer or further, at the same Perspective — a different move than widening the lens.' },
    { key: 'facing', label: 'Facing', type: 'pills', options: ['camera','ring'], default: 'ring', section: 'Depth' },
    { key: 'scaleContrast', label: 'Depth Contrast', type: 'slider', min: 0, max: 200, step: 1, default: 0, section: 'Depth', unit: '%', description: 'Exaggerates how much bigger a near card reads than a far one.' },
    // Measured on the reference, not guessed: with this off, the far arc shows
    // the reverse of each card and its picture comes back MIRRORED — two
    // photographs of the same face, one of them flipped, sitting side by side.
    // Turning it on rotates a card that has turned away by a further half turn,
    // so its front comes back to the camera. Pure pose, no material change; the
    // swap lands exactly at edge-on, where the card is a zero-width sliver and
    // nothing can be seen to pop.
    { key: 'flip', label: 'Flip Backs', type: 'toggle', options: ['no','yes'], default: 'no', section: 'Depth', description: 'Turns cards on the far arc to face the camera, so their pictures never read mirrored.' },
    { key: 'fade', label: 'Back Fade', type: 'slider', min: 0, max: 100, step: 1, default: 15, section: 'Finish', unit: '%' },
    { key: 'fadeMode', label: 'Fade Mode', type: 'pills', options: ['solid','alpha'], default: 'solid', section: 'Finish', description: 'Solid darkens the far arc and keeps it opaque; alpha makes it see-through.' },
    { key: 'backface', label: 'Hide Backface', type: 'toggle', options: ['show','hide'], default: 'show', section: 'Finish', description: 'Drops the far half of the ring entirely, leaving only the arc facing you.' },
    { key: 'shadow', label: 'Shadow', type: 'toggle', options: ['on','off'], default: 'on', section: 'Finish' },
    { key: 'spread', label: 'Ring Width', type: 'slider', min: 55, max: 135, step: 1, default: 100, section: 'Layout', unit: '%', visibleWhen: { key: 'style', equals: 'showcase' } },
    { key: 'pulse', label: 'Bloom', type: 'slider', min: 0, max: 35, step: 1, default: 15, section: 'Motion', unit: '%', visibleWhen: { key: 'style', equals: 'bloom' } },
    { key: 'curve', label: 'Curve', type: 'slider', min: -100, max: 100, step: 1, default: 0, section: 'Depth', unit: '%', visibleWhen: { key: 'style', equals: 'bloom' } },
    { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.3, section: 'Motion', unit: '×', precision: 1 },
    // The reference states this as an Action time plus a Pause time in seconds;
    // as a share of the step it survives a change of clip length, which those
    // two do not. 0 is a ring that never stops.
    { key: 'hold', label: 'Hold', type: 'slider', min: 0, max: 60, step: 1, default: 0, section: 'Motion', unit: '%', description: 'How much of each card-to-card step is spent stopped. Pairs with a shaped curve to make the ring index rather than spin.' },
    { key: 'offset', label: 'Offset', type: 'xypad', default: { x: 0, y: 0 }, section: 'Layout' },
  ],

  // The ceiling moves from 1 to 2.5, which takes the widest field of view from
  // 29 degrees to 50. Everything at or below Perspective 40 is arithmetically
  // UNCHANGED — same expression, same constants — so the three presets that
  // shipped before this port keep their exact framing while the range above
  // them becomes reachable.
  //
  // It had to move. Side by side, the reference's dramatic presets show a few
  // large cards at wildly different sizes and ours showed a uniform ring of
  // twelve; that is a field-of-view difference, and at 29 degrees it simply
  // could not be expressed. Their Perspective runs to 2000 where ours stopped
  // at the equivalent of about 800.
  camera: (v) => ({ fov: 15 + clamp(v.perspective / 40, 0, 2.5) * 14, distance: v.camDistance }),

  transform3d: (frame, index, count, v, ctx) => {
    const { dir, phase, slotsPerSecond } = ringPhase(frame, v, count, ctx);
    const a = TAU * ((index - phase) / count);
    const metrics = ringMetrics(v, count, ctx);
    const pulse = v.style === 'bloom' ? 1 + (v.pulse / 100) * Math.sin((phase / count) * TAU) : 1;
    const width = metrics.radius * (v.style === 'showcase' ? v.spread / 100 : 1) * pulse;
    const depth = metrics.radius * pulse;
    const curveY = v.style === 'bloom' ? (1 - Math.cos(a)) * metrics.radius * (v.curve / 100) * 0.28 : 0;
    const base = { x: Math.sin(a) * width, y: curveY, z: Math.cos(a) * depth };
    const rig = ringRig(v);
    const point = tiltPointCanvas(base, rig);
    const normal = tiltNormalCanvas({ x: Math.sin(a), y: 0, z: Math.cos(a) }, rig);
    const depthN = clamp((normal.z + 1) / 2, 0, 1);
    const lean = velocityLean(dir * v.speed, 1, 3) * DEG;
    // Half a turn more for a card that has turned away, so its front comes back
    // to the camera instead of its mirrored reverse. See the Flip Backs control.
    const flipTurn = pick(v.flip, 'no') === 'yes' && normal.z < 0 ? Math.PI : 0;
    // Facing 'camera' is a BILLBOARD: square to the viewer no matter what the
    // ring is doing, so it has to cancel the rig as well as the radial turn.
    // Rig-rotating it too made the reference's face-on ring presets come back
    // as a circle of edge-on slivers — the cards were dutifully following a
    // ring that had been turned 85 degrees away.
    //
    // Only the card's centre follows the rig; its face does not. That is the
    // one place in this template where position and orientation deliberately
    // use different frames.
    const qOrient = v.facing === 'ring'
      ? multiplyQuaternion(rigQuaternion(rig), quaternionFromEuler(0, a + flipTurn, 0))
      : { x: 0, y: 0, z: 0, w: 1 };
    // Card Tilt leans the card out of the ring plane; Card Rotation spins it
    // within its own. Both are card-local, so they compose INSIDE the radial
    // turn — outside it they would just re-aim the ring.
    const qCard = quaternionFromEuler(num(v.cardTilt) * DEG, 0, num(v.cardRotation) * DEG + lean);
    const quaternion = multiplyQuaternion(qOrient, qCard);
    const shading = cardShading(v, normal.z);
    const angularRate = (slotsPerSecond * TAU) / count;
    return {
      x: point.x + v.offset.x,
      y: point.y + v.offset.y,
      z: point.z,
      quaternion,
      scale: (metrics.cardPx / BASE) * (1 + smooth(depthN) * 0.035) * contrastScale(v, depthN),
      // Back Fade DARKENS the far arc; it does not make it see-through. On
      // alpha, the cards behind the ring showed straight through the ones in
      // front and the whole thing read as glass. It rides materialExposure
      // instead, which is a plain brightness multiply on the card's colour, so
      // a far card is dim AND solid.
      //
      // depthDim, not backfaceFade: this is a RING, and lib/tilt3d says it in
      // as many words — a ring's far arc has to stay present or the whole thing
      // reads as a front-only fan. backfaceFade multiplies in a hard cut to
      // zero near edge-on (added so sphere tiles never expose their DoubleSide
      // back), and applying it here deleted every card on the far side.
      alpha: shading.alpha,
      bend: v.cardBend / 100,
      thickness: 0,
      shadowStrength: v.shadow === 'on' ? 1 : 0,
      materialExposure: 0.78 + depthN * 0.28,
      dim: shading.dim,
      velocity: {
        x: Math.cos(a) * width * angularRate,
        y: Math.sin(a) * depth * angularRate * Math.sin(rig.pitch * DEG),
        z: -Math.sin(a) * depth * angularRate,
      },
    };
  },

  transform: (frame, index, count, v, ctx) => {
    // Same linear phase as the 3D path, so the thumbnail matches the stage.
    const { phase } = ringPhase(frame, v, count, ctx);
    const a = TAU * ((index - phase) / count);
    const metrics = ringMetrics(v, count, ctx);
    const base = { x: Math.sin(a) * metrics.radius, y: 0, z: Math.cos(a) * metrics.radius };
    const rig = ringRig(v);
    const p = tiltPointCanvas(base, rig);
    const normal = tiltNormalCanvas({ x: Math.sin(a), y: 0, z: Math.cos(a) }, rig);
    const depthN = clamp((normal.z + 1) / 2, 0, 1);
    const shading = cardShading(v, normal.z);
    return {
      x: p.x + v.offset.x,
      y: p.y + v.offset.y,
      scale: (metrics.cardPx / BASE) * (0.84 + depthN * 0.19) * contrastScale(v, depthN),
      // The 2D fallback has no card-local frame to spin, so Card Rotation lands
      // straight on the sprite. Ring Roll turns the whole ring, which in a flat
      // projection is the same thing applied to every card, so it rides here too.
      rotation: (num(v.cardRotation) + rig.roll) * DEG,
      // Same reasoning as transform3d above, and it matters more here: the 2D
      // fallback has no depth at all, so losing the far arc leaves a bare row.
      // Darkens rather than going see-through, unless Fade Mode says otherwise.
      alpha: shading.alpha,
      dim: shading.dim,
      depth: p.z,
    };
  },
};

// ---------------------------------------------------------------------------
//  The reference tool's Orbit family, ported onto this same ring.
//
//  Its 21 presets are ONE engine with different values — no per-preset code —
//  which is why they land here as variants rather than as new templates. Its
//  own values were read straight out of its editor, and the conversions below
//  are the only judgement in the port. Stated so they can be argued with:
//
//    Gap -> Card Size    Card Size = 100/(1 + Gap/100), because Gap is a share
//                        of the CARD, not of the slot. Measured by sweeping it
//                        on their Pure 04 and reading the drawn bounding box:
//                        at Gap 0..75 the box HEIGHT went 14 -> 8, a factor of
//                        0.571 against 1/(1+75/100) = 0.571 exactly. The first
//                        pass used 100 - Gap, which agrees near zero and is
//                        badly wrong at the ends — 37 instead of 61 at their
//                        widest gap, and 150 instead of 200 at their tightest.
//    Ring size           Sweeping Count 6..24 moved the box width 74 -> 76, and
//                        Gap 0..75 moved it 77 -> 74. Neither grows the ring:
//                        it is fixed by the canvas and those two only decide how
//                        much of a slot a card fills — which is our model too.
//                        But the SCALE was never ported. Their ring sits near
//                        0.21 of the stage's short edge and our family default
//                        is 0.3515, so all 21 shipped half again too big. Hence
//                        ringSizePct 55 rather than the family's 94.
//    Diameter -> Ring Offset   The one control that does grow the ring: box
//                        width 76 -> 103 -> 129 for Diameter 0 -> 200 -> 400,
//                        i.e. it adds Diameter/2 to the radius. Taken here
//                        against their 1280 stage short edge, not the 1080
//                        assumed on the first pass.
//    Surface Wrap -> Card Bend   Not a free amount: the card curves to follow
//                        the ring's own circle. Wrap narrowed the box to 0.952
//                        of Flat, and for cards on a ring that ratio is
//                        cos(alpha/2), giving alpha = 35.8 degrees against the
//                        34.8 their count and gap imply. So the sag is
//                        determined — bend = tan(alpha/4)/2 with
//                        alpha = (TAU/count)*cardShare — which is 3 to 7.5
//                        across these presets, not the flat 10 first shipped.
//    Perspective         Same SENSE as ours, larger meaning more distortion, and
//                        mapped as 40·px/2000. Measured, after this shipped
//                        inverted once on the reasonable-sounding assumption
//                        that a "perspective distance" in px had to run the
//                        other way: setting their Lightroom 01 from 1600 down
//                        to 200 flattened its hourglass into a plain row, which
//                        settles the direction. Their widest looks still sit
//                        past our ceiling — our Perspective tops out at a 29°
//                        field of view, so Ring Lightroom 01 lands flatter here
//                        than there even at 40.
//    Zoom -> Camera Distance   Their Zoom is a percentage and the two are
//                        reciprocal — Zoom% = 247/distance x 100, checked on
//                        four presets and exact on all four. That relation is
//                        true INSIDE their rig and does not transfer at the
//                        extremes: ours multiplies the fov's fit distance,
//                        theirs is a number in their own world, and the two
//                        only agree near their default. Faithfully converting
//                        their Lightroom 04 to 0.25 put our camera inside its
//                        own ring and filled the frame with a single card,
//                        where theirs shows a sparse vertical column. So the
//                        near-1 presets take the conversion and the extremes
//                        are framed against photographs of their stage — not
//                        their thumbnails, which are landscape while our stage
//                        is 4:5, a mismatch that made a correct conversion
//                        look wrong.
//    Loop length -> Speed      Theirs sets clip length for a fixed rotation;
//                        ours sets rate. speed = 0.3 · 20 / loopDuration,
//                        rounded to the slider's 0.1 step.
//
//  Not ported: their per-preset easing curves (Glide / Natural). `variant`
//  patches control defaults, and the curve lives on meta.defaultEasing, so
//  every preset here inherits the family's linear curve — correct for a
//  continuously turning ring, and the curve picker still overrides it.
// ---------------------------------------------------------------------------
export const orbit3dVariants: Template[] = [
  ringStream,
  variant(ringStream, 'orbit-3d-02', 'Orbit Showcase', {
    style: 'showcase', count: 10, ringSizePct: 86, opening: 48, tiltX: 0, perspective: 28, spread: 92, speed: 0.25,
  }),
  variant(ringStream, 'orbit-3d-03', 'Orbit Bloom', {
    style: 'bloom', count: 8, ringSizePct: 72, opening: 42, tiltX: -29, perspective: 26, fade: 45, pulse: 16,
  }),

  // Pure — cards wrapped around a drum, facing outward along the ring.
  variant(ringStream, 'orbit-3d-04', 'Ring Pure 01', {
    count: 18, ringSizePct: 65, cardSizePct: 74, cardBend: 3, facing: 'ring', fade: 30,
    tiltX: -10, ringYaw: -10, ringRoll: 50, perspective: 15, camDistance: 1, speed: 0.3, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'linear' }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-05', 'Ring Pure 02', {
    count: 9, ringSizePct: 65, cardSizePct: 87, cardBend: 7.5, facing: 'ring', fade: 15,
    tiltX: -10, ringYaw: -10, ringRoll: 50, perspective: 25, camDistance: 1.33, speed: 0.2, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'linear' }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-06', 'Ring Pure 03', {
    count: 9, ringSizePct: 65, cardSizePct: 87, cardBend: 7.5, facing: 'ring', fade: 15,
    tiltX: -7, perspective: 25, camDistance: 1.33, speed: 0.3, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'custom', bezier: [0.85, 0.15, 0.15, 0.85] }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-07', 'Ring Pure 04', {
    count: 18, ringSizePct: 65, cardSizePct: 87, cardBend: 4, facing: 'ring', fade: 15,
    tiltX: 0, perspective: 25, camDistance: 1, speed: 0.2, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'custom', bezier: [0.8, 0, 0.2, 1] }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-08', 'Ring Pure 05', {
    count: 12, ringSizePct: 65, cardSizePct: 87, cardBend: 5.5, facing: 'ring', fade: 15, ringOffset: 5,
    tiltX: 0, perspective: 25, camDistance: 1, speed: 0.2, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'custom', bezier: [0.8, 0, 0.2, 1] }, { cardAspect: 1 /* 1:1 */ }),
  // A drum rolled upright: Ring Roll -90 stands it on end and Card Rotation 90
  // turns each card to match, which is the vertical conveyor of the reference.
  variant(ringStream, 'orbit-3d-09', 'Ring Pure 06', {
    count: 18, ringSizePct: 65, cardSizePct: 100, cardBend: 4.5, facing: 'ring', fade: 15, ringOffset: 5,
    cardRotation: 90, ringRoll: -90, tiltX: 0, cornerRadius: 0,
    perspective: 15, camDistance: 1.54, speed: 0.2, direction: 'forward', shadow: 'off',
  }, { id: 'linear' }, { cardAspect: 1 /* 1:1 */ }),

  // Carousel — the same ring with the cards kept square to the camera.
  variant(ringStream, 'orbit-3d-10', 'Ring Carousel 01', {
    count: 18, ringSizePct: 65, cardSizePct: 74, cardBend: 0, facing: 'camera', fade: 30,
    tiltX: -10, ringYaw: -10, ringRoll: 50, perspective: 15, camDistance: 1, speed: 0.3, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'linear' }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-11', 'Ring Carousel 02', {
    count: 9, ringSizePct: 65, cardSizePct: 87, cardBend: 0, facing: 'camera', fade: 15,
    tiltX: -10, ringYaw: -10, ringRoll: 50, perspective: 25, camDistance: 1.33, speed: 0.3, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'linear' }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-12', 'Ring Carousel 03', {
    count: 9, ringSizePct: 65, cardSizePct: 87, cardBend: 0, facing: 'camera', fade: 15, scaleContrast: 50,
    tiltX: 0, ringRoll: 56, perspective: 25, camDistance: 2, speed: 0.4, direction: 'reverse', shadow: 'off', cornerRadius: 10, hold: 13,
  }, { id: 'custom', bezier: [0.8, 0, 0.2, 1] }, { cardAspect: 1 /* 1:1 */ }),
  // Overlapping by half a card, stood upright, and pushed hard on depth — the
  // reference's densest Orbit preset and the one our old 100% ceiling could
  // not have expressed at all.
  variant(ringStream, 'orbit-3d-13', 'Ring Carousel 04', {
    count: 20, ringSizePct: 65, cardSizePct: 200, cardBend: 0, facing: 'camera', fade: 15, scaleContrast: 200,
    tiltX: 0, ringRoll: 90, perspective: 37, camDistance: 2.44, speed: 0.2, direction: 'reverse', shadow: 'off', cornerRadius: 10, hold: 20,
  }, { id: 'custom', bezier: [0.8, 0, 0.2, 1] }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-14', 'Ring Carousel 05', {
    count: 9, ringSizePct: 65, cardSizePct: 118, cardBend: 0, facing: 'camera', fade: 15, scaleContrast: 200,
    tiltX: 0, perspective: 0, camDistance: 4, speed: 0.5, direction: 'reverse', shadow: 'off', cornerRadius: 10, hold: 20,
  }, { id: 'custom', bezier: [0.8, 0, 0.2, 1] }, { cardAspect: 1 /* 1:1 */ }),

  // Lightroom — an airy ring seen almost edge-on, fading on alpha rather than
  // darkening, with the far arc turned so its pictures never read mirrored.
  variant(ringStream, 'orbit-3d-15', 'Ring Lightroom 01', {
    count: 10, ringSizePct: 65, cardSizePct: 94, cardBend: 7.5, facing: 'ring', fade: 0, fadeMode: 'alpha', flip: 'yes',
    tiltX: 0, perspective: 80, camDistance: 1, speed: 0.3, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'linear' }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-16', 'Ring Lightroom 02', {
    count: 10, ringSizePct: 65, cardSizePct: 94, cardBend: 0, facing: 'ring', fade: 0, fadeMode: 'alpha', flip: 'yes',
    cardRotation: -90, ringRoll: 90, tiltX: 0, perspective: 75, camDistance: 0.91, speed: 0.3, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'linear' }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-17', 'Ring Lightroom 03', {
    count: 10, ringSizePct: 65, cardSizePct: 94, cardBend: 0, facing: 'ring', fade: 0, fadeMode: 'alpha', flip: 'yes',
    cardRotation: -90, ringRoll: 51, tiltX: 0, perspective: 75, camDistance: 0.95, speed: 0.3, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'custom', bezier: [0.85, 0.15, 0.15, 0.85] }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-18', 'Ring Lightroom 04', {
    count: 9, ringSizePct: 65, cardSizePct: 61, cardBend: 0, facing: 'ring', fade: 0, fadeMode: 'alpha', flip: 'yes',
    backface: 'hide', ringOffset: 12, cardRotation: -90, ringRoll: 90, tiltX: 0,
    perspective: 38, camDistance: 1, speed: 0.4, direction: 'reverse', shadow: 'off', cornerRadius: 10, hold: 36,
  }, { id: 'custom', bezier: [0.85, 0.15, 0.15, 0.85] }, { cardAspect: 0.8 /* 4:5 */ }),
  variant(ringStream, 'orbit-3d-19', 'Ring Lightroom 05', {
    count: 24, ringSizePct: 65, cardSizePct: 100, cardBend: 0, facing: 'ring', fade: 0, fadeMode: 'alpha', flip: 'yes',
    ringOffset: 39, tiltX: 0, cornerRadius: 0, perspective: 100, camDistance: 4, speed: 0.2, direction: 'reverse', shadow: 'off',
  }, { id: 'linear' }, { cardAspect: 0.8 /* 4:5 */ }),

  // Bloom — the ring turned toward the camera until it reads as a circle in
  // the frame rather than a wheel in depth.
  variant(ringStream, 'orbit-3d-20', 'Ring Bloom 01', {
    count: 12, ringSizePct: 65, cardSizePct: 85, cardBend: 0, facing: 'ring', fade: 25, cardTilt: 15,
    tiltX: 0, perspective: 31, camDistance: 1.17, speed: 0.3, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'custom', bezier: [0.8, 0, 0.2, 1] }, { cardAspect: 0.8 /* 4:5 */ }),
  variant(ringStream, 'orbit-3d-21', 'Ring Bloom 02', {
    count: 12, ringSizePct: 65, cardSizePct: 100, cardBend: 0, facing: 'camera', fade: 0, fadeMode: 'alpha', scaleContrast: 200,
    tiltX: 0, ringYaw: 85, ringRoll: 90, perspective: 100, camDistance: 2.5, speed: 0.6, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'linear' }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-22', 'Ring Bloom 03', {
    count: 12, ringSizePct: 65, cardSizePct: 100, cardBend: 0, facing: 'camera', fade: 0, fadeMode: 'alpha', scaleContrast: 200,
    tiltX: 24, ringYaw: 75, ringRoll: 90, perspective: 100, camDistance: 2.5, speed: 0.6, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'linear' }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-23', 'Ring Bloom 04', {
    count: 12, ringSizePct: 65, cardSizePct: 100, cardBend: 0, facing: 'camera', fade: 0, fadeMode: 'alpha', cardTilt: -44,
    tiltX: 97, ringYaw: -40, perspective: 100, camDistance: 1.82, speed: 0.6, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'linear' }, { cardAspect: 1 /* 1:1 */ }),
  variant(ringStream, 'orbit-3d-24', 'Ring Bloom 05', {
    count: 16, ringSizePct: 65, cardSizePct: 67, cardBend: 0, facing: 'ring', fade: 0, fadeMode: 'alpha',
    tiltX: 90, perspective: 31, camDistance: 0.84, speed: 0.5, direction: 'reverse', shadow: 'off', cornerRadius: 10,
  }, { id: 'linear' }, { cardAspect: 0.5625 /* 9:16 */ }),
];
