import Link from 'next/link';

// Now that the sections have real URLs, a mistyped one has to land somewhere.
// Sits outside the (editor) group on purpose: no stage, no stores, just a way
// back. The static export writes it to 404.html, which is what GitHub Pages
// serves for unknown paths.
export default function NotFound() {
  return (
    <main className="editor-loading route-404">
      <span className="eyebrow">404</span>
      <h1 className="route-404-title">This section doesn&apos;t exist</h1>
      <Link className="route-404-link" href="/library">Back to the library</Link>
    </main>
  );
}
