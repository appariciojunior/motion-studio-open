import type { Template } from '@/lib/types';
import { smooth, clamp } from '@/lib/motion';
import { variant } from './variant';
import { tiltPointCanvas } from '@/lib/tilt3d';

const BASE = 340;
const TEX_RATIO = 480 / 600; // house placeholder/texture proportion

// Frames Reveal — editorial magazine panels revealed one-by-one with a sweep,
// held, then swept out in reverse so the clip loops cleanly (frame 0 ≡ frame N:
// both fully empty). Layouts are pure data: panel rects in normalized canvas
// fractions (centre origin), ordered by reveal row.
interface Panel { x: number; y: number; w: number; h: number; row: number }

const LAYOUTS: Record<string, Panel[]> = {
  splitTop: [
    { x: 0, y: -0.22, w: 0.90, h: 0.50, row: 0 },
    { x: -0.235, y: 0.28, w: 0.43, h: 0.42, row: 1 },
    { x: 0.235, y: 0.28, w: 0.43, h: 0.42, row: 1 },
  ],
  thirds: [
    { x: -0.28, y: 0, w: 0.38, h: 0.92, row: 0 },
    { x: 0.20, y: -0.24, w: 0.52, h: 0.42, row: 1 },
    { x: 0.20, y: 0.24, w: 0.52, h: 0.42, row: 2 },
  ],
  grid6: [
    { x: -0.235, y: -0.31, w: 0.43, h: 0.28, row: 0 },
    { x: 0.235, y: -0.31, w: 0.43, h: 0.28, row: 0 },
    { x: -0.235, y: 0, w: 0.43, h: 0.28, row: 1 },
    { x: 0.235, y: 0, w: 0.43, h: 0.28, row: 1 },
    { x: -0.235, y: 0.31, w: 0.43, h: 0.28, row: 2 },
    { x: 0.235, y: 0.31, w: 0.43, h: 0.28, row: 2 },
  ],
  columns: [
    { x: -0.235, y: 0, w: 0.43, h: 0.92, row: 0 },
    { x: 0.235, y: 0, w: 0.43, h: 0.92, row: 1 },
  ],
};

const reveal: Template = {
  meta: {
    id: 'frames-05', name: 'Editorial Reveal', group: 'Editorial',
    defaultEasing: { id: 'flow' }, repeatAssets: true,
  },

  controls: [
    { key: 'layout',       label: 'Layout',        type: 'select', options: ['splitTop','thirds','grid6','columns'], default: 'splitTop' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 6, step: 1,    default: 6 },
    { key: 'sweep',        label: 'Sweep',         type: 'slider', min: 20, max: 90, step: 1,  default: 40 },  // % of the clip spent revealing + hiding
    { key: 'rowsSkipped',  label: 'Rows Skipped',  type: 'slider', min: 0, max: 2, step: 1,    default: 0 },   // interleave reveal rows per pass
    { key: 'gap',          label: 'Inset',         type: 'slider', min: 50, max: 130, step: 1, default: 100 }, // panel size %
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 0 },
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: -15, max: 15, step: 0.5, default: 0 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const panels = LAYOUTS[v.layout] ?? LAYOUTS.splitTop;
    const panel = panels[index];
    if (!panel) return { x: 0, y: 0, scale: 0, rotation: 0, alpha: 0, depth: -1 }; // unused slot

    // ---- reveal order: rows interleaved by rowsSkipped ----
    const rows = Math.max(...panels.map((p) => p.row)) + 1;
    const skip = Math.min(Math.round(v.rowsSkipped), Math.max(0, rows - 1)) + 1;
    // pass ordering: rows 0, skip, 2*skip, …, then 1, 1+skip, …
    const rowRank: number[] = new Array(rows).fill(0);
    let rank = 0;
    for (let start = 0; start < skip; start++)
      for (let r = start; r < rows; r += skip) rowRank[r] = rank++;
    const order = panels
      .map((p, i) => ({ i, key: rowRank[p.row] * 100 + p.x }))
      .sort((a, b) => a.key - b.key)
      .findIndex((o) => o.i === index);
    const n = panels.length;

    // ---- loop-safe timeline: sweep in → hold → sweep out (reverse order) ----
    const tn = frame / ctx.totalFrames;
    const half = clamp(v.sweep / 100, 0.2, 0.9) / 2; // each sweep's share of the clip
    const win = 1.5 / n;                              // per-panel ramp width within a sweep

    let vis: number;
    if (tn < half) {
      const p = ctx.ease(tn / half) * (1 + win);      // 0..1+win across the in-sweep
      vis = smooth((p - order / n) / win);
    } else if (tn > 1 - half) {
      const p = ctx.ease((1 - tn) / half) * (1 + win); // mirror: reverse reveal
      vis = smooth((p - (n - 1 - order) / n) / win);
    } else {
      vis = 1;                                        // hold — fully assembled
    }

    // ---- panel geometry (normalized → px, squashed to the panel's aspect) ----
    const inset = v.gap / 100;
    const pw = panel.w * ctx.width * inset;
    const ph = panel.h * ctx.height * inset;
    // base sprite is BASE px on its long edge with TEX_RATIO width:height
    const scale = ph / BASE;
    const scaleX = (pw / ph) / TEX_RATIO;

    const layoutPoint = tiltPointCanvas(
      { x: panel.x * ctx.width, y: panel.y * ctx.height, z: 0 },
      { roll: v.tilt },
    );
    return {
      x: layoutPoint.x + v.offset.x,
      y: layoutPoint.y + v.offset.y,
      scale: scale * (0.94 + 0.06 * vis),             // slight settle as it lands
      scaleX,
      rotation: (v.tilt * Math.PI) / 180,
      alpha: vis,
      depth: order,
    };
  },
};

export const revealVariants: Template[] = [
  reveal,
  variant(reveal, 'frames-06', 'Editorial Reveal 02', { layout: 'grid6', sweep: 55, rowsSkipped: 1 }),
  variant(reveal, 'frames-07', 'Editorial Reveal 03', { layout: 'thirds', sweep: 35, tilt: -4 }),
  variant(reveal, 'frames-08', 'Editorial Reveal 04', { layout: 'columns', sweep: 50, cornerRadius: 10 }),
];
