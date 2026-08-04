import { use3DStore } from '@/store/use3DStore';

// ── Device library (Mockup mode) ────────────────────────────────────────────
// Real device meshes + finish presets, mirrored from Arqé's own device-lab
// registry (the same product this feature is modelled after) so picking a
// device and a finish here behaves the same way it does there. `fitHeight` is
// Arqé's own tuned camera-fit size for each mesh — reused verbatim so each
// device frames correctly on first load.
export interface DeviceFinish { key: string; label: string; hex: string; }

export interface DeviceDef {
  key: string;
  label: string;
  modelUrl: string;        // local copy, served from /public/3d/devices
  fitHeight: number;       // world-size the model is fitted to (see three3d/frame.ts)
  screenAspect: number;    // the "Screen" mesh's own w/h — used to cover-fit uploaded media
  screenCornerFrac: number; // corner radius as a fraction of the screen's short side
  finishes: DeviceFinish[];
}

export const DEVICES: DeviceDef[] = [
  {
    key: 'iphone17pro', label: 'iPhone 17 Pro', modelUrl: '/3d/devices/iphone17pro-clean.glb', fitHeight: 2.077,
    screenAspect: 0.462, screenCornerFrac: 0.151,
    finishes: [
      { key: 'cosmic', label: 'Cosmic Orange', hex: '#db6018' },
      { key: 'silver', label: 'Silver', hex: '#d9dadc' },
      { key: 'blue', label: 'Deep Blue', hex: '#2c3a4f' },
    ],
  },
  {
    key: 'iphoneair', label: 'iPhone Air', modelUrl: '/3d/devices/iphoneair.glb', fitHeight: 2.077,
    screenAspect: 0.46, screenCornerFrac: 0.124,
    finishes: [{ key: 'skyblue', label: 'Sky Blue', hex: '#a9c3d6' }],
  },
  {
    key: 'macbook14', label: 'MacBook Pro 14"', modelUrl: '/3d/devices/macbook14-clean.glb', fitHeight: 1.3,
    screenAspect: 1.538, screenCornerFrac: 0.0086,
    finishes: [
      { key: 'spaceblack', label: 'Space Black', hex: '#565457' },
      { key: 'silver', label: 'Silver', hex: '#c6c7c8' },
    ],
  },
  {
    key: 'ipadpro', label: 'iPad Pro', modelUrl: '/3d/devices/ipadpro.glb', fitHeight: 1.7,
    screenAspect: 1.33, screenCornerFrac: 0.014,
    finishes: [
      { key: 'silver', label: 'Silver', hex: '#c6c7c8' },
      { key: 'spaceblack', label: 'Space Black', hex: '#565457' },
    ],
  },
  {
    key: 'ipadair', label: 'iPad Air', modelUrl: '/3d/devices/ipadair.glb', fitHeight: 1.7,
    screenAspect: 1.34, screenCornerFrac: 0.007,
    finishes: [{ key: 'blue', label: 'Blue', hex: '#8f9fb5' }],
  },
  {
    key: 'displayxdr', label: 'Pro Display XDR', modelUrl: '/3d/devices/displayxdr.glb', fitHeight: 1.5,
    screenAspect: 1.778, screenCornerFrac: 0,
    finishes: [{ key: 'silver', label: 'Silver', hex: '#c6c7c8' }],
  },
  {
    key: 'studiodisplay', label: 'Studio Display', modelUrl: '/3d/devices/studiodisplay.glb', fitHeight: 1.5,
    screenAspect: 1.78, screenCornerFrac: 0.012,
    finishes: [{ key: 'silver', label: 'Silver', hex: '#d8d8da' }],
  },
];

export function findDevice(modelUrl: string | null | undefined): DeviceDef | undefined {
  return DEVICES.find((d) => d.modelUrl === modelUrl);
}

// Single source of truth for "load this device" — used by both the device
// picker (every click) and the Mockup tab's first-entry default, so the two
// paths can never drift (e.g. one resetting the model offset, the other not).
export function selectDevice(key: string): void {
  const dev = DEVICES.find((d) => d.key === key);
  if (!dev) return;
  const s = use3DStore.getState();
  s.setModelUrl(dev.modelUrl, dev.label);
  s.setModelScale(1);
  s.centerModel(0, 0);                          // device meshes are already bbox-centred
  s.setParam('mockup', 'useModelColor', 'On');   // show its real materials first
}
