'use client';

import React, { useState } from 'react';
import { use3DStore, defaultModelFor } from '@/store/use3DStore';
import { DEVICES, findDevice, selectDevice } from '@/three3d/devices';
import { MOCKUP_ANIMATIONS } from '@/three3d/animations';
import { MockupAnimThumb } from './MockupThumb';
import { ChevronRightIcon } from './EditorIcons';

const Chevron = () => <ChevronRightIcon size={12}/>;

// Left column in Mockup mode — accordion list of devices. Clicking a device
// selects it and expands its panel showing the real 3D thumb, finish swatches,
// and animation preset cards. Same accordion pattern as TemplatesCard.
export default function MockupPanel() {
  // This panel always edits Mockup, even during the render in which a project
  // switch is still settling. Reading s.effectId here could briefly point the
  // device picker at the generic 3D model slot.
  const modelUrl = use3DStore((s) => (s.models.mockup ?? defaultModelFor('mockup')).url);
  const mockupAnimation = use3DStore((s) => s.mockupAnimation || 'static');
  const setMockupAnimation = use3DStore((s) => s.setMockupAnimation);

  const activeDevice = findDevice(modelUrl);
  const [openDevice, setOpenDevice] = useState<string | null>(activeDevice?.key ?? null);

  // No save button here any more. The studio autosaves into the open project,
  // and the one place that says so — and offers "Save now" — is the project chip
  // on the stage (components/ProjectDock). A second save control in this footer,
  // scoped to only half the document, was the reason saving read as unreliable.
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
                <span className="tpl-group-count">{MOCKUP_ANIMATIONS.length}</span>
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

    </section>
  );
}
