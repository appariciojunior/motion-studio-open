'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import DocsSearchButton from '@/components/docs/DocsSearchButton';
import { LinkOutIcon, RepoIcon } from '@/components/docs/DocsIcons';
import { REPO_URL, socials } from '@/lib/docsLinks';
import { DOCS_SECTIONS } from '@/lib/docsNav';

// The sidebar is the only part of the docs that has to know where it is, so it
// and the header are the only client components in the shell.
export default function DocsSidebar({ open, onOpenSearch }: { open: boolean; onOpenSearch: () => void }) {
  const pathname = usePathname();

  return (
    <nav className={`docs-nav ${open ? 'is-open' : ''}`} aria-label="Documentation">
      <DocsSearchButton onOpen={onOpenSearch} />
      {DOCS_SECTIONS.map((section) => (
        <div key={section.title} className="docs-nav-section">
          <div className="docs-nav-title">{section.title}</div>
          {/* The rail: one hairline down the group, with the active item marker
              sitting on top of it. */}
          <div className="docs-nav-rail">
            {section.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`docs-nav-link ${pathname === link.href ? 'active' : ''}`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
      {/* Only drawn in the drawer: above the breakpoint these live in the
          header, and showing them twice is showing them nowhere. */}
      <div className="docs-nav-foot">
        <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
          <RepoIcon />
          Source on GitHub
        </a>
        {socials().map((s) => (
          <a key={s.network} href={s.url} target="_blank" rel="noreferrer noopener">
            <LinkOutIcon />
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
