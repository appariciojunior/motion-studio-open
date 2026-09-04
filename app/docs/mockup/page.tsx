import Link from 'next/link';

export const metadata = { title: 'The Mockup studio' };

export default function MockupPage() {
  return (
    <>
      <p className="docs-eyebrow">How it works</p>
      <h1>The Mockup studio</h1>

      <p className="docs-lead">
        The Mockup studio is the other half of the editor: one screenshot or screen
        recording of yours, put on a real 3D device, lit and filmed. Where the Library
        moves many cards in 2D, this moves a camera around one object.
      </p>

      <h2>It is a real 3D scene</h2>
      <p>
        The device is an actual model with physically-based materials, standing in a
        studio rig that lights it and gives its body and glass something to reflect. So
        the highlights move when the camera moves, and the metal reads as metal. Nothing
        here is a flat image with a perspective transform faked on top.
      </p>

      <h2>Seven devices in four slots</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Slot</th><th>Device</th><th>Finishes</th><th>Screen</th></tr>
          </thead>
          <tbody>
            <tr><td>Phone</td><td>iPhone 17 Pro</td><td>3</td><td>1206 &times; 2622</td></tr>
            <tr><td>Phone</td><td>iPhone Air</td><td>1</td><td>1260 &times; 2736</td></tr>
            <tr><td>Laptop</td><td>MacBook Pro 14&quot;</td><td>2</td><td>3024 &times; 1964</td></tr>
            <tr><td>Tablet</td><td>iPad Pro</td><td>2</td><td>2752 &times; 2064</td></tr>
            <tr><td>Tablet</td><td>iPad Air</td><td>1</td><td>2732 &times; 2048</td></tr>
            <tr><td>Display</td><td>Pro Display XDR</td><td>1</td><td>6016 &times; 3384</td></tr>
            <tr><td>Display</td><td>Studio Display</td><td>1</td><td>5120 &times; 2880</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The screen column is each panel&rsquo;s real native pixel count, and it is in the
        UI for one practical reason: it tells you what size to capture your screenshot
        at so it lands on the glass without resampling.
      </p>

      <h2>What goes on the screen</h2>
      <p>
        An image or a video — a video plays on the device as a live texture, not as a
        still. It is fitted <strong>Cover</strong>, <strong>Fit width</strong> or{' '}
        <strong>Contain</strong>, with zoom and position on top, so a tall screenshot on
        a wide panel is your decision rather than a crop you inherit. A synthetic status
        bar can be drawn over it — time, battery, signal — for when the capture came
        without one, or came with the wrong one.
      </p>

      <h2>The animations drive the rig, not the device</h2>
      <p>
        There are <strong>16 animation presets</strong> in five groups: studio (4),
        turntable (2), cinematic (5), dynamic (2) and product (3). What they animate is
        the <em>rig</em> — the camera, the lighting, and on a laptop the lid — along a
        keyframed pose timeline. The device itself mostly stays put; the shot is what
        moves. Each preset previews in its own live 3D thumbnail, so you pick by looking
        rather than by name.
      </p>

      <h2>A project is one document or the other</h2>
      <p>
        This matters more than it sounds. A project holds <em>either</em> a Library scene
        or a Mockup studio, never both, and the two are separate shelves in the project
        list. Entering a section opens that section&rsquo;s most recent project, or makes
        one. The reason is blunt: with one project holding both, clicking a rail tab
        would make it save a document you were not editing.
      </p>
      <p>
        It autosaves, like the 2D scene does — within half a second of an edit. There is
        a <strong>Save now</strong> in the project dock next to the save state, but it is
        a reassurance, not the save path.
      </p>

      <h2>Export is the same dialog</h2>
      <p>
        Both 3D sections export through the same dialog as the Library, at the same
        resolutions, because the 2D and 3D renderers implement one capture contract. See{' '}
        <Link href="/docs/export">Export</Link>.
      </p>

      <p className="docs-next">
        <Link href="/docs/tracks">Motion tracks →</Link>
      </p>
    </>
  );
}
