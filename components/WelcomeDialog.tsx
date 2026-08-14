'use client';

import { useEffect, useState } from 'react';
import { useProjectStore } from '@/store/useProjectStore';

const SEEN_KEY = 'motion-welcome-seen';

// First-run welcome: shows once, until the user agrees and enters the library.
export default function WelcomeDialog() {
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    try { if (!localStorage.getItem(SEEN_KEY)) setOpen(true); } catch { /* storage blocked */ }
  }, []);

  // Accepting hands the user a real, named project to work in rather than an
  // unsaved scratch scene. bootstrap() (shell mount) has already created the
  // default project, so this only has to make sure one is open — it never
  // overwrites an existing project.
  //
  // It no longer forces the library section: the URL owns that now, and `/`
  // already lands there. Yanking a first-time visitor who opened /mockup back
  // to the library would break the link they followed.
  const enter = () => {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ }
    const projects = useProjectStore.getState();
    projects.bootstrap();               // no-op when already booted
    if (!projects.activeId) projects.create('Default project');
    setOpen(false);
    // Lets a first-time visitor's tour start right after they agree, instead of
    // AppTour racing WelcomeDialog's own localStorage check on mount.
    try { window.dispatchEvent(new Event('motion-welcome-done')); } catch { /* noop */ }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop welcome-backdrop">
      <div className="modal welcome" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-body">
          <span className="eyebrow">Welcome</span>
          <h1 className="welcome-title">Motion Studio</h1>

          <p>
            This is an open-source adaptation of several motion libraries —
            CodePen demos, React Bits, React Motion, JS motion work and others.
          </p>
          <p>
            Use it responsibly. It is <b>not to be sold or commercialised</b>{' — '}
            it&apos;s here for you and your company, where needed.
          </p>
          <p>
            This is a <b>beta</b>: since it&apos;s still being tested, some things
            might break or behave unexpectedly.
          </p>

          <p className="welcome-love">
            Made with love, so you can have great videos for your deck
            presentations and social media posts.
          </p>

          <label className="welcome-agree">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            I agree not to commercialise this
          </label>

          {agreed && (
            <button className="btn primary full" onClick={enter}>
              Go to the library
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
