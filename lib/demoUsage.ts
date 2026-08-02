import type { SceneState } from '@/store/useSceneStore';
import { getTemplate } from '@/templates';
import { assetIndexForSlot } from '@/lib/motion';
import { trackAssetIndices } from '@/lib/tracks';

export function countDemoSlotsInUse(scene: Pick<SceneState, 'tracks' | 'assets'>): number {
  let total = 0;
  for (const track of scene.tracks) {
    if (!track.visible || track.opacity <= 0) continue;
    const pool = trackAssetIndices(track, scene.assets).map((index) => scene.assets[index]).filter(Boolean);
    const count = Math.max(1, Math.round(track.values.count ?? 6));
    const repeat = getTemplate(track.templateId).meta.repeatAssets === true;
    for (let slot = 0; slot < count; slot++) {
      let asset = pool[assetIndexForSlot(slot, pool.length, repeat)];
      if (!asset && pool.length > 0) asset = pool[slot % pool.length];
      if (asset?.origin === 'demo') total++;
    }
  }
  return total;
}
