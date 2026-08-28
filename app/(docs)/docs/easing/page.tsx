import Link from 'next/link';
import EasingGallery from '@/components/docs/EasingGallery';
import { EASING_PRESETS } from '@/lib/easing';

export const metadata = { title: 'Easing' };

export default function EasingPage() {
  return (
    <>
      <p className="docs-eyebrow">Changing it</p>
      <h1>Easing</h1>

      <p className="docs-lead">
        Easing here does not move anything. Each motion runs on a cyclic phase, and the
        curve reshapes that phase — the same path, walked at a different rate. That one
        decision is why a curve can be dropped on any of the {EASING_PRESETS.length}{' '}
        families without breaking it, and why swapping one never breaks a loop.
      </p>

      <h2>Scrub it and watch</h2>
      <p>
        Pick a curve, then drag the phase across two full cycles. The two dots are the raw
        phase and the eased phase.
      </p>

      <EasingGallery />

      <h2>Why the loop survives</h2>
      <p>
        The renderer reshapes a phase as <code>floor(p) + ease(frac(p))</code>. Whole
        numbers are fixed points of that expression: at every integer the eased phase{' '}
        <em>is</em> the raw phase. So a motion that was tuned to complete a whole number
        of cycles per clip still completes them, on any curve, and frame 0 still equals the
        last frame.
      </p>
      <p>
        That is also the reason easing lives on the track rather than inside each template.
        A template hands its raw phase to <code>ctx.easedPhase</code> and inherits whatever
        curve the scene is on; it never needs to know which one.
      </p>

      <h2>Three groups, on purpose</h2>
      <p>
        <strong>Signature</strong> curves are the named ones most families ship with.{' '}
        <strong>Standard</strong> is the in / out / in-out ladder, from Sine through Expo —
        the same shapes CSS gives you, so they behave the way your eye already expects.{' '}
        <strong>Physics</strong> is different in kind: Bounce, Spring, Wiggle and Overshoot
        have no bezier handles at all and are sampled from real functions, which is why
        their curves leave the unit box. A bounce that never passes its target is not a
        bounce.
      </p>
      <p className="docs-note">
        Practical consequence: the curve editor can only show handles for a bezier-backed
        curve. Drag a handle on one of those and the scene stores{' '}
        <code>{'{ id: \'custom\', bezier: [...] }'}</code> instead of a preset name. The
        physics curves have nothing to drag.
      </p>

      <h2>Every family already ships one</h2>
      <p>
        A template declares its own default curve, and a preset can override it — because
        for anything that steps per item the curve is what separates a glide from a settle.
        So the honest way to read &ldquo;this preset feels wrong&rdquo; is usually: the
        curve is right and the clip length is not, or the other way round. See{' '}
        <Link href="/docs/library">The Library</Link> on why some presets pin the duration.
      </p>

      <p className="docs-next">
        <Link href="/docs/new-motion">New motion →</Link>
      </p>
    </>
  );
}
