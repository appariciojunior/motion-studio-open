'use client';

import { useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { getRendererInstance } from '@/lib/rendererInstance';
import { BASE_PATH, IS_STATIC_EXPORT } from '@/lib/paths';
import { supportsWebCodecs, encodeMp4WebCodecs } from '@/lib/webcodecsExport';
import { countDemoSlotsInUse } from '@/lib/demoUsage';

// An export artifact: server files carry a /exports url; WebCodecs results are
// local Blobs (url is an object URL for the download link).
interface OutputFile { name: string; url: string; blob?: Blob }

type Fmt = 'mp4' | 'gif' | 'both';
type Res = '1080p' | '2k' | '4k' | 'exact';
type Phase = 'idle' | 'preparing' | 'capturing' | 'encoding' | 'done' | 'error';

// Presets are defined by the shortest edge (vertical 1080p = 1080×1920).
const RES_SHORT: Record<Exclude<Res, 'exact'>, number> = { '1080p': 1080, '2k': 1440, '4k': 2160 };
const RES_LABEL: Record<Exclude<Res, 'exact'>, string> = { '1080p': '1080p', '2k': '2K', '4k': '4K' };

// Target output size + capture scale for a given preset. Even dimensions
// are required by libx264 with yuv420p.
function targetFor(res: Res, s: { width: number; height: number; customW: number; customH: number; aspect: string }) {
  if (res === 'exact' && s.aspect !== 'custom') res = '1080p'; // stale selection after aspect change
  let k: number;
  let tw: number, th: number;
  if (res === 'exact') {
    k = Math.max(s.customW, s.customH) / Math.max(s.width, s.height);
    tw = s.customW; th = s.customH;
  } else {
    k = RES_SHORT[res] / Math.min(s.width, s.height);
    tw = Math.round(s.width * k); th = Math.round(s.height * k);
  }
  return { k, width: tw - (tw % 2), height: th - (th % 2) };
}

async function post(body: any) {
  const res = await fetch(`${BASE_PATH}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const store = useSceneStore;
  const aspect = useSceneStore((s) => s.aspect);
  const width = useSceneStore((s) => s.width);
  const height = useSceneStore((s) => s.height);
  const customW = useSceneStore((s) => s.customW);
  const customH = useSceneStore((s) => s.customH);
  const demoSlots = useSceneStore(countDemoSlotsInUse);
  const [format, setFormat] = useState<Fmt>('mp4');
  const [res, setRes] = useState<Res>('1080p');
  const [phase, setPhase] = useState<Phase>('idle');
  const [captured, setCaptured] = useState(0);
  const [total, setTotal] = useState(0);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [engine, setEngine] = useState<'webcodecs' | 'ffmpeg'>('ffmpeg');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState('');
  const [confirmDemo, setConfirmDemo] = useState(false);

  // File System Access API — Chromium (Edge/Chrome) only. Lets the user pick a
  // destination folder; falls back to the download links when unavailable.
  const canPickDir = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const fileBytes = async (file: OutputFile): Promise<Blob> => {
    if (file.blob) return file.blob; // WebCodecs result — already local
    const resp = await fetch(file.url);
    if (!resp.ok) throw new Error(`could not read ${file.name}`);
    return resp.blob();
  };

  // Copy the freshly-encoded files into a folder the user picks. Folder-level
  // write permission is often denied (the browser's "save changes" prompt, or
  // Windows/OneDrive controlled-folder protection) — when that happens, fall
  // back to a per-file "Save as" dialog, which needs no folder permission.
  const saveToFolder = async () => {
    setSaveErr('');
    setSaving(true);
    try {
      try {
        const dir = await window.showDirectoryPicker({ id: 'motion-exports', mode: 'readwrite' });
        for (const file of outputs) {
          const handle = await dir.getFileHandle(file.name, { create: true });
          const writable = await handle.createWritable();
          await writable.write(await fileBytes(file));
          await writable.close();
        }
        setSavedTo(dir.name);
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError') return; // user cancelled the picker
        if (e?.name !== 'NotAllowedError' && e?.name !== 'SecurityError') throw e;
        // fall through — write access to the folder was denied
      }
      for (const file of outputs) {
        const handle = await window.showSaveFilePicker({ suggestedName: file.name });
        const writable = await handle.createWritable();
        await writable.write(await fileBytes(file));
        await writable.close();
      }
      setSavedTo(outputs.map((o) => o.name).join(', '));
    } catch (e: any) {
      if (e?.name !== 'AbortError') setSaveErr(String(e?.message ?? e)); // ignore user cancel
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    setConfirmDemo(false);
    const s = store.getState();
    const renderer = getRendererInstance();
    if (!renderer) { setErr('Renderer not ready'); setPhase('error'); return; }

    const totalFrames = Math.max(1, Math.round(s.duration * s.fps));
    const target = targetFor(res, s);
    const wasPlaying = s.playing;
    s.setPlaying(false);
    setTotal(totalFrames);
    setPhase('capturing');
    setErr('');

    // Fast path — in-browser hardware H.264 via WebCodecs (no per-frame HTTP, no
    // server re-encode). GIF and audio muxing still need the ffmpeg pipeline.
    if (format === 'mp4' && !s.audioUrl && supportsWebCodecs()) {
      try {
        // prepare video cards for one forward decode pass during capture
        setPhase('preparing');
        await renderer.beginVideoExport?.();
        setPhase('capturing');
        renderer.setCaptureScale(target.k);
        const blob = await encodeMp4WebCodecs({
          width: target.width,
          height: target.height,
          fps: s.fps,
          totalFrames,
          renderFrame: async (f) => {
            await renderer.seekVideos?.(f); // frame-accurate video cards
            renderer.renderFrame(f);
            return renderer.extractCanvas();
          },
          onProgress: setCaptured,
        });
        setEngine('webcodecs');
        const name = `motion_${Date.now().toString(36)}.mp4`;
        setOutputs([{ name, url: URL.createObjectURL(blob), blob }]);
        setPhase('done');
        if (wasPlaying) s.setPlaying(true);
        return;
      } catch {
        // encoder unavailable/failed mid-run — fall through to the ffmpeg path
        setCaptured(0);
        setPhase('capturing');
      } finally {
        renderer.endVideoExport?.();
        renderer.setCaptureScale(1);
        renderer.resumeVideos?.();
        if (!wasPlaying) renderer.pauseVideos?.();
      }
    }

    try {
      setPhase('preparing');
      await renderer.beginVideoExport?.();
      setPhase('capturing');
      const { sessionId } = await post({ action: 'begin' });

      renderer.setCaptureScale(target.k); // hi-res backing store; layout untouched
      try {
        for (let f = 0; f < totalFrames; f++) {
          await renderer.seekVideos?.(f);                 // frame-accurate video cards (no-op without video)
          const dataUrl = renderer.captureFrame(f);       // time = frame counter, never wall-clock
          await post({ action: 'frame', sessionId, index: f, dataUrl });
          setCaptured(f + 1);
          // yield to keep UI responsive
          if (f % 5 === 0) await new Promise((r) => setTimeout(r, 0));
        }
      } finally {
        renderer.endVideoExport?.();                      // restore original video sources
        renderer.setCaptureScale(1);
        renderer.resumeVideos?.();                        // back to live playback in the preview
      }

      setPhase('encoding');

      // audio bytes (blob url → base64) if present
      let audio: string | undefined;
      if (s.audioUrl) {
        const buf = await (await fetch(s.audioUrl)).arrayBuffer();
        audio = btoa(String.fromCharCode(...new Uint8Array(buf)));
      }

      const { files } = await post({
        action: 'encode',
        sessionId,
        fps: s.fps,
        format,
        width: target.width,
        height: target.height,
        audio,
      });

      setEngine('ffmpeg');
      setOutputs((files as string[]).map((f) => ({ name: f, url: `${BASE_PATH}/exports/${f}` })));
      setPhase('done');
      s.setFrame(s.frame);
      if (wasPlaying) s.setPlaying(true);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setPhase('error');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Export</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {IS_STATIC_EXPORT ? (
          <div className="export-static-note">
            <p>
              Export renders every frame and encodes MP4/GIF with native ffmpeg —
              that pipeline isn&apos;t available on this hosted demo.
            </p>
            <p>To export, clone the repo and run it locally:</p>
            <pre><code>{`git clone https://github.com/appariciojunior/motion-studio-open.git
cd motion-studio-open
npm install && brew install ffmpeg
npm run dev`}</code></pre>
            <a className="btn primary full" href="https://github.com/appariciojunior/motion-studio-open" target="_blank" rel="noreferrer">
              View on GitHub
            </a>
          </div>
          ) : (
          <>
          <div className="ctl-row">
            <label className="ctl-label">Format</label>
            <div className="ctl-input">
              <div className="pills">
                {(['mp4', 'gif', 'both'] as Fmt[]).map((f) => (
                  <button key={f} className={`pill ${format === f ? 'active' : ''}`} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="ctl-row">
            <label className="ctl-label">Resolution</label>
            <div className="ctl-input">
              <div className="pills">
                {(Object.keys(RES_SHORT) as Exclude<Res, 'exact'>[]).map((r) => (
                  <button key={r} className={`pill ${res === r ? 'active' : ''}`} onClick={() => setRes(r)}>{RES_LABEL[r]}</button>
                ))}
                {aspect === 'custom' && (
                  <button className={`pill ${res === 'exact' ? 'active' : ''}`} onClick={() => setRes('exact')} title={`Exact canvas size ${customW}×${customH}`}>
                    {customW}×{customH}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="ctl-hint">
            {(() => {
              const t = targetFor(res, { width, height, customW, customH, aspect });
              return `Output ${t.width}×${t.height} px`;
            })()}
          </div>

          {phase === 'idle' && !confirmDemo && (
            <button className="btn primary full" onClick={() => demoSlots > 0 ? setConfirmDemo(true) : run()}>Start export</button>
          )}

          {phase === 'idle' && confirmDemo && (
            <div className="export-demo-warning" role="alert">
              <strong>{demoSlots} demo {demoSlots === 1 ? 'slot is' : 'slots are'} still in use</strong>
              <p>Demo images will appear in the exported file unless you replace them in Media.</p>
              <div className="export-demo-actions">
                <button className="btn" onClick={() => setConfirmDemo(false)}>Cancel</button>
                <button className="btn primary" onClick={run}>Export anyway</button>
              </div>
            </div>
          )}

          {phase === 'preparing' && <div className="progress"><span>Preparing videos…</span></div>}

          {phase === 'capturing' && (
            <div className="progress">
              <div className="progress-bar"><div style={{ width: `${(captured / total) * 100}%` }} /></div>
              <span>Capturing frames {captured}/{total}</span>
            </div>
          )}

          {phase === 'encoding' && <div className="progress"><span>Encoding with ffmpeg…</span></div>}

          {phase === 'done' && (
            <div className="export-done">
              <p>
                Done{engine === 'webcodecs'
                  ? ' — encoded in-browser (WebCodecs, GPU).'
                  : <>. Generated in <code>/exports</code>:</>}
              </p>
              <ul>
                {outputs.map((f) => (
                  <li key={f.name}><a href={f.url} download={f.name}>{f.name}</a></li>
                ))}
              </ul>
              {canPickDir && (
                <>
                  <button className="btn primary full" onClick={saveToFolder} disabled={saving}>
                    {saving ? 'Saving…' : savedTo ? 'Save to another folder…' : 'Choose folder & save'}
                  </button>
                  {savedTo && <p className="ctl-hint">Saved to <code>{savedTo}</code>.</p>}
                  {saveErr && <div className="export-error">Save failed: {saveErr}</div>}
                </>
              )}
            </div>
          )}

          {phase === 'error' && (
            <div className="export-error">
              Export failed: {err}
              {/ffmpeg|ENOENT/i.test(err) && (
                <div className="export-hint">
                  ffmpeg isn’t installed. Install it, then retry:<br />
                  <code>brew install ffmpeg</code>
                </div>
              )}
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
