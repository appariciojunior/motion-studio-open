import { BASE_PATH } from '@/lib/paths';

// Bundled starter images (public/demo, 1080px long edge) seeded into the
// asset list so every template opens populated with real photos instead of
// numbered placeholders. Users can clear/replace them like any upload.
//
// A second set can stand in for local visual-comparison work via
// NEXT_PUBLIC_DEMO_SET. It is unset in every shipped build, so the deployed app
// always serves the bundled photos — the alternate folder is gitignored and
// never ships. Set it in .env.local and restart the dev server.
interface DemoSet {
  dir: string;
  prefix: string;
  ext: string;
  count: number;
}

const DEMO_SETS: Record<string, DemoSet> = {
  bundled: { dir: 'demo', prefix: 'demo', ext: 'jpg', count: 12 },
  ref: { dir: 'demo-ref', prefix: 'sample', ext: 'png', count: 10 },
};

const activeSet = DEMO_SETS[process.env.NEXT_PUBLIC_DEMO_SET ?? ''] ?? DEMO_SETS.bundled;

export const DEMO_ASSETS = Array.from({ length: activeSet.count }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return {
    name: `Demo ${n}`,
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
