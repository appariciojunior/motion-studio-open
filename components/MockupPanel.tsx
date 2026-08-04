'use client';

import { use3DStore } from '@/store/use3DStore';
import { DEVICES, findDevice, selectDevice } from '@/three3d/devices';

// Left column in Mockup mode — the device library, mirrored from Arqé's own
// device-lab: pick a real device mesh (iPhone, MacBook, iPad, displays…),
// then its real finish colours. Picking a finish just drives the same
// Material controls in the right panel (Effect3DControls → "color" /
// "useModelColor") that any other mockup color choice does — same sliders,
// same mechanism, just pre-filled with the device's own finish presets.
export default function MockupPanel() {
  const modelUrl = use3DStore((s) => s.model.url);
  const setParam = use3DStore((s) => s.setParam);
  const activeDevice = findDevice(modelUrl);

  const selectFinish = (hex: string) => {
    setParam('mockup', 'useModelColor', 'Off');
    setParam('mockup', 'color', hex);
  };

  return (
    <section className="card templates">
      <div className="tpl-head">
        <div className="tpl-head-row">
          <div className="tabs">
            <button className="tab tab-beta active">
              Mockup
              <span className="beta-tag">BETA</span>
            </button>
          </div>
        </div>
        <p className="beta-note">Real device meshes — pose, colour and light the shot on the right.</p>
      </div>
      <div className="tpl-list">
        {DEVICES.map((d) => (
          <button
            key={d.key}
            className={`tpl-item ${activeDevice?.key === d.key ? 'active' : ''}`}
            onClick={() => selectDevice(d.key)}
          >
            <span className="tpl-name">{d.label}</span>
          </button>
        ))}
      </div>

      {activeDevice && (
        <div className="section-body mc-colors" style={{ paddingTop: 0 }}>
          <div className="mc-field-label">Finish</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeDevice.finishes.map((f) => (
              <button
                key={f.key}
                title={f.label}
                onClick={() => selectFinish(f.hex)}
                style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: f.hex, border: '1px solid rgba(128,128,128,0.35)',
                  cursor: 'pointer', padding: 0,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
