'use client';

import { useState } from 'react';
import type { FillSpec } from '@/store/use3DStore';
import GradientEditor from './GradientEditor';
import { gradientCss, gradientFromFill, type GradientSpec } from '@/lib/gradient';
import { ControlRow } from './Controls';
import type { ControlDef } from '@/lib/types';

const solidColorDef: ControlDef = { key: 'fill-colour', label: 'Colour', type: 'color', default: '#cccccc' };

// One colour/fill row — the single shared pattern for BOTH model parts and the
// background. Type (Original / Solid / Linear / Radial) + start/centre colour +
// end/edge colour (gradients only). `allowNone` shows the Original option
// (parts revert to the model's own colour); the background has no Original.
export interface FillRowProps {
  label: string;
  fill: FillSpec | undefined;               // undefined = Original
  allowNone?: boolean;
  onType: (type: 'none' | 'solid' | 'linear' | 'radial') => void;
  onColor: (which: 'c1' | 'c2', hex: string) => void;
  onGradient?: (gradient: GradientSpec) => void;
  showEditor?: boolean;
  collapsibleEditor?: boolean;
  selected?: boolean;
  onEnter?: () => void;
  onLeave?: () => void;
}

export default function FillRow({ label, fill, allowNone, onType, onColor, onGradient, showEditor, collapsibleEditor, selected, onEnter, onLeave }: FillRowProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const type: string = fill ? fill.type : 'none';
  const c1 = fill?.c1 ?? '#cccccc';
  const c2 = fill?.c2 ?? '#ffffff';
  const isGrad = type === 'linear' || type === 'radial';
  const displayType = isGrad ? 'gradient' : type;
  const setDisplayType = (next: string) => {
    onType(next === 'gradient' ? (isGrad ? type as 'linear' | 'radial' : 'linear') : next as 'none' | 'solid');
  };

  // Background fills are regular panel controls, so they use exactly the same
  // primitives and metrics as the 2D canvas panel. Model parts use the compact
  // list below because several material groups can be visible at once.
  if (!allowNone) {
    return (
      <div className="mc-fill-block mc-fill-system">
        <div className="ctl-row">
          <label className="ctl-label">{label}</label>
          <div className="ctl-input">
            <div className="segmented">
              <button type="button" className={`seg ${type === 'solid' ? 'active' : ''}`} onClick={() => setDisplayType('solid')}>Solid</button>
              <button type="button" className={`seg ${isGrad ? 'active' : ''}`} onClick={() => setDisplayType('gradient')}>Gradient</button>
            </div>
          </div>
        </div>
        {type === 'solid' && <ControlRow def={solidColorDef} value={c1} onChange={(hex) => onColor('c1', hex)} />}
        {isGrad && showEditor && fill && onGradient && (
          <GradientEditor value={gradientFromFill(fill)} onChange={onGradient} />
        )}
      </div>
    );
  }

  return (
    <div className={`mc-fill-block ${selected ? 'sel' : ''}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="mc-color-row">
        <span className="mc-color-name" title={label}>{label}</span>
        <select className="mc-fill-type" value={displayType} onChange={(e) => setDisplayType(e.target.value)}>
          {allowNone && <option value="none">Original</option>}
          <option value="solid">Solid</option>
          <option value="gradient">Gradient</option>
        </select>
        {type !== 'none' && (!isGrad || !showEditor) && (
          <input type="color" value={c1} title={isGrad ? 'Start / centre' : 'Color'} onChange={(e) => onColor('c1', e.target.value)} />
        )}
        {isGrad && !showEditor && (
          <input type="color" value={c2} title="End / edge" onChange={(e) => onColor('c2', e.target.value)} />
        )}
        {isGrad && showEditor && collapsibleEditor && fill && (
          <button
            type="button"
            className={`mc-gradient-preview ${editorOpen ? 'active' : ''}`}
            title={editorOpen ? 'Close gradient editor' : 'Edit gradient'}
            aria-label={`${editorOpen ? 'Close' : 'Edit'} ${label} gradient`}
            style={{ background: gradientCss(gradientFromFill(fill)) }}
            onClick={() => setEditorOpen((open) => !open)}
          />
        )}
      </div>
      {isGrad && showEditor && fill && onGradient && (!collapsibleEditor || editorOpen) && (
        <GradientEditor value={gradientFromFill(fill)} onChange={onGradient} showMapping={allowNone} />
      )}
    </div>
  );
}
