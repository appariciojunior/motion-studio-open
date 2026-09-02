import type { Effect } from '@/lib/types';
import { grain } from './grain';
import { pixelate } from './pixelate';
import { rgbSplit } from './rgbSplit';
import { vignette } from './vignette';

// Insertion order is the order the panel offers them, so these read as a list a
// person would scan: the two that change the whole frame's feel first, then the
// two that are a deliberate look.
export const effects: Record<string, Effect> = {
  [grain.meta.id]: grain,
  [vignette.meta.id]: vignette,
  [rgbSplit.meta.id]: rgbSplit,
  [pixelate.meta.id]: pixelate,
};

export const effectList: Effect[] = Object.values(effects);

export function getEffect(id: string): Effect | undefined {
  return effects[id];
}

export function effectDefaults(id: string): Record<string, any> {
  const e = getEffect(id);
  if (!e) return {};
  const values: Record<string, any> = {};
  for (const c of e.controls) {
    values[c.key] = typeof c.default === 'object' && c.default !== null
      ? { ...(c.default as object) }
      : c.default;
  }
  return values;
}
