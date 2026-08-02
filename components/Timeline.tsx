'use client';

import { useEffect, useRef, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import ExportDialog from './ExportDialog';
import TrackLane from './TrackLane';
import { ExportIcon, PauseIcon, PlayIcon } from './EditorIcons';

function fmt(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
}

// Figma ruler: a label every 2s, three short dashes between labels.
function buildRuler(duration: number) {
  const labels: { t: number; pct: number }[] = [];
  const dashes: number[] = [];
  for (let t = 0; t <= duration; t += 2) {
    labels.push({ t, pct: (t / duration) * 100 });
    if (t + 2 <= duration) {
      const w = (2 / duration) * 100;
      for (let k = 1; k <= 3; k++) dashes.push(((t / duration) * 100) + (w * k) / 4);
    }
  }
  return { labels, dashes };
}

// `extra` fills the slot the export button occupies in 2D/3D — web mode puts
// its source controls there rather than spending a sidebar column on them.
export default function Timeline({
  showExport = true,
  extra,
}: {
  showExport?: boolean;
  extra?: React.ReactNode;
}) {
  const frame = useSceneStore((s) => s.frame);
  const fps = useSceneStore((s) => s.fps);
  const duration = useSceneStore((s) => s.duration);
  const playing = useSceneStore((s) => s.playing);
  const setPlaying = useSceneStore((s) => s.setPlaying);
  const setFrame = useSceneStore((s) => s.setFrame);
  const setDuration = useSceneStore((s) => s.setDuration);
  const tracks = useSceneStore((s) => s.tracks);
  const addTrack = useSceneStore((s) => s.addTrack);
  const reorderTracks = useSceneStore((s) => s.reorderTracks);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [lanesOpen, setLanesOpen] = useState(false);

  const shellRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);

  // Publish the scrubber's geometry as CSS vars on the shell, so the lane bars
  // below sit in the SAME coordinate space as the ruler above. The transport row
  // is a flex layout whose left offset depends on the time readout and the
  // buttons in `extra`, so measuring beats hardcoding: the playhead and the bars
  // stay aligned whatever lands in that row.
  useEffect(() => {
    const shell = shellRef.current;
    const scrubber = scrubberRef.current;
    if (!shell || !scrubber) return;
    // Only the SCRUBBER is observed, never the shell: these vars drive the lane
    // gutter width, so observing the shell we write to would feed its own layout
    // change back in as a resize — the classic ResizeObserver loop. Writes are
    // also skipped when the value is unchanged, so a nudge can't oscillate.
    const sync = () => {
      const a = shell.getBoundingClientRect();
      const b = scrubber.getBoundingClientRect();
      const left = `${Math.round(b.left - a.left)}px`;
      const width = `${Math.round(b.width)}px`;
      if (shell.style.getPropertyValue('--tl-axis-left') !== left) {
        shell.style.setProperty('--tl-axis-left', left);
      }
      if (shell.style.getPropertyValue('--tl-axis-w') !== width) {
        shell.style.setProperty('--tl-axis-w', width);
      }
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(scrubber);
    return () => ro.disconnect();
  }, [lanesOpen]);

  // Spacebar toggles play/pause anywhere except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      const s = useSceneStore.getState();
      s.setPlaying(!s.playing);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const totalFrames = Math.max(1, Math.round(duration * fps));
  const curTime = frame / fps;
  const progress = (frame / (totalFrames - 1 || 1)) * 100;
  const { labels, dashes } = buildRuler(duration);

  return (
    <div className={`timeline-shell ${lanesOpen ? 'lanes-open' : ''}`} ref={shellRef}>
    <div className="timeline">
      <button className="play-btn" onClick={() => setPlaying(!playing)} title={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <PauseIcon size={14} />
        ) : (
          <PlayIcon size={14} />
        )}
      </button>

      <span className="time-readout"><b>{fmt(curTime)}</b> / {fmt(duration)}s</span>

      <div className="scrubber" ref={scrubberRef}>
        <div className="tl-trackbar" />
        <div className="ruler">
          {dashes.map((pct, i) => (
            <span key={`d${i}`} className="ruler-dash" style={{ left: `${pct}%`, width: 8 }} />
          ))}
          {labels.map(({ t, pct }) => (
            <span key={`l${t}`} className="ruler-label" style={{ left: `${pct}%` }}>{t}s</span>
          ))}
        </div>
        <div className="playhead" style={{ left: `${progress}%` }}>
          <span className="playhead-chip">{curTime.toFixed(1)}s</span>
        </div>
        <input
          type="range" min={0} max={totalFrames - 1} step={1} value={frame}
          onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }}
        />
      </div>

      <span className="tl-divider" />

      <label className="dur-field">
        <input type="number" min={1} max={60} step={1} value={duration} onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))} />
        <span>s</span>
      </label>

      {/* Motion layers: the stack of tracks sharing this one timeline. */}
      <button
        className={`tl-lanes-btn ${lanesOpen ? 'active' : ''}`}
        onClick={() => setLanesOpen((v) => !v)}
        aria-expanded={lanesOpen}
        title="Motion layers"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.8l6 3-6 3-6-3 6-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M2 8.2l6 3 6-3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
        Layers
        <span className="tl-lanes-count">{tracks.length}</span>
      </button>

      {extra}

      {showExport && (
        <button className="export-btn" onClick={() => setShowExportDialog(true)}>
          <ExportIcon size={14} />
          Export
        </button>
      )}

      {showExport && showExportDialog && <ExportDialog onClose={() => setShowExportDialog(false)} />}
    </div>

    {lanesOpen && (
      <div className="tl-lanes">
        {/* Topmost lane = topmost layer, so the list reads like the stack looks:
            the store's array is bottom-to-top, the UI shows it reversed. */}
        {tracks.slice().reverse().map((track) => (
          <TrackLane
            key={track.id}
            track={track}
            index={tracks.findIndex((t) => t.id === track.id)}
            totalFrames={totalFrames}
            onReorder={reorderTracks}
          />
        ))}

        {/* one playhead across every lane, in the shared axis space */}
        <div className="tl-lanes-playhead" style={{ left: `calc(var(--tl-axis-left) + var(--tl-axis-w) * ${progress / 100})` }} />

        <div className="tl-lanes-foot">
          <button className="tl-add-track" onClick={() => addTrack()}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            Add layer
          </button>
          <span className="tl-lanes-hint">
            Drag a bar to retime · drag its edges to trim · the arrows change stacking order
          </span>
        </div>
      </div>
    )}
    </div>
  );
}
