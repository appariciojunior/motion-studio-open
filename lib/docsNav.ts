/**
 * The docs navigation.
 *
 * Deliberately a short, fixed list. An earlier cut generated one sidebar entry
 * per template family straight from the registry, which turned the docs into a
 * second catalogue browser — and the editor already is one, with search,
 * favourites and the real stage. These pages explain how the thing works; the
 * browsing happens in the app.
 */

export interface DocsLink {
  href: string;
  label: string;
}

export interface DocsSection {
  title: string;
  links: DocsLink[];
}

export const DOCS_SECTIONS: DocsSection[] = [
  {
    title: 'Getting started',
    links: [
      { href: '/docs', label: 'Introduction' },
      { href: '/docs/quick-start', label: 'Quick start' },
    ],
  },
  {
    title: 'How it works',
    links: [
      { href: '/docs/library', label: 'The Library' },
      { href: '/docs/media', label: 'Media' },
      { href: '/docs/canvas', label: 'Canvas' },
      { href: '/docs/timeline', label: 'Timeline' },
      { href: '/docs/effects', label: 'Effects' },
      { href: '/docs/mobile', label: 'On a phone' },
      { href: '/docs/mockup', label: 'The Mockup studio' },
      { href: '/docs/tracks', label: 'Motion tracks' },
      { href: '/docs/export', label: 'Export' },
    ],
  },
  {
    // Two subgroups, because there are exactly two places motion controls are
    // declared: per template, and once for the whole studio.
    title: 'Controls',
    links: [
      { href: '/docs/controls/library', label: 'Library' },
      { href: '/docs/controls/mockup', label: 'Mockup' },
    ],
  },
  {
    title: 'Changing it',
    links: [
      { href: '/docs/easing', label: 'Easing' },
      { href: '/docs/design', label: 'Design and theming' },
      { href: '/docs/new-motion', label: 'New motion' },
    ],
  },
];

/**
 * The search index.
 *
 * Hand-maintained on purpose: the pages are TSX, so there is no MDX AST to
 * harvest headings from, and a wrong-but-silent index is worse than a short
 * honest one. Keep the terms to what the page actually answers — when a page
 * gains a section, add its words here.
 */
export interface DocsSearchEntry {
  href: string;
  title: string;
  section: string;
  terms: string[];
}

export const DOCS_SEARCH: DocsSearchEntry[] = [
  {
    href: '/docs', title: 'Introduction', section: 'Getting started',
    terms: ['what is', 'overview', 'library', 'mockup', 'no account', 'runs locally', 'browser'],
  },
  {
    href: '/docs/quick-start', title: 'Quick start', section: 'Getting started',
    terms: ['install', 'npm run dev', 'first clip', 'media', 'canvas', 'adjust', 'undo', 'autosave'],
  },
  {
    href: '/docs/library', title: 'The Library', section: 'How it works',
    terms: ['preset', 'family', 'transform', 'pure function', 'card shape', 'lattice', 'loop', 'deep link', 'tpl'],
  },
  {
    href: '/docs/media', title: 'Media', section: 'How it works',
    terms: ['assets', 'images', 'video', 'reorder', 'crop', 'crop focus', 'card shape', 'auto', 'loop', 'hold', 'uploads', 'indexeddb', 'demo assets'],
  },
  {
    href: '/docs/canvas', title: 'Canvas', section: 'How it works',
    terms: ['aspect', 'ratio', '9:16', '1:1', 'pixel size', 'background', 'gradient', 'reflected card', 'blur', 'safe area', 'guides', 'logo', 'watermark'],
  },
  {
    href: '/docs/timeline', title: 'Timeline', section: 'How it works',
    terms: ['playhead', 'scrub', 'duration', 'frame rate', 'fps', 'ruler', 'lanes', 'blend mode', 'undo', 'redo', 'clock', 'playback'],
  },
  {
    href: '/docs/effects', title: 'Effects', section: 'How it works',
    terms: ['effect', 'filter', 'filter stack', 'pixelate', 'createFilter', 'order', 'post'],
  },
  {
    href: '/docs/mobile', title: 'On a phone', section: 'How it works',
    terms: ['mobile', 'phone', 'touch', 'tablet', 'breakpoint', 'sheet', 'bottom bar', 'drawer', 'hamburger', 'transport', 'scrubber'],
  },
  {
    href: '/docs/mockup', title: 'The Mockup studio', section: 'How it works',
    terms: ['device', 'iphone', 'ipad', 'macbook', 'display', 'finish', 'screen', 'status bar', 'animation preset', 'camera', 'lighting', 'save'],
  },
  {
    href: '/docs/tracks', title: 'Motion tracks', section: 'How it works',
    terms: ['track', 'layer', 'timeline', 'window', 'blend mode', 'clock', 'composite'],
  },
  {
    href: '/docs/export', title: 'Export', section: 'How it works',
    terms: ['mp4', 'webm', 'gif', 'h264', 'vp9', 'resolution', '4k', '1080p', 'webcodecs', 'ffmpeg', 'loop', 'encoder'],
  },
  {
    href: '/docs/controls/library', title: 'Library controls', section: 'Controls',
    terms: ['slider', 'toggle', 'pills', 'select', 'direction', 'color', 'xypad', 'upload', 'text', 'control types', 'declaration', 'visibleWhen', 'section', 'advanced', 'default', 'key', 'preset bundle'],
  },
  {
    href: '/docs/controls/mockup', title: 'Mockup controls', section: 'Controls',
    terms: ['mockup controls', 'lights', 'key light', 'fill light', 'ambient', 'exposure', 'material', 'wireframe', 'emissive', 'screen brightness', 'glare', 'adjustments', 'ground', 'shadow', 'rotation ball', 'trackball', 'view gizmo', 'field of view', 'laptop lid'],
  },
  {
    href: '/docs/easing', title: 'Easing', section: 'Changing it',
    terms: ['curve', 'bezier', 'phase', 'bounce', 'spring', 'wiggle', 'overshoot', 'sine', 'quad', 'cubic', 'expo', 'loop', 'timing function'],
  },
  {
    href: '/docs/design', title: 'Design and theming', section: 'Changing it',
    terms: ['tokens', 'colour', 'color', 'theme', 'dark mode', 'radius', 'type scale', 'restyle', 'accent', 'palette', 'hairline'],
  },
  {
    href: '/docs/new-motion', title: 'New motion', section: 'Changing it',
    terms: ['template', 'transform', 'pose', 'dim', 'alpha', 'clip', 'taper', 'depth', 'pure', 'seeded', 'registry', 'loopCycles', 'webgl', 'camera', 'tests'],
  },
];
