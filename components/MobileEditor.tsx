'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import TemplatesCard from './TemplatesCard';
import MediaSidebar from './MediaSidebar';
import ScenePanel from './ScenePanel';
import EffectsPanel from './EffectsPanel';
import CanvasPanel from './CanvasPanel';
import ProjectsPanel from './ProjectsPanel';
import HistoryControls from './HistoryControls';
import MobileTransport from './MobileTransport';
import ExportDialog from './ExportDialog';
import { useUIStore } from '@/store/useUIStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useSceneStore } from '@/store/useSceneStore';
import { AdjustIcon, BackIcon, CanvasIcon, ChevronDownIcon, ExportIcon, InfoIcon, LibraryIcon, MediaIcon, ProjectsIcon, ThemeGlyph } from './EditorIcons';
import { MobileInteractionProvider } from './MobileInteractions';

const PreviewStage = dynamic(() => import('./PreviewStage'), { ssr: false });

type Tab = 'templates' | 'media' | 'adjust' | 'canvas';

const NAV: { id: Tab | 'export'; label: string; icon: React.ReactNode }[] = [
  { id: 'templates', label: 'Templates', icon: <LibraryIcon /> },
  { id: 'media', label: 'Media', icon: <MediaIcon /> },
  { id: 'adjust', label: 'Adjust', icon: <AdjustIcon /> },
  { id: 'canvas', label: 'Canvas', icon: <CanvasIcon /> },
  { id: 'export', label: 'Export', icon: <ExportIcon size={20} /> },
];

export default function MobileEditor() {
  const tab = useUIStore((s) => s.mobileTab);
  const panelOpen = useUIStore((s) => s.mobilePanelOpen);
  const projectsOpen = useUIStore((s) => s.mobileProjectsOpen);
  const setTab = useUIStore((s) => s.setMobileTab);
  const setPanelOpen = useUIStore((s) => s.setMobilePanelOpen);
  const setProjectsOpen = useUIStore((s) => s.setMobileProjectsOpen);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const projects = useProjectStore((s) => s.projects);
  const activeId = useProjectStore((s) => s.activeId);
  const trackCount = useSceneStore((s) => s.tracks.length);
  const [exportOpen, setExportOpen] = useState(false);
  const [desktopNotice, setDesktopNotice] = useState(false);
  const activeProject = projects.find((project) => project.id === activeId);

  const selectTab = (id: Tab | 'export') => {
    if (id === 'export') {
      setExportOpen(true);
      return;
    }
    if (id === tab && panelOpen) {
      setPanelOpen(false);
      return;
    }
    setTab(id);
  };

  return (
    <MobileInteractionProvider>
    <div className={`mobile-editor ${panelOpen ? 'mobile-panel-is-open' : 'mobile-panel-is-closed'}`}>
      <header className="mobile-topbar">
        <button className="mobile-project-button" onClick={() => setProjectsOpen(true)} aria-label="Open projects">
          <ProjectsIcon size={18} />
          <span>{activeProject?.name ?? 'Projects'}</span>
          <ChevronDownIcon size={12} />
        </button>
        <div className="mobile-top-actions">
          <HistoryControls />
          <button
            className="mobile-icon-button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            <ThemeGlyph size={18} />
          </button>
          <button className="mobile-icon-button" onClick={() => setDesktopNotice(true)} aria-label="Desktop tools information">
            <InfoIcon size={18} />
          </button>
        </div>
      </header>

      <main className="stage-col mobile-stage">
        <PreviewStage />
      </main>

      <MobileTransport />

      <section className="mobile-panel" aria-label={`${tab} controls`}>
        <div className="mobile-panel-handle" aria-hidden="true" />
        <div className="mobile-panel-scroll">
          {tab === 'templates' && (
            <TemplatesCard
              customPresetsEnabled={false}
              onSelect={() => setPanelOpen(false)}
            />
          )}
          {tab === 'media' && <MediaSidebar />}
          {tab === 'adjust' && (
            <div className="mobile-composed-panel">
              {trackCount > 1 && <div className="mobile-desktop-hint">This project has {trackCount} layers. Manage layers and their timeline on desktop.</div>}
              <ScenePanel />
              <div className="hairline" />
              <EffectsPanel />
            </div>
          )}
          {tab === 'canvas' && (
            <div className="mobile-composed-panel">
              <CanvasPanel />
              <div className="mobile-desktop-hint">3D, Web and Board tools are available on desktop.</div>
            </div>
          )}
        </div>
      </section>

      <nav className="mobile-bottom-nav" aria-label="Editor sections">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`mobile-nav-item ${item.id === tab && panelOpen ? 'active' : ''} ${item.id === 'export' ? 'mobile-nav-export' : ''}`}
            onClick={() => selectTab(item.id)}
            aria-current={item.id === tab && panelOpen ? 'page' : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {projectsOpen && (
        <div className="mobile-projects-screen">
          <header className="mobile-subpage-head">
            <button className="mobile-icon-button" onClick={() => setProjectsOpen(false)} aria-label="Back to editor">
              <BackIcon />
            </button>
            <strong>Projects</strong>
            <span />
          </header>
          <ProjectsPanel onProjectOpen={() => setProjectsOpen(false)} />
        </div>
      )}

      {desktopNotice && (
        <div className="mobile-notice-backdrop" onClick={() => setDesktopNotice(false)}>
          <div className="mobile-notice" role="dialog" aria-modal="true" aria-labelledby="desktop-tools-title" onClick={(event) => event.stopPropagation()}>
            <strong id="desktop-tools-title">Desktop tools</strong>
            <p>3D, Web, Board and advanced layer timeline editing need a larger screen. Your projects remain available when you return on desktop.</p>
            <button className="btn primary full" onClick={() => setDesktopNotice(false)}>Got it</button>
          </div>
        </div>
      )}

      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
    </MobileInteractionProvider>
  );
}
