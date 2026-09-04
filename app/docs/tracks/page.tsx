import Link from 'next/link';

export const metadata = { title: 'Motion tracks' };

export default function TracksPage() {
  return (
    <>
      <p className="docs-eyebrow">Getting started</p>
      <h1>Motion tracks</h1>

      <p className="docs-lead">
        One preset is one motion. A track is how you get several in the same clip —
        a ticker along the bottom while a carousel runs above it, say.
      </p>

      <h2>What a track holds</h2>
      <p>
        A track is a self-contained mini-clip. It carries its own template, its own
        control values, its own easing curve, its own slice of the image list, a blend
        mode, and a window on the timeline. The renderer draws one container per track,
        in order, so tracks composite over each other the way layers do.
      </p>

      <h2>There is still only one clock</h2>
      <p>
        Tracks never keep their own time. Each one is handed the length of{' '}
        <em>its window</em> as its total frame count, so it loops seamlessly inside
        that window rather than against the whole clip. A single track spanning the
        whole clip behaves exactly like having no tracks at all — that is a property
        the project holds itself to, not a coincidence.
      </p>

      <h2>Where values live</h2>
      <p>
        The track is the source of truth for values and easing. Nothing writes those
        into the scene directly — which matters if you are reading the code: reach for
        the track, not the scene, when you want to know what a layer is doing.
      </p>

      <h2>Reusing a small image set across many cards</h2>
      <p>
        Some families place hundreds of cards — a woven gallery wall, a scatter field.
        Those cycle a small image set across the whole field instead of demanding one
        file per cell, so six photos can fill a wall.
      </p>

      <p className="docs-next">
        <Link href="/docs/export">Export →</Link>
      </p>
    </>
  );
}
