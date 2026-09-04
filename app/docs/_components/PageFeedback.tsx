'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ThumbDownIcon, ThumbUpIcon } from './DocsIcons';
import { REPO_URL } from '../_lib/docsLinks';

const KEY = 'motion-docs-feedback';
type Verdict = 'yes' | 'no';

function read(): Record<string, Verdict> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}

function remember(pathname: string, verdict: Verdict | null) {
  try {
    const all = read();
    if (verdict) all[pathname] = verdict;
    else delete all[pathname];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* Remembering the choice is optional. */ }
}

function issueUrl(title: string, body: string) {
  return REPO_URL + '/issues/new?' + new URLSearchParams({ title, body }).toString();
}

export default function PageFeedback() {
  const pathname = usePathname();
  const [given, setGiven] = useState<Verdict | null>(null);
  const [reporting, setReporting] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    setGiven(read()[pathname] ?? null);
    setReporting(false);
    setProblem('');
  }, [pathname]);

  const problemHref = useMemo(() => issueUrl(
    'Docs problem: ' + (problem.trim().slice(0, 72) || pathname),
    ['## What is wrong or unclear?', problem.trim() || 'Describe the problem here.', '', 'Docs page: ' + pathname].join('\n'),
  ), [pathname, problem]);

  const markHelpful = () => {
    setGiven('yes');
    remember(pathname, 'yes');
  };

  const reset = () => {
    setGiven(null);
    setReporting(false);
    setProblem('');
    remember(pathname, null);
  };

  return (
    <footer className="docs-feedback">
      {given === null && !reporting && (
        <>
          <span className="docs-feedback-q">Was this page helpful?</span>
          <div className="docs-feedback-actions">
            <button type="button" className="docs-feedback-btn" onClick={markHelpful}>
              <ThumbUpIcon /> Yes
            </button>
            <button type="button" className="docs-feedback-btn" onClick={() => setReporting(true)}>
              <ThumbDownIcon /> No
            </button>
          </div>
        </>
      )}

      {reporting && given === null && (
        <div className="docs-feedback-detail">
          <label htmlFor="docs-feedback-problem">What is wrong or unclear?</label>
          <textarea
            id="docs-feedback-problem"
            value={problem}
            onChange={(event) => setProblem(event.target.value)}
            maxLength={1000}
            rows={3}
            autoFocus
            placeholder="Describe the problem with this page"
          />
          <div className="docs-feedback-detail-actions">
            <button type="button" className="docs-feedback-cancel" onClick={() => setReporting(false)}>Cancel</button>
            <a
              className={'docs-feedback-send ' + (problem.trim() ? '' : 'disabled')}
              href={problem.trim() ? problemHref : undefined}
              target="_blank"
              rel="noreferrer noopener"
              aria-disabled={!problem.trim()}
              onClick={() => {
                if (!problem.trim()) return;
                setGiven('no');
                remember(pathname, 'no');
              }}
            >
              Open problem issue
            </a>
          </div>
          <p className="docs-feedback-hint">You will review and submit it on GitHub.</p>
        </div>
      )}

      {given !== null && (
        <>
          <span className="docs-feedback-q">
            {given === 'yes' ? 'Glad it helped.' : 'Problem prepared for GitHub.'}
          </span>
          <button type="button" className="docs-feedback-undo" onClick={reset}>Change answer</button>
        </>
      )}

    </footer>
  );
}
