'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellIcon } from './EditorIcons';

const SEEN_ITEMS_KEY = 'motion-news-seen-items';
const ALERTS_KEY = 'motion-news-alerts';
const CHECK_INTERVAL_MS = 5 * 60_000;

interface FeedItem {
  id: string;
  type: 'news';
  title: string;
  body: string | null;
  url: string | null;
}

interface FeedResponse {
  available: boolean;
  items: FeedItem[];
}

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ }
}

function readSeenItems(): Set<string> {
  try {
    const parsed = JSON.parse(readLocal(SEEN_ITEMS_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function markItemsSeen(items: FeedItem[]) {
  const seen = readSeenItems();
  items.forEach((item) => seen.add(item.id));
  writeLocal(SEEN_ITEMS_KEY, JSON.stringify(Array.from(seen).slice(-100)));
}

export default function NewsNotifier() {
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [checking, setChecking] = useState(false);
  const [items, setItems] = useState<FeedItem[]>([]);
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

  const markRead = useCallback(() => {
    markItemsSeen(items);
    setUnread(false);
  }, [items]);

  const check = useCallback(async (manual = false) => {
    if (process.env.NEXT_PUBLIC_STATIC_EXPORT === '1') return;
    setChecking(true);
    if (manual) setMessage('');

    try {
      const response = await fetch('/api/news', { cache: 'no-store' });
      const next = await response.json() as FeedResponse;
      if (!response.ok) throw new Error('Could not check for news.');

      const nextItems = next.available ? next.items : [];
      setItems(nextItems);
      const seen = readSeenItems();
      const hasUnread = nextItems.some((item) => !seen.has(item.id));
      setUnread(hasUnread);

      if (nextItems.length === 0 && manual) {
        setMessage('Published news will appear after a successful production deployment.');
      }
      if (hasUnread || manual) setOpen(true);
    } catch {
      if (manual) {
        setMessage('Could not check for news. Please try again.');
        setOpen(true);
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    setEnabled(readLocal(ALERTS_KEY) !== 'off');
  }, []);

  useEffect(() => {
    if (enabled !== true) return;
    const firstCheck = window.setTimeout(() => check(false), 2_000);
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
    const opening = !open;
    setOpen(opening);
    if (opening && enabled && items.length === 0) void check(true);
  };

  const disableAlerts = () => {
    writeLocal(ALERTS_KEY, 'off');
    markItemsSeen(items);
    setEnabled(false);
    setUnread(false);
    setMessage('');
  };

  const enableAlerts = () => {
    writeLocal(ALERTS_KEY, 'on');
    setEnabled(true);
    setMessage('');
    void check(true);
  };

  const panel = open && enabled !== null ? (
    <aside
      ref={panelRef}
      id="news-notification-panel"
      className="news-notice"
      style={{ left: position.left, bottom: position.bottom }}
      role="dialog"
      aria-modal="false"
      aria-labelledby="news-notice-title"
    >
      <button className="news-notice-close" onClick={() => setOpen(false)} aria-label="Close news">×</button>
      {enabled === false ? (
        <>
          <span className="news-notice-eyebrow">Notifications</span>
          <strong id="news-notice-title">News alerts are off</strong>
          <p>Automatic checks are disabled in this browser.</p>
          <button className="btn solid news-notice-primary" onClick={enableAlerts} disabled={checking}>
            {checking ? 'Checking…' : 'Turn alerts back on'}
          </button>
        </>
      ) : items.length > 0 ? (
        <>
          <span className="news-notice-eyebrow">Notifications</span>
          <strong id="news-notice-title">News</strong>
          <div className="news-notice-list">
            {items.slice(0, 5).map((item) => (
              <article className="news-notice-item" key={item.id}>
                <span className="news-notice-kind">News</span>
                <strong>{item.title}</strong>
                {item.body && <p>{item.body}</p>}
                {item.url && <a className="link-btn" href={item.url} target="_blank" rel="noreferrer">View details</a>}
              </article>
            ))}
          </div>
          <div className="news-notice-actions">
            <button className="btn solid news-notice-primary" onClick={() => { markRead(); setOpen(false); }}>
              Mark all as read
            </button>
          </div>
          <button className="news-notice-optout" onClick={disableAlerts}>Turn off news alerts</button>
        </>
      ) : (
        <>
          <span className="news-notice-eyebrow">Notifications</span>
          <strong id="news-notice-title">News</strong>
          <p>{message || 'Published news will appear here.'}</p>
          <button className="btn news-notice-primary" onClick={() => check(true)} disabled={checking}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
          <button className="news-notice-optout" onClick={disableAlerts}>Turn off news alerts</button>
        </>
      )}
    </aside>
  ) : null;

  if (process.env.NEXT_PUBLIC_STATIC_EXPORT === '1') return null;

  return (
    <>
      <button
        ref={bellRef}
        className={`rail-item rail-news ${open ? 'active' : ''}`}
        onClick={togglePanel}
        aria-label={unread ? 'News, new items available' : 'News'}
        aria-expanded={open}
        aria-controls="news-notification-panel"
        title="News"
      >
        <span className="rail-ico news-bell-icon">
          <BellIcon />
          {unread && <span className="news-bell-dot" aria-hidden="true" />}
        </span>
        <span className="rail-label">News</span>
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
  );
}
