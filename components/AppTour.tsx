'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUIStore } from '@/store/useUIStore';

const WELCOME_SEEN_KEY = 'motion-welcome-seen';

type Step = { title: string; body: string; selector: string };
type TourId = 'library' | 'mockup';

interface Tour {
  seenKey: string;
  nav: 'library' | 'mockup';
  path: string;
  steps: Step[];
}

// Mirrors the reference editor's first-run spotlight tour, retargeted at this
// editor's own panels. Each section that gets its own walkthrough is one entry
// here — same engine (measure/placeCard/render), different copy and trigger.
const TOURS: Record<TourId, Tour> = {
  // Rail -> templates -> controls -> canvas/assets -> projects -> export.
  // WelcomeDialog already covers the "welcome" beat, so this starts straight
  // at the tools.
  library: {
    seenKey: 'motion-tour-seen',
    nav: 'library',
    path: '/library',
    steps: [
      {
        title: 'Your tools',
        body: 'Switch between sections here: Projects, Library, Mockup and the experimental modes.',
        selector: '.rail',
      },
      {
        title: 'Pick a template',
        body: 'Search or scroll the library to choose a template as your starting point.',
        selector: '.card.templates',
      },
      {
        title: 'Customise',
        body: 'Adjust any value, pick an easing and preview everything live.',
        selector: '.controls',
      },
      {
        title: 'Canvas & content',
        body: 'Set the canvas size, the background and the logo, and drop in your own images and videos.',
        selector: '.right',
      },
      {
        title: 'Save your work',
        body: 'Made changes? Save them to a project — come back here whenever you want to resume.',
        selector: 'a[href="/projects"]',
      },
      {
        title: 'Export',
        body: "When you're ready, render your animation as a video or GIF.",
        selector: '.export-btn',
      },
    ],
  },
  // Devices -> pose/animate -> canvas & background -> export. The rail is
  // already covered by the library tour, so this stays focused on what's
  // actually new here.
  mockup: {
    seenKey: 'motion-mockup-tour-seen',
    nav: 'mockup',
    path: '/mockup',
    steps: [
      {
        title: 'Choose a device',
        body: 'Pick a real device mesh — phone, tablet or laptop — to mock your content on.',
        selector: '.card.templates',
      },
      {
        title: 'Pose it',
        body: "Drop in your screen content, then adjust the device's angle, colour and animation.",
        selector: '.controls',
      },
      {
        title: 'Canvas & background',
        body: 'Set the canvas size and the scene behind the device.',
        selector: '.right',
      },
      {
        title: 'Export',
        body: "When you're ready, render the mockup as a video or GIF.",
        selector: '.export-btn',
      },
    ],
  },
};

type Rect = { top: number; left: number; width: number; height: number };

