'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import MediaSidebar from '@/components/MediaSidebar';
import BackgroundFill from '@/components/BackgroundFill';
import BoardExportBar from '@/components/BoardExportBar';
import BoardPanel from '@/components/BoardPanel';
import CanvasPanel from '@/components/CanvasPanel';
import Effect3DControls from '@/components/Effect3DControls';
import Effects3DPanel from '@/components/Effects3DPanel';
import EffectsPanel from '@/components/EffectsPanel';
import HistoryControls from '@/components/HistoryControls';
import IconRail from '@/components/IconRail';
import ModelColors from '@/components/ModelColors';
import ModelControl from '@/components/ModelControl';
import MockupPanel from '@/components/MockupPanel';
import ProjectDock from '@/components/ProjectDock';
import ProjectsBrowser from '@/components/ProjectsBrowser';
import ScenePanel from '@/components/ScenePanel';
import ScreenContent from '@/components/ScreenContent';
import TemplatesCard from '@/components/TemplatesCard';
import Timeline from '@/components/Timeline';
import { CollapsedStrip } from '@/components/TplCollapse';
import WebCodeModal from '@/components/WebCodeModal';
import WebScenePanel from '@/components/WebScenePanel';
import WebSelectionPanel from '@/components/WebSelectionPanel';
import WebSourceBar from '@/components/WebSourceBar';
import { use3DStore } from '@/store/use3DStore';
import { useUIStore } from '@/store/useUIStore';
import { useWebStore } from '@/store/useWebStore';
import { ChevronRightIcon, FullscreenIcon } from '@/components/EditorIcons';

const PreviewStage = dynamic(() => import('@/components/PreviewStage'), { ssr: false });
const ThreeStage3D = dynamic(() => import('@/components/ThreeStage3D'), { ssr: false });
const WebStage = dynamic(() => import('@/components/WebStage'), { ssr: false });
const BoardStage = dynamic(() => import('@/components/BoardStage'), { ssr: false });

export default function DesktopEditor() {
  const nav = useUIStore((s) => s.nav);
  const leftCollapsed = useUIStore((s) => s.leftCollapsed);
  const rightCollapsed = useUIStore((s) => s.rightCollapsed);
  const toggleLeftPanel = useUIStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const tplCollapsed = useUIStore((s) => s.tplCollapsed);
  const codeOpen = useWebStore((s) => s.codeOpen);
  const is3D = nav === '3d';
  const isMockup = nav === 'mockup';
  const isWeb = nav === 'web';
  const isBoard = nav === 'board';
  const isProjects = nav === 'projects';

  // The model transform is stored per effect, so the side panels only show the
  // right one if the store's active effect tracks the nav tab. Without this,
  // opening Mockup would leave the store on 'cartoon' and Model Control would
  // pose the flower while the stage showed a phone.
  useEffect(() => {
    const s = use3DStore.getState();
    if (isMockup && s.effectId !== 'mockup') s.setEffect('mockup');
    else if (is3D && s.effectId === 'mockup') s.setEffect('cartoon');
  }, [isMockup, is3D]);

  return (
    <div className={`app ${isWeb || isBoard ? 'app-web' : ''} ${isProjects ? 'app-projects' : ''} ${tplCollapsed ? 'app-tpl-collapsed' : ''} ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}>
      <IconRail />

      {/* Projects is a tab of its own: it takes the middle of the screen (see
          the stage below) instead of listing files in the left column while the
          stage keeps showing whichever project happens to be open. The side
          columns and the transport are hidden by .app-projects rather than
          unmounted — the whole point of the shared editor layout is that the
          Pixi/Three canvases survive a section change. */}
      {isProjects ? null : tplCollapsed ? <CollapsedStrip /> : is3D ? <Effects3DPanel /> : isMockup ? <MockupPanel /> : <TemplatesCard controlsInline={isBoard} />}

      {!isWeb && !isBoard && !isProjects && (
        <section className="card controls card-scroll">
          {is3D || isMockup ? (
            <>
              {isMockup && <ScreenContent />}
              {isMockup && <div className="hairline" />}
              <ModelControl />
              <div className="hairline" />
              <ModelColors />
              <div className="hairline" />
              <Effect3DControls effectId={isMockup ? 'mockup' : undefined} />
            </>
          ) : (
            <>
              <ScenePanel />
              <div className="hairline" />
              <EffectsPanel />
            </>
          )}
        </section>
      )}

      <main className="stage-col">
        {isProjects && <ProjectsBrowser />}
        {isBoard ? <BoardStage /> : isWeb ? <WebStage /> : is3D || isMockup ? <ThreeStage3D effectId={isMockup ? 'mockup' : undefined} /> : (
          <>
            <PreviewStage />
            <button className="stage-fs" title="Fullscreen">
              <FullscreenIcon size={15}/>
            </button>
          </>
        )}
        {/* Which project is open, and whether it is saved. Not in the Projects
            tab: there the whole screen is that answer. */}
        {!isProjects && <ProjectDock />}
        <HistoryControls />
        <button className="panel-toggle panel-toggle-left" onClick={toggleLeftPanel} aria-expanded={!leftCollapsed} aria-label={leftCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'} title={leftCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}>
          <ChevronRightIcon size={16}/>
        </button>
        <button className="panel-toggle panel-toggle-right" onClick={toggleRightPanel} aria-expanded={!rightCollapsed} aria-label={rightCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'} title={rightCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'}>
          <ChevronRightIcon size={16}/>
        </button>
      </main>

      <section className="card right card-scroll">
        {isProjects ? null : isBoard ? <BoardPanel /> : isWeb ? (
          <><WebSelectionPanel /><div className="hairline" /><WebScenePanel /></>
        ) : is3D ? (
          <><CanvasPanel is3DMode /><div className="hairline" /><BackgroundFill /></>
        ) : isMockup ? (
          <><CanvasPanel is3DMode /><div className="hairline" /><BackgroundFill hideTexture /></>
        ) : (
          <MediaSidebar showCanvas />
        )}
      </section>

      <footer className="card bottom">
        <Timeline
          showExport={!isWeb && !isBoard}
          // Mockup is a single persisted 3D studio. Its renderer never consumes
          // the Library's motion-track stack, so exposing Add layer here created
          // an invisible parallax track in the wrong document.
          showLayers={!isMockup}
          extra={isWeb ? <WebSourceBar /> : isBoard ? <BoardExportBar /> : undefined}
        />
      </footer>

      {isWeb && codeOpen && <WebCodeModal />}
    </div>
  );
}
