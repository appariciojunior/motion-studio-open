'use client';

import { useSceneStore } from '@/store/useSceneStore';
import { PauseIcon, PlayIcon } from './EditorIcons';

function fmt(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export default function MobileTransport() {
  const frame = useSceneStore((s) => s.frame);
  const fps = useSceneStore((s) => s.fps);
  const duration = useSceneStore((s) => s.duration);
  const playing = useSceneStore((s) => s.playing);
  const setPlaying = useSceneStore((s) => s.setPlaying);
  const setFrame = useSceneStore((s) => s.setFrame);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  return (
    <div className="mobile-transport" aria-label="Playback controls">
      <button
        className="mobile-play"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <PauseIcon size={18} />
        ) : (
          <PlayIcon size={18} />
        )}
      </button>
      <span className="mobile-time">{fmt(frame / fps)}</span>
      <input
        className="mobile-scrubber"
        type="range"
        min={0}
        max={totalFrames - 1}
        step={1}
        value={frame}
        aria-label="Timeline"
        onChange={(event) => {
          setPlaying(false);
          setFrame(Number(event.target.value));
        }}
      />
      <span className="mobile-time mobile-time-total">{fmt(duration)}</span>
    </div>
  );
}
