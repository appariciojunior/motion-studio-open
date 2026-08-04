'use client';

import { threeEffects } from '@/three3d';
import { use3DStore } from '@/store/use3DStore';

// Left column in 3D mode — replaces the motion-template list. Picks the active
// 3D effect (ASCII, …). Its controls render in the right panel.
// 'mockup' has its own rail tab (IconRail 'mockup' → forces this id) and isn't
// picked from this list — filtered out so the two entry points stay distinct.
const pickableEffects = threeEffects.filter((e) => e.id !== 'mockup');

export default function Effects3DPanel() {
  const storeEffectId = use3DStore((s) => s.effectId);
  const setEffect = use3DStore((s) => s.setEffect);
  // guard stale ids (e.g. a removed effect persisted in the store)
  const effectId = pickableEffects.some((e) => e.id === storeEffectId) ? storeEffectId : pickableEffects[0].id;

  return (
    <section className="card templates">
      <div className="tpl-head">
        <div className="tpl-head-row">
          <div className="tabs">
            <button className="tab tab-beta active">
              3D Effects
              <span className="beta-tag">BETA</span>
            </button>
          </div>
        </div>
        <p className="beta-note">Work in progress — expect rough edges and bugs.</p>
      </div>
      <div className="tpl-list">
        {pickableEffects.map((e) => (
          <button
            key={e.id}
            className={`tpl-item ${effectId === e.id ? 'active' : ''}`}
            onClick={() => setEffect(e.id)}
          >
            <span className="tpl-name">{e.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
