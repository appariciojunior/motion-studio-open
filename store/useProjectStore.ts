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
  type ProjectMeta,
} from '@/lib/projects';
import { flushScene, setAutosaveTarget } from '@/lib/scenePersist';
import {
  deleteProjectThreeD,
  readProjectThreeD,
  setThreeDSaveTarget,
  writeProjectThreeD,
} from '@/lib/three3dPersist';
import { useSceneStore } from './useSceneStore';
import { use3DStore } from './use3DStore';
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
  bootstrap: () => void;
  refresh: () => void;

  open: (id: string) => void;
  create: (name: string) => void;
  duplicate: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

const DEFAULT_NAME = 'Default project';

// The 3D/Mockup slice lives in its own store under its own storage key, so every
// switch below has to move it in step with the 2D scene. Restoring it is one
// helper so the five paths cannot drift, and it RETURNS the slice it loaded so
// each caller can seed the SAVE signature with it — opening a project is not an
// edit. Unlike the 2D scene it is never written automatically; MockupPanel's
// button is the only writer. A project saved before any of this existed simply
// has no slice and falls back to the app defaults.
function load3D(projectId: string) {
  const slice = readProjectThreeD(projectId);
  if (slice) {
    use3DStore.getState().hydrate3D(slice);
    // Screen media saves an id, never a blob: url — those are dead after a
    // reload. Rebuild the urls from the stored bytes.
    void use3DStore.getState().rehydrateScreenMedia();
  } else {
    use3DStore.getState().reset3D();
  }
  return slice;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeId: null,
  booted: false,

  refresh: () => set(() => ({ projects: listProjects(), activeId: activeProjectId() })),

  bootstrap: () => {
    if (get().booted || typeof window === 'undefined') return;
    const { meta, scene } = openInitialProject(DEFAULT_NAME);
    // A migrated/saved scene hydrates; a brand-new project keeps the store's
    // own defaults (openInitialProject returns null for it).
    if (scene) {
      useSceneStore.getState().hydrate(scene);
      void useSceneStore.getState().rehydrateUploads();
    }
    // Seed the autosave signature with what we just loaded, so simply opening a
    // project doesn't rewrite it and bump its updatedAt.
    setAutosaveTarget(meta.id, scene);
    setThreeDSaveTarget(meta.id, load3D(meta.id));
    set(() => ({ projects: listProjects(), activeId: meta.id, booted: true }));
  },

  open: (id) => {
    if (id === get().activeId) return;
    flushScene();                       // the edits so far belong to the OLD project
    setAutosaveTarget(null);            // ...and nothing may be written mid-swap
    // The Mockup studio is saved by hand, so leaving a project does NOT write
    // it — unsaved arrangement is discarded, the same as any explicit-save
    // document. Only the target moves.
    setThreeDSaveTarget(null);
    setActiveProject(id);
    const scene = readProjectScene(id);
    if (scene) {
      useSceneStore.getState().hydrate(scene);
      void useSceneStore.getState().rehydrateUploads();
    } else {
      useSceneStore.getState().resetScene();
    }
    setAutosaveTarget(id, scene);
    setThreeDSaveTarget(id, load3D(id));
    resetHistory();
    set(() => ({ projects: listProjects(), activeId: id }));
  },

  create: (name) => {
    flushScene();
    setAutosaveTarget(null);
    setThreeDSaveTarget(null);
    const meta = createProject(name);
    // A new project starts from the app defaults, not from whatever the previous
    // project happened to be showing.
    useSceneStore.getState().resetScene();
    // Empty signature → the flush below actually writes, persisting the starting
    // scene now so the project isn't an empty shell if the user switches away
    // before the first autosave tick.
    setAutosaveTarget(meta.id, null);
    // A new project starts from the 3D defaults too. Nothing is written for it:
    // a project with no saved studio falls back to those same defaults, so the
    // first save is the user's.
    use3DStore.getState().reset3D();
    setThreeDSaveTarget(meta.id, null);
    flushScene();
    resetHistory();
    set(() => ({ projects: listProjects(), activeId: meta.id }));
  },

  duplicate: (id) => {
    // Duplicating the ACTIVE project must capture its unsaved edits first.
    if (id === get().activeId) flushScene();
    const meta = duplicateProject(id);
    if (!meta) return;
    setAutosaveTarget(meta.id, readProjectScene(meta.id));
    // duplicateProject only knows about the 2D scene, so the SAVED 3D slice is
    // copied across by hand — otherwise a duplicated mockup opens as an empty
    // studio. Unsaved arrangement is not copied, because it was never a document.
    // Both projects then resolve the same IndexedDB rows for their screen media,
    // which is intended: those rows are keyed by id and neither owns them.
    const src = readProjectThreeD(id);
    if (src) writeProjectThreeD(meta.id, src);
    setThreeDSaveTarget(meta.id, src);
    resetHistory();
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
    const nextActive = activeProjectId();
    if (wasActive) {
      if (nextActive) {
        const scene = readProjectScene(nextActive);
        if (scene) {
          useSceneStore.getState().hydrate(scene);
          void useSceneStore.getState().rehydrateUploads();
        } else {
          useSceneStore.getState().resetScene();
        }
        setAutosaveTarget(nextActive, scene);
        setThreeDSaveTarget(nextActive, load3D(nextActive));
      } else {
        // Deleted the last project — start a fresh default one rather than
        // leaving the app with nowhere to save.
        useSceneStore.getState().resetScene();
        use3DStore.getState().reset3D();
        const meta = createProject(DEFAULT_NAME);
        setAutosaveTarget(meta.id, null);
        setThreeDSaveTarget(meta.id, null);
        flushScene();
      }
    }
    resetHistory();
    set(() => ({ projects: listProjects(), activeId: activeProjectId() }));
  },
}));
