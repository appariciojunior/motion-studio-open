'use client';

import { useUIStore } from '@/store/useUIStore';
import { BackIcon, ChevronRightIcon } from './EditorIcons';

// The left column (templates / 3D effects) folds to a strip so the stage can
// have the width on a small display. Two halves: the chevron that lives in the
// panel header, and the strip that replaces the panel once it's folded.

export function CollapseButton() {
  const toggle = useUIStore((s) => s.toggleTplCollapsed);
  return (
    <button className="tpl-collapse" onClick={toggle} title="Collapse panel" aria-label="Collapse panel">
      <BackIcon size={14}/>
    </button>
  );
}

export function CollapsedStrip() {
  const toggle = useUIStore((s) => s.toggleTplCollapsed);
  return (
    <aside className="card templates tpl-strip">
      <button className="tpl-expand" onClick={toggle} title="Expand panel" aria-label="Expand panel">
        <ChevronRightIcon size={14}/>
      </button>
    </aside>
  );
}
