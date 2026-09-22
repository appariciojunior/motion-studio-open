import type { DeviceDef } from './devices';

// ── Web device library (MVP) ─────────────────────────────────────────────────
// A SEPARATE registry from three3d/devices.ts, on purpose: the Web section's
// new flow (pick a device → animate it → export vanilla HTML/CSS/JS someone
// else's page can drop in) needs its own model files, isolated from Mockup's,
// so optimizing/re-exporting them for that flow can never regress Mockup.
//
// public/3d/web-devices/*.glb are plain duplicates of the Mockup source
// meshes for now (see the audit: neither is web-weight yet — iphone17pro is
// 3.4MB / 76k tris, ipadpro is 4.3MB / 51k tris, no Draco/meshopt, no
// decimation). Compression happens on THESE copies once the export flow
// itself is proven, never on the Mockup originals.
export const WEB_DEVICES: DeviceDef[] = [
  {
    key: 'iphone17pro', label: 'iPhone 17 Pro', modelUrl: '/3d/web-devices/iphone17pro.glb', fitHeight: 2.077,
    screenAspect: 0.462, screenCornerFrac: 0.151, slot: 'phone', screenPx: [1206, 2622],
    finishes: [
      { key: 'cosmic', label: 'Cosmic Orange', hex: '#db6018' },
      { key: 'silver', label: 'Silver', hex: '#d9dadc' },
      { key: 'blue', label: 'Deep Blue', hex: '#2c3a4f' },
    ],
  },
  {
    key: 'ipadpro', label: 'iPad Pro', modelUrl: '/3d/web-devices/ipadpro.glb', fitHeight: 1.7,
    screenAspect: 1.33, screenCornerFrac: 0.014, screenTextureTranspose: 'anti', slot: 'tablet', screenPx: [2752, 2064],
    finishes: [
      { key: 'silver', label: 'Silver', hex: '#c6c7c8' },
      { key: 'spaceblack', label: 'Space Black', hex: '#565457' },
    ],
  },
];

export function findWebDevice(modelUrl: string | null | undefined): DeviceDef | undefined {
  return WEB_DEVICES.find((d) => d.modelUrl === modelUrl);
}
