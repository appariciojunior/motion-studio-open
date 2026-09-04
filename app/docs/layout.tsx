import type { Metadata } from 'next';
import DocsChrome from './_components/DocsChrome';
// docs.css usa ~20 tokens (--fg, --card, --fs-ui...) definidos pelo editor;
// o alias @ aponta para ele, entao a folha vem da mesma fonte que os componentes.
import '@/styles/tokens.css';
// The galleries mount the editor's REAL components — ControlRow, TemplateThumb,
// RotationBall, EasingCurveEditor — and every rule that makes those look like
// controls (.strack, .sfill, .shandle, .ctl-row, .tpl-card, .ez-*) lives in the
// editor's globals, not here. Without it they render as bare divs: measured,
// .strack came out position:static, transparent, with no cursor.
// Imported BEFORE docs.css so the docs sheet still wins where they overlap.
import '@/app/globals.css';
import './docs.css';

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
