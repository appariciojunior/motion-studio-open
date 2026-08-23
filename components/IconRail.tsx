'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { NAV_SECTIONS, sectionFromPathname, type NavSectionId } from '@/lib/navSections';
import { useUIStore } from '@/store/useUIStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { BoardIcon, ChevronDownIcon, ExperimentalsIcon, LibraryIcon, MockupIcon, MoonIcon, ProjectsIcon, SunIcon, ThreeDIcon, WebIcon } from './EditorIcons';

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
const workspaceInitial = (name: string) => name.trim().slice(0, 1).toUpperCase() || 'W';

export default function IconRail() {
  // The URL owns the active section (EditorShell mirrors it into the store for
  // the panels). Reading the pathname here means back/forward and pasted links
  // light up the right rail item without a second source of truth.
  const pathname = usePathname();
  const active = sectionFromPathname(pathname);
  const browserView = useSearchParams().get('view') ?? 'projects';
  const theme = useUIStore((s) => s.theme);
  const setNav = useUIStore((s) => s.setNav);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const bootstrapWorkspaces = useWorkspaceStore((s) => s.bootstrap);
  const selectWorkspace = useWorkspaceStore((s) => s.select);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceCreateOpen, setWorkspaceCreateOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [experimentalsOpen, setExperimentalsOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const experimentalActive = EXPERIMENTAL_NAV.some((item) => item.id === active);
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0];

  useEffect(() => { bootstrapWorkspaces(); }, [bootstrapWorkspaces]);
  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) setWorkspaceMenuOpen(false);
    };
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, []);


  return (
    <aside className="card rail">
      <div className="rail-top">
        {active === 'projects' && <div className="rail-logo-wrap">
          <div className="rail-logo">
            <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
              <path d="M 16.062 13.551 L 16.062 0.5 L 13.14 0.5 C 13.14 4.102 11.665 7.371 9.292 9.727 C 6.826 12.185 3.482 13.561 0 13.55 L 0 16.45 L 13.143 16.45 L 13.143 29.5 L 16.064 29.5 C 16.057 26.033 17.443 22.708 19.912 20.273 C 22.383 17.821 25.724 16.447 29.205 16.451 L 29.205 13.551 Z" fill="currentColor" />
            </svg>
          </div>
          <span className="beta-tag rail-beta-tag">Beta</span>
        </div>}
        {active !== 'projects' && (
          <Link href="/projects" onClick={() => setNav('projects')} className="rail-item rail-home" aria-label="Início — projetos" title="Início — projetos">
            <span className="rail-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 10.75 12 3.7l8.5 7.05v8.1a1.65 1.65 0 0 1-1.65 1.65H5.15A1.65 1.65 0 0 1 3.5 18.85v-8.1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9.25 20.5v-5.8h5.5v5.8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg></span>
            <span className="rail-label">Início</span>
          </Link>
        )}        {active === 'projects' && workspace && (
          <div className="rail-workspace-wrap" ref={workspaceMenuRef}>
            <button className="rail-workspace-selector" onClick={() => setWorkspaceMenuOpen((open) => !open)} aria-expanded={workspaceMenuOpen} aria-controls="rail-workspace-menu" title={`Switch workspace (current: ${workspace.name})`}>
              <span className="workspace-avatar">{workspace.icon || workspaceInitial(workspace.name)}</span>
              <span className="rail-workspace-name">{workspace.name}</span>
              <span className={`rail-workspace-chevron ${workspaceMenuOpen ? 'open' : ''}`}><ChevronDownIcon size={11} /></span>
            </button>
            {workspaceMenuOpen && (
              <div id="rail-workspace-menu" className="rail-workspace-menu">
                <span className="workspace-dropdown-label">Workspaces</span>
                {workspaces.map((item) => (
                  <button key={item.id} className={`rail-workspace-option ${item.id === workspace.id ? 'active' : ''}`} onClick={() => { selectWorkspace(item.id); setWorkspaceMenuOpen(false); }}>
                    <span className="workspace-avatar">{item.icon || workspaceInitial(item.name)}</span><span>{item.name}</span>
                  </button>
                ))}
                <button type="button" className="rail-add-workspace" onClick={() => { setWorkspaceName("Novo workspace"); setWorkspaceCreateOpen(true); setWorkspaceMenuOpen(false); }}>+ Novo workspace</button>
              </div>
            )}
          </div>
        )}        {active === 'projects' && (
          <nav className="rail-browser-nav" aria-label="Workspace navigation">
            <Link className={`rail-browser-link ${browserView === 'recent' ? 'active' : ''}`} href="/projects?view=recent"><span className="rail-ico"><LibraryIcon /></span>Recentes</Link>
            <div className="rail-browser-divider" />
            <Link className={`rail-browser-link ${browserView === 'drafts' ? 'active' : ''}`} href="/projects?view=drafts"><span className="rail-ico"><ProjectsIcon /></span>Rascunhos</Link>
            <Link className={`rail-browser-link ${browserView === 'projects' ? 'active' : ''}`} href="/projects"><span className="rail-ico"><ProjectsIcon /></span>Todos os projetos</Link>
            <Link className={`rail-browser-link ${browserView === 'trash' ? 'active' : ''}`} href="/projects?view=trash"><span className="rail-ico">⌫</span>Lixeira</Link>
            <div className="rail-browser-divider" />
            <button type="button" className="rail-browser-link" disabled><span className="rail-ico">⚙</span>Admin</button>
          </nav>
        )}        {NAV.filter((n) => active === 'projects' || n.id !== 'projects').map((n) => (
          <Link
            key={n.id}
            href={n.href}
            // Setting the store on click as well as on the URL change keeps the
            // panel swap on the same frame as the click: the mirror in
            // EditorShell is an effect, which lands a frame later.
            onClick={() => setNav(n.id)}
            aria-current={active === n.id ? 'page' : undefined}
            title={n.label}
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
                onClick={() => setNav(n.id)}
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
      {workspaceCreateOpen && (
        <div className="workspace-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWorkspaceCreateOpen(false); }}>
          <form className="workspace-dialog" onSubmit={(event) => { event.preventDefault(); if (!workspaceName.trim()) return; createWorkspace(workspaceName); setWorkspaceCreateOpen(false); setWorkspaceName(''); }}>
            <span className="workspace-dialog-kicker">Novo workspace</span>
            <h2>Criar workspace</h2>
            <input autoFocus className="field" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} aria-label="Nome do workspace" />
            <div className="workspace-dialog-actions">
              <button type="button" className="workspace-secondary" onClick={() => { setWorkspaceCreateOpen(false); setWorkspaceName(''); }}>Cancelar</button>
              <button type="submit" className="workspace-primary">Criar</button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}
