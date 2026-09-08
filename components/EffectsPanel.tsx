'use client';

import { useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSceneStore, type ActiveEffect } from '@/store/useSceneStore';
import type { EffectScope } from '@/lib/types';
import { effectList, getEffect, effectDefaults } from '@/effects';
import { ControlRow } from './Controls';
import { useMobileInteractions } from './MobileInteractions';
import { CloseIcon, EyeIcon, EyeOffIcon } from './EditorIcons';

function MobileEffectCard({
  effect,
  onToggle,
  onRemove,
  onValue,
}: {
  effect: ActiveEffect;
  onToggle: () => void;
  onRemove: () => void;
  onValue: (key: string, value: unknown) => void;
}) {
  const def = getEffect(effect.effectId);
  const [confirming, setConfirming] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: effect.instanceId });
  if (!def) return null;
  return (
    <div ref={setNodeRef} className={`effect-card mobile-effect-card ${effect.enabled ? '' : 'disabled'} ${isDragging ? 'is-dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <div className="effect-card-head">
        <button className="mobile-effect-grip" aria-label={`Reorder ${def.meta.name}`} {...attributes} {...listeners}>⠿</button>
        <span className="effect-title">{def.meta.name}</span>
        <button className="icon-btn" aria-label={effect.enabled ? `Disable ${def.meta.name}` : `Enable ${def.meta.name}`} onClick={onToggle}>
          {effect.enabled ? <EyeIcon size={16}/> : <EyeOffIcon size={16}/>}
        </button>
        <button className={`icon-btn ${confirming ? 'danger' : ''}`} aria-label={confirming ? `Confirm remove ${def.meta.name}` : `Remove ${def.meta.name}`} onClick={() => confirming ? onRemove() : setConfirming(true)} onBlur={() => setConfirming(false)}>
          {confirming ? <span className="mobile-remove-confirm">Remove?</span> : <span aria-hidden="true">×</span>}
        </button>
      </div>
      <div className="effect-card-body">
        {def.controls.map((control) => <ControlRow key={control.key} def={control} value={effect.values[control.key]} onChange={(value) => onValue(control.key, value)} />)}
      </div>
    </div>
  );
}

// Onde o efeito age. Uma linha so, na mesma forma das outras do card, para nao
// virar um controle de segunda classe: e a diferenca entre um Wave que ondula
// os cards e um que arrasta o fundo junto.
function ScopeRow({
  scope,
  tracks,
  onChange,
}: {
  scope: EffectScope;
  tracks: { id: string; name?: string }[];
  onChange: (scope: EffectScope) => void;
}) {
  return (
    <div className="ctl-row effect-scope-row">
      <span className="ctl-label">Applies to</span>
      <select
        className="field"
        value={scope}
        onChange={(ev) => onChange(ev.target.value as EffectScope)}
      >
        <option value="scene">Whole scene</option>
        <option value="artwork">Cards only</option>
        {tracks.map((t, i) => (
          <option key={t.id} value={`track:${t.id}`}>{t.name || `Layer ${i + 1}`}</option>
        ))}
      </select>
    </div>
  );
}

export default function EffectsPanel() {
  const mobile = useMobileInteractions();
  const effects = useSceneStore((s) => s.effects);
  const addEffect = useSceneStore((s) => s.addEffect);
  const removeEffect = useSceneStore((s) => s.removeEffect);
  const toggleEffect = useSceneStore((s) => s.toggleEffect);
  const reorderEffects = useSceneStore((s) => s.reorderEffects);
  const setEffectValue = useSceneStore((s) => s.setEffectValue);
  const setEffectScope = useSceneStore((s) => s.setEffectScope);
  const tracks = useSceneStore((s) => s.tracks);
  const [pick, setPick] = useState(effectList[0]?.meta.id ?? '');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const finishMobileDrag = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = effects.findIndex((effect) => effect.instanceId === active.id);
    const to = effects.findIndex((effect) => effect.instanceId === over.id);
    if (from >= 0 && to >= 0) reorderEffects(from, to);
  };

  return (
    <>
      <div className="section-head"><span className="eyebrow">Effects</span></div>
      <div className="section-body">
        <div className="effect-add">
          <select className="field" value={pick} onChange={(e) => setPick(e.target.value)}>
            {effectList.map((e) => <option key={e.meta.id} value={e.meta.id}>{e.meta.name}</option>)}
          </select>
          <button className="btn" onClick={() => pick && addEffect(pick, effectDefaults(pick), getEffect(pick)?.meta.defaultScope)}>Add</button>
        </div>

        {mobile ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finishMobileDrag}>
            <SortableContext items={effects.map((effect) => effect.instanceId)} strategy={verticalListSortingStrategy}>
              <div className="mobile-effects-list">
                {effects.map((effect) => (
                  <MobileEffectCard
                    key={effect.instanceId}
                    effect={effect}
                    onToggle={() => toggleEffect(effect.instanceId)}
                    onRemove={() => removeEffect(effect.instanceId)}
                    onValue={(key, value) => setEffectValue(effect.instanceId, key, value)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : effects.map((e, i) => {
          const def = getEffect(e.effectId);
          if (!def) return null;
          return (
            // `draggable` vive no GRIP, não no card. No card, qualquer arrasto
            // que começasse dentro dele — inclusive num slider — iniciava o
            // drag HTML5 e a reordenação roubava o gesto: era impossível
            // arrastar um controle de efeito. O card segue sendo o ALVO do
            // soltar, que é o que onDragOver/onDrop fazem.
            <div
              key={e.instanceId}
              className={`effect-card ${e.enabled ? '' : 'disabled'}`}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={() => { if (dragIdx !== null && dragIdx !== i) reorderEffects(dragIdx, i); setDragIdx(null); }}
            >
              <div className="effect-card-head">
                <span
                  className="drag-grip"
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragEnd={() => setDragIdx(null)}
                  role="button"
                  aria-label={`Reorder ${def.meta.name}`}
                >⣿</span>
                <span className="effect-title">{def.meta.name}</span>
                <button className="icon-btn" onClick={() => toggleEffect(e.instanceId)}>
                  {e.enabled ? <EyeIcon size={12}/> : <EyeOffIcon size={12}/>}
                </button>
                <button className="icon-btn" onClick={() => removeEffect(e.instanceId)}>
                  <CloseIcon size={12}/>
                </button>
              </div>
              <div className="effect-card-body">
                <ScopeRow
                  scope={e.scope ?? 'scene'}
                  tracks={tracks}
                  onChange={(scope) => setEffectScope(e.instanceId, scope)}
                />
                {def.controls.map((c) => (
                  <ControlRow key={c.key} def={c} value={e.values[c.key]} onChange={(val) => setEffectValue(e.instanceId, c.key, val)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
