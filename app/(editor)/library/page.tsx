import type { Metadata } from 'next';
import { Suspense } from 'react';
import TemplateDeepLink from '@/components/TemplateDeepLink';

export const metadata: Metadata = {
  title: 'Library',
  description: 'Browse and tweak the motion templates, then save your own.',
};

// The panels are EditorShell's (the group layout reads the URL and shows the
// matching ones), so this route renders no UI of its own. It exists to give the
// section a real route, a shareable link and its own <title> — and it is where
// `?tpl=<template-id>` is read, so the Suspense that useSearchParams needs in a
// static export sits on this page instead of around the shell that holds the
// WebGL context.
export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <TemplateDeepLink />
    </Suspense>
  );
}
