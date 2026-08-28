'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ThumbDownIcon, ThumbUpIcon } from '@/components/docs/DocsIcons';

/**
 * "Was this page helpful?", at the foot of every docs page.
 *
 * Mounted by the docs layout, after the page's own content, so a new page gets
 * it without doing anything.
 *
 * IMPORTANT, and stated here rather than discovered later: there is no endpoint.
 * The answer is kept in this browser only — enough to stop asking the same
 * reader the same question, and nothing more. Nobody receives it. Wire the
 * `answer` call below to a real collector before treating any of this as
 * feedback data.
 */

const KEY = 'motion-docs-feedback';

type Verdict = 'yes' | 'no';

function read(): Record<string, Verdict> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};   // private window, cleared storage, or storage blocked outright
  }
}

export default function PageFeedback() {
  const pathname = usePathname();
  const [given, setGiven] = useState<Verdict | null>(null);

  // localStorage can only be read after mount, and the value is per page.
  useEffect(() => { setGiven(read()[pathname] ?? null); }, [pathname]);

  const answer = (verdict: Verdict) => {
    setGiven(verdict);
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...read(), [pathname]: verdict }));
    } catch {
      // Not being able to remember the answer is not a reason to lose it on
      // screen, so this failure is deliberately silent.
    }
  };

  return (
    <footer className="docs-feedback">
      {given === null ? (
        <>
          <span className="docs-feedback-q">Was this page helpful?</span>
          <div className="docs-feedback-actions">
            <button type="button" className="docs-feedback-btn" onClick={() => answer('yes')}>
              <ThumbUpIcon />
              Yes
            </button>
            <button type="button" className="docs-feedback-btn" onClick={() => answer('no')}>
              <ThumbDownIcon />
              No
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="docs-feedback-q">
            {given === 'yes' ? 'Glad it helped.' : 'Noted — sorry it missed.'}
          </span>
          <button
            type="button"
            className="docs-feedback-undo"
            onClick={() => {
              setGiven(null);
              try {
                const all = read();
                delete all[pathname];
                localStorage.setItem(KEY, JSON.stringify(all));
              } catch { /* nothing to undo if it was never stored */ }
            }}
          >
            Change answer
          </button>
        </>
      )}
    </footer>
  );
}
