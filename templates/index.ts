import type { Template } from '@/lib/types';
import { DEFAULT_EASING, type EasingSpec } from '@/lib/easing';
import { carousel } from './carousel';
import { variant } from './variant';
import { wheelVariants } from './wheel';
import { orbitVariants } from './orbit';
import { orbit3dVariants } from './orbit3d';
import { spinVariants } from './spin';
import { stackVariants } from './stack';
import { storiesVariants } from './stories';
import { flickerVariants } from './flicker';
import { fieldVariants } from './field';
import { wipeVariants } from './wipe';
import { globeVariants } from './globe';
import { spiralVariants } from './spiral';
import { tourVariants } from './tour';
import { gravityVariants } from './gravity';
import { parallaxVariants } from './parallax';
import { scaleVariants } from './scale';
import { proximityVariants } from './proximity';
import { storiesFocusVariants } from './storiesFocus';
import { zoomVariants } from './zoom';
import { scatterVariants } from './scatter';
import { revealVariants } from './reveal';
import { blankVariants } from './blank';
import { galleryVariants } from './gallery';
import { tickerVariants } from './ticker';

const carouselVariants: Template[] = [
  { ...carousel, meta: { ...carousel.meta, name: 'Runway 01' } },
  variant(carousel, 'carousel-02', 'Runway 02', {
    gap: 140, bigScale: 145, perspective: 0, fade: 45, speed: 0.4,
  }),
  variant(carousel, 'carousel-03', 'Runway 03', {
    tiltStyle: 'fan', tiltAmount: 10, gap: 300, bigScale: 130, speed: 0.5,
  }),
  variant(carousel, 'carousel-04', 'Runway 04', {
    scaleFocus: 'start', bigScale: 160, gap: 260, fade: 30, direction: 'right',
  }),
  variant(carousel, 'carousel-05', 'Runway 05', {
    tiltStyle: 'alternate', tiltAmount: 6, direction: 'up', gap: 420, cornerRadius: 24,
  }),
];

// Order follows the reference catalogue's sidebar.
export const templateList: Template[] = [
  ...carouselVariants,
  ...orbitVariants,
  ...orbit3dVariants,
  ...spinVariants,
  ...stackVariants,
  ...wheelVariants,
  ...fieldVariants,
  ...wipeVariants,
  ...storiesVariants,
  ...storiesFocusVariants,
  ...flickerVariants,
  ...globeVariants,
  ...spiralVariants,
  ...tourVariants,
  ...gravityVariants,
  ...parallaxVariants,
  ...scatterVariants,
  ...scaleVariants,
  ...zoomVariants,
  ...proximityVariants,
  ...revealVariants,
  ...blankVariants,
  ...galleryVariants,
  ...tickerVariants,
];

export const templates: Record<string, Template> = Object.fromEntries(
  templateList.map((t) => [t.meta.id, t])
);

// Group order follows the reference catalogue.
export const templateGroups: { group: string; items: Template[] }[] = (() => {
  const order: string[] = [];
  const map = new Map<string, Template[]>();
  for (const t of templateList) {
    if (!map.has(t.meta.group)) { map.set(t.meta.group, []); order.push(t.meta.group); }
    map.get(t.meta.group)!.push(t);
  }
  return order.map((group) => ({ group, items: map.get(group)! }));
})();

export function getTemplate(id: string): Template {
  return templates[id] ?? carousel;
}

// Build the initial value bag from a template's declared defaults.
export function defaultsFor(id: string): Record<string, any> {
  const t = getTemplate(id);
  const values: Record<string, any> = {};
  for (const c of t.controls) {
    // clone objects (xypad) so state is never shared by reference
    values[c.key] = typeof c.default === 'object' && c.default !== null
      ? { ...(c.default as object) }
      : c.default;
  }
  return values;
}

// The easing curve a template ships with (falls back to linear).
export function easingFor(id: string): EasingSpec {
  const spec = getTemplate(id).meta.defaultEasing ?? DEFAULT_EASING;
  return { ...spec }; // clone so state never shares the preset reference
}
