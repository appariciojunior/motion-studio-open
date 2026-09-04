'use client';

import { useMemo, useRef } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import { templateList } from '@/templates';
import { trackWindow, type MotionTrack } from '@/lib/tracks';
import { ChevronDownIcon, ChevronUpIcon, DuplicateIcon, EyeIcon, EyeOffIcon, TrashIcon } from './EditorIcons';

type DragMode = 'move' | 'in' | 'out';

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
      {/* Every per-layer control lives here, always visible — they used to hide
          inside the bar on hover, which made them hard to find and put click
          targets on top of the drag surface. */}
      <div className="tl-lane-gutter">
        <button
          className="tl-lane-btn"
          title={track.visible ? 'Hide layer' : 'Show layer'}
          onClick={(e) => { e.stopPropagation(); toggleTrackVisible(track.id); }}
        >
          {track.visible ? <EyeIcon size={13}/> : <EyeOffIcon size={13}/>}
        </button>

        {/* stacking order: up = drawn nearer the viewer (later in the array) */}
        <div className="tl-lane-order">
          <button
            className="tl-lane-arrow"
            title="Bring forward"
            disabled={index === trackCount - 1}
            onClick={(e) => { e.stopPropagation(); onReorder(index, index + 1); }}
          >
            <ChevronUpIcon size={9}/>
          </button>
          <button
            className="tl-lane-arrow"
            title="Send backward"
            disabled={index === 0}
            onClick={(e) => { e.stopPropagation(); onReorder(index, index - 1); }}
          >
            <ChevronDownIcon size={9}/>
          </button>
        </div>

        <button
          className="tl-lane-btn"
          title="Duplicate layer (offset)"
          onClick={(e) => { e.stopPropagation(); duplicateTrack(track.id); }}
        >
          <DuplicateIcon size={12}/>
        </button>

        <button
          className="tl-lane-btn danger"
          title={trackCount > 1 ? 'Remove layer' : 'The last layer can’t be removed'}
          disabled={trackCount <= 1}
          onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
        >
          <TrashIcon size={12}/>
        </button>
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
          {/* The alpha envelope the renderer applies at the window edges. Only
              drawn when a fade is set (default 0), so a plain bar stays plain. */}
          {fadePct > 0 && (
            <div
              className="tl-bar-fade"
              style={{
                background: `linear-gradient(90deg, transparent 0%, var(--tl-bar-fill) ${fadePct}%, var(--tl-bar-fill) ${100 - fadePct}%, transparent 100%)`,
              }}
            />
          )}

          <span className="tl-bar-label">
            <b>{track.name}</b>
            <em>{templateName}</em>
          </span>

          <span className="tl-bar-edge in" onPointerDown={onPointerDown('in')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} title="Trim in" />
          <span className="tl-bar-edge out" onPointerDown={onPointerDown('out')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} title="Trim out" />
        </div>
      </div>
    </div>
  );
}
