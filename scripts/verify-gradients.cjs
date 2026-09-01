#!/usr/bin/env node
// Shared-gradient invariants. These protect the migration seam: old scenes only
// have two colours, while new 2D and 3D documents carry GradientSpec v2.

require('sucrase/register');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_GRADIENT_STOPS,
  createGradientSpec,
  fillPatchForGradient,
  gradientFromFill,
  gradientRenderStops,
  gradientRasterMaxEdge,
  gradientSignature,
  normalizeGradientSpec,
  sampleGradientPoint,
  sampleGradientRGB,
} = require('../lib/gradient');

let assertions = 0;
const failures = [];
const check = (condition, message) => { assertions++; if (!condition) failures.push(message); };
const close = (a, b, epsilon = 1) => Math.abs(a - b) <= epsilon;
const colorClose = (a, b, epsilon = 1) => a.slice(0, 3).every((v, i) => close(v, b[i], epsilon));

const legacy = gradientFromFill({ type: 'radial', c1: '#112233', c2: '#ddeeff' });
check(legacy.version === 2, 'legacy fill must migrate to GradientSpec v2');
check(legacy.shape === 'radial', 'legacy radial fill must keep its shape');
check(legacy.stops.length === 2, 'legacy fill must create two stops');
check(legacy.stops[0].color === '#112233' && legacy.stops[1].color === '#ddeeff', 'legacy colours must survive migration');
check(legacy.softness === 0, 'legacy gradients must preserve linear interpolation');

const crowded = normalizeGradientSpec({
  ...createGradientSpec(),
  stops: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, color: '#abcdef', position: 1 - i / 11 })),
});
check(crowded.stops.length === MAX_GRADIENT_STOPS, 'stop count must be capped at eight');
check(crowded.stops.every((stop, i, list) => i === 0 || list[i - 1].position <= stop.position), 'render stops must be sorted');

const simple = createGradientSpec('#000000', '#ffffff');
check(colorClose(sampleGradientRGB(simple, 0.5), [128, 128, 128, 255]), 'two-stop midpoint must interpolate');
const soft = normalizeGradientSpec({ ...simple, softness: 1 });
check(colorClose(sampleGradientRGB(soft, 0), [13, 13, 13, 255]), 'softness must feather the start of a two-stop ramp');
check(colorClose(sampleGradientRGB(soft, 1), [242, 242, 242, 255]), 'softness must feather the end of a two-stop ramp');
const peaked = normalizeGradientSpec({ ...simple, softness: 1, stops: [
  { id: 'dark-start', color: '#000000', position: 0 },
  { id: 'light-middle', color: '#ffffff', position: 0.5 },
  { id: 'dark-end', color: '#000000', position: 1 },
] });
check(sampleGradientRGB(peaked, 0.5)[0] < 240, 'softness must round a hard interior colour stop');
check(gradientRenderStops(simple).length === simple.stops.length && gradientRenderStops(soft).length > soft.stops.length, 'native renderers must add smoothing samples only when softness is enabled');
check(normalizeGradientSpec({ ...simple, softness: 7 }).softness === 1, 'softness must clamp to its document range');
const mesh = normalizeGradientSpec({ ...soft, mode: 'advanced', shape: 'mesh' });
check(!colorClose(sampleGradientPoint(mesh, 0.25, 0.5), sampleGradientPoint({ ...mesh, softness: 0 }, 0.25, 0.5), 0.1), 'mesh must honor the shared softness interpolation');
check(colorClose(sampleGradientPoint({ ...simple, angle: 0 }, 0, 0.5), [0, 0, 0, 255]), 'linear start must use first stop');
check(colorClose(sampleGradientPoint({ ...simple, angle: 0 }, 1, 0.5), [255, 255, 255, 255]), 'linear end must use last stop');

const radial = { ...simple, shape: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0.5 };
check(colorClose(sampleGradientPoint(radial, 0.5, 0.5), [0, 0, 0, 255]), 'radial centre must use first stop');
check(colorClose(sampleGradientPoint(radial, 1, 0.5), [255, 255, 255, 255]), 'radial radius must reach last stop');

