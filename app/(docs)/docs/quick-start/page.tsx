import Link from 'next/link';

export const metadata = { title: 'Quick start' };

export default function QuickStartPage() {
  return (
    <>
      <p className="docs-eyebrow">Getting started</p>
      <h1>Quick start</h1>

      <p className="docs-lead">
        An exported clip in five steps. A new project opens empty on purpose — nothing
        from the catalogue is in it until you choose something.
      </p>

      <h2>1. Run it</h2>
      <pre className="docs-code"><code>{`npm install
npm run dev          # → http://localhost:3000`}</code></pre>
      <p>
        That is the whole setup. Export runs in the browser, so there is no ffmpeg to
        install and no key to configure.
      </p>

      <h2>2. Pick a motion</h2>
      <p>
        Open <strong>Templates</strong> in the left bar and choose a family, or go
        through the preset cards on <Link href="/docs/library">The Library</Link> page and click a
        card — it opens the editor with that preset already applied. Picking a preset
        resets its controls to the values it was authored with, and some families also
        pin the clip length and the canvas shape, because their motion was measured at
        a specific cadence and only reads right there.
      </p>

      <h2>3. Bring your own images</h2>
      <p>
        Drop files into <strong>Media</strong>. Images and video both work — a video
        card becomes a live texture, not a still. Drag to reorder, set a crop focus per
        card, and pick a card shape (or leave it on <code>auto</code>, which defers to
        whatever proportion the preset was built for).
      </p>

      <h2>4. Set the frame</h2>
      <p>
        <strong>Canvas</strong> holds the aspect — six presets from 3:4 to 16:9, plus
        an exact pixel size — the safe-area guides, a logo slot, and the background,
        which can be a colour, a gradient, an image, or the featured card reflected and
        blurred behind itself.
      </p>
      <p>
        <strong>Adjust</strong> is where the preset&rsquo;s own controls live, alongside
        the easing curve. Every family ships with a default curve; the 28 presets cover
        the standard families plus physics curves, and you can drag your own bezier.
      </p>

      <h2>5. Export</h2>
      <p>
        <strong>Export</strong> writes MP4, WebM or GIF at 720p up to 4K. It captures
        from the same clock the preview uses, so the file is frame-for-frame what you
        watched. See <Link href="/docs/export">Export</Link> for the encoders and the
        loop rule.
      </p>

      <h2>Two things worth knowing early</h2>
      <ul className="docs-list">
        <li>
          <strong>Undo covers gestures, not keystrokes.</strong> A whole drag, a typed
          number or a template pick is one step back.
        </li>
        <li>
          <strong>Projects autosave.</strong> Each one is its own storage key, written
          within half a second of an edit. The Mockup studio saves the same way.
        </li>
      </ul>

      <h2>The keys worth knowing</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead><tr><th>Key</th><th>Does</th></tr></thead>
          <tbody>
            <tr><td><code>Ctrl</code>/<code>Cmd</code> + <code>K</code></td><td>Open the docs search palette. A bare <code>/</code> does the same.</td></tr>
            <tr><td><code>Ctrl</code>/<code>Cmd</code> + <code>Z</code></td><td>Undo — one whole gesture at a time, not one pixel of a drag.</td></tr>
            <tr><td><code>Ctrl</code>/<code>Cmd</code> + <code>Shift</code> + <code>Z</code>, or <code>Y</code></td><td>Redo.</td></tr>
            <tr><td><code>Shift</code> while dragging a slider</td><td>Fine adjustment — a grid ten times finer than the step.</td></tr>
            <tr><td>Arrow keys on a focused slider</td><td>Nudge by a step; with <code>Shift</code>, by a tenth.</td></tr>
            <tr><td><code>Enter</code> on a focused slider</td><td>Open the typed field. <code>Escape</code> leaves without writing.</td></tr>
            <tr><td>Double-click a slider</td><td>Back to the control&rsquo;s declared default.</td></tr>
            <tr><td><code>Shift</code> while dragging an XY pad</td><td>Hold the line the drag is already on.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Undo and redo are ignored while you are typing in a field, so the shortcut never
        steals a keystroke from a number you are entering.
      </p>

      <p className="docs-next">
        <Link href="/docs/library">The Library →</Link>
      </p>
    </>
  );
}
