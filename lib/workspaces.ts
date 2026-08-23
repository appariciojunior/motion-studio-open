import { listProjects, type ProjectMeta } from './projects';

const WORKSPACES_KEY = 'motion-workspaces-v1';

export interface AnimationFile extends ProjectMeta {
  thumbnail?: string;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  createdAt: number;
  files: AnimationFile[];
}

export interface TrashItem {
  id: string;
  type: 'project' | 'file';
  name: string;
  deletedAt: number;
  workspaceId: string;
  projectId?: string;
  project?: WorkspaceProject;
  file?: AnimationFile;
}

export interface Workspace {
  id: string;
  name: string;
  icon?: string;
  createdAt: number;
  projects: WorkspaceProject[];
}

interface WorkspaceIndex {
  activeWorkspaceId: string | null;
  activeProjectId: string | null;
  workspaces: Workspace[];
  drafts?: AnimationFile[];
  trash?: TrashItem[];
}

let sequence = 0;
// Keep the live index available when browser storage is full of thumbnails.
let memoryIndex: WorkspaceIndex | null = null;
const id = (prefix: string) => `${prefix}${Date.now().toString(36)}${(sequence++).toString(36)}`;
const empty = (): WorkspaceIndex => ({ activeWorkspaceId: null, activeProjectId: null, workspaces: [], drafts: [], trash: [] });

function read(): WorkspaceIndex {
  if (typeof window === 'undefined') return empty();
  if (memoryIndex) return memoryIndex;
  try {
    const value = JSON.parse(localStorage.getItem(WORKSPACES_KEY) || 'null') as WorkspaceIndex | null;
    if (!value || !Array.isArray(value.workspaces)) return migrate();
    return value;
  } catch { return migrate(); }
}

function write(index: WorkspaceIndex) {
  // Update the running app even if localStorage quota prevents persistence.
  memoryIndex = index;
  try { localStorage.setItem(WORKSPACES_KEY, JSON.stringify(index)); } catch { /* retry persistence on a later write */ }
}

function migrate(): WorkspaceIndex {
  const legacy = listProjects();
  const now = Date.now();
  const project: WorkspaceProject = { id: id('folder'), name: 'My projects', createdAt: now, files: legacy.map((file) => ({ ...file })) };
  const workspace: Workspace = { id: id('space'), name: 'Personal', createdAt: now, projects: [project] };
  const index: WorkspaceIndex = { activeWorkspaceId: workspace.id, activeProjectId: project.id, workspaces: [workspace], drafts: [], trash: [] };
  write(index);
  return index;
}

export function listWorkspaces(): Workspace[] { return read().workspaces; }
export function listDrafts(): AnimationFile[] { return (read().drafts ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt); }
export function listTrash(): TrashItem[] { return (read().trash ?? []).slice().sort((a, b) => b.deletedAt - a.deletedAt); }

export function workspaceSelection() {
  const index = read();
  return { workspaceId: index.activeWorkspaceId, projectId: index.activeProjectId };
}

export function setWorkspaceSelection(workspaceId: string, projectId?: string) {
  const index = read();
  const workspace = index.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return;
  const chosenProject = projectId && workspace.projects.some((item) => item.id === projectId) ? projectId : workspace.projects[0]?.id ?? null;
  write({ ...index, activeWorkspaceId: workspaceId, activeProjectId: chosenProject });
}

export function createWorkspace(name: string): Workspace {
  const index = read();
  const workspace: Workspace = { id: id('space'), name: name.trim() || 'Untitled workspace', createdAt: Date.now(), projects: [] };
  write({ ...index, activeWorkspaceId: workspace.id, activeProjectId: null, workspaces: [...index.workspaces, workspace] });
  return workspace;
}

