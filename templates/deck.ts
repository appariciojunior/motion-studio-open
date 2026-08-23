import type { Template } from '@/lib/types';
import { clamp, loopCycles, smooth } from '@/lib/motion';
import { cardPath } from '@/lib/cardPath';
import { variant } from './variant';

const BASE = 340;
const DEG = Math.PI / 180;

// A depth conveyor whose cards turn as they travel through the centre. This is
// the home for the WebGL tilt that was previously exposed as its own template:
// Tilt is a property of the deck, not a motion family.
const deck: Template = {
  meta: {
    id: 'deck-01', name: 'Deck 01', group: 'Deck', defaultEasing: { id: 'smooth' },
  },

  controls: [
    { key: 'direction',    label: 'Direction',     type: 'pills', options: ['up','down','left','right'], default: 'up' },
    { key: 'flipAxis',     label: 'Flip Axis',     type: 'pills', options: ['vertical','horizontal'], default: 'vertical' },
    { key: 'twoSided',     label: 'Two Sided',     type: 'toggle', options: ['off','on'], default: 'on' },
    { key: 'solo',         label: 'Solo',          type: 'toggle', options: ['off','on'], default: 'off' },
    { key: 'count',        label: 'Count',         type: 'slider', min: 2, max: 12, step: 1, default: 6 },
    { key: 'cardSize',     label: 'Plane Size',    type: 'slider', min: 80, max: 700, step: 1, default: 320 },
    { key: 'cornerRadius', label: 'Corner Radius', type: 'slider', min: 0, max: 100, step: 1, default: 16 },
    { key: 'distance',     label: 'Distance',      type: 'slider', min: 200, max: 5000, step: 10, default: 1000 },
    { key: 'perspective',  label: 'Perspective',   type: 'slider', min: 0, max: 200, step: 1, default: 100 },
    { key: 'gap',          label: 'Gap',           type: 'slider', min: 0.1, max: 1, step: 0.01, default: 0.29 },
    { key: 'maxScale',     label: 'Max Scale',     type: 'slider', min: 1, max: 2, step: 0.01, default: 1.15 },
    { key: 'tilt',         label: 'Tilt',          type: 'slider', min: -30, max: 30, step: 0.5, default: 4.5 },
    { key: 'fade',         label: 'Fade',          type: 'slider', min: 0, max: 100, step: 1, default: 0 },
    { key: 'thickness',    label: 'Thickness',     type: 'slider', min: 0, max: 24, step: 1, default: 9, section: 'Finish', unit: 'px', advanced: true },
    { key: 'shadow',       label: 'Shadow',        type: 'toggle', options: ['on','off'], default: 'on', section: 'Finish' },
    { key: 'speed',        label: 'Speed',         type: 'slider', min: 0, max: 2, step: 0.1, default: 0.25 },
  ],

  // Pixi fallback for thumbnails and multi-layer scenes. It keeps the timing,
  // tilt and front/back hand-off but does not pretend to provide 3D depth.
  transform: (frame, index, count, v, ctx) => {
    const verticalTravel = v.direction === 'up' || v.direction === 'down';
    const dir = v.direction === 'up' || v.direction === 'left' ? 1 : -1;
    const phase = ctx.easedPhase(
      (frame / ctx.totalFrames) * loopCycles(v.speed, ctx.duration, count) * dir
    );
    const path = cardPath({ kind: 'line', index, count, phase, gap: 1, wrap: true });
    const offset = path.x;
    const dist = Math.abs(offset);
    const centre = smooth(clamp(1 - dist, 0, 1));
    const turn = Math.cos(offset * Math.PI);
    const wrapFade = count > 1
      ? smooth(clamp((count / 2 - dist) / 0.8, 0, 1))
      : 1;
    const soloFade = v.solo === 'on' ? centre : 1;
    const backVisible = v.twoSided === 'on' ? 1 : smooth(clamp(turn / 0.18, 0, 1));
    const along = offset * v.distance * v.gap;
    return {
      x: verticalTravel ? 0 : along,
      y: verticalTravel ? along : 0,
      scale: (v.cardSize / BASE) * (1 + (v.maxScale - 1) * centre),
      scaleX: v.flipAxis === 'horizontal' ? turn : 1,
      scaleY: v.flipAxis === 'vertical' ? turn : 1,
      rotation: v.tilt * DEG,
      alpha: clamp(wrapFade * soloFade * backVisible * (1 - (v.fade / 100) * (1 - path.depthNorm)), 0, 1),
      depth: centre,
    };
  },
};

export const deckVariants: Template[] = [
  deck,
  variant(deck, 'deck-02', 'Deck 02', {
    direction: 'down', flipAxis: 'horizontal', cardSize: 375,
    gap: 0.44, tilt: 0, perspective: 100,
  }),
  variant(deck, 'deck-03', 'Deck 03', {
    direction: 'left', cardSize: 445, distance: 1500,
    gap: 0.44, maxScale: 1, tilt: -8, fade: 30, perspective: 70,
  }),
];
