import { create } from 'zustand';
import {
  addWorkspaceDraft, addWorkspaceFile, createWorkspace, createWorkspaceProject, deleteTrashItem, deleteWorkspace,
  deleteWorkspaceDraft, deleteWorkspaceFile, deleteWorkspaceProject, listDrafts, listTrash, listWorkspaces,
  renameWorkspace, renameWorkspaceDraft, renameWorkspaceFile, renameWorkspaceProject, restoreTrashItem,
  setFileThumbnail, setWorkspaceIcon, setWorkspaceSelection, workspaceSelection,
  type AnimationFile, type TrashItem, type Workspace,
} from '@/lib/workspaces';

interface WorkspaceState {
  workspaces: Workspace[];
  drafts: AnimationFile[];
  trash: TrashItem[];
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
  booted: boolean;
  bootstrap: () => void;
  select: (workspaceId: string, projectId?: string) => void;
  createWorkspace: (name: string) => void;
  renameWorkspace: (workspaceId: string, name: string) => void;
  removeWorkspace: (workspaceId: string) => void;
  setWorkspaceIcon: (workspaceId: string, icon: string) => void;
  createProject: (workspaceId: string, name: string) => void;
  renameProject: (workspaceId: string, projectId: string, name: string) => void;
  removeProject: (workspaceId: string, projectId: string) => void;
  addFile: (workspaceId: string, projectId: string, file: AnimationFile) => void;
  renameFile: (workspaceId: string, projectId: string, fileId: string, name: string) => void;
  removeFile: (workspaceId: string, projectId: string, fileId: string) => void;
  setThumbnail: (workspaceId: string, projectId: string, fileId: string, thumbnail?: string) => void;
  addDraft: (file: AnimationFile) => void;
  renameDraft: (fileId: string, name: string) => void;
  removeDraft: (fileId: string) => void;
  restoreTrash: (trashId: string) => void;
  deleteTrash: (trashId: string) => void;
}

const refresh = () => {
  const { workspaceId, projectId } = workspaceSelection();
  return {
    workspaces: listWorkspaces(),
    drafts: listDrafts(),
    trash: listTrash(),
    activeWorkspaceId: workspaceId,
    activeProjectId: projectId,
  };
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [], drafts: [], trash: [], activeWorkspaceId: null, activeProjectId: null, booted: false,
  bootstrap: () => {
    if (get().booted || typeof window === 'undefined') return;
    set({ ...refresh(), booted: true });
  },
  select: (workspaceId, projectId) => { setWorkspaceSelection(workspaceId, projectId); set(refresh()); },
  createWorkspace: (name) => {
    const workspace = createWorkspace(name);
    // Select the created workspace from the returned object, rather than
    // immediately re-reading browser storage (which may be full or stale).
    set((state) => ({
      workspaces: [...state.workspaces.filter((item) => item.id !== workspace.id), workspace],
      activeWorkspaceId: workspace.id,
      activeProjectId: null,
    }));
  },
  renameWorkspace: (workspaceId, name) => { renameWorkspace(workspaceId, name); set(refresh()); },
  removeWorkspace: (workspaceId) => { deleteWorkspace(workspaceId); set(refresh()); },
  setWorkspaceIcon: (workspaceId, icon) => { setWorkspaceIcon(workspaceId, icon); set(refresh()); },
  createProject: (workspaceId, name) => { createWorkspaceProject(workspaceId, name); set(refresh()); },
  renameProject: (workspaceId, projectId, name) => { renameWorkspaceProject(workspaceId, projectId, name); set(refresh()); },
  removeProject: (workspaceId, projectId) => { deleteWorkspaceProject(workspaceId, projectId); set(refresh()); },
  addFile: (workspaceId, projectId, file) => { addWorkspaceFile(workspaceId, projectId, file); set(refresh()); },
  renameFile: (workspaceId, projectId, fileId, name) => { renameWorkspaceFile(workspaceId, projectId, fileId, name); set(refresh()); },
  removeFile: (workspaceId, projectId, fileId) => { deleteWorkspaceFile(workspaceId, projectId, fileId); set(refresh()); },
  setThumbnail: (workspaceId, projectId, fileId, thumbnail) => { setFileThumbnail(workspaceId, projectId, fileId, thumbnail); set(refresh()); },
  addDraft: (file) => { addWorkspaceDraft(file); set(refresh()); },
  renameDraft: (fileId, name) => { renameWorkspaceDraft(fileId, name); set(refresh()); },
  removeDraft: (fileId) => { deleteWorkspaceDraft(fileId); set(refresh()); },
  restoreTrash: (trashId) => { restoreTrashItem(trashId); set(refresh()); },
  deleteTrash: (trashId) => { deleteTrashItem(trashId); set(refresh()); },
}));