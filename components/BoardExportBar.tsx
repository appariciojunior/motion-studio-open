'use client';

import { useState } from 'react';
import { downloadSceneZip } from '@/lib/exportScene';
import { AlertIcon, ExportIcon } from './EditorIcons';

// Board mode — the export control for the timeline bar, mirroring WebSourceBar.
// Packs the live scene (runtime + config + preview + README) into a zip.
export default function BoardExportBar() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      await downloadSceneZip();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="web-source-bar">
      {err && (
        <span className="web-source-err" title={err}>
          <AlertIcon size={12}/>
          {err}
        </span>
      )}
      <button
        className="export-btn"
        onClick={download}
        disabled={busy}
        title="Download the scene bundle (runtime + config + preview) as a zip"
      >
        <ExportIcon size={14}/>
        {busy ? 'Packing…' : 'Export zip'}
      </button>
    </div>
  );
}
