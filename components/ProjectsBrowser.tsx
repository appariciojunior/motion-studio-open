'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { modeForSection, sectionForProject } from '@/lib/navSections';
import { loadPoster, subscribePosters } from '@/lib/projectPoster';
import { readProjectScene, type ProjectMeta } from '@/lib/projects';
import { ago } from '@/lib/relativeTime';
import { readProjectThreeD } from '@/lib/three3dPersist';
import { templates } from '@/templates';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { AddIcon, DuplicateIcon, PencilIcon, TrashIcon } from './EditorIcons';

// ============================================================
//  PROJECTS TAB — the section's own full-width view
//
//  Projects used to be a list in the left column while the stage behind it kept
//  showing the open project, so picking one was a blind swap: the panel named
//  files, it never showed them. Here the section behaves like the other tabs —
//  it owns the middle of the screen — and every card carries the last picture of
//  its stage (lib/projectPoster), so you recognise the work before opening it.
//
//  Where a card has no picture yet (a project last touched before posters
//  existed, or one never opened) it falls back to a sketch built from the SAVED
//  scene: the real canvas ratio and the real background, with the template name
//  in the card's own meta line rather than stamped over the artwork.
//
//  Layout notes worth keeping:
//  - The grid is inside a max-width column. Left to fill a 1600px window it made
//    six 210px cards in one thin row with a screen of white under them: a file
//    browser reads as a shelf, not as a strip.
//  - Row actions live over the thumbnail, not in the name row. In the name row
//    they collided with long project names on every card narrower than ~260px.
// ============================================================

const SEARCH_THRESHOLD = 6;   // below this, a filter box is just another control
type Sort = 'recent' | 'name';

/** The poster bytes for one project as an object URL, refreshed on each capture. */
function usePosterUrl(projectId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let own: string | null = null;
    const load = () => {
      loadPoster(projectId).then((blob) => {
        if (dead) return;
        const next = blob ? URL.createObjectURL(blob) : null;
        if (own) URL.revokeObjectURL(own);
        own = next;
        setUrl(next);
      });
    };
    load();
    // A capture writes to IndexedDB, which no React state watches — so the
    // module tells its cards to read again.
    const off = subscribePosters(load);
    return () => {
      dead = true;
      off();
      if (own) URL.revokeObjectURL(own);
    };
  }, [projectId]);

  return url;
}

interface Sketch {
  ratio: number;          // canvas aspect, so the placeholder has the project's shape
  bg: string;             // the scene's own background, as a CSS value
  template: string | null;
  size: string | null;    // "1080 × 1350"
  layers: number;
  device: string | null;  // the saved Mockup device, when the project has one
  animation: string | null;
  screen: boolean;        // artwork loaded onto the device's screen
}

