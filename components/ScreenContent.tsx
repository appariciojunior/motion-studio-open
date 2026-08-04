'use client';

import { useRef } from 'react';
import { use3DStore } from '@/store/use3DStore';
import { findDevice } from '@/three3d/devices';

// Right column, Mockup mode only — upload an image or video onto the active
// device's own "Screen" mesh (cover-fit + real corner radius, handled in
// three3d/mockup.ts). Only shown for a recognised bundled device — a custom
// uploaded .glb has no known "Screen" mesh to composite onto.
export default function ScreenContent() {
  const modelUrl = use3DStore((s) => s.model.url);
  const screenMedia = use3DStore((s) => s.screenMedia);
  const setScreenMedia = use3DStore((s) => s.setScreenMedia);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!findDevice(modelUrl)) return null;

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    setScreenMedia({ url, kind: f.type.startsWith('video/') ? 'video' : 'image' });
  };

  return (
    <>
      <div className="section-head"><span className="eyebrow">Screen Content</span></div>
      <div className="section-body mc-body">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button className="btn full" onClick={() => fileRef.current?.click()}>
          {screenMedia ? `↑ Replace ${screenMedia.kind}…` : 'Upload image or video…'}
        </button>
        {screenMedia && (
          <button className="mc-reset-model" onClick={() => setScreenMedia(null)}>Use default screen</button>
        )}
      </div>
    </>
  );
}
