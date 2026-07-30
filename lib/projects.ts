// ============================================================
//  PROJECTS — many named scenes instead of one autosaved blob
//
//  Storage layout (localStorage):
//    motion-projects-v1     → { activeId, projects: ProjectMeta[] }   the index
//    motion-project-<id>    → ScenePartial                            one per project
//    motion-scene-v1        → ScenePartial   LEGACY, kept as a backup
//
//  The scene lives in its OWN key per project rather than inside the index, so
//  the 500ms autosave rewrites one project's blob instead of serializing every
//  project on every write (a scene carries the whole asset list).
//
//  Migration is non-destructive: the pre-projects scene is COPIED into a project
//  and `motion-scene-v1` is left untouched, so a user who downgrades (or a bug
//  here) can't lose their work.
// ============================================================

import type { ScenePartial } from './scenePersist';

const INDEX_KEY = 'motion-projects-v1';
export const LEGACY_SCENE_KEY = 'motion-scene-v1';

const sceneKeyFor = (id: string) => `motion-project-${id}`;

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;  // epoch ms
  updatedAt: number;
}

interface ProjectsIndex {
  activeId: string | null;
  projects: ProjectMeta[];
}

// A FUNCTION, not a shared constant: callers mutate the index they get back
// (createProject pushes into `.projects`), so handing out one frozen-in-place
// object would let an empty read accumulate state and resurrect phantom
// projects after the index is cleared or corrupted.
const emptyIndex = (): ProjectsIndex => ({ activeId: null, projects: [] });

// Ids only need to be unique within one browser. A counter alongside the clock
// keeps two projects created in the same millisecond apart.
let seq = 0;
const newId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

function readIndex(): ProjectsIndex {
  if (typeof window === 'undefined') return emptyIndex();
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return emptyIndex();
    const parsed = JSON.parse(raw) as ProjectsIndex;
    if (!Array.isArray(parsed.projects)) return emptyIndex();
    // Drop malformed entries rather than letting them crash the panel later.
    const projects = parsed.projects.filter(
      (p): p is ProjectMeta => !!p && typeof p.id === 'string' && typeof p.name === 'string',
    );
    return { activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null, projects };
  } catch {
    return emptyIndex();
  }
}

function writeIndex(ix: ProjectsIndex): void {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(ix)); } catch { /* quota — non-fatal */ }
}

export function listProjects(): ProjectMeta[] {
  // Most recently touched first: the list reads as a "recent projects" list.
  return readIndex().projects.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function activeProjectId(): string | null {
  const ix = readIndex();
  // Guard against an activeId whose project was removed out from under it.
  return ix.projects.some((p) => p.id === ix.activeId) ? ix.activeId : null;
}

export function readProjectScene(id: string): ScenePartial | null {
  try {
    const raw = localStorage.getItem(sceneKeyFor(id));
    return raw ? (JSON.parse(raw) as ScenePartial) : null;
  } catch {
    return null;
  }
}

// Persist a project's scene and stamp it as the most recently touched.
export function writeProjectScene(id: string, partial: ScenePartial): void {
  try { localStorage.setItem(sceneKeyFor(id), JSON.stringify(partial)); } catch { return; }
  const ix = readIndex();
  const i = ix.projects.findIndex((p) => p.id === id);
  if (i < 0) return;
  ix.projects[i] = { ...ix.projects[i], updatedAt: Date.now() };
  writeIndex(ix);
}

export function createProject(name: string, scene?: ScenePartial | null): ProjectMeta {
  const now = Date.now();
  const meta: ProjectMeta = { id: newId(), name: name.trim() || 'Untitled', createdAt: now, updatedAt: now };
  const ix = readIndex();
  ix.projects.push(meta);
  ix.activeId = meta.id;
  writeIndex(ix);
  // No scene → the app keeps its current state / built-in defaults. Writing an
  // empty object here would hydrate a blank scene over the defaults.
  if (scene) {
    try { localStorage.setItem(sceneKeyFor(meta.id), JSON.stringify(scene)); } catch { /* quota */ }
  }
  return meta;
}

export function renameProject(id: string, name: string): void {
  const ix = readIndex();
  const i = ix.projects.findIndex((p) => p.id === id);
  if (i < 0) return;
  ix.projects[i] = { ...ix.projects[i], name: name.trim() || ix.projects[i].name };
  writeIndex(ix);
}

export function duplicateProject(id: string): ProjectMeta | null {
  const ix = readIndex();
  const src = ix.projects.find((p) => p.id === id);
  if (!src) return null;
  return createProject(`${src.name} copy`, readProjectScene(id));
}

// Removing the active project hands the active slot to the next most recent one,
// so the app is never left pointing at nothing.
export function deleteProject(id: string): void {
  const ix = readIndex();
  const projects = ix.projects.filter((p) => p.id !== id);
  let activeId = ix.activeId;
  if (activeId === id) {
    const next = projects.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
    activeId = next ? next.id : null;
  }
  writeIndex({ activeId, projects });
  try { localStorage.removeItem(sceneKeyFor(id)); } catch { /* noop */ }
}

export function setActiveProject(id: string): void {
  const ix = readIndex();
  if (!ix.projects.some((p) => p.id === id)) return;
  writeIndex({ ...ix, activeId: id });
}

/**
 * Resolve which project the app should open, creating one if needed. Returns the
 * active project and the scene to hydrate (null = use the app's own defaults).
 *
 * Runs once on mount. Non-destructive by design: a pre-projects scene is COPIED
 * into a project and the legacy key is left in place as a backup.
 */
export function openInitialProject(defaultName: string): { meta: ProjectMeta; scene: ScenePartial | null } {
  const ix = readIndex();

  if (ix.projects.length === 0) {
    let legacy: ScenePartial | null = null;
    try {
      const raw = localStorage.getItem(LEGACY_SCENE_KEY);
      if (raw) legacy = JSON.parse(raw) as ScenePartial;
    } catch { /* corrupt legacy blob — start fresh instead of failing to boot */ }
    // A migrated scene keeps its own name so the user recognizes their work.
    const meta = createProject(legacy ? 'My project' : defaultName, legacy);
    return { meta, scene: legacy };
  }

  const wanted = activeProjectId();
  const sorted = ix.projects.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const meta = ix.projects.find((p) => p.id === wanted) ?? sorted[0];
  if (meta.id !== ix.activeId) setActiveProject(meta.id);
  return { meta, scene: readProjectScene(meta.id) };
}
