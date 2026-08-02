'use client';

import { useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSceneStore, type ActiveEffect } from '@/store/useSceneStore';
import { effectList, getEffect, effectDefaults } from '@/effects';
import { ControlRow } from './Controls';
import { useMobileInteractions } from './MobileInteractions';

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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/></svg>
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

export default function EffectsPanel() {
  const mobile = useMobileInteractions();
  const effects = useSceneStore((s) => s.effects);
  const addEffect = useSceneStore((s) => s.addEffect);
  const removeEffect = useSceneStore((s) => s.removeEffect);
  const toggleEffect = useSceneStore((s) => s.toggleEffect);
  const reorderEffects = useSceneStore((s) => s.reorderEffects);
  const setEffectValue = useSceneStore((s) => s.setEffectValue);
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
          <button className="btn" onClick={() => pick && addEffect(pick, effectDefaults(pick))}>Add</button>
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
            <div
              key={e.instanceId}
              className={`effect-card ${e.enabled ? '' : 'disabled'}`}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={() => { if (dragIdx !== null && dragIdx !== i) reorderEffects(dragIdx, i); setDragIdx(null); }}
            >
              <div className="effect-card-head">
                <span className="drag-grip">⣿</span>
                <span className="effect-title">{def.meta.name}</span>
                <button className="icon-btn" onClick={() => toggleEffect(e.instanceId)}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" strokeWidth="1.3"/>
                    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
                    {!e.enabled && <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>}
                  </svg>
                </button>
                <button className="icon-btn" onClick={() => removeEffect(e.instanceId)}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                </button>
              </div>
              <div className="effect-card-body">
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
