'use client';

import { getThreeEffect, threeEffects } from '@/three3d';
import { use3DStore } from '@/store/use3DStore';
import { ControlRow } from './Controls';

// Right column in 3D mode — renders the active 3D effect's control groups
// (Characters, Intensity, Lights, Tint, Post-Processing, …). Writes live into
// use3DStore; the stage + renderer read the values every frame.
export default function Effect3DControls({ effectId: forcedEffectId }: { effectId?: string } = {}) {
  const storeEffectId = use3DStore((s) => s.effectId);
  const def = getThreeEffect(forcedEffectId ?? storeEffectId) ?? threeEffects[0];   // guard stale ids
  const effectId = def.id;
  const params = use3DStore((s) => s.params[effectId]) ?? {};
  const setParam = use3DStore((s) => s.setParam);
  const resetEffectSettings = use3DStore((s) => s.resetEffectSettings);
  const mockupAnimation = use3DStore((s) => s.mockupAnimation || 'static');
  const mockupSpeed = use3DStore((s) => s.mockupSpeed || 1);
  const setMockupSpeed = use3DStore((s) => s.setMockupSpeed);
  const mockupEasing = use3DStore((s) => s.mockupEasing);
  const setMockupEasing = use3DStore((s) => s.setMockupEasing);
  const motionStrength = use3DStore((s) => s.mockupMotionStrength);
  const setMotionStrength = use3DStore((s) => s.setMockupMotionStrength);

  return (
    <>
      <div className="section-head">
        <span className="eyebrow">Scene</span>
        <span className="badge" style={{ textTransform: 'capitalize' }}>{mockupAnimation.replace(/_/g, ' ')}</span>
      </div>
      <div className="section-body e3d-controls">
        <div className="e3d-group">
          <div className="e3d-group-title">Camera Motion</div>
          <div className="ctl-row">
            <label className="ctl-label">Speed</label>
            <div className="pills">
              {[0.5, 1, 1.5, 2].map((sp) => (
                <button key={sp} className={`pill ${mockupSpeed === sp ? 'active' : ''}`} onClick={() => setMockupSpeed(sp)}>{sp}x</button>
              ))}
            </div>
          </div>
          <div className="ctl-row">
            <label className="ctl-label">Motion</label>
            <div className="pills">
              {[0.5, 0.75, 1, 1.25].map((amount) => (
                <button key={amount} className={`pill ${motionStrength === amount ? 'active' : ''}`} onClick={() => setMotionStrength(amount)}>
                  {Math.round(amount * 100)}%
                </button>
              ))}
            </div>
          </div>
          <div className="ctl-row">
            <label className="ctl-label">Curve</label>
            <div className="pills">
              {([['preset', 'Natural'], ['smooth', 'Smooth'], ['linear', 'Linear']] as const).map(([value, label]) => (
                <button key={value} className={`pill ${mockupEasing === value ? 'active' : ''}`} onClick={() => setMockupEasing(value)}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="hairline" />
      <div className="section-head"><span className="eyebrow">{def.name} Controls</span></div>
      <div className="section-body e3d-controls">
        {def.groups.map((g) => (
          <div key={g.title} className="e3d-group">
            <div className="e3d-group-title">{g.title}</div>
            {g.controls.map((c) => (
              <ControlRow
                key={c.key}
                def={c}
                value={params[c.key] ?? c.default}
                onChange={(v) => setParam(effectId, c.key, v)}
              />
            ))}
          </div>
        ))}
        <button
          className="web-auto-btn"
          onClick={() => resetEffectSettings(effectId)}
          style={{ width: '100%', marginTop: 8 }}
        >
          Reset all values
        </button>
      </div>
    </>
  );
}
