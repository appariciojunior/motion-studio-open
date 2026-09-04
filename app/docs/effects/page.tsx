import Link from 'next/link';
import { effectList } from '@/effects';

export const metadata = { title: 'Effects' };

export default function EffectsPage() {
  return (
    <>
      <p className="docs-eyebrow">How it works</p>
      <h1>Effects</h1>

      <p className="docs-lead">
        The third seam. A template decides where the cards go, a track decides how they
        composite, and an effect filters the result — an ordered stack over the rendered
        scene rather than something applied per card.
      </p>

      <p className="docs-note">
        Being straight about the state of it: {effectList.length === 1 ? 'one effect ships today' : `${effectList.length} effects ship today`} —{' '}
        {effectList.map((e, i) => (
          <span key={e.meta.id}>{i > 0 ? ', ' : ''}<strong>{e.meta.name}</strong></span>
        ))}
        . The panel and the contract are finished; the library behind them is not. That is
        deliberate rather than abandoned: the pattern was proven with one effect before
        filling a menu with them.
      </p>

      <h2>A stack, in order</h2>
      <p>
        Effects apply in the order you add them, over the whole frame. Order matters the
        way it does in any filter chain — pixelate then blur is a soft mosaic, blur then
        pixelate is mush.
      </p>

      <h2>Same self-declaring pattern as a template</h2>
      <p>
        An effect declares an id, a name, its own controls from the same{' '}
        <Link href="/docs/controls/library">nine-type vocabulary</Link>, and one function
        that builds the filter from those values. That is the whole file:
      </p>
      <pre className="docs-code"><code>{`export const pixelate: Effect = {
  meta: { id: 'pixelate', name: 'Pixelate' },
  controls: [
    { key: 'size', label: 'Pixel Size', type: 'slider',
      min: 1, max: 64, step: 1, default: 8 },
  ],
  createFilter: (v) => new PixelateFilter(v.size ?? 8),
};`}</code></pre>
      <p>
        Register it in <code>effects/index.ts</code> and the panel row, its controls and
        its defaults all follow — the same deal templates get, for the same reason.
      </p>

      <h2>Where they run</h2>
      <p>
        The stack is a 2D backend feature: it filters the rendered frame, so it applies to
        the Library scene. The 3D sections have their own stylised passes, which live with
        the scene rather than in this stack.
      </p>

      <p className="docs-next">
        <Link href="/docs/mockup">The Mockup studio →</Link>
      </p>
    </>
  );
}
