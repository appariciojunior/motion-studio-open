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
import { useSceneStore } from './useSceneStore';

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
    set(() => ({ projects: listProjects(), activeId: meta.id, booted: true }));
  },

  open: (id) => {
    if (id === get().activeId) return;
    flushScene();                       // the edits so far belong to the OLD project
    setAutosaveTarget(null);            // ...and nothing may be written mid-swap
    setActiveProject(id);
    const scene = readProjectScene(id);
    if (scene) {
      useSceneStore.getState().hydrate(scene);
      void useSceneStore.getState().rehydrateUploads();
    } else {
      useSceneStore.getState().resetScene();
    }
    setAutosaveTarget(id, scene);
    set(() => ({ projects: listProjects(), activeId: id }));
  },

  create: (name) => {
    flushScene();
    setAutosaveTarget(null);
    const meta = createProject(name);
    // A new project starts from the app defaults, not from whatever the previous
    // project happened to be showing.
    useSceneStore.getState().resetScene();
    // Empty signature → the flush below actually writes, persisting the starting
    // scene now so the project isn't an empty shell if the user switches away
    // before the first autosave tick.
    setAutosaveTarget(meta.id, null);
    flushScene();
    set(() => ({ projects: listProjects(), activeId: meta.id }));
  },

  duplicate: (id) => {
    // Duplicating the ACTIVE project must capture its unsaved edits first.
    if (id === get().activeId) flushScene();
    const meta = duplicateProject(id);
    if (!meta) return;
    setAutosaveTarget(meta.id, readProjectScene(meta.id));
    set(() => ({ projects: listProjects(), activeId: meta.id }));
  },

  rename: (id, name) => {
    renameProject(id, name);
    set(() => ({ projects: listProjects() }));
  },

  remove: (id) => {
    const wasActive = id === get().activeId;
    if (wasActive) setAutosaveTarget(null); // don't let a pending tick resurrect it
    deleteProject(id);
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
      } else {
        // Deleted the last project — start a fresh default one rather than
        // leaving the app with nowhere to save.
        useSceneStore.getState().resetScene();
        const meta = createProject(DEFAULT_NAME);
        setAutosaveTarget(meta.id, null);
        flushScene();
      }
    }
    set(() => ({ projects: listProjects(), activeId: activeProjectId() }));
  },
}));
