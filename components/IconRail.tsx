'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { modeForSection, NAV_SECTIONS, sectionFromPathname, type NavSectionId } from '@/lib/navSections';
import LogoMark from '@/components/LogoMark';
import { useUIStore } from '@/store/useUIStore';
import { useProjectStore } from '@/store/useProjectStore';
import { capturePoster } from '@/lib/projectPoster';
import UpdateNotifier from './UpdateNotifier';
import { AddIcon, BoardIcon, ChevronDownIcon, ExperimentalsIcon, LibraryIcon, MockupIcon, MoonIcon, ProjectsIcon, SunIcon, ThreeDIcon, WebIcon } from './EditorIcons';

const ICONS: Record<NavSectionId, React.ReactNode> = {
  projects: <ProjectsIcon />,
  library: <LibraryIcon />,
  mockup: <MockupIcon />,
  '3d': <ThreeDIcon />,
  web: <WebIcon />,
  board: <BoardIcon />,
};

const NAV = NAV_SECTIONS.filter((section) => !section.experimental);
const EXPERIMENTAL_NAV = NAV_SECTIONS.filter((section) => section.experimental);

export default function IconRail() {
  // The URL owns the active section (EditorShell mirrors it into the store for
  // the panels). Reading the pathname here means back/forward and pasted links
  // light up the right rail item without a second source of truth.
  const active = sectionFromPathname(usePathname());
  const router = useRouter();
  const theme = useUIStore((s) => s.theme);
  const setNav = useUIStore((s) => s.setNav);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const createProject = useProjectStore((s) => s.create);
  const projectCount = useProjectStore((s) => s.projects.length);
  const [experimentalsOpen, setExperimentalsOpen] = useState(false);
  const experimentalActive = EXPERIMENTAL_NAV.some((item) => item.id === active);

  // Leaving a section is the one moment the stage still shows what the user was
  // working on AND we know they're about to look elsewhere — so that is when the
  // project's card picture is grabbed. Reading the id at click time keeps the
  // rail from re-rendering on every project switch.
  const leaveSection = (next: NavSectionId) => {
    if (next !== active) capturePoster(useProjectStore.getState().activeId);
    setNav(next);
  };

  // An ACTION, not a nav section — so it never takes the active state. The +
  // icon at the top of the rail now creates what it looks like it creates.
  const newProject = () => {
    createProject(`Project ${projectCount + 1}`, modeForSection(active));
    setNav('projects');
    router.push('/projects');
  };

  return (
    <aside className="card rail">
      <div className="rail-top">
        <div className="rail-logo-wrap">
          <div className="rail-logo">
            <LogoMark />
          </div>
          <span className="beta-tag rail-beta-tag">Beta</span>
        </div>
        <button className="rail-item rail-action" onClick={newProject} title="Create a new project">
          <span className="rail-ico">
            <AddIcon />
          </span>
          <span className="rail-label">New</span>
        </button>
        {NAV.map((n) => (
          <Link
            key={n.id}
            href={n.href}
            // Setting the store on click as well as on the URL change keeps the
            // panel swap on the same frame as the click: the mirror in
            // EditorShell is an effect, which lands a frame later.
            onClick={() => leaveSection(n.id)}
            aria-current={active === n.id ? 'page' : undefined}
            className={`rail-item ${active === n.id ? 'active' : ''}`}
          >
            <span className="rail-ico">{ICONS[n.id]}</span>
            <span className="rail-label">{n.label}</span>
          </Link>
        ))}
        <button
          className={`rail-item rail-experimentals ${experimentalActive ? 'active' : ''}`}
          onClick={() => setExperimentalsOpen((open) => !open)}
          aria-expanded={experimentalsOpen}
          aria-controls="experimental-nav-items"
        >
          <span className="rail-ico"><ExperimentalsIcon /></span>
          <span className="rail-label">Experiments</span>
          <span className={`rail-exp-chevron ${experimentalsOpen ? 'open' : ''}`}><ChevronDownIcon size={10} /></span>
        </button>
        <div
          id="experimental-nav-items"
          className={`rail-experimental-items ${experimentalsOpen ? 'open' : 'closed'}`}
          aria-hidden={!experimentalsOpen}
        >
          <div className="rail-experimental-inner">
            {EXPERIMENTAL_NAV.map((n) => (
              <Link
                key={n.id}
                href={n.href}
                tabIndex={experimentalsOpen ? 0 : -1}
                onClick={() => leaveSection(n.id)}
                aria-current={active === n.id ? 'page' : undefined}
                className={`rail-item rail-subitem ${active === n.id ? 'active' : ''}`}
              >
                <span className="rail-ico">{ICONS[n.id]}</span>
                <span className="rail-label">{n.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <div className="rail-bottom">
        <UpdateNotifier />
        <button
          className="rail-item rail-theme"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          <span className="rail-ico">
            {theme === 'dark' ? (
              <SunIcon />
            ) : (
              <MoonIcon />
            )}
          </span>
          <span className="rail-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </aside>
  );
}
