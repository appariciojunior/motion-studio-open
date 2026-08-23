'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type { AnimationFile, WorkspaceProject } from '@/lib/workspaces';
import { AddIcon, LibraryIcon, ProjectsIcon } from './EditorIcons';

const initial = (name: string) => name.trim().slice(0, 1).toUpperCase() || 'W';

function AutoCover({ file, projectName }: { file: AnimationFile; projectName: string }) {
  return (
    <div className="workspace-cover workspace-cover-auto" aria-label={`Capa automática para ${file.name}`}>
      <span className="workspace-cover-project">{projectName}</span>
      <strong>{file.name}</strong>
      <span className="workspace-cover-user">Motion Studio</span>
    </div>
  );
}

function FileCard({ file, projectName, onOpen, onRename, onDelete, onSetThumbnail }: {
  file: AnimationFile;
  projectName: string;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSetThumbnail?: (thumbnail: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const uploadThumbnail = (next?: File) => {
    if (!next || !onSetThumbnail) return;
    const reader = new FileReader();
    reader.onload = () => onSetThumbnail(String(reader.result));
    reader.readAsDataURL(next);
  };
  return (
    <article className="workspace-file-card">
      <button className="workspace-file-open" onClick={onOpen} title={`Abrir ${file.name}`}>
        {file.thumbnail ? <img className="workspace-cover-image" src={file.thumbnail} alt="" /> : <AutoCover file={file} projectName={projectName} />}
      </button>
      <div className="workspace-file-foot">
        <div><strong>{file.name}</strong><span>Arquivo de animação</span></div>
        {onSetThumbnail && <button className="workspace-thumb-action" onClick={() => input.current?.click()} title="Alterar capa" aria-label={`Alterar capa de ${file.name}`}>▧</button>}
        <div className="workspace-card-menu-wrap">
          <button className="workspace-thumb-action" onClick={() => setMenuOpen((open) => !open)} aria-label={`Ações de ${file.name}`}>⋯</button>
          {menuOpen && <div className="workspace-card-menu">
            <button onClick={onOpen}>Abrir</button>
            <button onClick={() => { const name = window.prompt('Nome do arquivo', file.name); if (name) onRename(name); setMenuOpen(false); }}>Renomear</button>
            <button className="danger" onClick={() => { if (window.confirm(`Mover o arquivo “${file.name}” para a lixeira?`)) onDelete(); setMenuOpen(false); }}>Mover para a lixeira</button>
          </div>}
        </div>
        <input ref={input} className="workspace-file-input" type="file" accept="image/*" onChange={(event) => uploadThumbnail(event.target.files?.[0])} />
      </div>
    </article>
  );
}

function ProjectCard({ project, onOpen, onRename, onDelete }: {
  project: WorkspaceProject;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <article className="workspace-project-card">
      <button className="workspace-project-open" onClick={onOpen} title={`Abrir projeto ${project.name}`}>
        <div className="workspace-project-previews">
          {project.files.slice(0, 4).map((file) => file.thumbnail
            ? <img key={file.id} src={file.thumbnail} alt="" />
            : <div key={file.id} className="workspace-project-preview-fallback">{file.name.slice(0, 1).toUpperCase()}</div>)}
          {project.files.length === 0 && <div className="workspace-project-placeholder"><ProjectsIcon size={24} /></div>}
        </div>
      </button>
      <div className="workspace-project-foot">
        <div><strong>{project.name}</strong><span>{project.files.length} {project.files.length === 1 ? 'arquivo' : 'arquivos'}</span></div>
        <div className="workspace-project-menu-wrap">
          <button className="workspace-thumb-action" onClick={() => setMenuOpen((open) => !open)} aria-label={`Ações de ${project.name}`}>⋯</button>
          {menuOpen && <div className="workspace-project-menu">
            <button onClick={onOpen}>Abrir</button>
            <button onClick={() => { const name = window.prompt('Nome do projeto', project.name); if (name) onRename(name); setMenuOpen(false); }}>Renomear</button>
            <button className="danger" onClick={() => { if (window.confirm(`Mover o projeto “${project.name}” para a lixeira?`)) onDelete(); setMenuOpen(false); }}>Mover para a lixeira</button>
          </div>}
        </div>
      </div>
    </article>
  );
}

export default function WorkspaceDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const browserView = searchParams.get('view') ?? 'projects';
  const selectedProjectId = searchParams.get('project');
  const isDrafts = browserView === 'drafts';
  const isRecent = browserView === 'recent';
  const isTrash = browserView === 'trash';
  const isBrowserView = isDrafts || isRecent || isTrash;
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const drafts = useWorkspaceStore((s) => s.drafts);
  const trash = useWorkspaceStore((s) => s.trash);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const bootstrap = useWorkspaceStore((s) => s.bootstrap);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);
  const setWorkspaceIcon = useWorkspaceStore((s) => s.setWorkspaceIcon);
  const createProject = useWorkspaceStore((s) => s.createProject);
  const renameProject = useWorkspaceStore((s) => s.renameProject);
  const removeProject = useWorkspaceStore((s) => s.removeProject);
  const addFile = useWorkspaceStore((s) => s.addFile);
  const renameFile = useWorkspaceStore((s) => s.renameFile);
  const removeFile = useWorkspaceStore((s) => s.removeFile);
  const setThumbnail = useWorkspaceStore((s) => s.setThumbnail);
  const addDraft = useWorkspaceStore((s) => s.addDraft);
  const renameDraft = useWorkspaceStore((s) => s.renameDraft);
  const removeDraft = useWorkspaceStore((s) => s.removeDraft);
  const restoreTrash = useWorkspaceStore((s) => s.restoreTrash);
  const deleteTrash = useWorkspaceStore((s) => s.deleteTrash);
  const createScene = useProjectStore((s) => s.create);
  const openScene = useProjectStore((s) => s.open);
  const setNav = useUIStore((s) => s.setNav);
  const [creating, setCreating] = useState<'project' | 'file' | 'draft' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [workspaceActionsOpen, setWorkspaceActionsOpen] = useState(false);
  const workspaceActionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bootstrap(); }, [bootstrap]);
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!workspaceActionsRef.current?.contains(event.target as Node)) setWorkspaceActionsOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const workspace = workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0];
  const projects = workspace?.projects ?? [];
  const selectedProject = !isBrowserView ? projects.find((item) => item.id === selectedProjectId) : undefined;
  const allFiles = projects.flatMap((project) => project.files.map((file) => ({ file, project })));
  const recentFiles = [...allFiles].sort((a, b) => b.file.updatedAt - a.file.updatedAt).slice(0, 24);

  const startCreate = (kind: 'project' | 'file' | 'draft') => {
    const fallback = kind === 'project' ? `Projeto ${projects.length + 1}` : kind === 'draft' ? 'Rascunho sem título' : 'Arquivo de animação sem título';
    setDraftName(fallback);
    setCreating(kind);
  };
  const openFile = (file: AnimationFile) => {
    openScene(file.id);
    setNav('library');
    router.push('/library');
  };
  const commitCreate = () => {
    const name = draftName.trim();
    if (!name || !creating || !workspace) return;
    if (creating === 'project') {
      createProject(workspace.id, name);
      router.push('/projects');
    } else {
      createScene(name);
      const created = useProjectStore.getState().projects.find((item) => item.id === useProjectStore.getState().activeId);
      if (created && creating === 'file' && selectedProject) addFile(workspace.id, selectedProject.id, created);
      if (created && creating === 'draft') addDraft(created);
      if (created) openFile(created);
    }
    setCreating(null);
    setDraftName('');
  };

  if (!workspace) {
    return <main className="workspace-dashboard"><section className="workspace-main"><div className="workspace-empty"><ProjectsIcon size={24} /><h2>Nenhum workspace</h2><p>Crie um workspace no seletor lateral para começar.</p></div></section></main>;
  }

  const title = selectedProject?.name ?? workspace.name;
  const breadcrumb = selectedProject ? 'Todos os projetos' : isDrafts ? 'Rascunhos' : isRecent ? 'Recentes' : isTrash ? 'Lixeira' : 'Todos os projetos';
  const sectionTitle = selectedProject?.name ?? (isDrafts ? 'Rascunhos' : isRecent ? 'Recentes' : isTrash ? 'Lixeira' : 'Todos os projetos');
  const sectionCount = selectedProject ? selectedProject.files.length : isDrafts ? drafts.length : isRecent ? recentFiles.length : isTrash ? trash.length : projects.length;

  return (
    <main className="workspace-dashboard">
      <section className="workspace-main">
        <header className="workspace-header">
          <div className="workspace-title-wrap" ref={workspaceActionsRef}>
            <div className="workspace-title-row">
              {!selectedProject && <span className="workspace-avatar">{workspace.icon || initial(workspace.name)}</span>}
              <h1>{title}</h1>
              {!selectedProject && <button className="workspace-title-chevron" onClick={() => setWorkspaceActionsOpen((open) => !open)} aria-label="Ações do workspace">⌄</button>}
            </div>
            <span className="workspace-breadcrumb">{breadcrumb}</span>
            {workspaceActionsOpen && <div className="workspace-actions-menu">
              <button onClick={() => { const name = window.prompt('Nome do workspace', workspace.name); if (name) renameWorkspace(workspace.id, name); setWorkspaceActionsOpen(false); }}>Renomear</button>
              <button onClick={() => { const icon = window.prompt('Ícone do workspace (emoji)', workspace.icon ?? ''); if (icon !== null) setWorkspaceIcon(workspace.id, icon); setWorkspaceActionsOpen(false); }}>Alterar ícone</button>
              <button className="danger" onClick={() => { if (window.confirm(`Excluir o workspace “${workspace.name}”?`)) removeWorkspace(workspace.id); setWorkspaceActionsOpen(false); router.push('/projects'); }}>Excluir…</button>
            </div>}
          </div>
          {!isTrash && <div className="workspace-actions">
            {selectedProject ? <button className="workspace-primary" onClick={() => startCreate('file')}><AddIcon size={15} />Novo arquivo</button>
              : isDrafts ? <button className="workspace-primary" onClick={() => startCreate('draft')}><AddIcon size={15} />Novo arquivo</button>
                : !isRecent && <button className="workspace-primary" onClick={() => startCreate('project')}><AddIcon size={15} />Novo projeto</button>}
          </div>}
        </header>

        <div className="workspace-project-heading"><LibraryIcon size={15} />{sectionTitle} <span>{sectionCount}</span></div>

        {isTrash ? (
          trash.length ? <div className="workspace-trash-list">{trash.map((item) => <article key={item.id} className="workspace-trash-item"><LibraryIcon size={15} /><div><strong>{item.name}</strong><span>{item.type === 'project' ? 'Projeto' : 'Arquivo'} excluído</span></div><div className="workspace-trash-actions"><button onClick={() => restoreTrash(item.id)}>Restaurar</button><button className="danger" onClick={() => { if (window.confirm(`Excluir “${item.name}” permanentemente?`)) deleteTrash(item.id); }}>Excluir</button></div></article>)}</div>
            : <div className="workspace-empty"><LibraryIcon size={24} /><h2>Lixeira vazia</h2><p>Projetos e arquivos movidos para a lixeira aparecerão aqui.</p></div>
        ) : selectedProject ? (
          selectedProject.files.length ? <div className="workspace-file-grid">{selectedProject.files.map((file) => <FileCard key={file.id} file={file} projectName={selectedProject.name} onOpen={() => openFile(file)} onRename={(name) => renameFile(workspace.id, selectedProject.id, file.id, name)} onDelete={() => removeFile(workspace.id, selectedProject.id, file.id)} onSetThumbnail={(thumbnail) => setThumbnail(workspace.id, selectedProject.id, file.id, thumbnail)} />)}</div>
            : <div className="workspace-empty"><LibraryIcon size={24} /><h2>Sem arquivos</h2><p>Crie um arquivo para começar neste projeto.</p><button className="workspace-primary" onClick={() => startCreate('file')}><AddIcon size={15} />Novo arquivo</button></div>
        ) : isDrafts ? (
          drafts.length ? <div className="workspace-file-grid">{drafts.map((file) => <FileCard key={file.id} file={file} projectName="Rascunhos" onOpen={() => openFile(file)} onRename={(name) => renameDraft(file.id, name)} onDelete={() => removeDraft(file.id)} />)}</div>
            : <div className="workspace-empty"><LibraryIcon size={24} /><h2>Sem rascunhos</h2><p>Arquivos que ainda não pertencem a um projeto aparecerão aqui.</p><button className="workspace-primary" onClick={() => startCreate('draft')}><AddIcon size={15} />Novo arquivo</button></div>
        ) : isRecent ? (
          recentFiles.length ? <div className="workspace-file-grid">{recentFiles.map(({ file, project }) => <FileCard key={file.id} file={file} projectName={project.name} onOpen={() => openFile(file)} onRename={(name) => renameFile(workspace.id, project.id, file.id, name)} onDelete={() => removeFile(workspace.id, project.id, file.id)} onSetThumbnail={(thumbnail) => setThumbnail(workspace.id, project.id, file.id, thumbnail)} />)}</div>
            : <div className="workspace-empty"><LibraryIcon size={24} /><h2>Sem arquivos recentes</h2><p>Os arquivos criados ou alterados recentemente aparecerão aqui.</p></div>
        ) : projects.length ? (
          <div className="workspace-project-grid">{projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => router.push(`/projects?project=${project.id}`)} onRename={(name) => renameProject(workspace.id, project.id, name)} onDelete={() => { removeProject(workspace.id, project.id); router.push('/projects'); }} />)}</div>
        ) : (
          <div className="workspace-empty"><ProjectsIcon size={24} /><h2>Sem projetos</h2><p>Crie um projeto para organizar os seus arquivos.</p><button className="workspace-primary" onClick={() => startCreate('project')}><AddIcon size={15} />Novo projeto</button></div>
        )}
      </section>

      {creating && <div className="workspace-dialog-backdrop" role="presentation">
        <form className="workspace-dialog" onSubmit={(event) => { event.preventDefault(); commitCreate(); }}>
          <span className="workspace-dialog-kicker">{creating === 'project' ? 'Novo projeto' : creating === 'draft' ? 'Novo rascunho' : 'Novo arquivo'}</span>
          <h2>{creating === 'project' ? 'Criar projeto' : creating === 'draft' ? 'Criar rascunho' : 'Criar arquivo de animação'}</h2>
          <input autoFocus className="field" value={draftName} onChange={(event) => setDraftName(event.target.value)} aria-label="Nome" />
          <div className="workspace-dialog-actions"><button type="button" className="workspace-secondary" onClick={() => { setCreating(null); setDraftName(''); }}>Cancelar</button><button type="submit" className="workspace-primary">Criar</button></div>
        </form>
      </div>}
    </main>
  );
}