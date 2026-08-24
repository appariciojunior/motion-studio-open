// Strata — the shuffling card stack, travelling sideways.
//
// Pure CSS: the markup is three empty <i> elements and `.ld-cards` in
// app/globals.css does all the work, so this ships no JavaScript, needs no
// client boundary, and keeps animating while the main thread is busy — which is
// the whole point of a loader in an app that renders WebGL every frame.
//
// Two knobs, both CSS custom properties set from anywhere above it:
//   --ink   the colour; falls back to `currentColor`, so setting `color` works too
//   --dir   1 travels right (default), -1 travels left
//
//   <StrataLoader />
//   <div style={{ color: 'var(--muted)' }}><StrataLoader /></div>
//   <div style={{ '--dir': -1 } as React.CSSProperties}><StrataLoader /></div>
export function StrataLoader() {
  // Decorative: whatever announces the wait owns the label. The editor's
  // loading screen is a <main aria-label="Loading editor" aria-busy="true">,
  // so a second announcement here would just be noise.
  return <div className="ld-cards" aria-hidden="true"><i /><i /><i /></div>;
}
