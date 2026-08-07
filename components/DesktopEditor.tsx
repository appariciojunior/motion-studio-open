'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import AssetsPanel from '@/components/AssetsPanel';
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
import ProjectsPanel from '@/components/ProjectsPanel';
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
    <div className={`app ${isWeb || isBoard ? 'app-web' : ''} ${tplCollapsed ? 'app-tpl-collapsed' : ''} ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}>
      <IconRail />

      {tplCollapsed ? <CollapsedStrip /> : isProjects ? <ProjectsPanel /> : is3D ? <Effects3DPanel /> : isMockup ? <MockupPanel /> : <TemplatesCard controlsInline={isBoard} />}

      {!isWeb && !isBoard && (
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
        {isBoard ? <BoardStage /> : isWeb ? <WebStage /> : is3D || isMockup ? <ThreeStage3D effectId={isMockup ? 'mockup' : undefined} /> : (
          <>
            <PreviewStage />
            <button className="stage-fs" title="Fullscreen">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </>
        )}
        <HistoryControls />
        <button className="panel-toggle panel-toggle-left" onClick={toggleLeftPanel} aria-expanded={!leftCollapsed} aria-label={leftCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'} title={leftCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button className="panel-toggle panel-toggle-right" onClick={toggleRightPanel} aria-expanded={!rightCollapsed} aria-label={rightCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'} title={rightCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar'}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </main>

      <section className="card right card-scroll">
        {isBoard ? <BoardPanel /> : isWeb ? (
          <><WebSelectionPanel /><div className="hairline" /><WebScenePanel /></>
        ) : is3D ? (
          <><CanvasPanel is3DMode /><div className="hairline" /><BackgroundFill /></>
        ) : isMockup ? (
          <><CanvasPanel is3DMode /><div className="hairline" /><BackgroundFill hideTexture /></>
        ) : (
          <><CanvasPanel /><div className="hairline" /><AssetsPanel /></>
        )}
      </section>

      <footer className="card bottom">
        <Timeline showExport={!isWeb && !isBoard} extra={isWeb ? <WebSourceBar /> : isBoard ? <BoardExportBar /> : undefined} />
      </footer>

      {isWeb && codeOpen && <WebCodeModal />}
    </div>
  );
}
