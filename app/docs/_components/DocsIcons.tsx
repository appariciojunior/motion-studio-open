// House style, matching the editor's EditorIcons.tsx: 16x16, stroke line-art on
// currentColor, no fill. The one exception is RepoIcon, which is the real GitHub
// mark — see the note on it.

const base = {
  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
  'aria-hidden': true, focusable: 'false' as const,
};
const stroke = {
  stroke: 'currentColor', strokeWidth: 1.4,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

/**
 * The GitHub mark. This one IS the brand logotype, unlike everything else in
 * this file: a branch-and-node glyph was here first and read as "some repo",
 * not as GitHub. The path is `mark-github-16.svg` from primer/octicons (MIT),
 * downloaded verbatim rather than transcribed — a logo is exactly where one
 * wrong character produces something subtly wrong that nobody catches.
 *
 * It is a filled silhouette, so it does not take the `stroke` treatment; it
 * still follows the theme through `currentColor`.
 */
export function RepoIcon() {
  return (
    <svg {...base} fill="currentColor">
      <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg {...base}>
      <circle cx="7" cy="7" r="4.2" {...stroke} />
      <path d="M10.2 10.2L13.5 13.5" {...stroke} />
    </svg>
  );
}

/** Generic outbound glyph, used for any social link that is filled in. */
export function LinkOutIcon() {
  return (
    <svg {...base}>
      <path d="M9.5 3.5h3v3M12.5 3.5L7.5 8.5" {...stroke} />
      <path d="M11 9.5v2.2a1.3 1.3 0 01-1.3 1.3H4.3A1.3 1.3 0 013 11.7V6.3A1.3 1.3 0 014.3 5h2.2" {...stroke} />
    </svg>
  );
}

/** Thumbs up / down, for the page-feedback footer. */
export function ThumbUpIcon() {
  return (
    <svg {...base}>
      <path d="M5.5 14V7.2l3-4.7c.8.1 1.3.7 1.3 1.5V6.6h2.4c.9 0 1.5.8 1.3 1.6l-.9 4.6c-.1.7-.7 1.2-1.4 1.2H5.5z" {...stroke} />
      <path d="M5.5 7.2H3.4c-.5 0-.9.4-.9.9v5c0 .5.4.9.9.9h2.1" {...stroke} />
    </svg>
  );
}

export function ThumbDownIcon() {
  return (
    <svg {...base}>
      <path d="M5.5 2v6.8l3 4.7c.8-.1 1.3-.7 1.3-1.5V9.4h2.4c.9 0 1.5-.8 1.3-1.6l-.9-4.6C12.5 2.5 11.9 2 11.2 2H5.5z" {...stroke} />
      <path d="M5.5 8.8H3.4c-.5 0-.9-.4-.9-.9v-5c0-.5.4-.9.9-.9h2.1" {...stroke} />
    </svg>
  );
}

/** Hamburger and close, for the mobile nav drawer. */
export function MenuIcon() {
  return (
    <svg {...base}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" {...stroke} />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...base}>
      <path d="M4 4l8 8M12 4l-8 8" {...stroke} />
    </svg>
  );
}
