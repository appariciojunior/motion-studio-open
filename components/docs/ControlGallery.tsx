'use client';

import { useState } from 'react';
import { ControlRow } from '@/components/Controls';
import type { ControlDef } from '@/lib/types';

/**
 * Every control type, rendered by the editor's OWN control renderer.
 *
 * `ControlRow` is fully presentational — `{ def, value, onChange }`, no store —
 * so the docs can mount the real thing instead of drawing a picture of it. What
 * you see here is what the Adjust panel shows, down to the 34px track and the
 * click-the-value-to-type behaviour, because it IS that component. A screenshot
 * would go stale the first time a control is restyled; this cannot.
 *
 * The definitions below are examples in the same shape templates use, not
 * copies of any particular template's controls.
 */

interface Demo {
  def: ControlDef;
  what: string;
  how: string;
}

const DEMOS: Demo[] = [
  {
    def: {
      key: 'tilt', label: 'Tilt', type: 'slider',
      min: 0, max: 45, step: 1, default: 12, unit: '°', section: 'Motion',
      description: 'How far each card leans out of the plane.',
    },
    what: 'A number in a range.',
    how: 'The whole track is the control — press anywhere on it and drag. Hold Shift while dragging for a grid ten times finer than the declared step. Click the value to type an exact one; double-click the track to snap back to the declared default. Focus it and the arrow keys nudge by a step, or by a tenth of one with Shift held.',
  },
  {
    def: {
      key: 'bend', label: 'Card bend', type: 'slider',
      min: -100, max: 100, step: 1, default: 0, unit: '%', section: 'Depth',
      description: 'Negative bows the card away from you, positive bows it toward you.',
    },
    what: 'A range that spans zero.',
    how: 'The same type, declared with a negative minimum, and it reads differently for it: the fill starts at ZERO and runs out to the value, so right of centre is positive, left is negative, and zero is empty. Filling from the left edge instead made a neutral control look half-on — a bend of 0 showed a half-full track.',
  },
  {
    def: {
      key: 'direction', label: 'Direction', type: 'toggle',
      options: ['Forward', 'Reverse'], default: 'Forward', section: 'Motion',
    },
    what: 'Two states, both visible.',
    how: 'Use it when the two options are opposites and the reader should see both at once. It is a segmented pair rather than a checkbox because "Forward / Reverse" has no natural off state.',
  },
  {
    def: {
      key: 'mode', label: 'Mode', type: 'pills',
      options: ['Static', 'Rotate', 'Drift'], default: 'Rotate', section: 'Motion',
    },
    what: 'One of a few, all visible.',
    how: 'The same shape as the toggle, extended. Good up to about four options — past that the row gets cramped and a select reads better. A mode pill is usually what visibleWhen keys off, so the panel can hide settings the current mode does not use.',
  },
  {
    def: {
      key: 'blend', label: 'Blend', type: 'select',
      options: ['Normal', 'Multiply', 'Screen', 'Overlay', 'Soft light', 'Hard light', 'Difference'],
      default: 'Normal', section: 'Finish',
    },
    what: 'One of many, folded away.',
    how: 'A dropdown, for lists too long to lay out. Same data as pills — an options array and a string default — so switching between the two is a one-word edit if a list grows.',
  },
  {
    def: {
      key: 'from', label: 'From edge', type: 'direction',
      default: 'left', section: 'Layout',
    },
    what: 'A direction, picked spatially.',
    how: 'A 3×3 pad of edges and corners. It exists because "left / top-right / bottom" as a text list makes the reader translate words into geometry — here the control has the same shape as the thing it describes. Families that push content in from an edge use this.',
  },
  {
    def: {
      key: 'tint', label: 'Card tint', type: 'color',
      default: '#111827', section: 'Finish',
    },
    what: 'A colour, as a hex string.',
    how: 'The swatch opens the platform picker and the value is stored as a hex string. Worth noting: this is for colour a MOTION owns. The interface’s own colours never come from a control — they live in the token sheet.',
  },
  {
    def: {
      key: 'offset', label: 'Offset', type: 'xypad',
      default: { x: 0, y: 0 }, section: 'Layout',
    },
    what: 'Two numbers that belong together.',
    how: 'Drag the dot; the value is { x, y }. Reach for it when the two numbers are one gesture — a position, a nudge — rather than two independent settings. Two sliders would be more precise and much worse to aim.',
  },
  {
    def: {
      key: 'logo', label: 'Logo', type: 'upload',
      default: '', section: 'Finish',
    },
    what: 'A file or a URL.',
    how: 'Gives the motion its own image slot, separate from the card list — a watermark, a badge, a mask. The value is a reference, so it survives a reload with the rest of the project.',
  },
  {
    def: {
      key: 'caption', label: 'Caption', type: 'text',
      default: 'Motion Studio', section: 'Finish',
    },
    what: 'A string.',
    how: 'For motions that draw type. Plain and deliberately unstyled: the template decides how the string is rendered, the control only collects it.',
  },
];

// How a value reads back, so the panel side and the transform side line up.
function show(value: unknown): string {
  if (typeof value === 'string') return value === '' ? "''" : `'${value}'`;
  if (value && typeof value === 'object' && 'x' in (value as any)) {
    const v = value as { x: number; y: number };
    return `{ x: ${Math.round(v.x)}, y: ${Math.round(v.y)} }`;
  }
  return String(value);
}

// The number of distinct types shown, so the prose can never claim a count the
// gallery does not actually render — the vocabulary has gained a type before.
export const CONTROL_TYPE_COUNT = new Set(DEMOS.map((d) => d.def.type)).size;

export default function ControlGallery() {
  const [values, setValues] = useState<Record<string, any>>(() =>
    Object.fromEntries(DEMOS.map((d) => [d.def.key, d.def.default])),
  );

  const set = (key: string) => (val: any) => setValues((v) => ({ ...v, [key]: val }));

  return (
    <div className="docs-ctl-list">
      {DEMOS.map(({ def, what, how }) => (
        <section key={def.key} className="docs-ctl">
          <div className="docs-ctl-head">
            <code>{def.type}</code>
            <span>{what}</span>
          </div>

          <div className="docs-ctl-body">
            {/* The same surface the Adjust panel gives a control: panel
                background, one hairline, the panel's own side padding. */}
            <div className="docs-ctl-demo">
              <ControlRow def={def} value={values[def.key]} onChange={set(def.key)} />
            </div>

            <div className="docs-ctl-side">
              <p>{how}</p>
              <div className="docs-ctl-readout">
                <span>the transform reads</span>
                <code>values.{def.key} = {show(values[def.key])}</code>
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
