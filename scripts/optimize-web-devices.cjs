#!/usr/bin/env node
// ============================================================
//  optimize-web-devices — regenerate the Web MVP's device GLBs from
//  the Mockup originals, run through gltf-transform's optimize pipeline
//  (dedup, weld, meshopt simplify, prune, texture compression, meshopt
//  geometry compression + KHR_mesh_quantization).
//
//  --join false --palette false: those two steps merge sub-meshes and
//  consolidate their materials into a shared "PaletteMaterialNNN" atlas,
//  which also randomizes every material/node name in the process. That's
//  fine for a part nobody targets by name, but three3d/screenImage.ts
//  finds the device's screen by its material being literally named
//  "Screen" — joined+palette-d, that identity is gone and screen content
//  silently fails to composite. Costs ~10% of the size win (join/palette
//  were never the big lever here — meshopt compression is) to keep the
//  Screen material name intact.
//
//  Reads FROM public/3d/devices/ (Mockup's own meshes — never touched)
//  and writes TO public/3d/web-devices/ (the Web MVP's own isolated
//  copies — see three3d/webDevices.ts). Re-run this whenever a device
//  is added to WEB_DEVICES or the Mockup source mesh changes.
//
//  The output requires a GLTFLoader with setMeshoptDecoder() configured
//  (three3d/webMvpViewer.ts and lib/webMvpExport.ts's generated HTML
//  both do this) — EXT_meshopt_compression primitives silently fail to
//  load without it.
//
//  Usage: node scripts/optimize-web-devices.cjs
// ============================================================

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const bin = path.join(root, 'node_modules', '.bin', 'gltf-transform');

const DEVICES = [
  { src: 'public/3d/devices/iphone17pro-clean.glb', dst: 'public/3d/web-devices/iphone17pro.glb' },
  { src: 'public/3d/devices/ipadpro.glb', dst: 'public/3d/web-devices/ipadpro.glb' },
];

for (const { src, dst } of DEVICES) {
  const srcPath = path.join(root, src);
  const dstPath = path.join(root, dst);
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  console.log(`\n${src} -> ${dst}`);
  execFileSync(bin, ['optimize', srcPath, dstPath, '--join', 'false', '--palette', 'false'], { stdio: 'inherit' });
  const before = fs.statSync(srcPath).size;
  const after = fs.statSync(dstPath).size;
  console.log(`  ${(before / 1024 / 1024).toFixed(2)}MB -> ${(after / 1024 / 1024).toFixed(2)}MB (${Math.round((1 - after / before) * 100)}% smaller)`);
}
