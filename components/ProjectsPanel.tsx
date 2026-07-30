'use client';

import { useState } from 'react';
import { useProjectStore } from '@/store/useProjectStore';

// Relative time, coarse on purpose — an exact timestamp is noise in a list you
// scan to find "the one I was just working on".
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export default function ProjectsPanel() {
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
                  onClick={() => open(p.id)}
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
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10.5 2.5l3 3-8 8H2.5v-3l8-8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                  </button>
                  <button className="icon-btn" title="Duplicate" onClick={() => duplicate(p.id)}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 13.5h6a2 2 0 002-2v-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  </button>
                  <button
                    className={`icon-btn ${isConfirming ? 'danger' : ''}`}
                    title={isConfirming ? 'Click again to delete' : 'Delete'}
                    onClick={() => (isConfirming ? (remove(p.id), setConfirmId(null)) : setConfirmId(p.id))}
                    onBlur={() => setConfirmId((c) => (c === p.id ? null : c))}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 5h10M6.5 5V3.5h3V5M5 5l.6 8h4.8L11 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
