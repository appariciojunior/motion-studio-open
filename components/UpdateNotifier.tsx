'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IS_HOSTED_DEPLOYMENT, RELEASE_NOTES_URL } from '@/lib/deployment';
import { BellIcon } from './EditorIcons';

const READ_KEY = 'motion-update-dismissed';
const ALERTS_KEY = 'motion-update-alerts';
const CHECK_INTERVAL_MS = 60 * 60_000;

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ }
}

interface UpdateCommit {
  hash: string;
  subject: string;
}

interface UpdateStatus {
  supported: boolean;
  updateAvailable: boolean;
  canUpdate: boolean;
  currentCommit: string;
  latestCommit: string;
  commits: UpdateCommit[];
  reason?: 'dirty' | 'detached' | 'diverged' | 'branch';
  updated?: boolean;
  dependenciesChanged?: boolean;
  error?: string;
}

type Phase = 'idle' | 'updating' | 'done' | 'error';

const reasonText: Record<NonNullable<UpdateStatus['reason']>, string> = {
  dirty: 'You have local changes. Commit or stash them before updating.',
  detached: 'Git is in detached HEAD state. Switch to the main branch before updating.',
  diverged: 'Your history has diverged from the official version. Update it manually with Git.',
  branch: 'Automatic updates are only allowed on the main branch.',
};

