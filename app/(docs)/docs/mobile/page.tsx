import Link from 'next/link';

export const metadata = { title: 'On a phone' };

export default function MobilePage() {
  return (
    <>
      <p className="docs-eyebrow">How it works</p>
      <h1>On a phone</h1>

      <p className="docs-lead">
        Below 920px the editor swaps to a touch layout — not a squeezed version of the
        desktop one, a different arrangement of the same scene. Everything renders and
        exports the same; what changes is where the controls live.
      </p>

      <h2>Why 920px, and not a round number</h2>
      <p>
        The desktop layout is a five-column grid whose four fixed columns — the rail, the
        templates panel and the two side panels — need 64 + 296 + 280 + 280 = 920px before
        the stage gets any width at all. Below that the stage is what collapses, because it
        is the flexible column: measured at 769px it was zero pixels wide and the canvas
        rendered 0&times;525.
      </p>
      <p>
        So the breakpoint is not a taste call about phones. It is the width at which the
        desktop arrangement stops being able to show you your work.
      </p>

      <h2>The panels become a bottom bar</h2>
      <p>
        Five items across the bottom: <strong>Templates</strong>, <strong>Media</strong>,{' '}
        <strong>Adjust</strong>, <strong>Canvas</strong> and <strong>Export</strong>. The
        first four open the matching panel as a sheet over the stage; Export opens the same
        export dialog the desktop uses.
      </p>
      <p>
        A sheet carries its title and closes on <code>Escape</code> or on its own close
        control, and the stage keeps playing behind it — so you can watch the effect of a
        slider without dismissing the panel holding it.
      </p>

      <h2>Playback lives above the bar</h2>
      <p>
        A compact transport: play and pause, the current time, a scrubber, and the clip
        length. The full timeline with its track lanes is a desktop surface — there is no
        room to place a lane, a gutter and four per-lane actions on a phone and still leave
        the stage visible.
      </p>

      <h2>Controls are built for a thumb</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead><tr><th>Control</th><th>On touch</th></tr></thead>
          <tbody>
            <tr>
              <td>Slider</td>
              <td>A 52px track with a round handle instead of the 34px row and its 2px marker, and a value bubble above your finger while you drag — because your finger is covering the number.</td>
            </tr>
            <tr>
              <td>Template cards</td>
              <td>Previews play on their own. There is no hover to start them, so an observer keeps the cards on screen animating and the ones off screen at a still pose rather than animating a hundred at once.</td>
            </tr>
            <tr>
              <td>Favourite heart</td>
              <td>Always visible. On desktop it appears on hover, which does not exist here.</td>
            </tr>
            <tr>
              <td>Pads and the trackball</td>
              <td>Take the gesture directly and suppress the browser&rsquo;s own scroll and zoom while you are dragging inside them.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>What the touch layout leaves out</h2>
      <p>
        <strong>Saved presets.</strong> The Templates sheet shows the catalogue only — the
        Custom tab is a desktop surface. Your saved presets are not lost, they are simply
        not reachable from a phone.
      </p>
      <p>
        <strong>The track lanes.</strong> Stacking motion tracks is desktop work, for the
        room reason above. A project with tracks still plays and exports correctly on a
        phone; you just cannot rearrange them there.
      </p>
      <p className="docs-note">
        Export itself is not one of the omissions. The encoder is the browser&rsquo;s own,
        so a phone that supports it exports the same MP4 at the same resolutions — the file
        is written on the device, like everything else here.
      </p>

      <h2>These docs, too</h2>
      <p>
        The same breakpoint applies to this site. A bar appears under the navbar carrying
        the menu button and the search, the page list drops out from under that bar, and it
        closes itself when you open a page. Search is the same palette either way —{' '}
        <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>K</kbd> opens it from anywhere, on a phone
        too if you have a keyboard attached.
      </p>

      <p className="docs-next">
        <Link href="/docs/mockup">The Mockup studio →</Link>
      </p>
    </>
  );
}
