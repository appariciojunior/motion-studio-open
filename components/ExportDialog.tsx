'use client';

import { useEffect, useRef, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { getRendererInstance } from '@/lib/rendererInstance';
import { BASE_PATH, IS_STATIC_EXPORT } from '@/lib/paths';
import { supportsWebCodecs, encodeMp4WebCodecs } from '@/lib/webcodecsExport';
import { encodeGifInBrowser, gifEffectiveFps } from '@/lib/gifExport';
import { encodeWebmWebCodecs } from '@/lib/webmExport';
import { countDemoSlotsInUse } from '@/lib/demoUsage';
import { BackIcon, ExportIcon, PauseIcon, PlayIcon } from '@/components/EditorIcons';

// An export artifact: server files carry a /exports url; WebCodecs results are
// local Blobs (url is an object URL for the download link).
interface OutputFile { name: string; url: string; blob?: Blob }

// WebM replaced the old 'both': it encodes entirely in this tab through
// WebCodecs, whereas 'both' only ever meant "run the pipeline twice".
type Fmt = 'mp4' | 'gif' | 'webm';
type Res = '720p' | '1080p' | '2k' | '4k' | 'exact';
type Phase = 'idle' | 'preparing' | 'capturing' | 'encoding' | 'done' | 'error';

// Presets are defined by the shortest edge (vertical 1080p = 1080×1920).
// Key order drives the pill order in the dialog — smallest first.
const RES_SHORT: Record<Exclude<Res, 'exact'>, number> = { '720p': 720, '1080p': 1080, '2k': 1440, '4k': 2160 };
const RES_LABEL: Record<Exclude<Res, 'exact'>, string> = { '720p': '720p', '1080p': '1080p', '2k': '2K', '4k': '4K' };

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

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
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
  const frame = useSceneStore((s) => s.frame);
  const fps = useSceneStore((s) => s.fps);
  const duration = useSceneStore((s) => s.duration);
  const audioUrl = useSceneStore((s) => s.audioUrl);
  const playing = useSceneStore((s) => s.playing);
  const setPlaying = useSceneStore((s) => s.setPlaying);
  const demoSlots = useSceneStore(countDemoSlotsInUse);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [format, setFormat] = useState<Fmt>('mp4');
  const [res, setRes] = useState<Res>('1080p');
  const [phase, setPhase] = useState<Phase>('idle');
  const [captured, setCaptured] = useState(0);
  const [total, setTotal] = useState(0);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [engine, setEngine] = useState<'browser' | 'ffmpeg'>('ffmpeg');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState('');
  const [confirmDemo, setConfirmDemo] = useState(false);
  // Probed after mount: WebCodecs is absent during SSR, and branching the first
  // render on it would desync hydration.
  const [hasWebCodecs, setHasWebCodecs] = useState(false);
  useEffect(() => { setHasWebCodecs(supportsWebCodecs()); }, []);

  // Both formats encode client-side now — H.264 through WebCodecs, GIF through
  // gifenc — so a build with no API routes can still export. What genuinely
  // still needs the server is muxing an audio track, and making MP4 on a
  // browser that has no WebCodecs at all.
  const needsServer = format !== 'gif' && (!hasWebCodecs || !!audioUrl);
  const serverUnavailable = IS_STATIC_EXPORT && needsServer;

  // The mobile export page mirrors the existing renderer instead of creating
  // a second Pixi/Three instance. Desktop hides this canvas completely.
  useEffect(() => {
    // same bound as MOBILE_QUERY in app/page.tsx — see the note there
    if (!window.matchMedia('(max-width: 919px)').matches) return;
    let raf = 0;
    const draw = () => {
      const target = previewCanvasRef.current;
      const source = getRendererInstance()?.extractCanvas();
      if (target && source && source.width > 0 && source.height > 0) {
        const scale = Math.min(1, 1200 / Math.max(source.width, source.height));
        const nextWidth = Math.max(1, Math.round(source.width * scale));
        const nextHeight = Math.max(1, Math.round(source.height * scale));
        if (target.width !== nextWidth || target.height !== nextHeight) {
          target.width = nextWidth;
          target.height = nextHeight;
        }
        target.getContext('2d')?.drawImage(source, 0, 0, nextWidth, nextHeight);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

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

    // Fast path — everything encoded in the browser, so a deploy needs no
    // ffmpeg on the box at all. MP4 goes through hardware H.264 (WebCodecs);
    // GIF is quantised by gifenc, since WebCodecs has no GIF encoder to offer —
    // VideoEncoder only speaks video codecs. Audio muxing is the one job left
    // that still requires the server pipeline, and it does not apply to GIF.
    const wantsMp4 = format === 'mp4';
    const wantsGif = format === 'gif';
    const wantsWebm = format === 'webm';
    // GIF is pure JS and always works here. The two video formats need
    // WebCodecs, and an audio track is the one job only the server can do.
    const canEncodeInBrowser = wantsGif || (supportsWebCodecs() && !s.audioUrl);

    // One capture pass: prepare the video cards, hold the hi-res backing store
    // for the duration, and put everything back however it exits.
    const capturePass = async <T,>(encode: () => Promise<T>): Promise<T> => {
      setCaptured(0);
      setPhase('preparing');
      await renderer.beginVideoExport?.(); // one forward decode pass for video cards
      setPhase('capturing');
      renderer.setCaptureScale(target.k);  // hi-res backing store; layout untouched
      try {
        return await encode();
      } finally {
        renderer.endVideoExport?.();
        renderer.setCaptureScale(1);
        renderer.resumeVideos?.();
        if (!wasPlaying) renderer.pauseVideos?.();
      }
    };

    const drawFrame = async (f: number) => {
      await renderer.seekVideos?.(f); // frame-accurate video cards
      renderer.renderFrame(f);
      return renderer.extractCanvas();
    };

    if (canEncodeInBrowser) {
      try {
        const stamp = Date.now().toString(36);
        const files: OutputFile[] = [];
        if (wantsWebm) {
          const blob = await capturePass(() => encodeWebmWebCodecs({
            width: target.width,
            height: target.height,
            fps: s.fps,
            totalFrames,
            renderFrame: drawFrame,
            onProgress: setCaptured,
          }));
          files.push({ name: `motion_${stamp}.webm`, url: URL.createObjectURL(blob), blob });
        }
        if (wantsMp4) {
          const blob = await capturePass(() => encodeMp4WebCodecs({
            width: target.width,
            height: target.height,
            fps: s.fps,
            totalFrames,
            renderFrame: drawFrame,
            onProgress: setCaptured,
          }));
          files.push({ name: `motion_${stamp}.mp4`, url: URL.createObjectURL(blob), blob });
        }
        if (wantsGif) {
          const blob = await capturePass(() => encodeGifInBrowser({
            width: target.width,
            height: target.height,
            fps: s.fps,
            totalFrames,
            renderFrame: drawFrame,
            onProgress: setCaptured,
          }));
          files.push({ name: `motion_${stamp}.gif`, url: URL.createObjectURL(blob), blob });
        }
        setEngine('browser');
        setOutputs(files);
        setPhase('done');
        if (wasPlaying) s.setPlaying(true);
        return;
      } catch {
        // encoder unavailable/failed mid-run — fall through to the ffmpeg path
        setCaptured(0);
        setPhase('capturing');
      }
    }

    // WebM exists only on the WebCodecs path — the server pipeline has no VP9
    // branch, and adding one would put it back on an ffmpeg this deploy lacks.
    if (wantsWebm) {
      setErr('WebM needs WebCodecs, which this browser did not provide. Try MP4 or GIF.');
      setPhase('error');
      if (wasPlaying) s.setPlaying(true);
      return;
    }

    // A static build ships no API routes, so there is no ffmpeg to fall back
    // to — say that plainly instead of letting the POST fail as a 404.
    if (IS_STATIC_EXPORT) {
      setErr('This build has no export server. GIF encodes in-browser here; MP4 needs WebCodecs and no audio track.');
      setPhase('error');
      if (wasPlaying) s.setPlaying(true);
      return;
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
          const dataUrl = renderer.captureFrame(f, 'image/jpeg');
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
    <div className="modal-backdrop export-backdrop" onClick={onClose}>
      <div className="modal export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <button className="icon-btn export-mobile-back" onClick={onClose} aria-label="Back to editor"><BackIcon /></button>
          <span>Export</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="export-mobile-preview" aria-label="Export preview">
          <canvas ref={previewCanvasRef} />
        </div>

        <div className="export-mobile-transport">
          <button
            className="export-mobile-play"
            onClick={() => setPlaying(!playing)}
            aria-label={playing ? 'Pause preview' : 'Play preview'}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span><b>{formatTime(frame / Math.max(1, fps))}</b> / {formatTime(duration)}</span>
        </div>

        <div className="modal-body export-modal-body">
          <>
          <div className="ctl-row">
            <label className="ctl-label">
              <span className="export-label-desktop">Format</span>
              <span className="export-label-mobile">Output</span>
            </label>
            <div className="ctl-input">
              <div className="pills pills-fit">
                {(['mp4', 'gif', 'webm'] as Fmt[]).map((f) => (
                  <button key={f} className={`pill ${format === f ? 'active' : ''}`} onClick={() => setFormat(f)}>{f.toUpperCase()}</button>
                ))}
              </div>
            </div>
          </div>

          {format === 'webm' && <div className="ctl-hint">WebM uses VP9 with transparent background.</div>}

          <div className="ctl-row">
            <label className="ctl-label">Resolution</label>
            <div className="ctl-input">
              <div className="pills pills-fit">
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

          {/* GIF keeps frame delay in hundredths of a second, so most fps values
              cannot be expressed exactly. State the playback rate the file will
              really carry — this is a property of the format, not of gifenc. */}
          {format === 'gif' && Math.abs(gifEffectiveFps(fps) - fps) > 0.05 && (
            <div className="ctl-hint">
              GIF stores delays in 1/100 s, so {fps} fps plays back at {gifEffectiveFps(fps).toFixed(1)} fps.
            </div>
          )}

          {/* Only the combinations that still need native ffmpeg are blocked
              here — GIF and plain MP4 encode in this tab. The format pills stay
              reachable so switching to a workable one is one click away. */}
          {serverUnavailable && (
            <div className="export-static-note" role="alert">
              <p>
                {audioUrl
                  ? 'Muxing an audio track still needs native ffmpeg, which this hosted build has no server to run.'
                  : 'MP4 needs WebCodecs, which this browser doesn’t provide, and this hosted build has no server to run ffmpeg on.'}
                {' '}GIF exports here without either — switch the format above, or run it locally:
              </p>
              <pre><code>{`git clone https://github.com/appariciojunior/motion-studio-open.git
cd motion-studio-open
npm install && brew install ffmpeg
npm run dev`}</code></pre>
              <a className="btn full" href="https://github.com/appariciojunior/motion-studio-open" target="_blank" rel="noreferrer">
                View on GitHub
              </a>
            </div>
          )}

          {phase === 'idle' && !confirmDemo && !serverUnavailable && (
            <button className="btn primary full export-primary-action" onClick={() => demoSlots > 0 ? setConfirmDemo(true) : run()}>
              <ExportIcon size={16} />
              <span className="export-action-desktop">Start export</span>
              <span className="export-action-mobile">Export</span>
            </button>
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
                Done{engine === 'browser'
                  ? ` — encoded in-browser (${
                      format === 'gif' ? 'gifenc'
                      : format === 'webm' ? 'WebCodecs VP9'
                      : 'WebCodecs H.264'}).`
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
        </div>
      </div>
    </div>
  );
}
