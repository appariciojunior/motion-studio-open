'use client';

import { useState } from 'react';
import { useWebStore } from '@/store/useWebStore';
import { PaletteIcon, WebIcon } from './EditorIcons';

// Web mode (SPIKE) — the source editor, fullscreen.
// It opens on first entry (there is nothing to do without source) and closes
// once the user is done, handing the whole window back to the stage. Code is
// entered rarely and tweaked constantly, so it earns a modal, not a column.

export default function WebCodeModal() {
  const [tab, setTab] = useState<'source' | 'css'>('source');
  const source = useWebStore((s) => s.source);
  const css = useWebStore((s) => s.css);
  const setSource = useWebStore((s) => s.setSource);
  const setCss = useWebStore((s) => s.setCss);
  const tailwind = useWebStore((s) => s.tailwind);
  const setTailwind = useWebStore((s) => s.setTailwind);
  const setCodeOpen = useWebStore((s) => s.setCodeOpen);
  const compileError = useWebStore((s) => s.compileError);

  return (
    <div className="modal-backdrop">
      <div className="modal web-modal">
        <header className="web-modal-head">
          <div className="tabs">
            <button
              className={`tab tab-beta ${tab === 'source' ? 'active' : ''}`}
              onClick={() => setTab('source')}
            >
              <WebIcon size={14} />
              JSX / TSX / HTML
              <span className="beta-tag">BETA</span>
            </button>
            <button
              className={`tab ${tab === 'css' ? 'active' : ''}`}
              onClick={() => setTab('css')}
            >
              <PaletteIcon size={14} />
              CSS
            </button>
          </div>
          <button className="btn primary" onClick={() => setCodeOpen(false)}>Done</button>
        </header>

        <div className="web-modal-body">
          {tab === 'source' ? (
            <textarea
              className="web-editor-full"
              spellCheck={false}
              autoFocus
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={'Paste a component, or a bare JSX element.\n\nexport default function MyComponent() {\n  return <div>hi</div>;\n}'}
            />
          ) : (
            <textarea
              className="web-editor-full"
              spellCheck={false}
              autoFocus
              value={css}
              onChange={(e) => setCss(e.target.value)}
              placeholder=".card { ... }"
            />
          )}
        </div>

        <footer className="web-modal-foot">
          <label className="web-toggle">
            <input type="checkbox" checked={tailwind} onChange={(e) => setTailwind(e.target.checked)} />
            <span>Tailwind</span>
            <span className="web-toggle-note">JIT, compiled in the preview frame</span>
          </label>
          {compileError ? (
            <span className="web-modal-err">{compileError}</span>
          ) : (
            <span className="web-modal-ok">
              Only <code>react</code> imports resolve. Editing the source clears the selection.
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
