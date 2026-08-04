'use client';

import { useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSceneStore, type AssetItem } from '@/store/useSceneStore';
import { getTemplate } from '@/templates';
import { CARD_SHAPES, DEFAULT_FOCUS, type CropFocus } from '@/lib/crop';
import { isVideoSource } from '@/lib/videoTexture';
import MobileSheet from './MobileSheet';
import { useMobileInteractions } from './MobileInteractions';

const SHAPE_OPTIONS = ['auto', ...Object.keys(CARD_SHAPES)];

const EyeIcon = ({ off }: { off?: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" strokeWidth="1.3"/>
    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
    {off && <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>}
  </svg>
);

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
);

const CropIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 1.5v10.5h10.5M1.5 4H12v10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
);

// 3×3 focal-point picker: images cover-fill their card without stretching;
// the focus chooses which part survives the crop.
const FOCUS_CELLS: CropFocus[] = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y })));

function CropPopover({ asset, onClose }: { asset: AssetItem; onClose: () => void }) {
  const setAssetCrop = useSceneStore((s) => s.setAssetCrop);
  const setAllAssetCrops = useSceneStore((s) => s.setAllAssetCrops);
  const focus = asset.crop ?? DEFAULT_FOCUS;
  return (
    <>
      <div className="crop-scrim" onClick={onClose} />
      <div className="crop-pop" onPointerDown={(e) => e.stopPropagation()}>
        <span className="crop-pop-title">Crop focus</span>
        <div className="crop-grid">
          {FOCUS_CELLS.map((c) => (
            <button
              key={`${c.x}-${c.y}`}
              className={`crop-cell ${focus.x === c.x && focus.y === c.y ? 'active' : ''}`}
              title={`${['Left','Centre','Right'][c.x * 2]} / ${['Top','Middle','Bottom'][c.y * 2]}`}
              onClick={() => setAssetCrop(asset.id, c)}
            />
          ))}
        </div>
        <button className="link-btn" onClick={() => { setAllAssetCrops(focus); onClose(); }}>
          Apply to all images
        </button>
      </div>
    </>
  );
}

function MobileCropSheet({ asset, onClose }: { asset: AssetItem; onClose: () => void }) {
  const setAssetCrop = useSceneStore((s) => s.setAssetCrop);
  const setAllAssetCrops = useSceneStore((s) => s.setAllAssetCrops);
  const focus = asset.crop ?? DEFAULT_FOCUS;
  return (
    <MobileSheet title="Crop focus" onClose={onClose}>
      <div className="mobile-crop-grid">
        {FOCUS_CELLS.map((cell) => (
          <button
            key={`${cell.x}-${cell.y}`}
            className={focus.x === cell.x && focus.y === cell.y ? 'active' : ''}
            onClick={() => setAssetCrop(asset.id, cell)}
            aria-label={`${['Left', 'Centre', 'Right'][cell.x * 2]} / ${['Top', 'Middle', 'Bottom'][cell.y * 2]}`}
          />
        ))}
      </div>
      <button className="btn full" onClick={() => { setAllAssetCrops(focus); onClose(); }}>Apply to all images</button>
    </MobileSheet>
  );
}

const GripIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
    {[5, 9, 13].flatMap((y) => [7, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />))}
  </svg>
);

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
        <button onClick={() => { onCrop(); onOpen(false); }}><CropIcon /><span>Crop</span></button>
        <button onClick={() => { onToggle(); onOpen(false); }}><EyeIcon off={!asset.visible} /><span>{asset.visible ? 'Hide' : 'Show'}</span></button>
        <button className="danger" onClick={() => { onRemove(); onOpen(false); }}><XIcon /><span>Remove</span></button>
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
        <button
          className="mobile-drag-handle"
          data-drag-handle
          aria-label={`Reorder ${asset.name}`}
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </button>
      </div>
    </li>
  );
}

