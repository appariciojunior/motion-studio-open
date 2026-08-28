import { BASE_PATH } from '@/lib/paths';

// Bundled starter images seeded into the asset list so every template opens
// populated with real imagery instead of numbered placeholders. The default
// typographic set uses only type, with varied scale, width, weight, orientation,
// and repetition in a black, white, and ultramarine palette. Users can
// clear/replace it like uploads.
//
// NEXT_PUBLIC_DEMO_SET can switch back to the legacy `bundled` photos or select
// the local-only `ref` comparison set. Set it in .env.local and restart the dev
// server when a non-default collection is needed.
interface DemoSet {
  dir: string;
  prefix: string;
  ext: string;
  count: number;
}

const DEMO_SETS: Record<string, DemoSet> = {
  typographic: { dir: 'typographic-ultramarine-v5', prefix: 'type', ext: 'png', count: 8 },
  editorial: { dir: 'conceptual-editorial-v4', prefix: 'editorial', ext: 'png', count: 8 },
  clean: { dir: 'conceptual-clean-v3', prefix: 'clean', ext: 'png', count: 8 },
  mixed: { dir: 'conceptual-mix', prefix: 'mix', ext: 'png', count: 8 },
  conceptual: { dir: 'conceptual', prefix: 'concept', ext: 'jpg', count: 8 },
  bundled: { dir: 'demo', prefix: 'demo', ext: 'jpg', count: 12 },
  ref: { dir: 'demo-ref', prefix: 'sample', ext: 'png', count: 10 },
};

const activeSet = DEMO_SETS[process.env.NEXT_PUBLIC_DEMO_SET ?? ''] ?? DEMO_SETS.typographic;

export const DEMO_ASSETS = Array.from({ length: activeSet.count }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    name: activeSet === DEMO_SETS.typographic
      ? `Typographic Motion ${n}`
      : activeSet === DEMO_SETS.editorial
        ? `Editorial Motion ${n}`
        : activeSet === DEMO_SETS.clean
          ? `Clean Motion ${n}`
          : activeSet === DEMO_SETS.mixed
            ? `Motion Mix ${n}`
            : activeSet === DEMO_SETS.conceptual
              ? `Concept ${n}`
              : `Demo ${n}`,
    url: `${BASE_PATH}/${activeSet.dir}/${activeSet.prefix}-${n}.${activeSet.ext}`,
  };
});

export function demoSourceForSlot(index: number) {
  const source = DEMO_ASSETS[((index % DEMO_ASSETS.length) + DEMO_ASSETS.length) % DEMO_ASSETS.length];
  return { ...source };
}

// Matches ANY known demo set, not just the active one: a scene saved while one
// set was active still has to re-seed cleanly after the set is switched, or its
// images silently fall back to placeholders.
const DEMO_URL = new RegExp(
  `/(?:${Object.values(DEMO_SETS).map((s) => s.dir).join('|')})/`
  + `(?:${Object.values(DEMO_SETS).map((s) => s.prefix).join('|')})`
  + `-\\d{2}\\.(?:${[...new Set(Object.values(DEMO_SETS).map((s) => s.ext))].join('|')})(?:[?#].*)?$`
);

export function isDemoAssetSource(asset: { origin?: string; url?: string }): boolean {
  return asset.origin === 'demo' || DEMO_URL.test(asset.url ?? '');
}
