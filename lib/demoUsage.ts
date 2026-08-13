import type { SceneState } from '@/store/useSceneStore';
import { getTemplate, layerCountFor } from '@/templates';
import { assetIndexForSlot } from '@/lib/motion';
import { trackAssetIndices } from '@/lib/tracks';
import { cardAspectFor } from '@/lib/crop';

// Canvas size is part of the tally now: a lattice template derives how many
// cells it needs from the frame, so the same scene on a wider canvas really
// does consume more demo slots.
export function countDemoSlotsInUse(
  scene: Pick<SceneState, 'tracks' | 'assets' | 'width' | 'height' | 'cardShape'>,
): number {
  let total = 0;
  for (const track of scene.tracks) {
    if (!track.visible || track.opacity <= 0) continue;
    const pool = trackAssetIndices(track, scene.assets).map((index) => scene.assets[index]).filter(Boolean);
    const meta = getTemplate(track.templateId).meta;
    const count = layerCountFor(track.templateId, track.values, {
      width: scene.width,
      height: scene.height,
      cardAspect: cardAspectFor(meta, scene.width, scene.height, scene.cardShape),
    });
    const repeat = meta.repeatAssets === true;
    for (let slot = 0; slot < count; slot++) {
      let asset = pool[assetIndexForSlot(slot, pool.length, repeat)];
      if (!asset && pool.length > 0) asset = pool[slot % pool.length];
      if (asset?.origin === 'demo') total++;
    }
  }
  return total;
}