export default function AssetsPanel() {
  const mobile = useMobileInteractions();
  const assets = useSceneStore((s) => s.assets);
  const count = useSceneStore((s) => Math.max(1, Math.round(s.values.count ?? 1)));
  const repeat = useSceneStore((s) => getTemplate(s.activeTemplateId).meta.repeatAssets === true);
  const addAssets = useSceneStore((s) => s.addAssets);
  const replaceAssetAt = useSceneStore((s) => s.replaceAssetAt);
  const removeAsset = useSceneStore((s) => s.removeAsset);
  const toggleAsset = useSceneStore((s) => s.toggleAsset);
  const reorderAssets = useSceneStore((s) => s.reorderAssets);
  const clearAssets = useSceneStore((s) => s.clearAssets);
  const cardShape = useSceneStore((s) => s.cardShape);
  const setCardShape = useSceneStore((s) => s.setCardShape);
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
  const [cropOpenId, setCropOpenId] = useState<string | null>(null);
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

  // The list is sized by the template's `count` — one row per layer slot.
  // Repeat-mode templates cycle a small image set across many layers, so the
  // panel shows just the images plus one add-row instead of `count` slots.
  const realAssetCount = assets.filter((asset) => asset.origin !== 'demo').length;
  const rows = repeat ? Math.min(count, realAssetCount + 1) : count;
  const slots = Array.from({ length: rows }, (_, i) => assets[i] ?? null);
  const filled = slots.filter((asset) => asset && asset.origin !== 'demo').length;
  const sortableEntries = slots
    .map((asset, index) => asset && asset.origin !== 'demo' ? { asset, index } : null)
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
              : `${count} ${count === 1 ? 'slot' : 'slots'} · linked to Count`}
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
          <div className="pills shape-pills">
            {SHAPE_OPTIONS.map((opt) => (
              <button
                key={opt}
                className={`pill ${cardShape === opt ? 'active' : ''}`}
                onClick={() => setCardShape(opt)}
              >
                {opt === 'auto' ? 'Auto' : opt}
              </button>
            ))}
          </div>
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
                {slots.map((asset, index) => asset && asset.origin !== 'demo' ? (
                  <MobileAssetRow
                    key={asset.id}
                    asset={asset}
                    index={index}
                    open={swipeOpenId === asset.id}
                    onOpen={(open) => setSwipeOpenId(open ? asset.id : null)}
                    onReplace={() => openSlotPicker(index)}
                    onCrop={() => setCropOpenId(asset.id)}
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
                return asset ? <div className="mobile-asset-overlay"><span className="asset-thumb asset-thumb-empty" /><span>{asset.name}</span><GripIcon /></div> : null;
              })()}
            </DragOverlay>
            {cropOpenId && (() => {
              const asset = assets.find((item) => item.id === cropOpenId);
              return asset ? <MobileCropSheet asset={asset} onClose={() => setCropOpenId(null)} /> : null;
            })()}
          </DndContext>
        ) : (
        <ul className="asset-list">
          {slots.map((a, i) =>
            a && a.origin !== 'demo' ? (
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
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
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
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <button
                    className="icon-btn"
                    title="Move down"
                    aria-label={`Move ${a.name} down`}
                    disabled={i >= filled - 1}
                    onClick={() => i < filled - 1 && reorderAssets(i, i + 1)}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </span>
                <button
                  className={`icon-btn ${a.crop && (a.crop.x !== 0.5 || a.crop.y !== 0.5) ? 'crop-set' : ''}`}
                  title="Crop focus"
                  onClick={() => setCropOpenId(cropOpenId === a.id ? null : a.id)}
                >
                  <CropIcon />
                </button>
                <button className={`icon-btn ${a.visible ? '' : 'off'}`} title={a.visible ? 'Hide' : 'Show'} onClick={() => toggleAsset(a.id)}>
                  <EyeIcon off={!a.visible} />
                </button>
                <button className="icon-btn" title="Remove" onClick={() => removeAsset(a.id)}>
                  <XIcon />
                </button>
                {cropOpenId === a.id && <CropPopover asset={a} onClose={() => setCropOpenId(null)} />}
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
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
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
