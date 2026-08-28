'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { catalogTemplateList } from '@/templates';
import { useProjectStore } from '@/store/useProjectStore';
import { useSceneStore } from '@/store/useSceneStore';

/**
 * `/library?tpl=<template-id>` — a shareable link to one preset.
 *
 * Rendered by the Library route, not by EditorShell: the group layout owns the
 * WebGL context and must not gain a Suspense boundary for a query param. Renders
 * nothing; it only applies the link and then takes it back out of the URL.
 *
 * Applying goes through `setActiveTemplate`, so a link lands exactly where a
 * click on the template's card lands — the same value reset, the same pinned
 * duration and canvas for the ported families, and the same "first pick becomes
 * Layer 1" on a blank project.
 */

/** Query parameter that carries the template id. */
export const TEMPLATE_PARAM = 'tpl';

// Only what the pickers publish is addressable. The registry stays wider on
// purpose — 'catalogHidden' families remain loadable for saved scenes — and a
// URL is a public surface: it must not be the way to reach a preset that is
// deliberately withheld.
const catalogIds = new Set(catalogTemplateList.map((t) => t.meta.id));

export default function TemplateDeepLink() {
  const requested = useSearchParams().get(TEMPLATE_PARAM);
  const router = useRouter();
  const pathname = usePathname();
  const booted = useProjectStore((s) => s.booted);
  const activeId = useProjectStore((s) => s.activeId);
  const projects = useProjectStore((s) => s.projects);
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (!requested) { applied.current = null; return; }
    if (applied.current === requested) return;

    // Gate on the store, never on effect ordering. This component's effects run
    // BEFORE EditorShell's — it is a child of the group layout — so on a cold
    // load the scene has not been hydrated from the project yet, and a pick made
    // here would be overwritten by that hydration. Waiting for `booted` and for
    // the section's own 2D project to be the open one is what makes the link
    // land after, whichever commit that happens in.
    if (!booted) return;
    if (projects.find((p) => p.id === activeId)?.mode !== '2d') return;

    // Marked applied even when the id is unknown: a stale or hand-typed link is
    // answered by leaving the scene alone and cleaning the URL, not by retrying.
    applied.current = requested;
    if (catalogIds.has(requested)) useSceneStore.getState().setActiveTemplate(requested);

    // Take the param back out, so a reload cannot re-apply a pick over whatever
    // the user chose since — the one way a link could destroy work silently.
    // Through the router, not window.history: a bare replaceState is overwritten
    // when the router syncs its own entry, which measurably left `?tpl=` in the
    // address bar on an in-app navigation while a cold load looked fine.
    // `scroll: false` keeps the editor from jumping.
    router.replace(pathname, { scroll: false });
  }, [requested, booted, activeId, projects, router, pathname]);

  return null;
}
