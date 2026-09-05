'use client';

import { useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSceneStore, type AssetItem } from '@/store/useSceneStore';
import { getTemplate, layerCountFor } from '@/templates';
import { CARD_SHAPES, cardAspectFor, parseCardShape } from '@/lib/crop';
import { isVideoSource } from '@/lib/videoTexture';
import { useMobileInteractions } from './MobileInteractions';
import { DimInput } from './CanvasPanel';
import { AddIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, CropIcon, EyeIcon as Eye, EyeOffIcon, GripIcon } from './EditorIcons';

const SHAPE_OPTIONS = ['auto', ...Object.keys(CARD_SHAPES)];
// The pair the W×H fields open on. It is seeded from whatever ratio the scene
// is already showing, written with its long side at 1000 so the numbers read
// as pixels rather than as a fraction — 16:9 opens as 1000 × 563, 4:5 as
// 800 × 1000. The rounding is not free: 1000 × 563 is 1.7762 where 16:9 is
// 1.7778, so switching a preset to W×H shifts the crop by 0.09% — under a
// tenth of a pixel on a 1000px card, and the cost of fields that read as
// pixels instead of opening on "16" and "9".
const PIXEL_SEED_LONG_EDGE = 1000;
const pixelPairFor = (ratio: number): [number, number] => (ratio >= 1
  ? [PIXEL_SEED_LONG_EDGE, Math.round(PIXEL_SEED_LONG_EDGE / ratio)]
  : [Math.round(PIXEL_SEED_LONG_EDGE * ratio), PIXEL_SEED_LONG_EDGE]);

const AssetEyeIcon = ({ off }: { off?: boolean }) => (off ? <EyeOffIcon size={12}/> : <Eye size={12}/>);

