'use client';

import { useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { REPO_URL } from '../_lib/docsLinks';

export default function DocsIdeaDialog({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const [idea, setIdea] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const href = useMemo(() => {
    const title = 'Docs idea: ' + (idea.trim().slice(0, 72) || 'Improvement suggestion');
    const body = ['## Idea', idea.trim() || 'Describe the idea here.', '', 'Docs page: ' + pathname].join('\n');
    return REPO_URL + '/issues/new?' + new URLSearchParams({ title, body }).toString();
  }, [idea, pathname]);

  return (
    <div className="docs-palette-layer">
      <button type="button" className="docs-palette-scrim" aria-label="Close idea form" onClick={onClose} />
      <div className="docs-idea-dialog" role="dialog" aria-modal="true" aria-labelledby="docs-idea-title">
        <div className="docs-idea-dialog-head">
          <div>
            <span className="docs-eyebrow">GitHub issue</span>
            <h2 id="docs-idea-title">Suggest an idea</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close idea form">Esc</button>
        </div>
        <label htmlFor="docs-idea-dialog-field">What should be added or improved?</label>
        <textarea
          ref={inputRef}
          id="docs-idea-dialog-field"
          value={idea}
          onChange={(event) => setIdea(event.target.value)}
          maxLength={1000}
          rows={5}
          autoFocus
          placeholder="Describe your idea"
          onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
        />
        <div className="docs-idea-dialog-foot">
          <p>You will review and submit it on GitHub.</p>
          <a
            className={idea.trim() ? '' : 'disabled'}
            href={idea.trim() ? href : undefined}
            target="_blank"
            rel="noreferrer noopener"
            aria-disabled={!idea.trim()}
          >
            Open GitHub issue
          </a>
        </div>
      </div>
    </div>
  );
}
