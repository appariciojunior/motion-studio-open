'use client';

import { useHistoryStore } from '@/store/useHistoryStore';
import { RedoIcon, UndoIcon } from './EditorIcons';

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
        <UndoIcon size={15} />
      </button>
      <span className="stage-hist-sep" />
      <button
        className="stage-hist-btn"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl/⌘⇧Z)"
        aria-label="Redo"
      >
        <RedoIcon size={15} />
      </button>
    </div>
  );
}
