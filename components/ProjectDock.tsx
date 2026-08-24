'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { sectionForProject } from '@/lib/navSections';
import type { ProjectMeta } from '@/lib/projects';
import { capturePoster } from '@/lib/projectPoster';
import { ago } from '@/lib/relativeTime';
import { getSaveStatus, subscribeSaveStatus } from '@/lib/saveStatus';
import { flushScene } from '@/lib/scenePersist';
import { flushThreeD } from '@/lib/three3dPersist';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { ProjectsIcon } from './EditorIcons';

// ============================================================
//  PROJECT DOCK — which project am I in, and is it saved?
//
//  The editor never said either. Nothing on the desktop screen named the open
//  project, and the only save the UI admitted to was a button in the Mockup
//  panel — so work that WAS being autosaved looked unsaved, and work in another
//  project looked like the same document.
//
//  So: a chip at the top of the stage carrying the project name and the state of
//  the autosave, and a menu for the three things you actually want from it —
//  rename, save right now, jump to another project.
// ============================================================

const RECENTS = 4;   // enough to switch between what you're juggling, not a list

function statusLabel(pending: boolean, savedAt: number | null, tick: number): string {
  void tick;                                     // re-renders on the clock, see below
  if (pending) return 'Saving…';
  if (savedAt === null) return 'Not saved yet';
  // Under a minute, "Saved" alone is truer than "saved 0 min ago" and quieter.
  return Date.now() - savedAt < 45_000 ? 'Saved' : `Saved ${ago(savedAt)}`;
}

export default function ProjectDock() {
  const projects = useProjectStore((s) => s.projects);
  const activeId = useProjectStore((s) => s.activeId);
  const open = useProjectStore((s) => s.open);
  const rename = useProjectStore((s) => s.rename);
  const refresh = useProjectStore((s) => s.refresh);
  const setNav = useUIStore((s) => s.setNav);
  const router = useRouter();

  const status = useSyncExternalStore(subscribeSaveStatus, getSaveStatus, getSaveStatus);
  // "Saved" has to age into "Saved 3 min ago" on its own — nothing writes to the
  // store while the user reads, so the clock is the only thing that changes.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const active = projects.find((p) => p.id === activeId) ?? null;

  // Pointer-down rather than click: a click listener on the document fires after
  // the element under the pointer has already been re-rendered, so closing on
  // click can swallow the very button the user aimed at.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const openMenu = () => {
    refresh();                       // dates and names may have moved on disk
    setDraftName(active?.name ?? '');
    setMenuOpen(true);
  };

  const commitName = () => {
    const next = draftName.trim();
    if (active && next && next !== active.name) rename(active.id, next);
  };

  const saveNow = () => {
    if (active?.mode === 'mockup') flushThreeD();
    else flushScene();
    capturePoster(activeId);         // and refresh the card picture while here
    setSavedFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1400);
  };

  const goToProjects = () => {
    setMenuOpen(false);
    capturePoster(activeId);
    setNav('projects');
    router.push('/projects');
  };

  // Same fixed mode rule as the Projects tab.
  const switchTo = (project: ProjectMeta) => {
    setMenuOpen(false);
    open(project.id);
    const target = sectionForProject(project.mode);
    if (useUIStore.getState().nav !== target.id) {
      setNav(target.id);
      router.push(target.href);
    }
  };

  if (!active) return null;
  const recents = projects.filter((p) => p.id !== active.id).slice(0, RECENTS);
  const label = statusLabel(status.pending, status.savedAt, tick);

  return (
    <div className="pdock" ref={rootRef}>
      <button
        className={`pdock-chip ${menuOpen ? 'open' : ''}`}
        onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
        aria-expanded={menuOpen}
        title="Project"
      >
        <span className="pdock-ico"><ProjectsIcon size={13} /></span>
        <span className="pdock-name">{active.name}</span>
        <span className={`pdock-state ${status.pending ? 'busy' : ''}`}>{label}</span>
      </button>

      {menuOpen && (
        <div className="pdock-menu" role="dialog" aria-label="Project">
          <label className="pdock-field-label" htmlFor="pdock-name">Project name</label>
          <input
            id="pdock-name"
            className="field"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commitName(); setMenuOpen(false); }
              if (e.key === 'Escape') setDraftName(active.name);
            }}
          />

          <div className="pdock-row">
            <span className="pdock-hint">
              {status.pending
                ? 'Writing your changes…'
                : status.savedAt
                  ? `Autosaved to this browser · ${new Date(status.savedAt).toLocaleTimeString()}`
                  : 'Autosaves as you work.'}
            </span>
          </div>
          <button className="btn full" onClick={saveNow} disabled={savedFlash}>
            {savedFlash ? 'Saved' : 'Save now'}
          </button>

          {recents.length > 0 && (
            <>
              <div className="pdock-sep" />
              <span className="pdock-field-label">Switch to</span>
              <div className="pdock-recents">
                {recents.map((p) => (
                  <button key={p.id} className="pdock-recent" onClick={() => switchTo(p)}>
                    <span className="pdock-recent-name">{p.name}</span>
                    <span className="pdock-recent-meta">{ago(p.updatedAt)}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="pdock-sep" />
          <button className="btn full" onClick={goToProjects}>All projects</button>
        </div>
      )}
    </div>
  );
}
