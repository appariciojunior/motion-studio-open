'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DOCS_SEARCH, type DocsSearchEntry } from '../_lib/docsNav';
import { SearchIcon } from './DocsIcons';

/**
 * The command palette. Hand-rolled on purpose: cmdk would bring four Radix
 * packages into a codebase that carries no component library at all, to add
 * fuzzy matching over sixteen pages — and fuzzy matching on sixteen items
 * mostly produces confident nonsense. The ranking below is deliberate instead:
 * a title match outranks a section match, which outranks a keyword match.
 *
 * Opened with Ctrl/Cmd+K or `/` from anywhere, and by the search button.
 */

interface Hit {
  entry: DocsSearchEntry;
  score: number;
  /** The keyword that matched, when that is why it matched. */
  hit?: string;
}

function rank(query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return DOCS_SEARCH
    .map((entry) => {
      const title = entry.title.toLowerCase();
      let score = 0;
      if (title.startsWith(q)) score = 4;
      else if (title.includes(q)) score = 3;
      else if (entry.section.toLowerCase().includes(q)) score = 2;
      else if (entry.terms.some((t) => t.toLowerCase().includes(q))) score = 1;
      return { entry, score, hit: entry.terms.find((t) => t.toLowerCase().includes(q)) };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, 8);
}

/** With no query the palette is a table of contents, not an empty box. */
function browse(): Hit[] {
  return DOCS_SEARCH.map((entry) => ({ entry, score: 0 }));
}

export default function DocsPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Where focus was before the dialog opened, so closing puts it back rather
  // than dropping the caller at the top of the document.
  const returnTo = useRef<HTMLElement | null>(null);

  const hits = useMemo(() => (query.trim() ? rank(query) : browse()), [query]);

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', keepFocusInside);
    return () => {
      window.removeEventListener('keydown', keepFocusInside);
      document.body.style.overflow = previousOverflow;
      returnTo.current?.focus?.();
    };
  }, []);

  useEffect(() => { setCursor(0); }, [query]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.docs-palette-hit.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + hits.length) % hits.length); }
    else if (e.key === 'Home') { e.preventDefault(); setCursor(0); }
    else if (e.key === 'End') { e.preventDefault(); setCursor(hits.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[cursor].entry.href); }
  };

  // Section headings, but only while browsing: once a query is ranked, grouping
  // by section would fight the ranking that put the best answer first.
  const grouped = !query.trim();
  let lastSection = '';

  return (
    <div className="docs-palette-layer" role="presentation">
      <button
        type="button"
        className="docs-palette-scrim"
        aria-label="Close the search"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="docs-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search the docs"
      >
        <div className="docs-palette-field">
          <span className="docs-palette-ico"><SearchIcon /></span>
          <input
            ref={inputRef}
            type="text"
            className="docs-palette-input"
            placeholder="Search the docs"
            aria-label="Search the docs"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="docs-palette-list"
            aria-activedescendant={hits.length ? `docs-palette-option-${cursor}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="docs-palette-esc">esc</kbd>
        </div>

        <div className="docs-palette-list" id="docs-palette-list" role="listbox" ref={listRef}>
          {hits.length === 0 && (
            <p className="docs-palette-empty">No page matches “{query}”.</p>
          )}
          {hits.map((h, i) => {
            const head = grouped && h.entry.section !== lastSection ? h.entry.section : null;
            if (head) lastSection = h.entry.section;
            return (
              <div key={h.entry.href}>
                {head && <div className="docs-palette-group">{head}</div>}
                <button
                  id={`docs-palette-option-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  className={`docs-palette-hit ${i === cursor ? 'active' : ''}`}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => go(h.entry.href)}
                >
                  <span className="docs-palette-hit-title">{h.entry.title}</span>
                  <span className="docs-palette-hit-meta">
                    {h.score === 1 && h.hit ? h.hit : h.entry.section}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="docs-palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
          <span><kbd>↵</kbd> to open</span>
          <span><kbd>esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
