'use client';

import { useUIStore } from '@/store/useUIStore';
import { useProjectStore } from '@/store/useProjectStore';
import { AddIcon, BoardIcon, LibraryIcon, MoonIcon, ProjectsIcon, SunIcon, ThreeDIcon, WebIcon } from './EditorIcons';

const NAV = [
  { id: 'projects', label: 'Projects', icon: (
    <ProjectsIcon />
  ) },
  { id: 'library', label: 'Library', icon: (
    <LibraryIcon />
  ) },
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
  { id: 'board', label: 'Board', icon: (
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
          <svg width="42" height="19" viewBox="0 0 42 19" fill="none">
            <rect x="1" y="2" width="10" height="15" rx="2.5" fill="currentColor"/>
            <rect x="14" y="4.5" width="8" height="10" rx="2" fill="currentColor" opacity="0.55"/>
            <rect x="25" y="6.5" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.3"/>
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