function MobileAssetRow({
  asset,
  index,
  open,
  onOpen,
  onReplace,
  onCrop,
  onToggle,
  onRemove,
}: {
  asset: AssetItem;
  index: number;
  open: boolean;
  onOpen: (open: boolean) => void;
  onReplace: () => void;
  onCrop: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: asset.id });
  const [offset, setOffset] = useState(open ? -168 : 0);
  const swipe = useRef<{ x: number; y: number; start: number; horizontal: boolean } | null>(null);
  const shownOffset = swipe.current ? offset : (open ? -168 : 0);

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button,[data-drag-handle]')) return;
    swipe.current = { x: event.clientX, y: event.clientY, start: open ? -168 : 0, horizontal: false };
    setOffset(open ? -168 : 0);
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = swipe.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.horizontal && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      state.horizontal = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (state.horizontal) setOffset(Math.max(-168, Math.min(0, state.start + dx)));
  };
  const pointerUp = () => {
    const shouldOpen = offset < -64;
    swipe.current = null;
    onOpen(shouldOpen);
    setOffset(shouldOpen ? -168 : 0);
  };

  return (
    <li
      ref={setNodeRef}
      className={`mobile-asset-row ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="mobile-asset-actions" aria-hidden={!open}>
        <button onClick={() => { onCrop(); onOpen(false); }}><CropIcon size={12}/><span>Crop</span></button>
        <button onClick={() => { onToggle(); onOpen(false); }}><AssetEyeIcon off={!asset.visible} /><span>{asset.visible ? 'Hide' : 'Show'}</span></button>
        <button className="danger" onClick={() => { onRemove(); onOpen(false); }}><CloseIcon size={12}/><span>Remove</span></button>
      </div>
      <div
        className="mobile-asset-face"
        style={{ transform: `translateX(${shownOffset}px)` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => { swipe.current = null; setOffset(open ? -168 : 0); }}
      >
        <span className="asset-idx">{index + 1}</span>
        {!asset.url ? (
          <span className="asset-thumb asset-thumb-empty" onClick={onReplace}>+</span>
        ) : isVideoSource(asset.url, asset.kind) ? (
          <video className="asset-thumb" src={asset.url} muted playsInline preload="metadata" onClick={onReplace} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="asset-thumb" src={asset.url} alt={asset.name} onClick={onReplace} />
        )}
        <span className="asset-name" title={asset.name}>{asset.name}</span>
        <button className="icon-btn mobile-crop-open" data-crop-asset={asset.id} aria-label={`Adjust ${asset.name}`} disabled={!asset.url} onClick={onCrop}><CropIcon size={16}/></button>
        <button
          className="mobile-drag-handle"
          data-drag-handle
          aria-label={`Reorder ${asset.name}`}
          {...attributes}
          {...listeners}
        >
          <GripIcon size={18}/>
        </button>
      </div>
    </li>
  );
}

export default function AssetsPanel({ onEditAsset }: { onEditAsset: (id: string) => void }) {
  const mobile = useMobileInteractions();
  const assets = useSceneStore((s) => s.assets);
  // How many card slots the active template will actually fill — asked of the
  // template, since a lattice family derives that from the canvas rather than
  // from a control.
  const count = useSceneStore((s) => layerCountFor(s.activeTemplateId, s.values, {
    width: s.width,
    height: s.height,
    cardAspect: cardAspectFor(getTemplate(s.activeTemplateId).meta, s.width, s.height, s.cardShape),
  }));
  const repeat = useSceneStore((s) => getTemplate(s.activeTemplateId).meta.repeatAssets === true);
  const derivesCount = useSceneStore((s) => typeof getTemplate(s.activeTemplateId).layerCount === 'function');
  const addAssets = useSceneStore((s) => s.addAssets);
  const replaceAssetAt = useSceneStore((s) => s.replaceAssetAt);
  const removeAsset = useSceneStore((s) => s.removeAsset);
  const toggleAsset = useSceneStore((s) => s.toggleAsset);
  const reorderAssets = useSceneStore((s) => s.reorderAssets);
  const clearAssets = useSceneStore((s) => s.clearAssets);
  const cardShape = useSceneStore((s) => s.cardShape);
  const setCardShape = useSceneStore((s) => s.setCardShape);
  // Custom mode cannot be read off the value alone: type 4 × 5 into the
  // fields and the string becomes "4:5", which IS a preset key — the fields
  // would vanish under the user mid-edit. So the mode is held locally, and a
  // stored ratio that no preset claims re-opens it on its own. A project saved
  // on a shape that happens to equal a preset re-opens showing that preset,
  // which crops identically, so nothing is lost.
  // What the cards are actually cropped to right now, whatever produced it —
  // the seed for the pixel fields when the scene is on 'auto' and there is no
  // preset ratio to read.
  const resolvedAspect = useSceneStore((s) => cardAspectFor(
    getTemplate(s.activeTemplateId).meta, s.width, s.height, s.cardShape,
  ));
  const [wantsCustomShape, setWantsCustomShape] = useState(false);
  const storedIsCustom = !CARD_SHAPES[cardShape] && parseCardShape(cardShape) !== null;
  const customShape = storedIsCustom || wantsCustomShape;
  // A pair the user typed shows back verbatim; a preset or 'auto' is rewritten
  // as pixels at the same ratio, so the fields never open on "16" and "9".
  const [customW, customH] = storedIsCustom
    ? (cardShape.split(':').map(Number) as [number, number])
    : pixelPairFor(CARD_SHAPES[cardShape] ?? resolvedAspect);
  const videoEnd = useSceneStore((s) => s.videoEnd);
  const setVideoEnd = useSceneStore((s) => s.setVideoEnd);
  const hasVideo = useSceneStore((s) => s.assets.some((a) => a.origin !== 'demo' && isVideoSource(a.url, a.kind)));
  const fullBleed = useSceneStore((s) => getTemplate(s.activeTemplateId).meta.cardAspect === 'canvas');
  const inputRef = useRef<HTMLInputElement>(null);
  const slotInputRef = useRef<HTMLInputElement>(null);
  const slotTarget = useRef<number>(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // Pointer-based row drag (HTML5 DnD is unreliable: img elements hijack the
  // drag and re-renders can cancel it). Drag arms after a 4px move so plain
  // clicks (replace / hide / remove) keep working.
  const drag = useRef<{ idx: number; startY: number; active: boolean } | null>(null);

  const rowIndexAt = (x: number, y: number): number | null => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot-idx]');
    return row ? Number(row.dataset.slotIdx) : null;
  };

  const onRowPointerDown = (e: React.PointerEvent<HTMLLIElement>, i: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return; // eye / remove clicks
    e.preventDefault(); // stop native image drag + text selection
    drag.current = { idx: i, startY: e.clientY, active: false };
  };

  const onRowPointerMove = (e: React.PointerEvent<HTMLLIElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.active) {
      if (Math.abs(e.clientY - d.startY) < 4) return;
      d.active = true;
      setDragIdx(d.idx);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const over = rowIndexAt(e.clientX, e.clientY);
    setOverIdx(over !== null && over !== d.idx ? over : null);
  };

  const onRowPointerUp = (e: React.PointerEvent<HTMLLIElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    const over = rowIndexAt(e.clientX, e.clientY);
    if (over !== null && over !== d.idx) {
      // dropping past the filled range (an empty slot) moves the card to the end
      reorderAssets(d.idx, Math.min(over, assets.length - 1));
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  const onRowPointerCancel = () => {
    drag.current = null;
    setDragIdx(null);
    setOverIdx(null);
  };

  const ingest = (files: FileList | File[]) => {
    const items = Array.from(files)
      .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
      .map((f) => ({
        name: f.name,
        url: URL.createObjectURL(f),
        kind: (f.type.startsWith('video/') ? 'video' : 'image') as 'image' | 'video',
        blob: f, // stashed in IndexedDB by the store so the upload survives a refresh
      }));
    if (items.length) addAssets(items);
  };

  const openSlotPicker = (index: number) => {
    slotTarget.current = index;
    slotInputRef.current?.click();
  };

  // Keep every uploaded slot visible, even when the active template renders
  // fewer layers. The old repeat-mode cap (`min(count, ...)`) hid uploads as
  // soon as a template had a low Count (often one), which also made those
  // hidden cards impossible to remove. Empty demo entries deliberately stay
  // in the list as holes so replacement keeps each card's position.
  const realAssetCount = assets.filter((asset) => asset.origin !== 'demo').length;
  // Always retain the template's complete card grid. Repeat-mode templates
  // still render the same source more than once, but must not collapse the
  // editor to a single row. Always retain one empty row after the current
  // media, so standard/model images never hide where to add another one.
  const rows = Math.max(count, assets.length + 1);
  const slots = Array.from({ length: rows }, (_, i) => assets[i] ?? null);
  const filled = slots.filter(Boolean).length;
  const sortableEntries = slots
    .map((asset, index) => asset ? { asset, index } : null)
    .filter((entry): entry is { asset: AssetItem; index: number } => entry !== null);

  const finishMobileDrag = ({ active, over }: DragEndEvent) => {
    setActiveDragId(null);
    if (!over || active.id === over.id) return;
    const from = sortableEntries.find((entry) => entry.asset.id === active.id)?.index;
    const to = sortableEntries.find((entry) => entry.asset.id === over.id)?.index;
    if (from !== undefined && to !== undefined) reorderAssets(from, to);
  };

  return (
    <>
      <div className="section-head">
        <span className="eyebrow">Assets</span>
        <span className="badge">{filled}/{count}</span>
      </div>
      <div className="section-body">
        <div
          className={`dropzone ${dropActive ? 'over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(e) => { e.preventDefault(); setDropActive(false); ingest(e.dataTransfer.files); }}
        >
          {repeat ? 'Drop images or videos — a few are enough, they repeat' : `Drop images or videos to fill ${count} ${count === 1 ? 'slot' : 'slots'}`}
          <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => e.target.files && ingest(e.target.files)} />
        </div>

        <div className="asset-meta">
          <span>
            {repeat
              ? `${realAssetCount || 'your'} image${realAssetCount === 1 ? '' : 's'} repeat across ${count} layers`
              // "linked to Count" is only true while a Count control exists. The
              // lattice families derive their layer total from Plane Size, Gap
              // and the canvas instead, so the copy has to follow.
              : `${count} ${count === 1 ? 'slot' : 'slots'} · ${derivesCount ? 'set by the canvas' : 'linked to Count'}`}
          </span>
          <span className="spacer" />
          {realAssetCount > 0 && <button className="link-btn" onClick={clearAssets}>Clear all</button>}
        </div>

        {/* card shape — the cover-crop aspect every card adapts to */}
        <div className="asset-meta">
          <span>Card shape</span>
        </div>
        {fullBleed ? (
          <div className="asset-meta"><span className="asset-name-empty">Full-bleed template — cards match the canvas</span></div>
        ) : (
          <>
            <div className="pills shape-pills card-shape-pills">
              {SHAPE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  className={`pill ${!customShape && cardShape === opt ? 'active' : ''}`}
                  onClick={() => { setWantsCustomShape(false); setCardShape(opt); }}
                >
                  {opt === 'auto' ? 'Auto' : opt}
                </button>
              ))}
              {/* Eight options now fill the four-column grid exactly, where
                  seven left a ragged second row. */}
              <button
                className={`pill ${customShape ? 'active' : ''}`}
                onClick={() => { setWantsCustomShape(true); setCardShape(`${customW}:${customH}`); }}
              >
                W×H
              </button>
            </div>
            {customShape && (
              <>
                {/* Labelled like the canvas custom size above it, in this
                    panel's own idiom (.asset-meta, not .ctl-label). */}
                <div className="asset-meta">
                  <span>Size px</span>
                </div>
                <div className="dim-inputs card-shape-dims">
                  <DimInput value={customW} min={1} max={4096} onCommit={(v) => setCardShape(`${v}:${customH}`)} />
                  <span className="dim-x">×</span>
                  <DimInput value={customH} min={1} max={4096} onCommit={(v) => setCardShape(`${customW}:${v}`)} />
                </div>
                {/* Says outright what the numbers can and cannot do. A card's
                    on-screen size is the template's layout decision — the
                    renderer normalizes a sprite's long edge — so what a pixel
                    pair can carry here is its ratio, and only its ratio. */}
                <div className="ctl-hint">The crop follows the ratio — 800 × 1000 and 4 × 5 are the same shape. Card size on the canvas stays the template&apos;s.</div>
              </>
            )}
          </>
        )}

        {/* when a card video is shorter than the clip: restart or freeze at the end */}
        {hasVideo && (
          <>
            <div className="asset-meta">
              <span>Video end</span>
            </div>
            <div className="pills shape-pills">
              <button className={`pill ${videoEnd === 'loop' ? 'active' : ''}`} onClick={() => setVideoEnd('loop')} title="Restart the video when it ends">
                Loop
              </button>
              <button className={`pill ${videoEnd === 'hold' ? 'active' : ''}`} onClick={() => setVideoEnd('hold')} title="Freeze on the final frame until the clip ends">
                Hold last frame
              </button>
            </div>
          </>
        )}

        {/* hidden picker for empty-slot uploads */}
        <input
          ref={slotInputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) replaceAssetAt(slotTarget.current, {
              name: f.name,
              url: URL.createObjectURL(f),
              kind: f.type.startsWith('video/') ? 'video' : 'image',
              blob: f,
            });
            e.target.value = '';
          }}
        />

        {mobile ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={({ active }) => { setSwipeOpenId(null); setActiveDragId(String(active.id)); }}
            onDragCancel={() => setActiveDragId(null)}
            onDragEnd={finishMobileDrag}
          >
            <SortableContext items={sortableEntries.map((entry) => entry.asset.id)} strategy={verticalListSortingStrategy}>
              <ul className="mobile-asset-list" onPointerDown={(event) => {
                if (!(event.target as HTMLElement).closest('.mobile-asset-row')) setSwipeOpenId(null);
              }}>
                {slots.map((asset, index) => asset ? (
                  <MobileAssetRow
                    key={asset.id}
                    asset={asset}
                    index={index}
                    open={swipeOpenId === asset.id}
                    onOpen={(open) => setSwipeOpenId(open ? asset.id : null)}
                    onReplace={() => openSlotPicker(index)}
                    onCrop={() => onEditAsset(asset.id)}
                    onToggle={() => toggleAsset(asset.id)}
                    onRemove={() => removeAsset(asset.id)}
                  />
                ) : (
                  <li key={`mobile-empty-${index}`} className="mobile-asset-empty" onClick={() => openSlotPicker(index)}>
                    <span className="asset-idx">{index + 1}</span>
                    <span className="asset-thumb asset-thumb-empty">+</span>
                    <span className="mobile-slot-copy"><strong>Slot {index + 1}</strong><small>Drop or click to add</small></span>
                  </li>
                ))}
              </ul>
            </SortableContext>
            <DragOverlay>
              {activeDragId && (() => {
                const asset = sortableEntries.find((entry) => entry.asset.id === activeDragId)?.asset;
                return asset ? <div className="mobile-asset-overlay"><span className="asset-thumb asset-thumb-empty" /><span>{asset.name}</span><GripIcon size={18}/></div> : null;
              })()}
            </DragOverlay>

          </DndContext>
        ) : (
        <ul className="asset-list">
          {slots.map((a, i) =>
            a ? (
              <li
                key={a.id}
                data-slot-idx={i}
                className={`asset-item ${dragIdx === i ? 'dragging' : ''} ${overIdx === i && dragIdx !== null && dragIdx !== i ? 'drop-target' : ''}`}
                onPointerDown={(e) => onRowPointerDown(e, i)}
                onPointerMove={onRowPointerMove}
                onPointerUp={onRowPointerUp}
                onPointerCancel={onRowPointerCancel}
              >
                <span className="asset-idx">{i + 1}</span>
                {!a.url ? (
                  // persisted upload still resolving from IndexedDB (or its bytes
                  // are gone) — show a clickable placeholder, never src="".
                  <span className="asset-thumb asset-thumb-empty" onClick={() => openSlotPicker(i)} title="Re-add file">
                    <AddIcon size={12}/>
                  </span>
                ) : isVideoSource(a.url, a.kind) ? (
                  // play only on hover — a still poster frame otherwise, so N video
                  // thumbnails don't all decode in a loop and burn CPU/GPU
                  <video
                    className="asset-thumb"
                    src={a.url}
                    muted
                    playsInline
                    loop
                    preload="metadata"
                    onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = 0.05; } catch { /* noop */ } }}
                    onMouseEnter={(e) => { e.currentTarget.play().catch(() => { /* noop */ }); }}
                    onMouseLeave={(e) => { const v = e.currentTarget; v.pause(); try { v.currentTime = 0.05; } catch { /* noop */ } }}
                    onClick={() => openSlotPicker(i)}
                    title="Replace"
                  />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img className="asset-thumb" src={a.url} alt={a.name} onClick={() => openSlotPicker(i)} title="Replace" />
                )}
                <span className="asset-name" title={a.name}>{a.name}</span>
                <span className="asset-mobile-order" aria-label={`Reorder ${a.name}`}>
                  <button
                    className="icon-btn"
                    title="Move up"
                    aria-label={`Move ${a.name} up`}
                    disabled={i === 0}
                    onClick={() => i > 0 && reorderAssets(i, i - 1)}
                  >
                    <ChevronUpIcon size={14}/>
                  </button>
                  <button
                    className="icon-btn"
                    title="Move down"
                    aria-label={`Move ${a.name} down`}
                    disabled={i >= filled - 1}
                    onClick={() => i < filled - 1 && reorderAssets(i, i + 1)}
                  >
                    <ChevronDownIcon size={14}/>
                  </button>
                </span>
                <button
                  className={`icon-btn ${a.crop && (a.crop.x !== 0.5 || a.crop.y !== 0.5 || (a.crop.zoom ?? 1) !== 1) ? 'crop-set' : ''}`}
                  data-crop-asset={a.id} title="Adjust media" aria-label={`Adjust ${a.name}`} disabled={!a.url}
                  onClick={() => onEditAsset(a.id)}
                >
                  <CropIcon size={12}/>
                </button>
                <button className={`icon-btn ${a.visible ? '' : 'off'}`} title={a.visible ? 'Hide' : 'Show'} onClick={() => toggleAsset(a.id)}>
                  <AssetEyeIcon off={!a.visible} />
                </button>
                <button className="icon-btn" title="Remove" onClick={() => removeAsset(a.id)}>
                  <CloseIcon size={12}/>
                </button>
              </li>
            ) : (
              <li
                key={`empty-${i}`}
                data-slot-idx={i}
                className={`asset-item asset-empty ${overIdx === i && dragIdx !== null ? 'drop-target' : ''}`}
                onClick={() => openSlotPicker(i)}
              >
                <span className="asset-idx">{i + 1}</span>
                <span className="asset-thumb asset-thumb-empty">
                  <AddIcon size={12}/>
                </span>
                <span className="mobile-slot-copy"><strong>Slot {i + 1}</strong><small>Drop or click to add</small></span>
              </li>
            )
          )}
        </ul>
        )}
      </div>
    </>
  );
}
