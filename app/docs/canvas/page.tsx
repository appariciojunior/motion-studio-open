import Link from 'next/link';
import { ASPECTS } from '@/store/useSceneStore';

export const metadata = { title: 'Canvas' };

export default function CanvasPage() {
  const aspects = Object.keys(ASPECTS);

  return (
    <>
      <p className="docs-eyebrow">How it works</p>
      <h1>Canvas</h1>

      <p className="docs-lead">
        The frame everything happens inside: its shape, what sits behind the cards, and the
        guides that keep your content out of the places a platform will cover.
      </p>

      <h2>Shape</h2>
      <p>
        {aspects.length} presets —{' '}
        {aspects.map((a, i) => (
          <span key={a}>{i > 0 ? ', ' : ''}<code>{a}</code></span>
        ))}{' '}
        — plus an exact pixel size when none of them is the answer. The presets are built
        from a fixed longest edge, so switching shape reframes the scene rather than
        rescaling your work.
      </p>
      <p>
        Some presets set the shape for you when you pick them. That is not the app being
        opinionated: those motions were authored against a specific frame, and their
        framing is measured against its half-height — at another ratio the sides show a
        different amount of the ring, which is a different composition.
      </p>

      <h2>Background</h2>
      <p>Three sources, and the third is the interesting one.</p>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead><tr><th>Source</th><th>What it does</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Colour</strong></td>
              <td>A solid, or a two-stop gradient when you turn gradient on.</td>
            </tr>
            <tr>
              <td><strong>Image</strong></td>
              <td>Your own file behind the cards, with a blur so it reads as a backdrop rather than competing with them.</td>
            </tr>
            <tr>
              <td><strong>Card</strong></td>
              <td>The featured card itself, reflected and blurred behind the scene. The background follows the motion — as the featured card changes, so does the wash behind it.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        A background you set explicitly is remembered as <em>yours</em>: the presets that
        would otherwise impose a white backdrop leave it alone once you have made a choice.
      </p>

      <h2>Safe-area guides</h2>
      <p>
        An overlay marking the edges a platform is likely to cover — the caption bar, the
        profile row, the buttons stacked down one side. They are drawn on the stage only:
        they never appear in the export, and turning them off changes nothing about the
        file.
      </p>
      <p>
        Worth switching on before you finish rather than after, because the fix for
        something sitting under a caption bar is usually a different canvas shape, not a
        nudge.
      </p>

      <h2>Logo slot</h2>
      <p>
        A single image pinned to a corner, with a size, kept separate from the card list so
        it is not swept into the motion. It sits above the scene and stays put while
        everything else moves — a watermark, a wordmark, an end-card badge.
      </p>

      <p className="docs-next">
        <Link href="/docs/timeline">Timeline →</Link>
      </p>
    </>
  );
}
