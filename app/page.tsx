'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import IconRail from '@/components/IconRail';
import TemplatesCard from '@/components/TemplatesCard';
import ScenePanel from '@/components/ScenePanel';
import CanvasPanel from '@/components/CanvasPanel';
import EffectsPanel from '@/components/EffectsPanel';
import AssetsPanel from '@/components/AssetsPanel';
import Timeline from '@/components/Timeline';
import BoardPanel from '@/components/BoardPanel';
import BoardExportBar from '@/components/BoardExportBar';
import WelcomeDialog from '@/components/WelcomeDialog';
import Effects3DPanel from '@/components/Effects3DPanel';
import Effect3DControls from '@/components/Effect3DControls';
import ModelControl from '@/components/ModelControl';
import ModelColors from '@/components/ModelColors';
import BackgroundFill from '@/components/BackgroundFill';
import WebScenePanel from '@/components/WebScenePanel';
import WebSelectionPanel from '@/components/WebSelectionPanel';
import WebCodeModal from '@/components/WebCodeModal';
import WebSourceBar from '@/components/WebSourceBar';
import { CollapsedStrip } from '@/components/TplCollapse';
import { useUIStore } from '@/store/useUIStore';
import { useProjectStore } from '@/store/useProjectStore';
import { startSceneAutosave } from '@/lib/scenePersist';
import { useWebStore } from '@/store/useWebStore';
import ProjectsPanel from '@/components/ProjectsPanel';

// Pixi must run client-side only.
const PreviewStage = dynamic(() => import('@/components/PreviewStage'), { ssr: false });
// Three.js 3D stage — also client-only.
const ThreeStage3D = dynamic(() => import('@/components/ThreeStage3D'), { ssr: false });
// Web mode compiles user source in the browser — client-only too.
const WebStage = dynamic(() => import('@/components/WebStage'), { ssr: false });
// Board mode poses DOM cards from a rAF loop — client-only too.
const BoardStage = dynamic(() => import('@/components/BoardStage'), { ssr: false });

export default function Home() {
  const nav = useUIStore((s) => s.nav);
  const leftCollapsed = useUIStore((s) => s.leftCollapsed);
  const rightCollapsed = useUIStore((s) => s.rightCollapsed);
  const toggleLeftPanel = useUIStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const is3D = nav === '3d';
  const isWeb = nav === 'web';
  const isBoard = nav === 'board';
  // Projects swaps the left column for the project list; the stage, scene column
  // and timeline keep showing the open project, so switching is a live preview.
  const isProjects = nav === 'projects';
  const codeOpen = useWebStore((s) => s.codeOpen);
  const tplCollapsed = useUIStore((s) => s.tplCollapsed);

  // Open the active project on mount (after hydration, so no SSR mismatch), then
  // start throttled auto-save into it. bootstrap() also migrates a pre-projects
  // scene into a project and rebuilds uploaded media urls from IndexedDB.
  useEffect(() => {
    useUIStore.getState().hydratePreferences();
    useProjectStore.getState().bootstrap();
    return startSceneAutosave();
  }, []);

  return (
    <div className={`app ${is3D ? 'app-3d' : ''} ${isWeb || isBoard ? 'app-web' : ''} ${tplCollapsed ? 'app-tpl-collapsed' : ''} ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}>

      <IconRail />

      {/* left column — motion templates (2D, web, board) or the 3D effect
          picker, foldable to a strip when the stage needs the width.
          Web and board reuse the template list wholesale: the templates are
          pure frame→pose functions, so the picker doesn't care what renders
          them. */}
      {tplCollapsed ? <CollapsedStrip /> : isProjects ? <ProjectsPanel /> : is3D ? <Effects3DPanel /> : <TemplatesCard controlsInline={isBoard} />}

      {/* middle SCENE column — 2D only. 3D, web and board fold everything into
          the single right sidebar rather than run two 280px panels side by
          side. */}
      {!is3D && !isWeb && !isBoard && (
        <section className="card controls card-scroll">
          <ScenePanel />
          <div className="hairline" />
          <EffectsPanel />
        </section>
      )}

      <main className="stage-col">
        {isBoard ? (
          <BoardStage />
        ) : isWeb ? (
          <WebStage />
        ) : is3D ? (
          <ThreeStage3D />
        ) : (
          <>
            <PreviewStage />
            <button className="stage-fs" title="Fullscreen">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </>
        )}
        <button
          className="panel-toggle panel-toggle-left"
          onClick={toggleLeftPanel}
          aria-expanded={!leftCollapsed}
          aria-label={leftCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}
          title={leftCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button
          className="panel-toggle panel-toggle-right"
          onClick={toggleRightPanel}
          aria-expanded={!rightCollapsed}
          aria-label={rightCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'}
          title={rightCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </main>

      {/* right column — canvas/assets (2D) or current 3D effect controls */}
      <section className="card right card-scroll">
        {isBoard ? (
          <BoardPanel />
        ) : isWeb ? (
          <>
            {/* what animates, then how it moves */}
            <WebSelectionPanel />
            <div className="hairline" />
            <WebScenePanel />
          </>
        ) : is3D ? (
          <>
            <ModelControl />
            <div className="hairline" />
            <ModelColors />
            <div className="hairline" />
            <BackgroundFill />
            <div className="hairline" />
            <Effect3DControls />
          </>
        ) : (
          <>
            <CanvasPanel />
            <div className="hairline" />
            <AssetsPanel />
          </>
        )}
      </section>

      <footer className="card bottom">
        {/* Video export is a 2D/3D product; web mode's deliverable is a zip
            of the user's component, which doesn't exist yet. Its source
            controls take that slot. */}
        <Timeline showExport={!isWeb && !isBoard} extra={isWeb ? <WebSourceBar /> : isBoard ? <BoardExportBar /> : undefined} />
      </footer>

      <WelcomeDialog />
      {isWeb && codeOpen && <WebCodeModal />}
    </div>
  );
}
