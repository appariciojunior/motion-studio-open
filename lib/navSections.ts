import { EXPERIMENTS_ENABLED } from './deployment';
import type { ProjectMode } from './projects';

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
  /**
   * Unfinished, and closed to people using a built app. See EXPERIMENTS_ENABLED
   * in lib/deployment.ts.
   *
   * Gating Boards takes the React component export with it: BoardExportBar is
   * the only caller of downloadSceneZip, and DesktopEditor only mounts it while
   * the board section is active. That is a deliberate decision, not an
   * oversight — the export needs a home outside Boards before it can come back,
   * because lib/exportScene.ts packs boardPose/boardCompose and emits a board.
   */
  gated?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  { id: 'projects', label: 'Projects', href: '/projects' },
  { id: 'library', label: 'Library', href: '/library' },
  { id: 'mockup', label: 'Mockup', href: '/mockup' },
  { id: '3d', label: '3D', href: '/3d', experimental: true, gated: true },
  { id: 'web', label: 'Web', href: '/web', experimental: true, gated: true },
  // Board mode — a DOM playground of arranged cards with hover interactions,
  // and the entry point for the drop-in React component export. Its nav id is
  // 'board' rather than the original 'new': the + button at the top of the rail
  // now creates a project, so the two ids would collide. Kept last in the list.
  { id: 'board', label: 'Boards', href: '/board', experimental: true, gated: true },
];

/** What `/` renders, and the fallback for any path we don't recognise. */
export const DEFAULT_SECTION: NavSectionId = 'library';

const SECTION_IDS = new Set<string>(NAV_SECTIONS.map((section) => section.id));

/**
 * A gated section is closed everywhere, not just hidden in the rail. The route
 * folders under app/(editor) still exist and still resolve — every page.tsx
 * there returns null and EditorShell picks the stage from this function — so
 * dropping the rail button alone would leave /web reachable to anyone who typed
 * it. Answering DEFAULT_SECTION here is what actually shuts the door.
 */
export function isSectionAvailable(id: string | null | undefined): boolean {
  const section = NAV_SECTIONS.find((item) => item.id === id);
  return !!section && (!section.gated || EXPERIMENTS_ENABLED);
}

/** What the rail may offer. NAV_SECTIONS stays the full list, for route lookup. */
export const AVAILABLE_NAV_SECTIONS: NavSection[] = NAV_SECTIONS.filter((section) =>
  isSectionAvailable(section.id),
);

/**
 * `/mockup` → 'mockup'. `/` → the default section, because the index route is
 * an alias for the library rather than a redirect: a redirect would have to run
 * on a server, and the GitHub Pages build (STATIC_EXPORT=1) has none. A gated
 * section answers the same way, for the same reason.
 *
 * usePathname() already strips basePath, so the subpath deploy needs no special
 * casing here.
 */
export function sectionFromPathname(pathname: string | null | undefined): NavSectionId {
  const segment = (pathname ?? '').split('?')[0].split('/').filter(Boolean)[0];
  if (!segment || !SECTION_IDS.has(segment)) return DEFAULT_SECTION;
  return isSectionAvailable(segment) ? (segment as NavSectionId) : DEFAULT_SECTION;
}

/** Convert the current editor tab into the type of document it creates. */
export function modeForSection(section: string | null | undefined): ProjectMode {
  return section === 'mockup' ? 'mockup' : '2d';
}

/** A project's mode is fixed, so its route no longer depends on navigation history. */
export function sectionForProject(mode: ProjectMode): NavSection {
  const id: NavSectionId = mode === 'mockup' ? 'mockup' : 'library';
  return NAV_SECTIONS.find((section) => section.id === id)!;
}
