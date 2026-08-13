// The editor's sections in one place: the IconRail renders its buttons from
// this list, the route folders under app/(editor) are named after the slugs,
// and EditorShell maps the current URL back to the nav id every panel reads
// off useUIStore. Add a section here and it still needs its own page.tsx —
// the route has to exist for the URL to resolve.
export type NavSectionId = 'projects' | 'library' | 'mockup' | '3d' | 'web' | 'board';

export interface NavSection {
  id: NavSectionId;
  label: string;
  href: string;
  /** Lives under the collapsible "Experiments" group in the rail. */
  experimental?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  { id: 'projects', label: 'Projects', href: '/projects' },
  { id: 'library', label: 'Library', href: '/library' },
  { id: 'mockup', label: 'Mockup', href: '/mockup' },
  { id: '3d', label: '3D', href: '/3d', experimental: true },
  { id: 'web', label: 'Web', href: '/web', experimental: true },
  // Board mode — a DOM playground of arranged cards with hover interactions,
  // and the entry point for the drop-in React component export. Its nav id is
  // 'board' rather than the original 'new': the + button at the top of the rail
  // now creates a project, so the two ids would collide. Kept last in the list.
  { id: 'board', label: 'Boards', href: '/board', experimental: true },
];

/** What `/` renders, and the fallback for any path we don't recognise. */
export const DEFAULT_SECTION: NavSectionId = 'library';

const SECTION_IDS = new Set<string>(NAV_SECTIONS.map((section) => section.id));

/**
 * `/mockup` → 'mockup'. `/` → the default section, because the index route is
 * an alias for the library rather than a redirect: a redirect would have to run
 * on a server, and the GitHub Pages build (STATIC_EXPORT=1) has none.
 *
 * usePathname() already strips basePath, so the subpath deploy needs no special
 * casing here.
 */
export function sectionFromPathname(pathname: string | null | undefined): NavSectionId {
  const segment = (pathname ?? '').split('?')[0].split('/').filter(Boolean)[0];
  return segment && SECTION_IDS.has(segment) ? (segment as NavSectionId) : DEFAULT_SECTION;
}
