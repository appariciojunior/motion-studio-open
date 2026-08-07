'use client';

import React, { useState } from 'react';
import { use3DStore } from '@/store/use3DStore';
import { DEVICES, findDevice, selectDevice } from '@/three3d/devices';
import { MOCKUP_ANIMATIONS } from '@/three3d/animations';
import { DeviceThumb, MockupAnimThumb } from './MockupThumb';

const Chevron = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Left column in Mockup mode — accordion list of devices. Clicking a device
// selects it and expands its panel showing the real 3D thumb, finish swatches,
// and animation preset cards. Same accordion pattern as TemplatesCard.
export default function MockupPanel() {
  const modelUrl = use3DStore((s) => s.model.url);
  const mockupAnimation = use3DStore((s) => s.mockupAnimation || 'static');
  const setMockupAnimation = use3DStore((s) => s.setMockupAnimation);
  const mockupSpeed = use3DStore((s) => s.mockupSpeed || 1);
  const setMockupSpeed = use3DStore((s) => s.setMockupSpeed);

  const activeDevice = findDevice(modelUrl);
  const [openDevice, setOpenDevice] = useState<string | null>(activeDevice?.key ?? null);

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
            <button className="tab active">Devices</button>
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

                  {/* ── Speed pills ── */}
                  <div style={{ padding: '8px 4px 4px' }}>
                    <div className="ctl-row">
                      <label className="ctl-label">Speed</label>
                      <div className="pills">
                        {[0.5, 1, 1.5, 2].map((sp) => (
                          <button
                            key={sp}
                            className={`pill ${mockupSpeed === sp ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setMockupSpeed(sp); }}
                          >
                            {sp}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
