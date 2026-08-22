'use client';

import { useState } from 'react';
import { useUIStore } from '@/store/useUIStore';
import { useProjectStore } from '@/store/useProjectStore';
import { AddIcon, BoardIcon, ChevronDownIcon, ExperimentalsIcon, LibraryIcon, MockupIcon, MoonIcon, ProjectsIcon, SunIcon, ThreeDIcon, WebIcon } from './EditorIcons';

const NAV = [
  { id: 'projects', label: 'Projects', icon: (
    <ProjectsIcon />
  ) },
  { id: 'library', label: 'Library', icon: (
    <LibraryIcon />
  ) },
  { id: 'mockup', label: 'Mockup', icon: (
    <MockupIcon />
  ) },
];

const EXPERIMENTAL_NAV = [
  { id: '3d', label: '3D', icon: (
    <ThreeDIcon />
  ) },
  { id: 'web', label: 'Web', icon: (
    <WebIcon />
  ) },
  // Board mode — a DOM playground of arranged cards with hover interactions,
  // and the entry point for the drop-in React component export. Its nav id is
  // 'board' rather than the original 'new': the + button at the top of the rail
  // now creates a project, so the two ids would collide. Kept last in the list.
  { id: 'board', label: 'Boards', icon: (
    <BoardIcon />
  ) },
];

export default function IconRail() {
  const active = useUIStore((s) => s.nav);
  const theme = useUIStore((s) => s.theme);
  const setActive = useUIStore((s) => s.setNav);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const createProject = useProjectStore((s) => s.create);
  const projectCount = useProjectStore((s) => s.projects.length);
  const [experimentalsOpen, setExperimentalsOpen] = useState(false);
  const experimentalActive = EXPERIMENTAL_NAV.some((item) => item.id === active);

  // An ACTION, not a nav section — so it never takes the active state. The +
  // icon at the top of the rail now creates what it looks like it creates.
  const newProject = () => {
    createProject(`Project ${projectCount + 1}`);
    setActive('projects');
  };

  return (
    <aside className="card rail">
      <div className="rail-top">
        <div className="rail-logo">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <path d="M 16.062 13.551 L 16.062 0.5 L 13.14 0.5 C 13.14 4.102 11.665 7.371 9.292 9.727 C 6.826 12.185 3.482 13.561 0 13.55 L 0 16.45 L 13.143 16.45 L 13.143 29.5 L 16.064 29.5 C 16.057 26.033 17.443 22.708 19.912 20.273 C 22.383 17.821 25.724 16.447 29.205 16.451 L 29.205 13.551 Z" fill="currentColor" />
          </svg>
        </div>
        <button className="rail-item rail-action" onClick={newProject} title="Create a new project">
          <span className="rail-ico">
            <AddIcon />
          </span>
          <span className="rail-label">New</span>
        </button>
        {NAV.map((n) => (
          <button key={n.id} className={`rail-item ${active === n.id ? 'active' : ''}`} onClick={() => setActive(n.id)}>
            <span className="rail-ico">{n.icon}</span>
            <span className="rail-label">{n.label}</span>
          </button>
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
              <button key={n.id} tabIndex={experimentalsOpen ? 0 : -1} className={`rail-item rail-subitem ${active === n.id ? 'active' : ''}`} onClick={() => setActive(n.id)}>
                <span className="rail-ico">{n.icon}</span>
                <span className="rail-label">{n.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="rail-bottom">
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
