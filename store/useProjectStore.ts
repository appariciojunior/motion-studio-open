import { create } from 'zustand';
import {
  activeProjectId,
  createProject,
  deleteProject,
  duplicateProject,
  listProjects,
  openInitialProject,
  readProjectScene,
  renameProject,
  setActiveProject,
  type ProjectMode,
  type ProjectMeta,
} from '@/lib/projects';
import { capturePoster, copyPoster, deletePoster } from '@/lib/projectPoster';
import { resetSaveStatus } from '@/lib/saveStatus';
import { flushScene, setAutosaveTarget } from '@/lib/scenePersist';
import {
  deleteProjectThreeD,
  flushThreeD,
  readProjectThreeD,
  setThreeDSaveTarget,
  writeProjectThreeD,
} from '@/lib/three3dPersist';
import { useSceneStore } from './useSceneStore';
import { reset3DMemory, use3DStore } from './use3DStore';
import { useHistoryStore } from './useHistoryStore';

// Any switch of the open project drops undo history: undoing across a switch
// would write one project's scene into another.
const resetHistory = () => useHistoryStore.getState().reset();

// The project list, and the switching that keeps the scene store and the
// autosave target in step. Kept out of useSceneStore: a project is ABOUT a
// scene, it isn't part of one — and the scene store is what gets serialized.
export interface ProjectState {
  projects: ProjectMeta[];
  activeId: string | null;
  booted: boolean;

  // Mount-time: resolve/create the project to open and hydrate its scene.
  bootstrap: (mode?: ProjectMode) => void;
  refresh: () => void;

