'use client';

import { useState } from 'react';
import { ago } from '@/lib/relativeTime';
import { useProjectStore } from '@/store/useProjectStore';
import { DuplicateIcon, PencilIcon, TrashIcon } from './EditorIcons';

// The mobile projects sheet. On desktop the section is the full-width Projects
// tab instead (components/ProjectsBrowser).
export default function ProjectsPanel({ onProjectOpen }: { onProjectOpen?: () => void } = {}) {
  const projects = useProjectStore((s) => s.projects);
  const activeId = useProjectStore((s) => s.activeId);
  const open = useProjectStore((s) => s.open);
  const create = useProjectStore((s) => s.create);
  const duplicate = useProjectStore((s) => s.duplicate);
  const rename = useProjectStore((s) => s.rename);
  const remove = useProjectStore((s) => s.remove);

  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  // Deleting a project throws away its scene, so it asks first.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const commitNew = () => {
    create(newName.trim() || `Project ${projects.length + 1}`);
    setNaming(false);
    setNewName('');
    onProjectOpen?.();
  };

  const commitRename = (id: string) => {
    if (editName.trim()) rename(id, editName.trim());
    setEditingId(null);
    setEditName('');
  };

  return (
    <section className="card templates">
      <div className="tpl-head">
        <div className="tpl-head-row">
          <span className="eyebrow">Projects</span>
        </div>
        <div className="prj-sub">
          {projects.length} {projects.length === 1 ? 'project' : 'projects'} in this browser
        </div>
      </div>

      <div className="tpl-list prj-list">
        {projects.map((p) => {
          const isActive = p.id === activeId;
          const isEditing = editingId === p.id;
          const isConfirming = confirmId === p.id;

          return (
            <div key={p.id} className={`prj-item ${isActive ? 'active' : ''}`}>
              {isEditing ? (
                <input
                  className="field prj-rename"
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => commitRename(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(p.id);
                    if (e.key === 'Escape') { setEditingId(null); setEditName(''); }
                  }}
                />
              ) : (
                <button
                  className="prj-open"
                  onClick={() => { open(p.id); onProjectOpen?.(); }}
                  title={isActive ? 'Project open' : 'Open project'}
                >
                  <span className="prj-name">{p.name}</span>
                  <span className="prj-meta">
                    {isActive && <b>open · </b>}
                    edited {ago(p.updatedAt)}
                  </span>
                </button>
              )}

              {!isEditing && (
                <div className="prj-actions">
                  <button
                    className="icon-btn"
                    title="Rename"
                    onClick={() => { setEditingId(p.id); setEditName(p.name); setConfirmId(null); }}
                  >
                    <PencilIcon size={12}/>
                  </button>
                  <button className="icon-btn" title="Duplicate" onClick={() => duplicate(p.id)}>
                    <DuplicateIcon size={12}/>
                  </button>
                  <button
                    className={`icon-btn ${isConfirming ? 'danger' : ''}`}
                    title={isConfirming ? 'Click again to delete' : 'Delete'}
                    onClick={() => (isConfirming ? (remove(p.id), setConfirmId(null)) : setConfirmId(p.id))}
                    onBlur={() => setConfirmId((c) => (c === p.id ? null : c))}
                  >
                    <TrashIcon size={12}/>
                  </button>
                </div>
              )}

              {isConfirming && (
                <div className="prj-confirm">Click the bin again to delete — this can&apos;t be undone.</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="tpl-foot">
        {naming ? (
          <div className="tpl-save-row">
            <input
              className="field"
              autoFocus
              placeholder={`Project ${projects.length + 1}`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNew();
                if (e.key === 'Escape') { setNaming(false); setNewName(''); }
              }}
            />
            <button className="btn solid" onClick={commitNew}>Create</button>
          </div>
        ) : (
          <button className="btn full" onClick={() => setNaming(true)}>New project</button>
        )}
      </div>
    </section>
  );
}
