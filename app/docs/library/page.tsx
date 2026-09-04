import Link from 'next/link';
import PresetSample from '../_components/PresetSample';
import { catalogTemplateList, templateGroups } from '@/templates';

export const metadata = { title: 'The Library' };

export default function LibraryPage() {
  return (
    <>
      <p className="docs-eyebrow">How it works</p>
      <h1>The Library</h1>

      <p className="docs-lead">
        The Library is the 2D side of the editor: your images, arranged and moved by
        one piece of motion, on a canvas you frame. This page explains the pieces and
        how they fit; the browsing itself belongs in the app, where there is search,
        favourites and the real stage.
      </p>

      <h2>A preset is a function, not a recording</h2>
      <p>
        Every motion in the catalogue is a small pure function. It is handed a frame
        number and a card index, and it answers where that card sits at that instant:
        position, scale, rotation, transparency, depth. Nothing is baked and nothing is
        pre-rendered.
      </p>
      <p>
        Three things follow from that, and they are the reason the editor behaves the
        way it does. The preview, the thumbnails and the exported file are all the same
        function, so they cannot disagree. Any control can change while the clip plays,
        because the next frame is simply computed again. And a preset works with 3
        images or 300, because the count is an input, not a property of the motion.
      </p>

      <h2>Families and presets</h2>
      <p>
        A <strong>family</strong> is one idea — cards gliding past in a row, a ring you
        can film from inside, a marquee band. A <strong>preset</strong> is that idea at
        one set of values. The catalogue currently publishes{' '}
        <strong>{catalogTemplateList.length} presets</strong> in{' '}
        <strong>{templateGroups.length} families</strong>; both numbers are counted from
        the registry when this page is built, so they cannot drift from the editor.
      </p>
      <p>
        Picking a preset resets its controls to the values it was authored with. Some
        families also set the clip length and the canvas shape, and that is not a
        liberty — their motion was measured in seconds per card, so at another duration
        it is a different motion, and their framing was authored against a specific
        aspect.
      </p>

      <PresetSample ids={['carousel', 'orbit-3d-12', 'ticker-01', 'wipe-01', 'bloom-01', 'flip-01']} />
      <p className="docs-note">
        Six presets from six families, running here as an illustration. Hover one to
        play it; click one to open it in the editor. The whole catalogue lives in the
        editor&rsquo;s Templates panel.
      </p>

      <h2>The controls belong to the motion</h2>
      <p>
        A template declares its own controls, so what you see in the Adjust panel is
        whatever that motion actually has — not a fixed set of sliders that some
        families ignore. They are drawn from a small vocabulary: sliders, toggles,
        pills, dropdowns, colours, an XY pad, an upload and a text field. Nothing else
        is needed, and the limit is deliberate: a template cannot invent a control the
        panel does not know how to render, so every motion stays fully editable by the
        same UI.
      </p>

      <h2>Easing reshapes time, not position</h2>
      <p>
        Easing does not move cards. Each motion runs on a cyclic phase, and the easing
        curve reshapes that phase — the same path, walked at a different rate. That is
        why a curve can be swapped on any family without breaking it, and why the loop
        survives the swap. There are 28 curves, from the standard families to physics
        ones, plus a bezier you can drag yourself.
      </p>

      <h2>Some families count their own cards</h2>
      <p>
        Most motions place as many cards as you have images. The lattice families — a
        woven gallery wall, an aligned grid — do the opposite: they derive how many
        cells they need from the canvas, so the wall fills the frame instead of leaving
        a gap when you supply six photos. Those cycle your images across the field, so
        a small set can fill a large wall.
      </p>

      <h2>Why clips loop cleanly</h2>
      <p>
        Every template quantizes its speed to a whole number of motion cycles per clip,
        so the last frame lands exactly where the first one starts. Conveyors go further
        and match their period to the card count, so each image returns to its own slot.
        A few presets are one-shot by design — something that drops and bounces has
        nowhere to loop back to — and those skip the rule rather than fake it.
      </p>

      <h2>Sharing a starting point</h2>
      <p>
        Any preset is addressable: <code>/library?tpl=&lt;preset-id&gt;</code> opens the
        editor with it already applied, exactly as clicking its card would. Useful for
        handing a teammate the exact starting point instead of describing it. The id
        appears under each card above.
      </p>

      <h2>Keep what you tuned</h2>
      <p>
        Two shelves sit above the catalogue, and both are yours rather than ours.
      </p>
      <p>
        <strong>Favourites</strong> are a heart on any card: they collect into a shelf
        pinned above the families, in the order you hearted them. A family withheld from
        the catalogue keeps its hearts rather than losing them — bring it back and they are
        still there.
      </p>
      <p>
        <strong>Saved presets</strong> are the step after adjusting. The Custom tab holds
        the value bundles you name and save, and applying one puts those values back
        without touching anything else. It is the honest answer to &ldquo;I got this
        right once&rdquo; — a preset is nothing but a set of defaults, so saving your own
        is the same mechanism the shipped ones use.
      </p>

      <p className="docs-next">
        <Link href="/docs/media">Media →</Link>
      </p>
    </>
  );
}
