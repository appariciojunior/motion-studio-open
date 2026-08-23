'use client';

import React, { useEffect, useRef, useState } from 'react';
import { saveThreeD } from '@/lib/three3dPersist';
import { use3DStore, defaultModelFor } from '@/store/use3DStore';
import { DEVICES, findDevice, selectDevice } from '@/three3d/devices';
import { MOCKUP_ANIMATIONS } from '@/three3d/animations';
import { MockupAnimThumb } from './MockupThumb';
import { MockupIcon } from './EditorIcons';

const Chevron = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Left column in Mockup mode — accordion list of devices. Clicking a device
// selects it and expands its panel showing the real 3D thumb, finish swatches,
// and animation preset cards. Same accordion pattern as TemplatesCard.
export default function MockupPanel() {
  const modelUrl = use3DStore((s) => (s.models[s.effectId] ?? defaultModelFor(s.effectId)).url);
  const mockupAnimation = use3DStore((s) => s.mockupAnimation || 'static');
  const setMockupAnimation = use3DStore((s) => s.setMockupAnimation);

  const activeDevice = findDevice(modelUrl);
  const [openDevice, setOpenDevice] = useState<string | null>(activeDevice?.key ?? null);

  // Confirmation is transient rather than a permanent "saved" state: the studio
  // becomes dirty again on the very next control the user touches, and a label
  // that stayed on "Saved" would be lying by the second click.
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  const onSave = () => {
    if (!saveThreeD()) return; // no open project, or storage refused the write
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1600);
  };

  const handleDeviceClick = (key: string) => {
    if (openDevice === key) {
      setOpenDevice(null);
    } else {
      setOpenDevice(key);
      selectDevice(key);
    }
  };

  return (
    <section className="card templates">
      <div className="tpl-head">
        <div className="tpl-head-row">
          <div className="tabs">
            <button className="tab active"><MockupIcon size={14} />Devices</button>
          </div>
        </div>
        <p className="beta-note">
          Real device meshes — select a device to pose, colour and animate it.
        </p>
      </div>

      <div className="tpl-list">
        {DEVICES.map((d) => {
          const isActive = activeDevice?.key === d.key;
          const isOpen = openDevice === d.key;
          const panelId = `mockup-device-${d.key}`;
          return (
            <div key={d.key} className={`tpl-accordion ${isOpen ? 'open' : ''}`}>
              <button
                className={`tpl-item ${isActive || isOpen ? 'active' : ''}`}
                onClick={() => handleDeviceClick(d.key)}
                aria-expanded={isOpen}
                aria-controls={panelId}
              >
                <span className="tpl-name">{d.label}</span>
                <span className="tpl-accordion-chevron"><Chevron /></span>
              </button>
              {isOpen && (
                <div id={panelId} className="tpl-grid-accordion">
                  {/* ── Animation presets grid ── */}
                  <div className="tpl-grid">
                    {MOCKUP_ANIMATIONS.map((anim) => (
                      <button
                        key={anim.key}
                        className={`tpl-card ${mockupAnimation === anim.key ? 'active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setMockupAnimation(anim.key); }}
                      >
                        <MockupAnimThumb animKey={anim.key} deviceKey={d.key} />
                        <span className="tpl-card-label">{anim.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Saving the studio is explicit, the same shape as "Save as custom" in
          the templates panel. The 2D scene autosaves because it is the timeline
          being continuously edited; a mockup is arranged and then kept, and an
          autosave meant a stray drag of the model quietly became the project's
          saved state. */}
      <div className="tpl-foot">
        <button className="btn full" onClick={onSave} disabled={saved}>
          {saved ? 'Saved' : 'Save mockup to project'}
        </button>
      </div>
    </section>
  );
}