// 'tilt-slow' → 'Tilt slow'. The preset table lives in three3d/animations, which
// imports three.js — not something the Projects tab should pull in for a label.
function humanize(key: string): string {
  const words = key.replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

function sketchFor(p: ProjectMeta): Sketch {
  const scene = p.mode === '2d' ? readProjectScene(p.id) : null;
  const studio = p.mode === 'mockup' ? readProjectThreeD(p.id) : null;
  const w = studio?.canvas?.width || scene?.width || 1080;
  const h = studio?.canvas?.height || scene?.height || 1350;
  const bgSpec = scene?.background;
  const bg = bgSpec
    ? bgSpec.gradient
      ? `linear-gradient(160deg, ${bgSpec.color} 0%, ${bgSpec.color2} 100%)`
      : bgSpec.color
    : 'var(--card-thumb)';
  const tracks = scene?.tracks ?? [];
  const templateId = scene?.activeTemplateId ?? tracks[0]?.templateId;
  const template = templateId ? templates[templateId]?.meta.name ?? templateId : null;
  const animation = studio?.mockupAnimation && studio.mockupAnimation !== 'static'
    ? humanize(studio.mockupAnimation)
    : null;
  return {
    ratio: w / h,
    bg,
    template,
    size: scene || studio ? `${w} × ${h}` : null,
    layers: tracks.length,
    device: studio?.models?.mockup?.name ?? null,
    animation,
    screen: Object.values(studio?.screenMedia ?? {}).some((m) => !!m),
  };
}

/**
 * Size the picture frame inside the 4:3 window. ONE axis is fixed and the other
 * is left to aspect-ratio: fixing both (a size plus a max- in the other axis)
 * silently breaks the ratio the moment the max clamps — and the frame exists to
 * state the project's shape. The sketch also paints the scene's background;
 * a poster brings its own pixels.
 */
function frameStyle(sketch: Sketch, poster: string | null): React.CSSProperties {
  const axis = sketch.ratio < 4 / 3 ? { height: '76%' } : { width: '82%' };
  return { aspectRatio: String(sketch.ratio), ...axis, ...(poster ? null : { background: sketch.bg }) };
}

export default function ProjectsBrowser() {
  const projects = useProjectStore((s) => s.projects);
  const activeId = useProjectStore((s) => s.activeId);
  const open = useProjectStore((s) => s.open);
  const create = useProjectStore((s) => s.create);
  const duplicate = useProjectStore((s) => s.duplicate);
  const rename = useProjectStore((s) => s.rename);
  const remove = useProjectStore((s) => s.remove);
  const refresh = useProjectStore((s) => s.refresh);
  const setNav = useUIStore((s) => s.setNav);
  const lastEditorNav = useUIStore((s) => s.lastEditorNav);
  const router = useRouter();

  // Both autosaves stamp updatedAt straight into localStorage without going
  // through this store, so the list it holds can be stale by the time the tab
  // opens: measured a card reading "edited 13 h ago" seconds after the write.
  // Re-reading the index on mount is one localStorage parse.
  useEffect(() => { refresh(); }, [refresh]);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  // Deleting a project throws away its scene, so it asks first.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects.slice();
    // `projects` already arrives most-recent-first (lib/projects sorts the index).
    return sort === 'name' ? list.sort((a, b) => a.name.localeCompare(b.name)) : list;
  }, [projects, query, sort]);

  // Opening a project means going to its fixed editor mode. Navigation history
  // cannot turn a 2D project into a mockup or vice versa.
  //
  // Same optimistic setNav as the rail: the URL is the source of truth, but a
  // first navigation to an uncompiled route takes seconds in dev.
  const openProject = (project: ProjectMeta) => {
    if (project.id !== activeId) open(project.id);
    const target = sectionForProject(project.mode);
    setNav(target.id);
    router.push(target.href);
  };

  // Create and stay here, with the new card's name selected — a project is named
  // at birth or never, and dropping straight into the editor is what the card
  // click is for. The kind comes from the group the button belongs to, so a
  // mockup project is a mockup project from the moment it exists.
  const newProject = () => {
    const name = `Project ${projects.length + 1}`;
    create(name, modeForSection(lastEditorNav));
    setQuery('');
    setEditingId(null);
    setEditName(name);
    // The store's activeId is the project just created; pick it up after the
    // state lands rather than guessing its id here.
    queueMicrotask(() => {
      const id = useProjectStore.getState().activeId;
      if (id) setEditingId(id);
    });
  };

  const commitRename = (id: string) => {
    if (editName.trim()) rename(id, editName.trim());
    setEditingId(null);
    setEditName('');
  };

  return (
    <div className="pj">
      <div className="pj-inner">
        <header className="pj-head">
          <div className="pj-head-titles">
            <h1 className="pj-title">Projects</h1>
            <p className="pj-sub">
              {projects.length === 0
                ? 'Nothing saved in this browser yet'
                : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} saved in this browser · autosaved as you work`}
              {shown.length !== projects.length ? ` · ${shown.length} shown` : ''}
            </p>
          </div>

          <div className="pj-tools">
            {projects.length >= SEARCH_THRESHOLD && (
              <input
                className="field pj-search"
                placeholder="Search projects"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            {projects.length > 1 && (
              <div className="segmented pj-sort">
                <button className={`seg ${sort === 'recent' ? 'active' : ''}`} onClick={() => setSort('recent')}>Recent</button>
                <button className={`seg ${sort === 'name' ? 'active' : ''}`} onClick={() => setSort('name')}>Name</button>
              </div>
            )}
            <button className="btn solid" onClick={newProject}>New project</button>
          </div>
        </header>

        {/* One shelf, two document modes. The type chip on each card says which
            editor and which persistence slice that project owns. */}
        <div className="pj-grid">
          {shown.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              isActive={p.id === activeId}
              isEditing={editingId === p.id}
              isConfirming={confirmId === p.id}
              editName={editName}
              onOpen={() => openProject(p)}
              onEditName={setEditName}
              onStartRename={() => { setEditingId(p.id); setEditName(p.name); setConfirmId(null); }}
              onCommitRename={() => commitRename(p.id)}
              onCancelRename={() => { setEditingId(null); setEditName(''); }}
              onDuplicate={() => duplicate(p.id)}
              onDelete={() => (confirmId === p.id ? (remove(p.id), setConfirmId(null)) : setConfirmId(p.id))}
              onCancelDelete={() => setConfirmId(null)}
            />
          ))}

          {/* The create affordance sits IN the grid as well as in the header: a
              shelf with one card should still show where the next one comes
              from. Hidden while filtering — a tile that ignores the query would
              read as a result. */}
          {!query.trim() && (
            <button className="pj-new" onClick={newProject}>
              <span className="pj-new-mark"><AddIcon size={18}/></span>
              <span className="pj-new-label">New project</span>
              <span className="pj-new-hint">Starts empty · pick a template</span>
            </button>
          )}

          {shown.length === 0 && query.trim() && (
            <p className="pj-empty">Nothing matches “{query.trim()}”.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  isActive,
  isEditing,
  isConfirming,
  editName,
  onOpen,
  onEditName,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDuplicate,
  onDelete,
  onCancelDelete,
}: {
  project: ProjectMeta;
  isActive: boolean;
  isEditing: boolean;
  isConfirming: boolean;
  editName: string;
  onOpen: () => void;
  onEditName: (v: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
}) {
  const poster = usePosterUrl(project.id);
  // Re-read on every stamped edit: a rename or a save changes what the sketch
  // should say, and the scene it reads from is localStorage, not React state.
  const sketch = useMemo(() => sketchFor(project), [project.id, project.updatedAt]);   // eslint-disable-line react-hooks/exhaustive-deps

  const facts = (project.mode === 'mockup'
    ? ['Mockup', sketch.device ?? 'No device yet', sketch.animation, sketch.screen ? 'Screen art' : null, sketch.size]
    : ['2D', sketch.template, sketch.layers > 0 ? `${sketch.layers} ${sketch.layers === 1 ? 'layer' : 'layers'}` : 'Empty', sketch.size]
  ).filter(Boolean) as string[];

  return (
    <article className={`pj-card ${isActive ? 'active' : ''} ${isConfirming ? 'confirming' : ''}`}>
      <button
        className="pj-shot"
        onClick={onOpen}
        title={isActive ? `Continue in ${project.name}` : `Open ${project.name}`}
      >
        {/* Poster and sketch get the SAME treatment: a frame at the project's
            own canvas ratio, sitting on the mat with a hairline of its own. A
            poster stretched edge to edge with object-fit: contain has no visible
            edge, so a light scene dissolved into the light mat and read as a
            washed-out blob rather than as a picture. */}
        <span className={`pj-frame ${poster ? '' : 'sketch'}`} style={frameStyle(sketch, poster)}>
          {poster && <img className="pj-shot-img" src={poster} alt="" draggable={false} />}
        </span>
        {isActive && <span className="pj-flag">Open</span>}
        {!poster && <span className="pj-noshot">No preview yet</span>}
      </button>

      {/* Over the thumbnail, revealed on hover/focus — see the layout note at
          the top of the file. */}
      <div className="pj-actions">
        <button className="pj-act" title="Rename" onClick={onStartRename}><PencilIcon size={13}/></button>
        <button className="pj-act" title="Duplicate" onClick={onDuplicate}><DuplicateIcon size={13}/></button>
        <button className={`pj-act ${isConfirming ? 'danger' : ''}`} title={isConfirming ? 'Click again to delete' : 'Delete'} onClick={onDelete}><TrashIcon size={13}/></button>
      </div>

      <div className="pj-foot">
        {isEditing ? (
          <input
            className="field pj-rename"
            autoFocus
            value={editName}
            onChange={(e) => onEditName(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
          />
        ) : (
          <>
            <span className="pj-name" title={project.name}>{project.name}</span>
            {/* The open project keeps its date too: "open now" alone dropped the
                one fact every other card in the row states. */}
            <span className="pj-meta">
              {isActive ? `open now · edited ${ago(project.updatedAt)}` : `edited ${ago(project.updatedAt)}`}
            </span>
            {facts.length > 0 && (
              <span className="pj-facts">
                {facts.map((f) => <span key={f} className="pj-fact">{f}</span>)}
              </span>
            )}
          </>
        )}
      </div>

      {isConfirming && (
        <div className="pj-confirm">
          <span>Delete “{project.name}”? Its saved document goes with it.</span>
          <div className="pj-confirm-row">
            <button className="btn" onClick={onCancelDelete}>Keep</button>
            <button className="btn solid danger" onClick={onDelete}>Delete</button>
          </div>
        </div>
      )}
    </article>
  );
}
