import Link from 'next/link';

export const metadata = { title: 'Introduction' };

export default function IntroductionPage() {
  return (
    <>
      <p className="docs-eyebrow">Getting started</p>
      <h1>Introduction</h1>

      <p className="docs-lead">
        Motion Studio turns a folder of images into a short video, a GIF or a device
        mockup. It runs on your own machine: nothing is uploaded, and the MP4 you download
        was encoded by your own browser.
      </p>

      <h2>Two ways to work</h2>
      <p>
        The editor is one shell over several sections, and two of them are where the
        work happens. <strong>The Library</strong> moves many images in 2D — cards on a
        row, a ring, a wall — on a canvas you frame. <strong>The Mockup studio</strong>
        {' '}does the opposite: one screenshot of yours on a real 3D device, lit and
        filmed by a camera that moves.
      </p>
      <p>
        They share the timeline, the export dialog and the project list, and they are
        described one each in the pages below.
      </p>

      <h2>What these docs are for</h2>
      <p>
        They explain the concepts — what a preset actually is, what easing does, what a
        track is, why clips loop cleanly, how the mockup rig is put together. They are
        not a catalogue: the editor already is one, with search, favourites, live
        thumbnails and the real stage. Read here, browse there.
      </p>

      <h2>Start here</h2>
      <ul className="docs-list">
        <li>
          <Link href="/docs/quick-start">Quick start</Link> — from an empty project to
          an exported clip.
        </li>
        <li>
          <Link href="/docs/library">The Library</Link> — presets, controls, easing, and
          why any of it can change mid-playback.
        </li>
        <li>
          <Link href="/docs/mockup">The Mockup studio</Link> — devices, screens, and
          what the animation presets actually animate.
        </li>
        <li>
          <Link href="/docs/tracks">Motion tracks</Link> — stacking more than one motion
          on the same clip.
        </li>
        <li>
          <Link href="/docs/export">Export</Link> — formats, resolutions and the loop
          rule.
        </li>
      </ul>

      <h2>Changing it</h2>
      <p>
        The editor is meant to be edited. Three pages cover the seams most changes go
        through — <Link href="/docs/controls/library">Controls</Link>, where a motion declares
        its own panel; <Link href="/docs/design">Design and theming</Link>, where one
        token sheet holds every colour and metric in the app; and{' '}
        <Link href="/docs/new-motion">New motion</Link>, which is one file and one line
        in the registry.
      </p>

      <p className="docs-next">
        <Link href="/docs/quick-start">Quick start →</Link>
      </p>
    </>
  );
}
