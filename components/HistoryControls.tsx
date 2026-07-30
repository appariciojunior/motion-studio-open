'use client';

import { useHistoryStore } from '@/store/useHistoryStore';

// Undo / redo, floating over the stage. It sits here rather than in the
// transport row because it acts on the scene, not on the clock — and the stage
// already owns the floating-control idiom (fullscreen, panel toggles).
export default function HistoryControls() {
  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  return (
    <div className="stage-history">
      <button
        className="stage-hist-btn"
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl/⌘Z)"
        aria-label="Undo"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 7h6.5a3.5 3.5 0 010 7H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 4.5L3 7l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <span className="stage-hist-sep" />
      <button
        className="stage-hist-btn"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl/⌘⇧Z)"
        aria-label="Redo"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 7H6.5a3.5 3.5 0 000 7H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M10.5 4.5L13 7l-2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
    </div>
  );
}
