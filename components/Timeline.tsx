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
//
// The 2s step alone does not survive a long clip. At 60s on a 925px ruler it
// lands 31 labels 30px apart — "0s 2s 4s … 58s 60s" packed shoulder to
// shoulder — so past that point the step goes up to 10s and the dashes follow
// it, three to a gap either way. Only those two cadences: seconds read in
// twos and tens, and a 5s step would put labels on values nobody counts in.
//
// The choice is made against the ruler's MEASURED width rather than a
// duration cutoff, because the same clip crowds or breathes depending on the
// window — a 40s clip is fine on a wide screen and unreadable on a narrow
// panel. Width 0 (the first render, before the observer has reported) falls
// through to 2s, which is what it always was.
const RULER_STEPS = [2, 10];
// Two guards on the 2s step, and it takes both. The count is what keeps the
// ruler from turning into a row of numbers — seven labels is the most this
// strip carries before they stop being landmarks and start being noise, and
// it is what puts the switch at 12s. The pixel gap catches the case the count
// cannot see: the same clip on a narrow panel, where even five labels collide.
const RULER_MAX_LABELS = 7;
const RULER_LABEL_MIN_GAP = 56;

function buildRuler(duration: number, width: number) {
  const step = RULER_STEPS.find((s) => {
    const gaps = Math.max(1, Math.floor(duration / s));
    return gaps + 1 <= RULER_MAX_LABELS && (!width || width / gaps >= RULER_LABEL_MIN_GAP);
  }) ?? RULER_STEPS[RULER_STEPS.length - 1];
  const labels: { t: number; pct: number }[] = [];
  const dashes: string[] = [];
  const w = (step / duration) * 100;
  // A 3px mark is only square if it lands ON the pixel grid. Left as a
  // percentage it does not: 6.25% of 925 is x 289.781, the mark spreads over
  // three columns at partial coverage, and antialiasing turns it into a blob.
  // These are decorative subdivisions, so rounding to the nearest pixel costs
  // nothing and is the whole difference between a square and a dot. Falls
  // back to the percentage before the width has been measured.
  const at = (pct: number) => (width ? `${Math.round((pct / 100) * width)}px` : `${pct}%`);
  for (let t = 0; t <= duration; t += step) {
    labels.push({ t, pct: (t / duration) * 100 });
    // The three marks that follow this label, including into a PARTIAL last
    // gap: a 13s clip labels 0s and 10s, and without this its final three
    // seconds are blank and the ruler looks like it stopped early. Anything
    // past the end is dropped rather than the gap being skipped whole.
    for (let k = 1; k <= 3; k++) {
      const pct = ((t / duration) * 100) + (w * k) / 4;
      if (pct < 100) dashes.push(at(pct));
    }
  }
  return { labels, dashes };
}

// `extra` fills the slot the export button occupies in 2D/3D — web mode puts
// its source controls there rather than spending a sidebar column on them.
export default function Timeline({
  showExport = true,
  showLayers = true,
  extra,
}: {
  showExport?: boolean;
  showLayers?: boolean;
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
  // The scrubber's measured width, which decides the ruler's label step.
  const [axisW, setAxisW] = useState(0);

  const shellRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);

  // The shell survives section navigation. If a user leaves Library while the
  // lane editor is expanded, close it before entering a mode whose renderer
  // does not consume motion tracks (Mockup currently owns one 3D studio, not a
  // stack of 2D tracks). Otherwise the open lane editor leaks into that mode
  // and its Add layer button writes an invisible Library track.
  useEffect(() => {
    if (!showLayers) setLanesOpen(false);
  }, [showLayers]);

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
      const px = Math.round(b.width);
      const width = `${px}px`;
      if (shell.style.getPropertyValue('--tl-axis-left') !== left) {
        shell.style.setProperty('--tl-axis-left', left);
      }
      if (shell.style.getPropertyValue('--tl-axis-w') !== width) {
        shell.style.setProperty('--tl-axis-w', width);
      }
      // The ruler's label step needs this as a NUMBER, not only as a var. It
      // rides the observer that is already reading this box rather than
      // starting a second one, and the guard keeps a re-render from being
      // scheduled on every notification. Safe against the loop the comment
      // above warns of: the labels live in an absolutely positioned .ruler,
      // so how many there are cannot change the scrubber's width.
      setAxisW((prev) => (prev === px ? prev : px));
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
  const { labels, dashes } = buildRuler(duration, axisW);

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
          {dashes.map((pos, i) => (
            <span key={`d${i}`} className="ruler-dash" style={{ left: pos }} />
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
      {showLayers && (
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
      )}

      {extra}

      {showExport && (
        <button className="export-btn" onClick={() => setShowExportDialog(true)}>
          <ExportIcon size={14} />
          Export
        </button>
      )}

      {showExport && showExportDialog && <ExportDialog onClose={() => setShowExportDialog(false)} />}
    </div>

    {showLayers && lanesOpen && (
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
