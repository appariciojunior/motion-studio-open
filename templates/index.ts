import type { Template } from '@/lib/types';
import { DEFAULT_EASING, type EasingSpec } from '@/lib/easing';
import { carousel, carouselRefVariants } from './carousel';
import { variant } from './variant';
import { wheelVariants } from './wheel';
import { orbitVariants } from './orbit';
import { orbit3dVariants } from './orbit3d';
import { spinVariants } from './spin';
import { stackVariants } from './stack';
import { storiesVariants } from './stories';
import { flickerVariants, flickerRefVariants } from './flicker';
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
import { bloomVariants } from './bloom';
import { scatterVariants } from './scatter';
import { revealVariants } from './reveal';
import { framesVariants } from './frames';
import { gridVariants } from './grid';
import { blankVariants } from './blank';
import { galleryVariants } from './gallery';
import { tickerVariants } from './ticker';
import { isometricVariants } from './isometric';
import { coverflowVariants } from './coverflow';
import { deckVariants } from './deck';
import { flipVariants } from './flipgrid';
import { boxVariants } from './box';
import { surfaceVariants } from './surface';
import { premium3dTemplates } from './premium3d';
import { showcaseVariants } from './showcase';
import { helix3dVariants } from './helix3d';

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

// The reference's complete "3D & Perspective" shelf, in the same order.
// Each item still lives in the geometry file it shares with related presets;
// this array is catalogue composition only.
const perspective3dTemplates: Template[] = [
  showcaseVariants[0],
  surfaceVariants[0],
  globeVariants[0],
  globeVariants[1],
  surfaceVariants[1],
  surfaceVariants[2],
  premium3dTemplates[2],
  premium3dTemplates[0],
  helix3dVariants[0],
  premium3dTemplates[1],
];

// Order follows the reference catalogue's sidebar.
export const templateList: Template[] = [
  ...perspective3dTemplates,
  ...carouselVariants,
  ...carouselRefVariants,
  ...orbitVariants,
  ...orbit3dVariants,
  ...showcaseVariants.slice(1),
  ...spinVariants,
  ...stackVariants,
  ...wheelVariants,
  ...fieldVariants,
  ...wipeVariants,
  ...storiesVariants,
  ...storiesFocusVariants,
  ...flickerVariants,
  ...flickerRefVariants,
  ...globeVariants.slice(2),
  ...spiralVariants,
  ...helix3dVariants.slice(1),
  ...tourVariants,
  ...gravityVariants,
  ...parallaxVariants,
  ...scatterVariants,
  ...scaleVariants,
  ...zoomVariants,
  ...bloomVariants,
  ...proximityVariants,
  ...revealVariants,
  ...framesVariants,
  ...gridVariants,
  ...blankVariants,
  ...galleryVariants,
  ...tickerVariants,
  ...isometricVariants,
  ...coverflowVariants,
  ...deckVariants,
  ...flipVariants,
  ...boxVariants,
];

export const templates: Record<string, Template> = Object.fromEntries(
  templateList.map((t) => [t.meta.id, t])
);

// Templates can remain addressable for persisted scenes while being withheld
// from every picker until their visual quality is ready for the catalogue.
export const catalogTemplateList = templateList.filter((t) => !t.meta.catalogHidden);

// Group order follows the reference catalogue.
export const templateGroups: { group: string; items: Template[] }[] = (() => {
  const order: string[] = [];
  const map = new Map<string, Template[]>();
  // A renderer is an implementation detail, not a catalogue category. Runway
  // may use WebGL for perspective and Ticker Tilt may use it for a rigid plane,
  // but neither belongs to the same family as Box, Globe or Surface.
  for (const t of catalogTemplateList) {
    const group = t.meta.group === '3D & Perspective'
      ? t.meta.group
      : t.meta.catalog3d ? `${t.meta.group} 3D` : t.meta.group;
    if (!map.has(group)) { map.set(group, []); order.push(group); }
    map.get(group)!.push(t);
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