  open: (id: string) => void;
  create: (name: string, mode?: ProjectMode) => void;
  duplicate: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

const DEFAULT_NAME = 'Default project';

// The 3D/Mockup slice lives in its own store under its own storage key, so every
// switch below has to move it in step with the 2D scene. Restoring it is one
// helper so the five paths cannot drift, and it RETURNS the slice it loaded so
// each caller can seed the SAVE signature with it — opening a project is not an
// edit, and an unseeded signature would make the autosave rewrite the slice it
// just read. A project saved before any of this existed simply has no slice and
// falls back to the app defaults.
function load3D(projectId: string) {
  const slice = readProjectThreeD(projectId);
  // Release only the previous tab's object URLs. Deleting its IndexedDB rows
  // here would corrupt the saved mockup we just left.
  reset3DMemory();
  if (slice) {
    use3DStore.getState().hydrate3D(slice);
    // Screen media saves an id, never a blob: url — those are dead after a
    // reload. Rebuild the urls from the stored bytes.
    void use3DStore.getState().rehydrateScreenMedia();
  } else {
    // reset3DMemory above already established the defaults.
  }
  return slice;
}

function flushProject(meta: ProjectMeta | undefined): void {
  if (meta?.mode === 'mockup') flushThreeD();
  else if (meta) flushScene();
}

/** Hydrate one document and explicitly disable the other save target. */
function loadProject(meta: ProjectMeta): void {
  if (meta.mode === 'mockup') {
    useSceneStore.getState().blankScene();
    setAutosaveTarget(null);
    const studio = load3D(meta.id);
    if (studio?.canvas) useSceneStore.setState(studio.canvas);
    setThreeDSaveTarget(meta.id, studio);
    return;
  }

  const scene = readProjectScene(meta.id);
  if (scene) {
    useSceneStore.getState().hydrate(scene);
    void useSceneStore.getState().rehydrateUploads();
  } else {
    useSceneStore.getState().blankScene();
  }
  setAutosaveTarget(meta.id, scene);
  reset3DMemory();
  setThreeDSaveTarget(null);
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeId: null,
  booted: false,

  refresh: () => set(() => ({ projects: listProjects(), activeId: activeProjectId() })),

  bootstrap: (mode = '2d') => {
    if (get().booted || typeof window === 'undefined') return;
    const { meta } = openInitialProject(DEFAULT_NAME, mode);
    loadProject(meta);
    // Seed the editor's save indicator with when this project was last written,
    // not with "now" and not with nothing: a project that has been on disk for
    // two hours must not open reading "Not saved yet".
    resetSaveStatus(meta.updatedAt);
    set(() => ({ projects: listProjects(), activeId: meta.id, booted: true }));
  },

  open: (id) => {
    if (id === get().activeId) return;
    // The card picture of the project being left, grabbed while its stage is
    // still the one on screen (see lib/projectPoster: the pixel read is sync).
    const current = get().projects.find((p) => p.id === get().activeId);
    capturePoster(get().activeId);
    flushProject(current);              // only the document this project owns
    setAutosaveTarget(null);            // nothing may be written mid-swap
    setThreeDSaveTarget(null);
    setActiveProject(id);
    const next = listProjects().find((p) => p.id === id);
    if (!next) return;
    loadProject(next);
    resetHistory();
    // The "saved 2 min ago" of the project just left says nothing about this
    // one, whose true answer is when IT was last written.
    const list = listProjects();
    resetSaveStatus(list.find((p) => p.id === id)?.updatedAt ?? Date.now());
    set(() => ({ projects: list, activeId: id }));
  },

  create: (name, mode = '2d') => {
    const current = get().projects.find((p) => p.id === get().activeId);
    capturePoster(get().activeId);
    flushProject(current);
    setAutosaveTarget(null);
    setThreeDSaveTarget(null);
    const meta = createProject(name, mode);
    // A new project starts BLANK — no layers at all. It used to start from the
    // app's default template ('carousel', shown as "Runway") with the demo set
    // animating, so every new project was a copy of the last one and the list
    // read as two of the same thing. The first template pick is the user's, and
    // nothing from the library is in it until they make one.
    useSceneStore.getState().blankScene();
    // Empty signature → the flush below actually writes, persisting the starting
    // scene now so the project isn't an empty shell if the user switches away
    // before the first autosave tick.
    setAutosaveTarget(mode === '2d' ? meta.id : null, null);
    // A new project starts from the 3D defaults too. The empty signature means
    // the autosave's next tick writes those defaults out, which is the same
    // state a missing slice falls back to — so either way a fresh project opens
    // an empty studio.
    reset3DMemory();
    setThreeDSaveTarget(mode === 'mockup' ? meta.id : null, null);
    if (mode === 'mockup') flushThreeD();
    else flushScene();
    resetHistory();
    resetSaveStatus(Date.now());
    set(() => ({ projects: listProjects(), activeId: meta.id }));
  },

  duplicate: (id) => {
    // Duplicating the ACTIVE project must capture its unsaved edits first.
    const source = get().projects.find((p) => p.id === id);
    if (id === get().activeId) flushProject(source);
    const meta = duplicateProject(id);
    if (!meta) return;
    // Posters live outside the project record, so the copy starts blank unless
    // its picture is copied across too.
    copyPoster(id, meta.id);
    setAutosaveTarget(meta.mode === '2d' ? meta.id : null, readProjectScene(meta.id));
    // duplicateProject only knows about the 2D scene, so the SAVED 3D slice is
    // copied across by hand — otherwise a duplicated mockup opens as an empty
    // studio. Unsaved arrangement is not copied, because it was never a document.
    // Both projects then resolve the same IndexedDB rows for their screen media,
    // which is intended: those rows are keyed by id and neither owns them.
    const src = meta.mode === 'mockup' ? readProjectThreeD(id) : null;
    if (src) writeProjectThreeD(meta.id, src);
    setThreeDSaveTarget(meta.mode === 'mockup' ? meta.id : null, src);
    resetHistory();
    resetSaveStatus(Date.now());
    set(() => ({ projects: listProjects(), activeId: meta.id }));
  },

  rename: (id, name) => {
    renameProject(id, name);
    set(() => ({ projects: listProjects() }));
  },

  remove: (id) => {
    const wasActive = id === get().activeId;
    if (wasActive) {
      setAutosaveTarget(null);       // don't let a pending tick resurrect it
      setThreeDSaveTarget(null);
    }
    deleteProject(id);
    deleteProjectThreeD(id);
    deletePoster(id);            // nothing else would ever collect it
    const nextActive = activeProjectId();
    if (wasActive) {
      if (nextActive) {
        const next = listProjects().find((p) => p.id === nextActive);
        if (next) loadProject(next);
      } else {
        // Deleted the last project — start a fresh one rather than leaving the
        // app with nowhere to save. Blank, like any created project.
        useSceneStore.getState().blankScene();
        reset3DMemory();
        const meta = createProject(DEFAULT_NAME, '2d');
        setAutosaveTarget(meta.id, null);
        setThreeDSaveTarget(null);
        flushScene();
      }
    }
    resetHistory();
    if (wasActive) resetSaveStatus(Date.now());
    set(() => ({ projects: listProjects(), activeId: activeProjectId() }));
  },
}));
