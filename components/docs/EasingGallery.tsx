'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ControlRow } from '@/components/Controls';
import EasingCurveEditor from '@/components/EasingCurveEditor';
import type { ControlDef } from '@/lib/types';
import { EASING_MAP, EASING_PRESETS, resolveEasing, sampleEasing, type EasingSpec } from '@/lib/easing';

/**
 * The easing playground, in three stacked blocks — the demo, the adjuster, the
 * presets. An earlier cut put the demo and the editor side by side in a 382px
 * column with five widgets stacked in it; measured, the 21 strobe marks were
 * 26px wide at 18px apart, so they overlapped into a smear instead of showing a
 * pattern. One thing per row now, and the marks are thin ticks on their own
 * ruler.
 *
 * Everything reads the real library: paths from `sampleEasing` over
 * `resolveEasing`, and the adjuster is the editor's own EasingCurveEditor.
 */

const TIME: ControlDef = {
  key: 'time', label: 'Time through one cycle', type: 'slider',
  min: 0, max: 1, step: 0.01, default: 0.35, precision: 2, section: 'Motion',
};

const GROUPS: { key: 'signature' | 'standard' | 'physics'; title: string; blurb: string }[] = [
  { key: 'signature', title: 'Signature', blurb: 'The named curves, and what most families ship with.' },
  { key: 'standard', title: 'Standard', blurb: 'The in / out / in-out families, gentlest to sharpest.' },
  { key: 'physics', title: 'Physics', blurb: 'Sampled functions, not beziers — these leave the box on purpose.' },
];

// Ticks at equal slices of TIME, placed at the curve's output. Crowding means
// slow, spreading means fast.
const TICKS = Array.from({ length: 21 }, (_, i) => i / 20);

// A path in a box widened to whatever the curve reaches: the physics curves
// pass 0 and 1, and a unit box would clip them.
function miniCurve(fn: (t: number) => number) {
  const pts = sampleEasing(fn, 48);
  let lo = 0;
  let hi = 1;
  for (const [, y] of pts) { if (y < lo) lo = y; if (y > hi) hi = y; }
  const pad = 0.06 * (hi - lo);
  const top = hi + pad;
  const span = top - (lo - pad);
  return pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x * 100).toFixed(2)},${(((top - y) / span) * 100).toFixed(2)}`)
    .join(' ');
}

export default function EasingGallery() {
  const [spec, setSpec] = useState<EasingSpec>({ id: 'glide' });
  const [time, setTime] = useState(TIME.default as number);
  const [playing, setPlaying] = useState(false);

  const ease = useMemo(() => resolveEasing(spec), [spec]);
  const preset = EASING_MAP[spec.id];
  const name = spec.id === 'custom' ? 'Custom curve' : preset?.label ?? spec.id;

  // Autoplay drives the same state the slider does, so pausing leaves the
  // square exactly where it is.
  const raf = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let last = 0;
    const tick = (t: number) => {
      if (last) setTime((p) => (p + (t - last) / 1600) % 1);
      last = t;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  const out = ease(time);
  const pct = (n: number) => `${Math.max(0, Math.min(100, n * 100))}%`;

  return (
    <div className="docs-ez">
      {/* 1. the demo */}
      <div className="docs-ez-block">
        <div className="docs-ez-block-head">
          <span>{name}</span>
          <em>time {time.toFixed(2)} &rarr; position {out.toFixed(2)}</em>
        </div>

        <div className="docs-ez-lane">
          <div className="docs-ez-runway">
            <div className="docs-ez-square" style={{ left: pct(out) }} />
          </div>
          <div className="docs-ez-ruler">
            {TICKS.map((t) => (
              <i key={t} style={{ left: pct(ease(t)) }} />
            ))}
          </div>
        </div>

        <div className="docs-ez-row">
          <button
            type="button"
            className="docs-ez-play"
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <div className="docs-ez-scrub">
            <ControlRow def={TIME} value={Number(time.toFixed(2))} onChange={(v) => setTime(v)} />
          </div>
        </div>

        <p className="docs-ez-note">
          The ticks are the square&rsquo;s position at 21 equal slices of time. Where they
          crowd, the motion is slow; where they spread, it is fast. That spacing is what
          the curve does — the plot below is the same fact, drawn.
        </p>
      </div>

      {/* 2. the adjuster */}
      <div className="docs-ez-block">
        <div className="docs-ez-block-head">
          <span>Adjust the curve</span>
          <em>the editor&rsquo;s own widget</em>
        </div>

        <div className="docs-ez-adjust">
          <div className="docs-ez-editor">
            <EasingCurveEditor spec={spec} onChange={setSpec} />
          </div>
          <div className="docs-ez-adjust-side">
            <p>
              Drag either handle and the square above changes with it. The four numbers are
              the bezier control points — x is clamped to the unit interval, y is free, so a
              curve can overshoot.
            </p>
            <p>
              The physics curves have nothing to drag: they are sampled from real functions
              rather than built from handles, so the plot shows the curve and the handles
              disappear.
            </p>
            <div className="docs-ez-readout">
              <span>the scene stores</span>
              <code>
                {spec.id === 'custom'
                  ? `{ id: 'custom', bezier: [${(spec.bezier ?? []).map((n) => n.toFixed(2)).join(', ')}] }`
                  : preset?.bezier
                    ? `{ id: '${spec.id}' }   // cubic-bezier(${preset.bezier.map((n) => n.toFixed(2)).join(', ')})`
                    : `{ id: '${spec.id}' }   // sampled function, no handles`}
              </code>
            </div>
          </div>
        </div>
      </div>

      {/* 3. the presets */}
      <div className="docs-ez-block">
        <div className="docs-ez-block-head">
          <span>The {EASING_PRESETS.length} curves</span>
          <em>pick one to load it above</em>
        </div>

        {GROUPS.map((group) => (
          <div key={group.key} className="docs-ez-group">
            <div className="docs-ez-group-head">
              <span>{group.title}</span>
              <em>{group.blurb}</em>
            </div>
            <div className="docs-ez-grid">
              {EASING_PRESETS.filter((p) => p.group === group.key).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`docs-ez-card ${p.id === spec.id ? 'active' : ''}`}
                  onClick={() => setSpec({ id: p.id })}
                  aria-pressed={p.id === spec.id}
                >
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <path className="docs-ez-curve" d={miniCurve(resolveEasing({ id: p.id }))} vectorEffect="non-scaling-stroke" />
                  </svg>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
