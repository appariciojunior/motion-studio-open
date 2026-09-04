'use client';

import Link from 'next/link';
import DocsThumb from './DocsThumb';
import { catalogTemplateList } from '@/templates';

/**
 * A handful of presets, running, as an illustration inside a concept page —
 * not a catalogue. The catalogue is the editor; browsing belongs there, where
 * search, favourites and the real stage are.
 *
 * A client component that reads the registry itself, on purpose: a Template
 * carries functions (`transform`), which a server component cannot hand across
 * the boundary as props. The ids cross; the templates are looked up on this side.
 *
 * Unknown or withheld ids are skipped rather than thrown: this list is written
 * by hand in prose pages, and a preset that leaves the catalogue should quietly
 * drop out of the illustration instead of breaking the page.
 */
export default function PresetSample({ ids }: { ids: string[] }) {
  const byId = new Map(catalogTemplateList.map((t) => [t.meta.id, t]));
  const items = ids.map((id) => byId.get(id)).filter((t) => t !== undefined);

  if (items.length === 0) return null;

  return (
    <div className="docs-grid">
      {items.map((t) => (
        // Same app now, so this is an in-app route rather than a cross-origin
        // link — Link also carries the deploy basePath, which a raw href would
        // drop on the subpath build.
        <Link
          key={t.meta.id}
          href={`/library?tpl=${encodeURIComponent(t.meta.id)}`}
          className="tpl-card docs-preset"
        >
          {/* .tpl-card is what TemplateThumb looks for to drive its preview, and
              what gives the card its hairline; both come from globals.css. */}
          <DocsThumb template={t} autoPreview />
          <span className="tpl-card-label">{t.meta.name}</span>
          <code className="docs-preset-id">?tpl={t.meta.id}</code>
        </Link>
      ))}
    </div>
  );
}