function measure(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function tourSeen(tourId: TourId): boolean {
  try { return !!localStorage.getItem(TOURS[tourId].seenKey); } catch { return true; }
}

function markSeen(tourId: TourId) {
  try { localStorage.setItem(TOURS[tourId].seenKey, '1'); } catch { /* storage blocked */ }
}

// WelcomeDialog gates first entry, so a brand-new visitor must not see a
// tour's scrim stacked behind it — only a returning visitor (who already
// closed Welcome in an earlier session) can auto-start one on mount. A
// first-timer gets the library tour from the 'motion-welcome-done' event
// once they actually agree, and the mockup tour once they later visit it.
function welcomeSeen(): boolean {
  try { return !!localStorage.getItem(WELCOME_SEEN_KEY); } catch { return true; }
}

// Gap between the spotlight ring and the card, and how far the ring itself
// stands off the target's edge.
const RING_PAD = 4;
const CARD_GAP = 28;
const CARD_W = 300;
// A full-height panel (rail, controls, right column) leaves no room above or
// below it — only to a side — so this is an upper-bound estimate of the
// card's own height used purely to pick a side with enough room, not to
// render it.
const CARD_H_EST = 210;
const EDGE_MARGIN = 16;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

// Tries below -> above -> right -> left of the target, in that order, and
// only picks a side once it actually has room — otherwise a tall element
// like the rail or a side panel (no space above/below it at all) would leave
// the card with nowhere to go but on top of the very thing it's describing.
function placeCard(rect: Rect | null, viewportW: number, viewportH: number) {
  if (!rect) {
    return { left: viewportW / 2 - CARD_W / 2, top: viewportH / 2 - CARD_H_EST / 2 };
  }
  const spaceBelow = viewportH - (rect.top + rect.height);
  const spaceAbove = rect.top;
  const spaceRight = viewportW - (rect.left + rect.width);
  const spaceLeft = rect.left;

  if (spaceBelow >= CARD_H_EST + CARD_GAP) {
    return {
      top: rect.top + rect.height + CARD_GAP,
      left: clamp(rect.left, EDGE_MARGIN, viewportW - CARD_W - EDGE_MARGIN),
    };
  }
  if (spaceAbove >= CARD_H_EST + CARD_GAP) {
    return {
      top: rect.top - CARD_GAP - CARD_H_EST,
      left: clamp(rect.left, EDGE_MARGIN, viewportW - CARD_W - EDGE_MARGIN),
    };
  }
  if (spaceRight >= CARD_W + CARD_GAP) {
    return {
      left: rect.left + rect.width + CARD_GAP,
      top: clamp(rect.top, EDGE_MARGIN, viewportH - CARD_H_EST - EDGE_MARGIN),
    };
  }
  if (spaceLeft >= CARD_W + CARD_GAP) {
    return {
      left: rect.left - CARD_GAP - CARD_W,
      top: clamp(rect.top, EDGE_MARGIN, viewportH - CARD_H_EST - EDGE_MARGIN),
    };
  }
  // No side has room (very small viewport) — settle below and let the clamp
  // keep it on-screen, overlap is the least-bad option left.
  return {
    top: clamp(rect.top + rect.height + CARD_GAP, EDGE_MARGIN, viewportH - CARD_H_EST - EDGE_MARGIN),
    left: clamp(rect.left, EDGE_MARGIN, viewportW - CARD_W - EDGE_MARGIN),
  };
}

export default function AppTour() {
  const [activeTour, setActiveTour] = useState<TourId | null>(null);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const prevPanels = useRef<{ tplCollapsed: boolean; leftCollapsed: boolean; rightCollapsed: boolean } | null>(null);

  const start = (tourId: TourId) => {
    const tour = TOURS[tourId];
    // Marked the moment it opens, not when it's dismissed — so an interrupted
    // tour (closed tab, mid-way navigation) never re-triggers on the next visit.
    markSeen(tourId);
    const ui = useUIStore.getState();
    prevPanels.current = { tplCollapsed: ui.tplCollapsed, leftCollapsed: ui.leftCollapsed, rightCollapsed: ui.rightCollapsed };
    // Every step targets a panel that only exists expanded, in that section —
    // force both so the spotlight always finds its target.
    useUIStore.setState({ tplCollapsed: false, leftCollapsed: false, rightCollapsed: false, nav: tour.nav });
    router.push(tour.path);
    setRect(null);
    setStep(0);
    setActiveTour(tourId);
  };

  // Library tour: first-run, gated by the welcome dialog.
  useEffect(() => {
    if (!tourSeen('library') && welcomeSeen()) start('library');
    const onWelcomeDone = () => { if (!tourSeen('library')) start('library'); };
    window.addEventListener('motion-welcome-done', onWelcomeDone);
    return () => window.removeEventListener('motion-welcome-done', onWelcomeDone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mockup tour: first time the user actually opens the Mockup section,
  // whenever that happens to be — not gated to the very first session like
  // the library tour is. Skipped while another tour is already on screen.
  useEffect(() => {
    if (activeTour) return;
    if (!pathname?.startsWith('/mockup')) return;
    if (tourSeen('mockup') || !welcomeSeen()) return;
    start('mockup');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, activeTour]);

  useLayoutEffect(() => {
    if (!activeTour) return;
    const selector = TOURS[activeTour].steps[step].selector;
    setRect(measure(selector));
    // The route push / panel expand from start() (or a step change) can land
    // its DOM a frame or two late — re-measure a few times rather than
    // trusting the first synchronous read. Timeouts, not just rAF: a
    // backgrounded/occluded tab throttles rAF to near-never, and a step that
    // just navigated (the mockup tour's first step, right after start()'s
    // router.push) needs a measurement that still lands in that case.
    const raf1 = requestAnimationFrame(() => setRect(measure(selector)));
    const t1 = setTimeout(() => setRect(measure(selector)), 50);
    const t2 = setTimeout(() => setRect(measure(selector)), 200);
    const onResize = () => setRect(measure(selector));
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', onResize);
    };
  }, [activeTour, step]);

  const close = () => setActiveTour(null);

  if (!activeTour) return null;

  const tour = TOURS[activeTour];
  const current = tour.steps[step];
  const isLast = step === tour.steps.length - 1;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const { top: cardTop, left: cardLeft } = placeCard(rect, viewportW, viewportH);

  return (
    <>
      <svg className="tour-scrim" aria-hidden="true">
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
            {rect && <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} fill="#000" />}
          </mask>
        </defs>
        <rect className="tour-scrim-fill" x="0" y="0" width="100%" height="100%" mask="url(#tour-mask)" />
      </svg>

      {rect && (
        <div
          className="tour-ring"
          style={{
            width: rect.width + RING_PAD * 2,
            height: rect.height + RING_PAD * 2,
            transform: `translate(${rect.left - RING_PAD}px, ${rect.top - RING_PAD}px)`,
          }}
        />
      )}

      <div className="tour-card" style={{ width: CARD_W, transform: `translate(${cardLeft}px, ${cardTop}px)` }}>
        <span className="tour-step">Step {step + 1} of {tour.steps.length}</span>
        <span className="tour-title">{current.title}</span>
        <p className="tour-body">{current.body}</p>
        <div className="tour-actions">
          <button className="link-btn" onClick={close}>Skip tour</button>
          <div className="tour-nav">
            {step > 0 && (
              <button className="btn" onClick={() => setStep((s) => s - 1)}>Back</button>
            )}
            <button className="btn primary" onClick={() => (isLast ? close() : setStep((s) => s + 1))}>
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
