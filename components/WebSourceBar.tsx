'use client';

import { useState } from 'react';
import { useWebStore } from '@/store/useWebStore';
import { useSceneStore } from '@/store/useSceneStore';
import { getTemplate } from '@/templates';
import { resolveEasing } from '@/lib/easing';
import { buildZip } from '@/lib/webExport';
import { AlertIcon, ExportIcon, WebIcon } from './EditorIcons';

// Web mode (SPIKE) — the source controls and the zip, laid out for the
// timeline bar. Opening the editor is one button and a compile status; as a
// sidebar section it cost 280px of stage width to say almost nothing.

export default function WebSourceBar() {
  const setCodeOpen = useWebStore((s) => s.setCodeOpen);
  const compileError = useWebStore((s) => s.compileError);
  const selected = useWebStore((s) => s.selected);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canExport = selected.length > 0 && !compileError;

  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      const web = useWebStore.getState();
      const st = useSceneStore.getState();
      const box = web.canvas ?? web.measured;
      if (!box) throw new Error('The canvas has no size yet.');

      const blob = await buildZip({
        template: getTemplate(st.activeTemplateId),
        mode: web.layoutMode,
        values: st.values,
        selectors: web.selected,
        canvas: box,
        duration: st.duration,
        fps: st.fps,
        ease: resolveEasing(st.easing),
        source: web.source,
        css: web.css,
        hover: web.hoverPause
          ? { duration: web.hoverMs, curve: resolveEasing(st.easing) }
          : null,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${st.activeTemplateId}-component.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick — Safari cancels the download if the URL dies
      // in the same frame the click was dispatched.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const problem = compileError ?? err;

  return (
    <div className="web-source-bar">
      {problem && (
        <span className="web-source-err" title={problem}>
          <AlertIcon size={12}/>
          {problem}
        </span>
      )}

      <button className="tl-ghost-btn" onClick={() => setCodeOpen(true)}>
        <WebIcon size={14}/>
        Edit code
      </button>

      <button
        className="export-btn"
        onClick={download}
        disabled={!canExport || busy}
        title={canExport ? 'Download the component + motion as a zip' : 'Mark at least one element first'}
      >
        <ExportIcon size={14}/>
        {busy ? 'Packing…' : 'Export zip'}
      </button>
    </div>
  );
}
