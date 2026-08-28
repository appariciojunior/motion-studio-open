'use client';

import { useEffect, useState } from 'react';
import { SearchIcon } from '@/components/docs/DocsIcons';

/**
 * Looks like a field, behaves like a button: it opens the palette. One search
 * implementation instead of an inline dropdown plus a dialog, and the results
 * are no longer at the mercy of whatever container is clipping them.
 *
 * The shortcut hint is platform-dependent, so it can only be decided after
 * mount — rendering a guess on the server and correcting it on the client is a
 * hydration mismatch, which is a broken tree rather than a cosmetic slip.
 */
export default function DocsSearchButton({ onOpen }: { onOpen: () => void }) {
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    setHint(mac ? '⌘K' : 'Ctrl K');
  }, []);

  return (
    <button type="button" className="docs-searchbtn" onClick={onOpen}>
      <span className="docs-searchbtn-ico"><SearchIcon /></span>
      <span className="docs-searchbtn-label">Search the docs</span>
      {/* Reserved either way, so the row does not reflow when the hint lands. */}
      <kbd className="docs-searchbtn-kbd">{hint ?? ' '}</kbd>
    </button>
  );
}
