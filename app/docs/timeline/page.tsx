import Link from 'next/link';

export const metadata = { title: 'Timeline' };

export default function TimelinePage() {
  return (
    <>
      <p className="docs-eyebrow">How it works</p>
      <h1>Timeline and playback</h1>

      <p className="docs-lead">
        One clock runs the whole scene. The preview reads it, the thumbnails read it, and
        the encoder reads it — which is why the file you export is frame-for-frame the clip
        you watched.
      </p>

      <h2>Frames, not seconds</h2>
      <p>
        The scene is a whole number of frames: the duration in seconds times the frame
        rate. Everything downstream is asked for a frame index, never for a timestamp, so
        there is no rounding drift between what plays and what encodes.
      </p>
      <p>
        Changing the frame rate keeps the moment you were looking at rather than the frame
        number, so the playhead does not jump to a different part of the clip when you go
        from 30 to 60.
      </p>

      <h2>The ruler and the playhead</h2>
      <p>
        The ruler is labelled every two seconds with three ticks between, so a beat lands
        on something you can see. Drag the playhead to scrub; the scene recomputes at that
        frame rather than replaying up to it, so scrubbing backwards costs the same as
        scrubbing forwards.
      </p>

      <h2>Duration is part of the motion</h2>
      <p>
        It is tempting to treat clip length as packaging, and for most families it is. For
        the ported ones it is not: their cadence was authored in seconds per card, so the
        duration is what pins how fast a card advances. Those presets set the length when
        you pick them, and changing it afterwards genuinely changes the motion — a settle
        becomes a drift.
      </p>
      <p>
        This is also what makes loops clean. Speeds are quantised to a whole number of
        motion cycles per clip, so the last frame lands exactly where the first one starts.
        See <Link href="/docs/easing">Easing</Link> for why a curve cannot break that.
      </p>

      <h2>Lanes are tracks</h2>
      <p>
        Each lane below the ruler is a motion track with its own template, values and
        window. The gutter beside a lane carries its visibility, its stacking, and the
        duplicate and remove actions — and the selected lane is the one the control panel
        is editing, which is the single most useful thing to keep an eye on when a slider
        seems to do nothing.
      </p>
      <p>
        A lane also carries a <strong>blend mode</strong>. The renderer draws one container
        per track, in order, so a lane set to something other than normal composites
        against the lanes beneath it rather than simply covering them — which is how a
        light wash or a texture pass goes over a carousel without hiding it.
      </p>
      <p>
        Tracks never keep their own clock. Each is handed the length of its own window, so
        it loops inside that window, and a single track spanning the whole clip behaves
        exactly like having no tracks at all. <Link href="/docs/tracks">Motion tracks</Link>{' '}
        goes into it.
      </p>

      <h2>Undo covers gestures</h2>
      <p>
        A whole drag is one step back, not forty. So is a typed number and a template pick.
        The history coalesces by gesture on purpose: undoing a slider drag one pixel at a
        time is not undo, it is punishment.
      </p>

      <p className="docs-next">
        <Link href="/docs/effects">Effects →</Link>
      </p>
    </>
  );
}
