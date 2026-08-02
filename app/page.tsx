'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import WelcomeDialog from '@/components/WelcomeDialog';
import { startSceneAutosave } from '@/lib/scenePersist';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';

const MobileEditor = dynamic(() => import('@/components/MobileEditor'), {
  ssr: false,
  loading: () => <EditorLoading />,
});

const DesktopEditor = dynamic(() => import('@/components/DesktopEditor'), {
  ssr: false,
  loading: () => <EditorLoading />,
});

const MOBILE_QUERY = '(max-width: 767px)';
type ViewportMode = 'pending' | 'mobile' | 'desktop';

function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>('pending');

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const sync = () => setMode(query.matches ? 'mobile' : 'desktop');
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return mode;
}

function EditorLoading() {
  return (
    <main className="editor-loading" aria-label="Loading editor" aria-busy="true">
      <span className="editor-loading-mark" aria-hidden="true" />
      <span>Loading editor...</span>
    </main>
  );
}

export default function Home() {
  const mode = useViewportMode();

  useEffect(() => {
    useUIStore.getState().hydratePreferences();
    useProjectStore.getState().bootstrap();
    const stopHistory = useHistoryStore.getState().start();
    const stopAutosave = startSceneAutosave();
    return () => {
      stopHistory();
      stopAutosave();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      e.preventDefault();
      const history = useHistoryStore.getState();
      if (key === 'y' || e.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (mode === 'pending') return <EditorLoading />;

  return (
    <>
      {mode === 'mobile' ? <MobileEditor /> : <DesktopEditor />}
      <WelcomeDialog />
    </>
  );
}
