'use client';

import { useEffect, useState } from 'react';
import type { Template } from '@/lib/types';
import TemplateThumb from '@/components/TemplateThumb';

/**
 * TemplateThumb, mounted client-side only.
 *
 * The editor never hits this: it loads its whole shell through
 * next/dynamic with `ssr: false`, so the thumbnails there only ever render in
 * the browser. The docs DO server-render, and the thumb cannot survive that —
 * it writes computed floats straight into inline styles, and the server and the
 * client do not serialize them identically (measured: `27.0082%` from the server
 * against `27.0081928052793%` from the client, on every card). React reports
 * that as a hydration mismatch it "won't patch up", which is a broken tree, not
 * a warning to live with.
 *
 * So the frame and the label render on the server — the card keeps its size, the
 * link is in the static HTML, nothing shifts — and only the moving part waits
 * for the client. The placeholder is the same `.tpl-thumb` box, so there is no
 * reflow when the real one arrives.
 */
export default function DocsThumb({
  template,
  autoPreview = false,
}: {
  template: Template;
  autoPreview?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return <div className="tpl-thumb" aria-hidden="true" />;
  return <TemplateThumb template={template} autoPreview={autoPreview} />;
}
