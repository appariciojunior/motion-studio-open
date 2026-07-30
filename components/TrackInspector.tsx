'use client';

import { useSceneStore } from '@/store/useSceneStore';
import { BLEND_MODES, trackWindow, type BlendMode } from '@/lib/tracks';
import { ControlRow } from './Controls';

// The active track's own properties — everything that is about the LAYER rather
// than about the motion template inside it. The template's own controls stay in
// the Scene block above; this block is what makes two layers read as a
// composition instead of two things drawn on top of each other.
export default function TrackInspector() {
  const tracks = useSceneStore((s) => s.tracks);
  const activeTrackId = useSceneStore((s) => s.activeTrackId);
  const patchTrack = useSceneStore((s) => s.patchTrack);
  const renameTrack = useSceneStore((s) => s.renameTrack);
  const toggleTrackAsset = useSceneStore((s) => s.toggleTrackAsset);
  const assets = useSceneStore((s) => s.assets);
  const duration = useSceneStore((s) => s.duration);
  const fps = useSceneStore((s) => s.fps);

  const track = tracks.find((t) => t.id === activeTrackId);
  // A single layer needs no compositing controls — the block would be noise.
  if (!track || tracks.length < 2) return null;

  const totalFrames = Math.max(1, Math.round(duration * fps));
  const { inFrame, outFrame, length } = trackWindow(track, totalFrames);
  const patch = (p: Parameters<typeof patchTrack>[1]) => patchTrack(track.id, p);
  // Which assets this layer draws. An empty list means "all of them".
  const usesAll = track.assetIds.length === 0;

  return (
    <>
      <div className="section-head">
        <span className="eyebrow">Layer</span>
        <input
          className="badge trk-name"
          value={track.name}
          onChange={(e) => renameTrack(track.id, e.target.value)}
          aria-label="Layer name"
        />
      </div>

      <div className="section-body">
        <ControlRow
          def={{ key: '_op', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 1, default: 100 }}
          value={Math.round(track.opacity * 100)}
          onChange={(v) => patch({ opacity: Math.max(0, Math.min(100, Number(v))) / 100 })}
        />
        <ControlRow
          def={{ key: '_blend', label: 'Blend', type: 'select', options: [...BLEND_MODES], default: 'normal' }}
          value={track.blend}
          onChange={(v) => patch({ blend: v as BlendMode })}
        />
        <ControlRow
          def={{ key: '_ts', label: 'Speed', type: 'slider', min: 0.25, max: 4, step: 0.05, default: 1 }}
          value={track.timeScale}
          onChange={(v) => patch({ timeScale: Number(v) })}
        />
        {/* Phase slip: the same template twice at different offsets reads as an
            echo instead of a duplicate. */}
        <ControlRow
          def={{ key: '_off', label: 'Offset %', type: 'slider', min: 0, max: 100, step: 1, default: 0 }}
          value={track.offset}
          onChange={(v) => patch({ offset: Number(v) })}
        />
        {/* Fade in frames, capped at half the window by resolveTrackTime. */}
        <ControlRow
          def={{ key: '_fade', label: 'Fade (frames)', type: 'slider', min: 0, max: Math.max(1, Math.floor(length / 2)), step: 1, default: 0 }}
          value={Math.min(track.fade, Math.floor(length / 2))}
          onChange={(v) => patch({ fade: Number(v) })}
        />
        <div className="ctl-hint">
          Window {(inFrame / fps).toFixed(1)}s → {(outFrame / fps).toFixed(1)}s ({length} frames)
        </div>
      </div>

      <div className="hairline" />

      <div className="section-head"><span className="eyebrow">Layer transform</span></div>
      <div className="section-body">
        <ControlRow
          def={{ key: '_xy', label: 'Position', type: 'xypad', max: 400, default: { x: 0, y: 0 } }}
          value={{ x: track.transform.x, y: track.transform.y }}
          onChange={(v) => patch({ transform: { ...track.transform, x: v.x, y: v.y } })}
        />
        <ControlRow
          def={{ key: '_sc', label: 'Scale', type: 'slider', min: 0.1, max: 3, step: 0.05, default: 1 }}
          value={track.transform.scale}
          onChange={(v) => patch({ transform: { ...track.transform, scale: Number(v) } })}
        />
        <ControlRow
          def={{ key: '_rot', label: 'Rotation', type: 'slider', min: -180, max: 180, step: 1, default: 0 }}
          value={track.transform.rotation}
          onChange={(v) => patch({ transform: { ...track.transform, rotation: Number(v) } })}
        />
      </div>

      <div className="hairline" />

      {/* Splitting the asset list across layers is what turns two animations
          into one scene: layer A drifts the backdrop images, layer B runs the
          foreground carousel. */}
      <div className="section-head">
        <span className="eyebrow">Layer images</span>
        {!usesAll && (
          <button className="badge" onClick={() => patch({ assetIds: [] })}>All</button>
        )}
      </div>
      <div className="section-body">
        {assets.length === 0 ? (
          <div className="ctl-hint">No images in the scene.</div>
        ) : (
          <>
            <div className="trk-assets">
              {assets.map((a, i) => {
                const on = usesAll || track.assetIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    className={`trk-asset ${on ? 'on' : ''}`}
                    onClick={() => toggleTrackAsset(track.id, a.id)}
                    title={a.name}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="ctl-hint">
              {usesAll ? 'Using every image in the scene.' : `${track.assetIds.length} of ${assets.length} selected.`}
            </div>
          </>
        )}
      </div>
    </>
  );
}