export function createWorkspaceProject(workspaceId: string, name: string): WorkspaceProject | null {
  const index = read();
  const project: WorkspaceProject = { id: id('folder'), name: name.trim() || 'Untitled project', createdAt: Date.now(), files: [] };
  let found = false;
  const workspaces = index.workspaces.map((workspace) => {
    if (workspace.id !== workspaceId) return workspace;
    found = true;
    return { ...workspace, projects: [...workspace.projects, project] };
  });
  if (!found) return null;
  write({ ...index, activeWorkspaceId: workspaceId, activeProjectId: project.id, workspaces });
  return project;
}

export function renameWorkspace(workspaceId: string, name: string) {
  const nextName = name.trim();
  if (!nextName) return;
  const index = read();
  write({ ...index, workspaces: index.workspaces.map((workspace) => workspace.id === workspaceId ? { ...workspace, name: nextName } : workspace) });
}

export function setWorkspaceIcon(workspaceId: string, icon: string) {
  const nextIcon = icon.trim().slice(0, 2) || undefined;
  const index = read();
  write({ ...index, workspaces: index.workspaces.map((workspace) => workspace.id === workspaceId ? { ...workspace, icon: nextIcon } : workspace) });
}

export function deleteWorkspace(workspaceId: string) {
  const index = read();
  const workspaces = index.workspaces.filter((workspace) => workspace.id !== workspaceId);
  const selected = index.activeWorkspaceId === workspaceId ? workspaces[0] : workspaces.find((workspace) => workspace.id === index.activeWorkspaceId) ?? workspaces[0];
  write({ ...index, activeWorkspaceId: selected?.id ?? null, activeProjectId: selected?.projects[0]?.id ?? null, workspaces });
}

export function addWorkspaceFile(workspaceId: string, projectId: string, file: AnimationFile) {
  const index = read();
  const workspaces = index.workspaces.map((workspace) => workspace.id !== workspaceId ? workspace : {
    ...workspace,
    projects: workspace.projects.map((project) => project.id !== projectId ? project : { ...project, files: [...project.files.filter((item) => item.id !== file.id), file] }),
  });
  write({ ...index, workspaces });
}

export function setFileThumbnail(workspaceId: string, projectId: string, fileId: string, thumbnail?: string) {
  const index = read();
  const workspaces = index.workspaces.map((workspace) => workspace.id !== workspaceId ? workspace : {
    ...workspace,
    projects: workspace.projects.map((project) => project.id !== projectId ? project : { ...project, files: project.files.map((file) => file.id === fileId ? { ...file, thumbnail, updatedAt: Date.now() } : file) }),
  });
  write({ ...index, workspaces });
}

export function renameWorkspaceProject(workspaceId: string, projectId: string, name: string) {
  const nextName = name.trim();
  if (!nextName) return;
  const index = read();
  write({ ...index, workspaces: index.workspaces.map((workspace) => workspace.id !== workspaceId ? workspace : {
    ...workspace, projects: workspace.projects.map((project) => project.id === projectId ? { ...project, name: nextName } : project),
  }) });
}

export function deleteWorkspaceProject(workspaceId: string, projectId: string) {
  const index = read();
  const workspace = index.workspaces.find((item) => item.id === workspaceId);
  const project = workspace?.projects.find((item) => item.id === projectId);
  if (!workspace || !project) return;
  const projects = workspace.projects.filter((item) => item.id !== projectId);
  const activeProjectId = index.activeWorkspaceId === workspaceId && index.activeProjectId === projectId ? projects[0]?.id ?? null : index.activeProjectId;
  const trashItem: TrashItem = { id: id('trash'), type: 'project', name: project.name, deletedAt: Date.now(), workspaceId, projectId, project };
  write({ ...index, activeProjectId, trash: [...(index.trash ?? []), trashItem], workspaces: index.workspaces.map((item) => item.id === workspaceId ? { ...item, projects } : item) });
}

