import Link from 'next/link';

export const metadata = { title: 'New motion' };

export default function NewMotionPage() {
  return (
    <>
      <p className="docs-eyebrow">Changing it</p>
      <h1>New motion</h1>

      <p className="docs-lead">
        A new family is one file and one line in the registry. The codebase is built
        around that seam on purpose: everything downstream — the panel, the thumbnail,
        the timeline, the export — is generated from what the template declares, so
        there is nothing else to wire up.
      </p>

      <h2>The contract</h2>
      <p>
        A template is a <code>meta</code> block, a list of <Link href="/docs/controls/library">controls</Link>,
        and one function:
      </p>
      <pre className="docs-code"><code>{`transform(frame, index, count, values, ctx) -> pose`}</code></pre>
      <p>
        It is asked where layer <code>index</code> of <code>count</code> sits at{' '}
        <code>frame</code>, and answers a pose: <code>x</code>, <code>y</code>,{' '}
        <code>scale</code>, <code>rotation</code>, <code>alpha</code>,{' '}
        <code>depth</code>. Canvas centre is <code>0,0</code>; rotation is radians;{' '}
        <code>depth</code> is the sort order, higher drawn nearer.
      </p>
      <p>
        <code>ctx</code> carries the frame it is living in — canvas size, fps, clip
        length, the resolved card shape — plus the scene&rsquo;s easing as{' '}
        <code>ease</code> and <code>easedPhase</code>.
      </p>

      <h2>Reach for the right pose field</h2>
      <p>
        Several of these look interchangeable and are not. Getting them wrong is the
        most common way a new family looks subtly broken.
      </p>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead><tr><th>Want</th><th>Use</th><th>Not</th></tr></thead>
          <tbody>
            <tr>
              <td>A card is far away</td>
              <td><code>dim</code> — it darkens toward black</td>
              <td><code>alpha</code>, which makes it see-through so whatever it overlaps ghosts through and the field reads as broken glass</td>
            </tr>
            <tr>
              <td>A card is genuinely arriving or leaving</td>
              <td><code>alpha</code></td>
              <td><code>dim</code></td>
            </tr>
            <tr>
              <td>An edge uncovers a still image</td>
              <td><code>clip</code> — the card does not move at all</td>
              <td>Translating it (that slides) or scaling it (that distorts)</td>
            </tr>
            <tr>
              <td>A card tilts out of the plane</td>
              <td><code>taper</code>, drawn through a perspective mesh</td>
              <td><code>skew</code> or <code>scale</code>, which keep opposite edges parallel and equal — no affine transform can say &ldquo;this edge turned away&rdquo;</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <code>taper</code> is the expensive path, so use it only when a card really is
        folding; everything else stays on the cheaper sprite path.
      </p>

      <h2>Stay pure</h2>
      <ul className="docs-list">
        <li>
          Same inputs, same output, always. No <code>Math.random</code> — scattered
          fields use a seeded hash of the index, so the scatter is stable across a
          reload and identical in the preview and the export.
        </li>
        <li>
          Read nothing outside <code>values</code> and <code>ctx</code>. No store, no
          DOM, no clock.
        </li>
        <li>
          No side effects. The function is called for every layer of every frame, by the
          preview, the thumbnails and the encoder.
        </li>
      </ul>

      <h2>Make it loop</h2>
      <p>
        Route your phase through <code>ctx.easedPhase</code> so the scene&rsquo;s easing
        applies, and quantize speed with the loop helper so the clip holds a whole number
        of motion cycles — that is what makes frame 0 identical to the last frame.
        Conveyors pass their card count as the period so each image lands back on its own
        slot. If your motion is genuinely one-shot, skip the helper rather than faking a
        loop.
      </p>

      <h2>Register it</h2>
      <p>
        Add it to the registry in <code>templates/index.ts</code>. The sidebar group, the
        control panel, the easing block, the live thumbnail and the export all pick it up
        from there. Ship variations as preset bundles rather than as copies of the
        transform.
      </p>
      <p>
        Keep the id stable once it has shipped: ids are what saved projects reference.
        Display names can change freely.
      </p>

      <h2>If it needs real perspective</h2>
      <p>
        Set the engine to the 3D backend and add a second pose function returning true 3D
        positions and rotations, plus a camera. The 2D transform stays as the thumbnail
        and fallback projection, so the catalogue card still previews correctly.
      </p>

      <h2>Before you call it done</h2>
      <pre className="docs-code"><code>{`npm test          # invariants over every registered template
npx tsc --noEmit  # the required check`}</code></pre>
      <p>
        The suites run without a browser and check that geometry is well formed and finite,
        that the template holds in every canvas aspect and card shape, that its render
        context is complete and its thumbnail stays inside budget. A family that breaks one
        of those breaks it for the whole catalogue, which is why the check is cheap and
        mandatory rather than a review comment.
      </p>
    </>
  );
}
