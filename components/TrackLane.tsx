'use client';

import { useMemo, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { getTemplate, templateList } from '@/templates';
import { resolveEasing } from '@/lib/easing';
import { trackWindow, type MotionTrack } from '@/lib/tracks';

// How many poses to sample for a bar's motion sparkline. 48 is enough to read
// the shape of a curve at bar width without making a drag feel heavy — the
// sample is memoized on the values that actually change it.
const SPARK_SAMPLES = 48;

type DragMode = 'move' | 'in' | 'out';

/**
 * The motion signature drawn inside a track bar: the template's own x and y for
 * slot 0, sampled across the track's window and normalized to the bar. Templates
 * are pure functions of (frame, index, count, values, ctx), so this is just a
 * cheap read of the same code the renderer runs — the bar shows the real motion,
 * not a generic waveform.
 */
function useSparkline(track: MotionTrack, length: number, width: number, height: number) {
  return useMemo(() => {
    let template;
    try { template = getTemplate(track.templateId); } catch { return null; }
    const count = Math.max(1, Math.round(track.values.count ?? 6));
    const ease = resolveEasing(track.easing);
    const ctx = {
      fps: 30,
      width: 1080,
      height: 1350,
      duration: Math.max(1, length / 30),
      totalFrames: Math.max(1, length),
      ease,
      easedPhase: (p: number) => { const b = Math.floor(p); return b + ease(p - b); },
    };

    const xs: number[] = [];
    const ys: number[] = [];
    try {
      for (let i = 0; i < SPARK_SAMPLES; i++) {
        const f = (i / (SPARK_SAMPLES - 1)) * Math.max(1, length);
        const t = template.transform(f, 0, count, track.values, ctx);
        xs.push(Number.isFinite(t.x) ? t.x : 0);
        ys.push(Number.isFinite(t.y) ? t.y : 0);
      }
    } catch {
      return null; // a template that dislikes being sampled just gets no spark
    }

    // Normalize each axis independently into the bar; a flat signal sits on the
    // centre line instead of collapsing to an edge.
    const toPath = (vals: number[]) => {
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const span = max - min;
      return vals
        .map((v, i) => {
          const px = (i / (SPARK_SAMPLES - 1)) * width;
          const norm = span < 1e-6 ? 0.5 : (v - min) / span;
          const py = height - norm * height;
          return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`;
        })
        .join(' ');
    };

    return { x: toPath(xs), y: toPath(ys) };
  }, [track.templateId, track.values, track.easing, length, width, height]);
}

export default function TrackLane({
  track,
  index,
  totalFrames,
  onReorder,
}: {
  track: MotionTrack;
  index: number;             // index in the store's tracks array
  totalFrames: number;
  onReorder: (from: number, to: number) => void;
}) {
  const activeTrackId = useSceneStore((s) => s.activeTrackId);
  const setActiveTrack = useSceneStore((s) => s.setActiveTrack);
  const toggleTrackVisible = useSceneStore((s) => s.toggleTrackVisible);
  const patchTrack = useSceneStore((s) => s.patchTrack);
  const duplicateTrack = useSceneStore((s) => s.duplicateTrack);
  const removeTrack = useSceneStore((s) => s.removeTrack);
  const trackCount = useSceneStore((s) => s.tracks.length);

  const barsRef = useRef<HTMLDivElement>(null);
  // Drag state lives in a ref: a pointer drag must not re-render per move, and
  // the store already re-renders us when the window actually changes.
  const dragRef = useRef<{ mode: DragMode; startX: number; inF: number; outF: number; moved: boolean } | null>(null);

  const active = track.id === activeTrackId;
  const { inFrame, outFrame, length } = trackWindow(track, totalFrames);
  const leftPct = (inFrame / totalFrames) * 100;
  const widthPct = (length / totalFrames) * 100;

  const templateName = useMemo(
    () => templateList.find((t) => t.meta.id === track.templateId)?.meta.name ?? track.templateId,
    [track.templateId],
  );

  const spark = useSparkline(track, length, 200, 20);
  const fadePct = length > 0 ? Math.min(45, (Math.min(track.fade, length / 2) / length) * 100) : 0;

  // ---- window drag / trim ----
  const framesPerPx = () => {
    const el = barsRef.current;
    if (!el) return 0;
    const w = el.getBoundingClientRect().width;
    return w > 0 ? totalFrames / w : 0;
  };

  const onPointerDown = (mode: DragMode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    setActiveTrack(track.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, inF: inFrame, outF: outFrame, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dFrames = Math.round((e.clientX - d.startX) * framesPerPx());
    if (dFrames === 0 && !d.moved) return;
    d.moved = true;

    if (d.mode === 'move') {
      const span = d.outF - d.inF;
      // Slide the whole window, stopping at both ends of the clip rather than
      // squashing it.
      const nextIn = Math.max(0, Math.min(totalFrames - span, d.inF + dFrames));
      patchTrack(track.id, { inFrame: nextIn, outFrame: nextIn + span });
    } else if (d.mode === 'in') {
      const nextIn = Math.max(0, Math.min(d.outF - 2, d.inF + dFrames));
      patchTrack(track.id, { inFrame: nextIn, outFrame: d.outF });
    } else {
      const nextOut = Math.min(totalFrames, Math.max(d.inF + 2, d.outF + dFrames));
      patchTrack(track.id, { inFrame: d.inF, outFrame: nextOut });
    }
  };

  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div
      className={`tl-lane ${active ? 'active' : ''} ${track.visible ? '' : 'hidden'}`}
      onPointerDown={() => setActiveTrack(track.id)}
    >
      <div className="tl-lane-gutter">
        <button
          className="tl-lane-eye"
          title={track.visible ? 'Hide layer' : 'Show layer'}
          onClick={(e) => { e.stopPropagation(); toggleTrackVisible(track.id); }}
        >
          {track.visible ? (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8S12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8S12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" strokeWidth="1.3"/><path d="M3 13L13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          )}
        </button>

        {/* stacking order: up = drawn nearer the viewer (later in the array) */}
        <div className="tl-lane-order">
          <button
            className="tl-lane-arrow"
            title="Bring forward"
            disabled={index === trackCount - 1}
            onClick={(e) => { e.stopPropagation(); onReorder(index, index + 1); }}
          >
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 7.5L6 4l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button
            className="tl-lane-arrow"
            title="Send backward"
            disabled={index === 0}
            onClick={(e) => { e.stopPropagation(); onReorder(index, index - 1); }}
          >
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      <div className="tl-lane-bars" ref={barsRef}>
        <div
          className="tl-bar"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          onPointerDown={onPointerDown('move')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          title={`${track.name} · ${templateName}`}
        >
          {/* the fade ramps, drawn as the alpha envelope the renderer applies */}
          {fadePct > 0 && (
            <div
              className="tl-bar-fade"
              style={{
                background: `linear-gradient(90deg, transparent 0%, var(--tl-bar-fill) ${fadePct}%, var(--tl-bar-fill) ${100 - fadePct}%, transparent 100%)`,
              }}
            />
          )}

          {spark && (
            <svg className="tl-bar-spark" viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true">
              <path d={spark.x} />
              <path d={spark.y} className="tl-bar-spark-y" />
            </svg>
          )}

          <span className="tl-bar-label">
            <b>{track.name}</b>
            <em>{templateName}</em>
          </span>

          <span className="tl-bar-edge in" onPointerDown={onPointerDown('in')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} title="Trim in" />
          <span className="tl-bar-edge out" onPointerDown={onPointerDown('out')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} title="Trim out" />

          <span className="tl-bar-actions">
            <button
              title="Duplicate layer (offset)"
              onClick={(e) => { e.stopPropagation(); duplicateTrack(track.id); }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 13.5h6a2 2 0 002-2v-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </button>
            {trackCount > 1 && (
              <button
                title="Remove layer"
                onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
