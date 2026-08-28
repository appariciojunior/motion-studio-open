import Link from 'next/link';
import ControlGallery, { CONTROL_TYPE_COUNT } from '@/components/docs/ControlGallery';

export const metadata = { title: 'Library controls' };

export default function LibraryControlsPage() {
  return (
    <>
      <p className="docs-eyebrow">Changing it</p>
      <h1>Library controls</h1>

      <p className="docs-lead">
        The Adjust panel is not written per template. Each motion declares the controls it
        has, and the panel renders that declaration — which is why every family shows
        exactly its own settings and no dead ones, and why adding a control is a one-line
        change with no UI to touch.
      </p>

      <p className="docs-note">
        Controls are declared in two places in this app, and they are edited in different
        files for different reasons. This page is the motion side. The studio side is{' '}
        <Link href="/docs/controls/mockup">Mockup controls</Link>.
      </p>

      <h2>The vocabulary is closed</h2>
      <p>
        A template may only use these {CONTROL_TYPE_COUNT} types. The limit is the point: a motion cannot
        invent a widget the panel does not know how to draw, so every motion stays fully
        editable, thumbnailable and exportable by the same code.
      </p>
      <p>
        The controls below are live, and they are the editor&rsquo;s own — the same
        component the Adjust panel mounts, not a drawing of it. Drag them. The readout
        beside each one is the value your transform would read that instant, which is the
        whole contract between the panel and the motion.
      </p>

      <ControlGallery />

      <h2>The slider has more in it than a track</h2>
      <p>
        It carries most of the controls in the app, so it earned some depth. None of this
        is configured per template — declare <code>type: 'slider'</code> and you get all
        of it.
      </p>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Gesture</th><th>Does</th></tr>
          </thead>
          <tbody>
            <tr><td>Drag anywhere on the track</td><td>Sets the value. The whole 34px row is the control, not a thin rail with a knob to hit.</td></tr>
            <tr><td><strong>Hold Shift while dragging</strong></td><td><strong>Fine adjustment</strong> — the grid becomes a tenth of the declared step, so a step-1 slider lands on 12.4.</td></tr>
            <tr><td>Click the value</td><td>Types an exact number. It snaps to the same grid a drag uses, so the readout can never show 19 while storing 18.5.</td></tr>
            <tr><td>Arrow keys, track focused</td><td>Nudges by one step; with Shift, by a tenth. Enter opens the typed field.</td></tr>
            <tr><td>Arrow keys while typing</td><td>Nudges from what is <em>typed</em>, not from what is stored — and Shift means the finer grid here too.</td></tr>
            <tr><td>Double-click the track</td><td>Back to the control&rsquo;s declared default.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The fine adjustment is why a control can declare a coarse step without becoming
        imprecise. A rotation in whole degrees is the right default for dragging, and Shift
        is there for the one shot that needs 12.4.
      </p>
      <p className="docs-note">
        Two details that look cosmetic and are not. A drag belongs to the track that was
        pressed: without that, a pointer held down and swept across a panel rewrote every
        slider it crossed. And the typed field is a text input with a decimal input mode
        rather than a number input, because a number input refuses to report a selection —
        so the first keystroke landed beside the old value instead of replacing it, and
        340 followed by 5 became 3405.
      </p>

      <h2>What one declaration looks like</h2>
      <p>
        Every control above is one object in the template&rsquo;s <code>controls</code>{' '}
        array. The full set of fields:
      </p>
      <pre className="docs-code"><code>{`{
  key: 'tilt',            // unique within the template; transform reads values.tilt
  label: 'Tilt',          // what the panel shows
  type: 'slider',
  min: 0, max: 45, step: 1,
  default: 12,            // also the value a template switch resets to
  section: 'Motion',      // Layout | Motion | Depth | Finish — groups the panel
  unit: '°',              // ° % px × s — drawn next to the number
  precision: 0,           // decimals shown
  description: 'How far each card leans out of the plane.',
  visibleWhen: { key: 'mode', equals: 'perspective' },
  advanced: true,         // folded away until Advanced is opened
}`}</code></pre>
      <p>
        <code>section</code> is what groups the panel, so a new control lands in the right
        block without any layout work. <code>visibleWhen</code> is how a family hides
        settings that do not apply to the mode it is in — cheaper and clearer than shipping
        two near-identical templates. <code>advanced</code> keeps the long tail out of the
        way without hiding it.
      </p>

      <h2>Adding or changing one</h2>
      <ul className="docs-list">
        <li>Add the entry to the template&rsquo;s <code>controls</code> array.</li>
        <li>Read it in the transform as <code>values.yourKey</code>.</li>
        <li>
          That is all. The panel row, the default, the reset-on-switch, the undo step, the
          thumbnail and the export all follow from the declaration.
        </li>
      </ul>
      <p>
        Changing a <code>default</code> changes what a fresh pick of that template looks
        like. Changing a <code>key</code> does something else entirely: keys are what saved
        projects reference, so renaming one silently drops that value from every scene
        already on disk. Labels are free to change; keys and template ids are not.
      </p>

      <h2>A new preset is a new set of defaults</h2>
      <p>
        Most &ldquo;new motions&rdquo; are not new motions. A preset is the same transform
        shipped with different declared defaults, built by a small helper that patches
        them — so a family of six presets is one piece of code and six value bundles.
        Because picking a template does a full reset from the declaration, the preset look
        comes out for free.
      </p>
      <p className="docs-note">
        Two traps if you write a preset by hand rather than through the helper: a preset of
        a 3D family that loses its 3D pose function renders flat while its base renders in
        perspective, and a preset of a lattice family that loses its layer-count function
        falls back to reading a card-count control those families do not have — six cards
        where a wall was expected. Both are silent.
      </p>

      <p className="docs-next">
        <Link href="/docs/controls/mockup">Mockup controls →</Link>
      </p>
    </>
  );
}
