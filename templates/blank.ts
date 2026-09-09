import type { Template } from '@/lib/types';
import { canvasScale } from './lattice';

const BASE = 340;

// Blank — a minimal empty starting canvas: a static, centred grid with no motion.
// The transform ignores `frame` entirely, giving a still slate to build from.
const blank: Template = {
  meta: { id: 'blank-01', name: 'Canvas 01', group: 'Canvas', catalogHidden: true, defaultEasing: { id: 'linear' } },

  controls: [
    { key: 'count',        label: 'Count',         type: 'slider', min: 1, max: 12, step: 1,   default: 4 },
    { key: 'cols',         label: 'Columns',       type: 'slider', min: 1, max: 6, step: 1,    default: 2 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 50, max: 500, step: 1, default: 220 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1,  default: 14 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0, max: 200, step: 1,  default: 40 },
    { key: 'offset',       label: 'Offset',        type: 'xypad',                              default: { x: 0, y: 0 } },
  ],

  transform: (frame, index, count, v, ctx) => {
    const resolution = canvasScale(ctx);
    const sizeFactor = v.cardSize * resolution / BASE;
    const aspect = ctx.cardAspect ?? 4 / 5;
    const cols = Math.min(count, Math.max(1, Math.round(v.cols)));
    const rows = Math.ceil(count / cols);
    const col = index % cols;
    const row = Math.floor(index / cols);

    const spacingX = (v.cardSize * Math.min(1, aspect) + v.gap) * resolution;
    const spacingY = (v.cardSize * Math.min(1, 1 / aspect) + v.gap) * resolution;
    const rowCount = Math.min(cols, count - row * cols);
    const x = (col - (rowCount - 1) / 2) * spacingX + v.offset.x * resolution;
    const y = (row - (rows - 1) / 2) * spacingY + v.offset.y * resolution;

    return {
      x,
      y,
      scale: sizeFactor,
      rotation: 0,
      alpha: 1,
      depth: index,
    };
  },
};

export const blankVariants: Template[] = [blank];