const moving = normalizeGradientSpec({
  ...simple,
  mode: 'advanced',
  shape: 'warped-field',
  advanced: { warp: 1.2, flow: 0.8, scale: 1.4, detail: 3, contrast: 1.2 },
});
check(colorClose(sampleGradientPoint(moving, 0.31, 0.73, 0), sampleGradientPoint(moving, 0.31, 0.73, 1), 0.001), 'flow must loop seamlessly at phase 0/1');
check(gradientRasterMaxEdge(simple) === 1080, 'basic native gradients must keep their high-resolution raster');
check(gradientRasterMaxEdge(moving) === 160, 'animated procedural fields must use the responsive raster budget');
check(gradientSignature(moving, 0.1) === gradientSignature(moving, 0.1005), 'near-identical animated phases must share a cached raster');

const patch = fillPatchForGradient({ ...radial, stops: [
  { id: 'a', color: '#123456', position: 0 },
  { id: 'b', color: '#abcdef', position: 1 },
] });
check(patch.type === 'radial', 'v2 radial must mirror to the legacy radial type');
check(patch.c1 === '#123456' && patch.c2 === '#abcdef', 'v2 endpoints must mirror into legacy colours');

// UI contract: the shared editor must stay on the Motion Studio primitives and
// token sheet. This catches the exact regression that previously introduced a
// second visual language with native range inputs, local radii and local type.
const root = path.resolve(__dirname, '..');
const editorSource = fs.readFileSync(path.join(root, 'components', 'GradientEditor.tsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
const sceneStoreSource = fs.readFileSync(path.join(root, 'store', 'useSceneStore.ts'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'lib', 'renderer.ts'), 'utf8');
const gradientCssBlock = cssSource.split('/* ---- Shared 2D / 3D gradient editor ---- */')[1]
  ?.split('/* Neutral SSR/hydration gate.')[0] ?? '';
check(editorSource.includes("import { ControlRow } from './Controls'"), 'gradient sliders must use the shared ControlRow primitive');
check(editorSource.includes("label: 'Softness'") && editorSource.includes('value={spec.softness}'), 'shared editor must expose softness through the design-system control primitive');
check(editorSource.includes('advanced: { ...DEFAULT_GRADIENT_ADVANCED }') && editorSource.includes('center: { x: 0.5, y: 0.5 }'), 'Basic-to-Advanced activation must reset hidden legacy geometry');
check(editorSource.includes('className="segmented"') && editorSource.includes('className="field"') && editorSource.includes('className="btn"'), 'gradient choices and actions must use shared control classes');
check(!editorSource.includes('type="range"') && !editorSource.includes('gradient-number'), 'gradient editor must not introduce native parallel sliders');
check(gradientCssBlock.includes('var(--ctl-h)') && gradientCssBlock.includes('var(--gap-row)') && gradientCssBlock.includes('var(--r-ctrl)'), 'gradient geometry must derive from tokens.css metrics');
check(!/#[0-9a-f]{3,8}\b/i.test(gradientCssBlock), 'gradient UI CSS must not hardcode theme colours');
check(!/font-size:\s*\d/.test(gradientCssBlock), 'gradient UI CSS must not hardcode typography');
const gradientRadii = [...gradientCssBlock.matchAll(/border-radius:\s*([^;]+)/g)].map((match) => match[1].trim());
check(gradientRadii.every((value) => value.startsWith('var(')), 'gradient UI CSS must keep every control, including stop handles, on the square radius tokens');
check(/if \(patch\.gradientSpec\)[\s\S]*?source: 'color',[\s\S]*?gradient: true,/.test(sceneStoreSource), 'writing a gradient document must atomically activate the colour-gradient background');
check(/const background = \{[\s\S]*?\.\.\.s\.background,[\s\S]*?\.\.\.rawBackground,[\s\S]*?gradientSpec: normalizeGradientSpec/.test(sceneStoreSource), 'legacy project hydration must merge saved background fields over the current complete background contract');
check(rendererSource.includes("s.background.source === 'color' && s.background.gradient"), '2D renderer must obey the same background source guard as 3D');

if (failures.length) {
  console.error(`Gradient verification failed (${failures.length}/${assertions})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Gradient verification passed (${assertions} assertions).`);
