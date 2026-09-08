import type { Effect } from '@/lib/types';
import { bloom } from './bloom';
import { blur } from './blur';
import { grain } from './grain';
import { halftone } from './halftone';
import { pixelate } from './pixelate';
import { posterize } from './posterize';
import { rgbSplit } from './rgbSplit';
import { scanlines } from './scanlines';
import { tiltShift } from './tiltShift';
import { vignette } from './vignette';
import { wave } from './wave';

// Insertion order is the order the panel offers them, grouped by what a person
// is looking for rather than alphabetically: first the ones that set a whole
// frame's mood, then the four that are a deliberate printed/broadcast look,
// then the one that distorts geometry.
//
// Blur, Bloom e Tilt-shift entram junto de grao e vinheta porque sao da mesma
// familia: efeitos de LENTE — o que a camera faz com a cena, e nao um
// tratamento aplicado por cima dela.
export const effects: Record<string, Effect> = {
  [grain.meta.id]: grain,
  [vignette.meta.id]: vignette,
  [blur.meta.id]: blur,
  [bloom.meta.id]: bloom,
  [tiltShift.meta.id]: tiltShift,
  [halftone.meta.id]: halftone,
  [posterize.meta.id]: posterize,
  [scanlines.meta.id]: scanlines,
  [pixelate.meta.id]: pixelate,
  [rgbSplit.meta.id]: rgbSplit,
  [wave.meta.id]: wave,
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
