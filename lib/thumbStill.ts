// Turning a rendered thumbnail canvas into the still the idle card shows.
//
// This is JPEG and not PNG, and the difference is not cosmetic. Measured in the
// browser on a 180x240 canvas, encoding 34 stills — one search's worth:
//
//   toDataURL('image/png')          7.66 ms each   260 ms blocked
//   toDataURL('image/jpeg', 0.85)   0.27 ms each     9 ms blocked
//   toBlob(png) + objectURL        28.13 ms each   worse still
//
// PNG was costing 260ms of SYNCHRONOUS main-thread work every time a search
// mounted its cards, and it showed: rAF fell from 38 to 29.6 fps just from
// having the thumbnails mounted, with nothing hovered. The stage's own export
// picks JPEG for the same reason.
//
// JPEG has no alpha, so the frame colour has to be painted underneath. That is
// also what the .tpl-thumb box behind it is filled with, so the result is
// identical — but it does mean a still baked in one theme is wrong in the other,
// which is why `themeKey` exists for callers to watch.

/** The thumb backdrop for the CURRENT theme, resolved from the token. */
export function frameColour(): string {
  if (typeof window === 'undefined') return '#0d0d0d';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--frame').trim();
  return v || '#0d0d0d';
}

/**
 * Changes when the theme does, so a component can regenerate its still.
 * Reads the same `documentElement.dataset.theme` that useUIStore writes.
 */
export function themeKey(): string {
  if (typeof window === 'undefined') return '';
  return document.documentElement.dataset.theme ?? '';
}

/** Watch for theme changes. Returns an unsubscribe. */
export function onThemeChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const observer = new MutationObserver(() => fn());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/**
 * Read a rendered canvas into a still.
 *
 * The frame colour goes down first because the renderers clear to transparent
 * and JPEG would otherwise flatten that to black.
 */
export function stillFrom(source: HTMLCanvasElement, w: number, h: number): string | null {
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const g = off.getContext('2d');
  if (!g) return null;
  g.fillStyle = frameColour();
  g.fillRect(0, 0, w, h);
  g.drawImage(source, 0, 0);
  return off.toDataURL('image/jpeg', 0.85);
}
