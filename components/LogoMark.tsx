// The brand mark: three rounded rects, each smaller and fainter, on one line.
// It is the app icon put in motion by the loader (see .strata-* in
// app/globals.css) and the mark at the top of the icon rail.
//
// Shared rather than copied: it lived inline in IconRail, and the docs header
// needed the same thing. `currentColor` throughout, so it takes the colour of
// wherever it is mounted and follows the theme with no extra tokens.
export default function LogoMark({ height = 19 }: { height?: number }) {
  return (
    <svg
      width={(42 / 19) * height}
      height={height}
      viewBox="0 0 42 19"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="2" width="10" height="15" rx="2.5" fill="currentColor" />
      <rect x="14" y="4.5" width="8" height="10" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="25" y="6.5" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.3" />
    </svg>
  );
}
