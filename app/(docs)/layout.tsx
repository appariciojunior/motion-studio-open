import type { Metadata } from 'next';
import DocsChrome from '@/components/docs/DocsChrome';
import '../../styles/docs.css';

export const metadata: Metadata = {
  title: { default: 'Docs', template: '%s · Motion Studio docs' },
  description: 'How to use Motion Studio: the motion catalogue, tracks, canvas and export.',
};

/**
 * Its own route group, deliberately NOT inside (editor): the editor group's
 * layout mounts EditorShell, which owns the Pixi and three contexts, the
 * autosave loop and the whole store graph. Docs need none of that, and a reader
 * should not pay for a WebGL context to read a page.
 *
 * The live previews still work here, because TemplateThumb renders the
 * template's own transform as plain DOM.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <DocsChrome>{children}</DocsChrome>;
}