export default function UpdateNotifier() {
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [position, setPosition] = useState({ left: 84, bottom: 72 });

  const placePanel = useCallback(() => {
    const rect = bellRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.round(rect.right + 10),
      bottom: Math.max(12, Math.round(window.innerHeight - rect.bottom)),
    });
  }, []);

  const markRead = useCallback((latestCommit?: string) => {
    if (latestCommit) writeLocal(READ_KEY, latestCommit);
    setUnread(false);
  }, []);

  const check = useCallback(async (manual = false) => {
    if (IS_HOSTED_DEPLOYMENT || process.env.NEXT_PUBLIC_STATIC_EXPORT === '1') return;
    setChecking(true);
    if (manual) {
      setMessage('');
      setPhase('idle');
    }
    try {
      const response = await fetch('/api/update', { cache: 'no-store' });
      const next = await response.json() as UpdateStatus;
      if (!response.ok || !next.supported) throw new Error(next.error || 'Could not check for updates.');
      setStatus(next);
      if (next.updateAvailable) {
        const isUnread = readLocal(READ_KEY) !== next.latestCommit;
        setUnread(isUnread);
        if (isUnread || manual) setOpen(true);
      } else if (manual) {
        setOpen(true);
        setMessage('You are already running the latest version.');
      }
    } catch (error) {
      if (manual) {
        setMessage(error instanceof Error ? error.message : 'Could not check for updates.');
        setPhase('error');
        setOpen(true);
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    setEnabled(IS_HOSTED_DEPLOYMENT || readLocal(ALERTS_KEY) !== 'off');
  }, []);

  useEffect(() => {
    if (IS_HOSTED_DEPLOYMENT || enabled !== true) return;
    const firstCheck = window.setTimeout(() => check(false), 4_000);
    const interval = window.setInterval(() => check(false), CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(firstCheck);
      window.clearInterval(interval);
    };
  }, [check, enabled]);

  useLayoutEffect(() => {
    if (!open) return;
    placePanel();
    window.addEventListener('resize', placePanel);
    return () => window.removeEventListener('resize', placePanel);
  }, [open, placePanel]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !bellRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const togglePanel = () => {
    if (!open) markRead(status?.latestCommit);
    setOpen(!open);
  };

  const disableAlerts = () => {
    writeLocal(ALERTS_KEY, 'off');
    setEnabled(false);
    setUnread(false);
    setPhase('idle');
    setMessage('Automatic update alerts are turned off in this browser.');
  };

  const enableAlerts = () => {
    writeLocal(ALERTS_KEY, 'on');
    setEnabled(true);
    setMessage('');
    void check(true);
  };

  const update = async () => {
    setPhase('updating');
    setMessage('');
    try {
      const response = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Motion-Update': 'confirmed' },
        body: JSON.stringify({ confirm: true }),
      });
      const next = await response.json() as UpdateStatus;
      setStatus(next);
      if (!response.ok || !next.updated) {
        const detail = next.reason ? reasonText[next.reason] : next.error;
        throw new Error(detail || 'Could not update the project.');
      }
      markRead(next.latestCommit);
      setPhase('done');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update the project.');
      setPhase('error');
    }
  };

  const panel = open && enabled !== null ? (
    <aside
      ref={panelRef}
      id="update-notification-panel"
      className="update-notice"
      style={{ left: position.left, bottom: position.bottom }}
      role="dialog"
      aria-modal="false"
      aria-labelledby="update-notice-title"
    >
      <button className="update-notice-close" onClick={() => setOpen(false)} aria-label="Close notifications">×</button>
      {IS_HOSTED_DEPLOYMENT ? (
        <>
          <span className="update-notice-eyebrow">Hosted version</span>
          <strong id="update-notice-title">What’s new in Motion Studio</strong>
          <p>
            This version is updated automatically when a new Vercel deployment is published.
            There is no local Git update to install here.
          </p>
          <a
            className="btn solid update-notice-primary"
            href={RELEASE_NOTES_URL}
            target="_blank"
            rel="noreferrer"
          >
            See latest changes
          </a>
        </>
      ) : enabled === false ? (
        <>
          <span className="update-notice-eyebrow">Notifications</span>
          <strong id="update-notice-title">Update alerts are off</strong>
          <p>No automatic Git checks will run in this browser.</p>
          {message && <p className="update-notice-info">{message}</p>}
          <button className="btn solid update-notice-primary" onClick={enableAlerts} disabled={checking}>
            {checking ? 'Checking…' : 'Turn alerts back on'}
          </button>
        </>
      ) : phase === 'done' ? (
        <>
          <span className="update-notice-eyebrow">Update complete</span>
          <strong id="update-notice-title">Git is up to date.</strong>
          <p>
            {status?.dependenciesChanged
              ? <>Run <code>npm install</code>, then restart the server to use the new version.</>
              : 'Restart the server to use the new version.'}
          </p>
          <button className="btn solid update-notice-primary" onClick={() => setOpen(false)}>Got it</button>
        </>
      ) : status?.updateAvailable ? (
        <>
          <span className="update-notice-eyebrow">New version available</span>
          <strong id="update-notice-title">What’s new in Motion Studio</strong>
          {status.commits.length > 0 && (
            <ul className="update-notice-list">
              {status.commits.slice(0, 3).map((commit) => <li key={commit.hash}>{commit.subject}</li>)}
            </ul>
          )}
          {status.reason && <p className="update-notice-warning">{reasonText[status.reason]}</p>}
          {phase === 'error' && <p className="update-notice-warning">{message}</p>}
          <div className="update-notice-actions">
            <button className="link-btn" onClick={() => { markRead(status.latestCommit); setOpen(false); }} disabled={phase === 'updating'}>Not now</button>
            <button className="btn solid update-notice-primary" onClick={update} disabled={!status.canUpdate || phase === 'updating'}>
              {phase === 'updating' ? 'Updating…' : 'Update Git'}
            </button>
          </div>
          <button className="update-notice-optout" onClick={disableAlerts}>Turn off update alerts</button>
        </>
      ) : (
        <>
          <span className="update-notice-eyebrow">Notifications</span>
          <strong id="update-notice-title">Motion Studio updates</strong>
          {phase === 'error'
            ? <p className="update-notice-warning">{message}</p>
            : <p>{message || 'New versions will appear here when they are available.'}</p>}
          <button className="btn update-notice-primary" onClick={() => check(true)} disabled={checking}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
          <button className="update-notice-optout" onClick={disableAlerts}>Turn off update alerts</button>
        </>
      )}
    </aside>
  ) : null;

  if (process.env.NEXT_PUBLIC_STATIC_EXPORT === '1') return null;

  return (
    <>
      <button
        ref={bellRef}
        className={`rail-item rail-update ${open ? 'active' : ''}`}
        onClick={togglePanel}
        aria-label={IS_HOSTED_DEPLOYMENT
          ? 'What’s new in Motion Studio'
          : unread ? 'Notifications, new update available' : 'Update notifications'}
        aria-expanded={open}
        aria-controls="update-notification-panel"
        title={IS_HOSTED_DEPLOYMENT ? 'What’s new' : 'Updates'}
      >
        <span className="rail-ico update-bell-icon">
          <BellIcon />
          {unread && <span className="update-bell-dot" aria-hidden="true" />}
        </span>
        <span className="rail-label">{IS_HOSTED_DEPLOYMENT ? 'News' : 'Updates'}</span>
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
  );
}
