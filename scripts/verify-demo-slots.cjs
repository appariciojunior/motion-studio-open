const path = require('path');
const Module = require('module');

require('sucrase/register');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};

const { useSceneStore } = require('../store/useSceneStore');
const { DEMO_ASSETS } = require('../lib/demoAssets');
const { countDemoSlotsInUse } = require('../lib/demoUsage');

let assertions = 0;
function assert(ok, message) {
  assertions++;
  if (!ok) throw new Error(message);
}

const store = useSceneStore.getState();
store.resetScene();
let scene = useSceneStore.getState();
assert(scene.assets.length === 8, 'fresh scene should keep eight conceptual preview slots');
assert(scene.assets.every((asset) => asset.origin === 'demo'), 'fresh slots should be demos');
assert(countDemoSlotsInUse(scene) === 6, 'default six-card template should report six demo slots');

const firstId = scene.assets[0].id;
store.addAssets([{ name: 'Real 01', url: 'https://example.com/real-01.jpg', origin: 'remote' }]);
scene = useSceneStore.getState();
assert(scene.assets[0].id === firstId, 'filling a slot should preserve its id');
assert(scene.assets[0].origin === 'remote', 'upload should replace the first demo');
assert(countDemoSlotsInUse(scene) === 5, 'one filled slot should leave five demos in use');

store.removeAsset(firstId);
scene = useSceneStore.getState();
assert(!scene.assets.some((asset) => asset.id === firstId), 'removing should delete the media item');
assert(scene.assets.length === 7, 'removing should leave seven conceptual media items');
assert(countDemoSlotsInUse(scene) === 6, 'the six-card template should continue using six remaining demos');

store.addAssets([
  { name: 'Real 01', url: 'https://example.com/real-01.jpg', origin: 'remote' },
  { name: 'Real 02', url: 'https://example.com/real-02.jpg', origin: 'remote' },
]);
assert(useSceneStore.getState().assets.slice(0, 2).every((asset) => asset.origin !== 'demo'), 'multi-add should fill demos first');
store.clearAssets();
assert(useSceneStore.getState().assets.every((asset) => asset.origin === 'demo'), 'clear should restore demos');

store.hydrate({
  assets: [{ ...DEMO_ASSETS[0], id: 'legacy_1', visible: false, origin: 'remote' }],
});
scene = useSceneStore.getState();
assert(scene.assets[0].origin === 'demo', 'legacy bundled remote should migrate to demo');
assert(scene.assets[0].visible === true, 'migrated demo should be visible in preview');

console.log(`${assertions} demo-slot assertions passed`);