export function renameWorkspaceFile(workspaceId: string, projectId: string, fileId: string, name: string) {
  const nextName = name.trim();
  if (!nextName) return;
  const index = read();
  write({ ...index, workspaces: index.workspaces.map((workspace) => workspace.id !== workspaceId ? workspace : {
    ...workspace, projects: workspace.projects.map((project) => project.id !== projectId ? project : { ...project, files: project.files.map((file) => file.id === fileId ? { ...file, name: nextName, updatedAt: Date.now() } : file) }),
  }) });
}

export function deleteWorkspaceFile(workspaceId: string, projectId: string, fileId: string) {
  const index = read();
  const workspace = index.workspaces.find((item) => item.id === workspaceId);
  const project = workspace?.projects.find((item) => item.id === projectId);
  const file = project?.files.find((item) => item.id === fileId);
  if (!file) return;
  const trashItem: TrashItem = { id: id('trash'), type: 'file', name: file.name, deletedAt: Date.now(), workspaceId, projectId, file };
  write({ ...index, trash: [...(index.trash ?? []), trashItem], workspaces: index.workspaces.map((item) => item.id !== workspaceId ? item : {
    ...item, projects: item.projects.map((entry) => entry.id !== projectId ? entry : { ...entry, files: entry.files.filter((candidate) => candidate.id !== fileId) }),
  }) });
}

export function addWorkspaceDraft(file: AnimationFile) {
  const index = read();
  write({ ...index, drafts: [...(index.drafts ?? []).filter((item) => item.id !== file.id), file] });
}

export function renameWorkspaceDraft(fileId: string, name: string) {
  const nextName = name.trim();
  if (!nextName) return;
  const index = read();
  write({ ...index, drafts: (index.drafts ?? []).map((file) => file.id === fileId ? { ...file, name: nextName, updatedAt: Date.now() } : file) });
}

export function deleteWorkspaceDraft(fileId: string) {
  const index = read();
  const file = (index.drafts ?? []).find((item) => item.id === fileId);
  if (!file) return;
  const trashItem: TrashItem = { id: id('trash'), type: 'file', name: file.name, deletedAt: Date.now(), workspaceId: index.activeWorkspaceId ?? '', file };
  write({ ...index, drafts: (index.drafts ?? []).filter((item) => item.id !== fileId), trash: [...(index.trash ?? []), trashItem] });
}

export function restoreTrashItem(trashId: string) {
  const index = read();
  const item = (index.trash ?? []).find((entry) => entry.id === trashId);
  if (!item) return;
  const trash = (index.trash ?? []).filter((entry) => entry.id !== trashId);
  if (item.type === 'project' && item.project) {
    const targetId = index.workspaces.some((workspace) => workspace.id === item.workspaceId) ? item.workspaceId : index.workspaces[0]?.id;
    if (!targetId) return;
    const workspaces = index.workspaces.map((workspace) => workspace.id === targetId ? { ...workspace, projects: [...workspace.projects.filter((project) => project.id !== item.project!.id), item.project!] } : workspace);
    write({ ...index, trash, workspaces });
    return;
  }
  if (!item.file) return;
  const workspace = index.workspaces.find((entry) => entry.id === item.workspaceId);
  const project = workspace?.projects.find((entry) => entry.id === item.projectId);
  if (!workspace || !project) {
    write({ ...index, trash, drafts: [...(index.drafts ?? []).filter((file) => file.id !== item.file!.id), item.file] });
    return;
  }
  const workspaces = index.workspaces.map((entry) => entry.id !== workspace.id ? entry : {
    ...entry,
    projects: entry.projects.map((candidate) => candidate.id !== project.id ? candidate : { ...candidate, files: [...candidate.files.filter((file) => file.id !== item.file!.id), item.file!] }),
  });
  write({ ...index, trash, workspaces });
}

export function deleteTrashItem(trashId: string) {
  const index = read();
  write({ ...index, trash: (index.trash ?? []).filter((item) => item.id !== trashId) });
}