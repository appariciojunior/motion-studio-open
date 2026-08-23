import type { Template } from '@/lib/types';
import { DEFAULT_EASING, type EasingSpec } from '@/lib/easing';
import { carousel, carouselVariants, carouselRefVariants } from './carousel';
import { wheelVariants } from './wheel';
import { wheelEllipseVariants } from './wheelEllipse';
import { arcVariants } from './arc';
import { orbitVariants } from './orbit';
import { orbit3dVariants } from './orbit3d';
import { spinVariants } from './spin';
import { revolveVariants } from './revolve';
import { stackVariants } from './stack';
import { storiesVariants } from './stories';
import { flickerVariants, flickerRefVariants } from './flicker';
import { fieldVariants } from './field';
import { wipeVariants } from './wipe';
import { wipeRevealVariants } from './wipeReveal';
import { globeVariants } from './globe';
import { spiralVariants } from './spiral';
import { spiralImagesVariants } from './spiralImages';
import { tourVariants } from './tour';
import { gravityVariants } from './gravity';
import { parallaxVariants } from './parallax';
import { scaleVariants } from './scale';
import { proximityVariants } from './proximity';
import { proximityFieldVariants } from './proximityField';
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
import { rippleVariants } from './flipgrid';
import { flipVariants } from './flip';
import { magazineVariants } from './magazine';
import { boxVariants } from './box';
import { surfaceVariants } from './surface';
import { premium3dTemplates } from './premium3d';
import { showcaseVariants } from './showcase';
import { helix3dVariants } from './helix3d';
import { interactiveCardsVariants } from './interactiveCards';
import { spinnerVariants } from './spinner';
import { stickerVariants } from './stickers';


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
  ...interactiveCardsVariants,
  ...spinnerVariants,
  ...stickerVariants,
  ...carouselVariants,
  ...carouselRefVariants,
  ...arcVariants,
  ...orbitVariants,
  ...orbit3dVariants,
  ...showcaseVariants.slice(1),
  ...spinVariants,
  ...revolveVariants,
  ...stackVariants,
  ...wheelVariants,
  ...wheelEllipseVariants,
  ...fieldVariants,
  ...wipeVariants,
  ...wipeRevealVariants,
  ...storiesVariants,
  ...storiesFocusVariants,
  ...flickerVariants,
  ...flickerRefVariants,
  ...globeVariants.slice(2),
  ...spiralVariants,
  ...spiralImagesVariants,
  ...helix3dVariants.slice(1),
  ...tourVariants,
  ...gravityVariants,
  ...parallaxVariants,
  ...scatterVariants,
  ...scaleVariants,
  ...zoomVariants,
  ...bloomVariants,
  ...proximityVariants,
  ...proximityFieldVariants,
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
  ...magazineVariants,
  ...rippleVariants,
  ...boxVariants,
];

export const templates: Record<string, Template> = Object.fromEntries(
  templateList.map((t) => [t.meta.id, t])
);

// Templates can remain addressable for persisted scenes while being withheld
// from every picker until their visual quality is ready for the catalogue.
const HIDDEN_CATALOG_GROUPS = new Set(['3D & Perspective', 'Dock', 'Editorial', 'Ripple']);
export const catalogTemplateList = templateList.filter(
  (t) => !t.meta.catalogHidden && !HIDDEN_CATALOG_GROUPS.has(t.meta.group)
);

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

// The number of layers a template actually wants. Everything that sizes a
// sprite pool, a thumbnail's pose list or a demo-slot tally must ask HERE, not
// read `values.count` directly — a lattice family derives its cell total from
// the canvas, so the two disagree and any site still reading the control lays
// out a different wall than the stage.
export function layerCountFor(
  id: string,
  values: Record<string, any>,
  ctx: { width: number; height: number; cardAspect?: number },
): number {
  const t = getTemplate(id);
  const derived = t.layerCount?.(values, ctx);
  if (typeof derived === 'number' && Number.isFinite(derived)) return Math.max(1, Math.round(derived));
  return Math.max(1, Math.round(values.count ?? 6));
}
