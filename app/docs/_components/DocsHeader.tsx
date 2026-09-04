'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { MoonIcon, SunIcon } from '@/components/EditorIcons';
import LogoMark from '@/components/LogoMark';
import { LinkOutIcon, RepoIcon } from './DocsIcons';
import { REPO_URL, socials } from '../_lib/docsLinks';
import { useUIStore } from '@/store/useUIStore';

/**
 * The docs header. Reuses the editor's own theme action and icons rather than
 * keeping a second notion of the theme: the root layout sets `data-theme` from
 * the stored preference before first paint, and this writes to the same store
 * and the same storage key, so switching here follows you into the editor.
 */
export default function DocsHeader({ onSuggest }: { onSuggest: () => void }) {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const hydratePreferences = useUIStore((s) => s.hydratePreferences);

  // The store's default is 'light'; the stored preference lives in
  // localStorage, so it can only be read after mount.
  useEffect(() => { hydratePreferences(); }, [hydratePreferences]);

  const social = socials();

  return (
    <header className="docs-header">
      <Link href="/docs" className="docs-brand">
        <LogoMark height={17} />
        {/* Wrapped so the narrow layout can drop the wordmark and keep the mark:
            measured, the header's content needed 455px in a 375px viewport. */}
        <span className="docs-brand-name">Motion Studio</span>
        <span className="docs-brand-tag">docs</span>
      </Link>

      <nav className="docs-header-nav">
        <Link href="/docs/library">Library</Link>
        <Link href="/docs/mockup">Mockup</Link>
        <Link href="/docs/controls/library">Controls</Link>
        <button type="button" className="docs-suggest-btn" onClick={onSuggest}>
          <span aria-hidden="true">+</span>
          Suggest an idea
        </button>
      </nav>


      <div className="docs-header-end">
        <a
          className="docs-icon-btn docs-repo-link"
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Source repository on GitHub"
          title="Source on GitHub"
        >
          <RepoIcon />
        </a>

        {social.map((s) => (
          <a
            key={s.network}
            className="docs-icon-btn"
            href={s.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={s.label}
            title={s.label}
          >
            <LinkOutIcon />
          </a>
        ))}

        <button
          className="docs-icon-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>

        {/* In the landing this pointed at another origin and opened a tab. Here
            the editor IS this app, so it is an in-app route: Link, no target. */}
        <Link href="/library" className="docs-header-cta">
          Open the editor
        </Link>
      </div>
    </header>
  );
}
