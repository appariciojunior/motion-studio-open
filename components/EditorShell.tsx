'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import AppTour from '@/components/AppTour';
import WelcomeDialog from '@/components/WelcomeDialog';
import { sectionFromPathname } from '@/lib/navSections';
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

// The desktop shell is a five-column grid whose four fixed columns need
// 64 + 296 + 280 + 280 = 920px before the stage — minmax(0, 1fr) — gets ANY
// width. Below that the preview collapses to zero and the editor looks broken:
// measured on the deploy at 769px, the stage column was 0px and the canvas 0x525.
// So the phone layout has to own everything up to the width where the desktop
// grid actually fits. Keep this in step with the same breakpoint in
// app/globals.css and components/ExportDialog.tsx.
const MOBILE_QUERY = '(max-width: 919px)';
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

/**
 * Mounted by app/(editor)/layout.tsx, so it survives every section navigation:
 * the Pixi and Three canvases, the autosave loop and the whole store graph stay
 * alive while the URL changes from /library to /mockup. The section pages under
 * that layout render nothing — they only declare the route and its <title>.
 *
 * The URL is the source of truth for which section is open; useUIStore.nav is
 * the read path the panels already use, mirrored from it here.
 */
export default function EditorShell({ children }: { children?: React.ReactNode }) {
  const mode = useViewportMode();
  const pathname = usePathname();
  const section = sectionFromPathname(pathname);
  const seeded = useRef(false);

  // Seed the store during the first render rather than in the effect below:
  // an effect lands after the editor's first paint, so a deep link to /mockup
  // would flash the library first. Safe to write mid-render only because no
  // subscriber is mounted yet — DesktopEditor is rendered by this component.
  if (!seeded.current) {
    seeded.current = true;
    if (useUIStore.getState().nav !== section) useUIStore.setState({ nav: section });
  }

  // Later changes — rail clicks, back/forward, a pasted URL. Rail clicks also
  // set the store optimistically, so this mostly matters for history moves.
  useEffect(() => {
    if (useUIStore.getState().nav !== section) useUIStore.setState({ nav: section });
  }, [section]);

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

  if (mode === 'pending') {
    return (
      <>
        <EditorLoading />
        {children}
      </>
    );
  }

  return (
    <>
      {mode === 'mobile' ? <MobileEditor /> : <DesktopEditor />}
      <WelcomeDialog />
      {mode === 'desktop' && <AppTour />}
      {children}
    </>
  );
}
