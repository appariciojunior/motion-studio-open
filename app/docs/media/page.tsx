import Link from 'next/link';
import { CARD_SHAPES } from '@/lib/crop';

export const metadata = { title: 'Media' };

export default function MediaPage() {
  const shapes = Object.keys(CARD_SHAPES);

  return (
    <>
      <p className="docs-eyebrow">How it works</p>
      <h1>Media</h1>

      <p className="docs-lead">
        Your images and videos, and the slots a motion puts them in. Drop files into the
        Media panel; the active motion takes them in order.
      </p>

      <h2>Order is meaning</h2>
      <p>
        A motion asks for layer <em>index</em> 0, 1, 2 — so the order of the list is the
        order of the cards. Drag to reorder, and hide a card without deleting it when you
        want to try the clip without it.
      </p>
      <p>
        When a motion places more cards than you have files, it cycles the set across the
        field rather than leaving gaps — which is how six photos fill a gallery wall of a
        hundred cells.
      </p>

      <h2>Video is a live texture, not a still</h2>
      <p>
        A video card decodes into a texture that updates every frame, on both backends. It
        plays inside the card while the card moves, and it is captured that way in the
        export too.
      </p>
      <p>
        A video shorter than the clip has to do something when it runs out, and that is a
        choice: <strong>loop</strong> restarts it, <strong>hold</strong> freezes on its
        final frame. The setting applies to the preview and the export identically, so
        what you watched is what you get.
      </p>

      <h2>Card shape and the crop</h2>
      <p>
        Cards are not the shape of your files — they are the shape the scene asks for, and
        your image is cropped to fill it. The scene-level choice is{' '}
        <code>auto</code> plus {shapes.length} explicit ratios:{' '}
        {shapes.map((s, i) => (
          <span key={s}>{i > 0 ? ', ' : ''}<code>{s}</code></span>
        ))}.
      </p>
      <p>
        <strong><code>auto</code> is the one worth understanding.</strong> It defers to the
        shape the template itself declares, falling back to a 4:5 portrait. That is why
        picking one family gives you square cards and another gives you portrait ones
        without you touching anything — and why the ported families set{' '}
        <code>auto</code> on purpose: their presets each declare their own shape, and
        pinning one ratio for the whole family came out wrong on most of them.
      </p>
      <p>
        Full-bleed motions ignore all of it and crop to the canvas aspect instead. A
        part-screen card in a full-bleed field would leave a gap, so the choice is not
        offered.
      </p>

      <h2>Crop focus, per card</h2>
      <p>
        Cropping to a shape throws pixels away, and which pixels is your call. Each card
        carries its own focus point — the middle by default — so a face near the top of a
        landscape photo survives being squeezed into a portrait card. It is stored per
        card, not per scene: one badly framed photo does not force a compromise on the
        rest.
      </p>

      <h2>Your uploads survive a reload</h2>
      <p>
        Uploaded files are kept in the browser&rsquo;s own database, not as temporary links
        that die when the tab closes. Reopen the project and your images come back with it.
      </p>
      <p className="docs-note">
        Which also means they live in <em>that</em> browser, on <em>that</em> machine.
        Nothing is uploaded anywhere — that is the point of the tool — so a project moved
        to another computer needs its files again.
      </p>

      <h2>What the demo set is for</h2>
      <p>
        A new scene starts with a demo set so the catalogue previews are not empty
        rectangles. They are marked as demo assets: replace them with your own and nothing
        of yours is mixed in with them.
      </p>

      <p className="docs-next">
        <Link href="/docs/canvas">Canvas →</Link>
      </p>
    </>
  );
}
