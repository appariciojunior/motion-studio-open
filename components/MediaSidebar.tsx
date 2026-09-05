'use client';

import { useRef, useState } from 'react';
import { useSceneStore } from '@/store/useSceneStore';
import AssetsPanel from './AssetsPanel';
import CanvasPanel from './CanvasPanel';
import MediaCropEditor from './MediaCropEditor';

// Media adjustment replaces the inspector contents; the stage stays interactive.
export default function MediaSidebar({ showCanvas = false }: { showCanvas?: boolean }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const asset = useSceneStore(s => s.assets.find(a => a.id === editingId));
  const container = useRef<HTMLDivElement>(null);
  const previousScroll = useRef(0);
  const open = (id: string) => {
    const scroller = container.current?.closest('.card-scroll, .mobile-panel-scroll');
    previousScroll.current = scroller?.scrollTop ?? 0;
    if (scroller) scroller.scrollTop = 0;
    setEditingId(id);
  };
  const close = () => {
    const id = editingId;
    setEditingId(null);
    requestAnimationFrame(() => {
      const scroller = container.current?.closest('.card-scroll, .mobile-panel-scroll');
      if (scroller) scroller.scrollTop = previousScroll.current;
      const buttons = container.current?.querySelectorAll<HTMLButtonElement>('button[data-crop-asset]');
      const trigger = Array.from(buttons ?? []).find(button => button.dataset.cropAsset === id);
      trigger?.focus({ preventScroll: true });
    });
  };
  return (
    <div ref={container} className={`media-sidebar ${asset ? 'is-editing' : ''}`}>
      {asset ? <MediaCropEditor key={asset.id + asset.url} asset={asset} onClose={close} /> : <>
        {showCanvas && <><CanvasPanel /><div className="hairline" /></>}
        <AssetsPanel onEditAsset={open} />
      </>}
    </div>
  );
}
