import type { Template } from '@/lib/types';
import { loopCycles } from '@/lib/motion';
import { variant } from './variant';

const BASE = 340;
// The helix crosses its complete vertical span in one phase unit. Keep that
// traversal cinematic instead of interpreting Speed as full spans per second.
const HELIX_RATE = 0.2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Spiral — the camera corkscrews through a helix of cards (DNA / spiral
// staircase): continuous rotation around the axis plus looping vertical travel.
const spiral: Template = {
  meta: { id: 'spiral-01', name: 'Helix 01', group: 'Helix', repeatAssets: true, defaultEasing: { id: 'linear' } },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'toggle', options: ['forward','reverse'], default: 'forward' },
    { key: 'count',        label: 'Count',          type: 'slider', min: 8, max: 70, step: 1,   default: 40 },
    { key: 'radius',       label: 'Radius',         type: 'slider', min: 80, max: 600, step: 1, default: 300 },
    { key: 'turns',        label: 'Turns',          type: 'slider', min: 1, max: 6, step: 1,    default: 3 },
    { key: 'pitch',        label: 'Pitch',          type: 'slider', min: 10, max: 120, step: 1, default: 40 },
    { key: 'cardSize',     label: 'Plane Size',     type: 'slider', min: 20, max: 300, step: 1, default: 110 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 12 },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 3, step: 0.05, default: 0.2, unit: '×', precision: 2,
      description: 'Helix motion multiplier. Low values select the slowest seamless traversal supported by the clip.' },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const dir = v.direction === 'reverse' ? -1 : 1;
    // Keep complete cycles so the vertical wrap and rotation return to the same
    // pose at the seam. HELIX_RATE makes the old 0.50 setting resolve to one
    // traversal per default clip instead of four.
    const t = (frame / ctx.totalFrames) * loopCycles(v.speed * HELIX_RATE, ctx.duration) * dir;
    const sizeFactor = v.cardSize / BASE;

    // Angle around the helix axis.
    const a = index * (Math.PI * 2 * v.turns / count) + t * Math.PI * 2;
    const x = Math.sin(a) * v.radius + v.offset.x;
    const depthN = (Math.cos(a) + 1) / 2; // 1 = front, 0 = back

    // Vertical travel that loops seamlessly through one full helix span.
    const span = count * v.pitch;
    const raw = index * v.pitch - t * span;
    const y = (((raw % span) + span) % span) - span / 2 + v.offset.y;

    const scale = sizeFactor * lerp(0.4, 1.15, depthN);
    // Fade with depth, and taper at the top/bottom ends of the travel.
    const alpha = lerp(0.2, 1, depthN) * Math.min(1, (1 - Math.abs(y) / (span / 2)) * 2 + 0.2);

    return {
      x,
      y,
      scale,
      rotation: 0,
      alpha,
      depth: depthN,
    };
  },
};

export const spiralVariants: Template[] = [
  spiral, // Spiral 01 — classic staircase
  variant(spiral, 'spiral-02', 'Helix 02', {
    turns: 5, radius: 200, pitch: 30, speed: 0.18,
  }),
  variant(spiral, 'spiral-03', 'Helix 03', {
    turns: 2, radius: 480, pitch: 70, count: 30, speed: 0.14,
  }),
  variant(spiral, 'spiral-04', 'Helix 04', {
    turns: 6, radius: 140, pitch: 20, count: 60, cardSize: 80, speed: 0.16,
  }),
];
