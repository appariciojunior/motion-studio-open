import type { Template } from '@/lib/types';
import { TAU, clamp, loopCycles, smooth } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;

// ============================================================
//  BOX — a rotating prism, one image per face
//
//  A closed drum that turns on its own axis: each slot is one face, and the
//  faces are laid out around a regular N-gon so they meet at the edges. With
//  count 4 it is a cube, 6 a hexagonal drum, 3 a triangular prism.
//
//  There is no real 3D here. A face is a flat plane whose normal points out at
//  angle θ from the viewer, so it needs three things to read as part of a solid:
//
//  · foreshortening — the face compresses by cos(θ) across the turn axis, which
//    is exactly what `scaleX` / `scaleY` are for. At θ = 90° it is edge-on and
//    vanishes, which is what hides the seam between faces.
//  · offset — its centre sits at sin(θ)·apothem along the axis-perpendicular,
//    so faces sweep across rather than rotating in place.
//  · occlusion — a face with cos(θ) < 0 points away from the viewer and must not
//    draw at all, or the far side of the drum shows through the near side.
//
//  The apothem (axis → face centre) is derived from the face width so the prism
//  is closed: for a regular N-gon of side w, apothem = w / (2·tan(π/N)). Leaving
//  it free would let the faces float apart or overlap into a mess.
// ============================================================

const box: Template = {
  // Square faces are a geometric requirement, not a style choice. The apothem
  // that closes the prism depends on the face dimension PERPENDICULAR to the
  // spin axis — width for a vertical axis, height for a horizontal one. With the
  // 4:5 default those two differ, so one of the two axes would always leave the
  // faces gapping or overlapping. cardAspect 1 makes a single `Face Size` valid
  // on either axis.
  meta: { id: 'box-01', name: 'Box 01', group: 'Box', isNew: true, cardAspect: 1, defaultEasing: { id: 'linear' } },

  controls: [
    { key: 'axis',         label: 'Spin Axis',     type: 'pills',  options: ['vertical','horizontal'], default: 'vertical' },
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    // Count IS the face count: one slot per face, so the drum stays closed.
    { key: 'count',        label: 'Faces',         type: 'slider', min: 3, max: 12, step: 1,     default: 4 },
    { key: 'cardSize',     label: 'Face Size',     type: 'slider', min: 80, max: 600, step: 1,   default: 330 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,    default: 0 },
    { key: 'girth',        label: 'Girth',         type: 'slider', min: 0.5, max: 2, step: 0.05, default: 1 },   // ×apothem: <1 squeezes the drum, >1 opens it out
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 0, max: 100, step: 1,    default: 35 },  // near faces grow, far ones shrink
    { key: 'shade',        label: 'Edge Shade',    type: 'slider', min: 0, max: 100, step: 1,    default: 40 },  // darkens faces as they turn away
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: -30, max: 30, step: 1,   default: 0 },   // degrees, whole drum
    { key: 'offset',       label: 'Offset',        type: 'xypad',                                default: { x: 0, y: 0 } },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.1,    default: 0.35 }, // turns/sec
  ],

  transform: (frame, index, count, v, ctx) => {
    const vertical = v.axis === 'vertical';
    const dir = v.direction === 'reverse' ? -1 : 1;

    // One slot per face. Clamped to the control's own range so a stale saved
    // value can't produce a degenerate prism.
    const faces = clamp(Math.round(count), 3, 12);
    const step = TAU / faces;

    // Period 1 = one full turn per cycle, so a whole number of turns fits the
    // clip and frame totalFrames lands back on frame 0.
    const turns = ctx.easedPhase((frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, 1)) * dir;

    // Angle between this face's outward normal and the viewer.
    const theta = turns * TAU + index * step;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const sizeFactor = v.cardSize / BASE;
    // Closed-prism apothem. The renderer normalizes a sprite's longest edge to
    // BASE and then applies our scale, so a face lands exactly `cardSize` px
    // wide — the apothem is therefore in cardSize px directly. Multiplying by
    // sizeFactor here (as this first did) scaled it a second time and pushed the
    // faces apart, leaving the prism open.
    const apothem = (v.cardSize / (2 * Math.tan(Math.PI / faces))) * v.girth;

    // Face centre: swept along the axis-perpendicular, depth from cos.
    const along = sinT * apothem;
    const z = cosT * apothem;

    // Perspective: nearer faces (z > 0) grow, far ones shrink.
    const persp = v.perspective / 100;
    const depthScale = 1 + persp * (z / Math.max(1, apothem)) * 0.35;

    // Foreshortening across the turn axis. Negative cos means the face points
    // away — it is culled below, so only the magnitude matters here.
    const squash = Math.abs(cosT);

    // Cull the far side. The fade is only wide enough to avoid a one-frame
    // artefact at the crossing; the squash already takes the face to zero width.
    const facing = smooth(clamp(cosT / 0.12, 0, 1));

    // Faces turning away also darken, which is what separates them from the one
    // pointing at the viewer on a flat-lit drum.
    const shaded = 1 - (v.shade / 100) * (1 - Math.max(0, cosT));

    const x = (vertical ? along : 0) + v.offset.x;
    const y = (vertical ? 0 : along) + v.offset.y;

    return {
      x,
      y,
      scale: sizeFactor * depthScale,
      rotation: (v.tilt * Math.PI) / 180,
      alpha: clamp(facing * shaded, 0, 1),
      // A vertical axis compresses horizontally; a horizontal axis vertically.
      scaleX: vertical ? squash : 1,
      scaleY: vertical ? 1 : squash,
      depth: z,
    };
  },
};

export const boxVariants: Template[] = [
  box,
  variant(box, 'box-02', 'Box Tumble', {
    axis: 'horizontal', count: 4, cardSize: 300, perspective: 50, shade: 55, speed: 0.3,
  }),
  variant(box, 'box-03', 'Box Drum', {
    count: 8, cardSize: 200, girth: 1.1, perspective: 60, shade: 50, tilt: -8, speed: 0.45,
  }),
];
