'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import DocsHeader from './DocsHeader';
import DocsPalette from './DocsPalette';
import DocsSearchButton from './DocsSearchButton';
import DocsSidebar from './DocsSidebar';
import PageFeedback from './PageFeedback';
import DocsIdeaDialog from './DocsIdeaDialog';
import { CloseIcon, MenuIcon } from './DocsIcons';

/**
 * The docs chrome, and the one client component that has to exist: the menu
 * button and the panel it opens are two different elements, so something above
 * both has to hold that one piece of state.
 *
 * Below the breakpoint a second bar sits under the navbar carrying the menu
 * button and the search, and the page list drops out from under IT. Above the
 * breakpoint that bar is gone and both live where they already did — the sidebar
 * is a column and it holds its own search.
 *
 * `children` is the page, still server-rendered — passing it through here costs
 * nothing and keeps the pages themselves free of client code.
 */
export default function DocsChrome({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const pathname = usePathname();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasMenuOpen = useRef(false);

  // Navigating closes it. Without this, tapping a link on a phone leaves the
  // panel sitting over the page you just asked for.
  useEffect(() => { setMenuOpen(false); setSearchOpen(false); setIdeaOpen(false); }, [pathname]);

  // Opening the palette closes the page list: two overlays at once is one too
  // many, and the palette can reach every page the list can.
  const openSearch = () => { setMenuOpen(false); setSearchOpen(true); };

  useEffect(() => {
    if (wasMenuOpen.current && !menuOpen && !searchOpen) {
      menuButtonRef.current?.focus();
    }
    wasMenuOpen.current = menuOpen;
  }, [menuOpen, searchOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+K on Windows and Linux, Cmd+K on a Mac. Both are claimed by the
      // browser in some builds, so preventDefault is not optional.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
        setMenuOpen(false);
        return;
      }
      // A bare slash, the way most docs sites do it — but never while the
      // caller is typing somewhere, or it eats the character.
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key === 'Escape' && menuOpen) setMenuOpen(false);
      if (e.key === 'Escape' && ideaOpen) setIdeaOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, ideaOpen]);

  return (
    <div className={`docs-shell ${menuOpen ? 'menu-open' : ''}`}>
      <DocsHeader onSuggest={() => { setMenuOpen(false); setIdeaOpen(true); }} />

      {/* The bar under the navbar. Only drawn under the breakpoint — see docs.css. */}
      <div className="docs-subbar">
        <button
          ref={menuButtonRef}
          type="button"
          className="docs-menu-btn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? 'Close the menu' : 'Open the menu'}
          aria-expanded={menuOpen}
          aria-controls="docs-navigation"
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
          <span>Menu</span>
        </button>
        <DocsSearchButton onOpen={openSearch} />
      </div>

      <div className="docs-body">
        <DocsSidebar open={menuOpen} onOpenSearch={openSearch} onSuggest={() => { setMenuOpen(false); setIdeaOpen(true); }} />
        {/* A real button, not a div: the panel has to be dismissable by
            something the keyboard and a screen reader can reach too. */}
        {menuOpen && (
          <button
            type="button"
            className="docs-scrim"
            aria-label="Close the menu"
            onClick={() => setMenuOpen(false)}
          />
        )}
        {searchOpen && <DocsPalette onClose={() => setSearchOpen(false)} />}
        {ideaOpen && <DocsIdeaDialog onClose={() => setIdeaOpen(false)} />}
        <main className="docs-main">
          <article className="docs-article">
            {children}
            <PageFeedback />
          </article>
        </main>
      </div>
    </div>
  );
}
