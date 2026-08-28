// House style, matching components/EditorIcons.tsx: 16x16, stroke line-art on
// currentColor, no fill. Deliberately NOT brand logotypes — a hand-traced
// wordmark is worse than an honest glyph, and these inherit the theme for free.
// Swap in official marks here if the project ever wants them.

const base = {
  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
  'aria-hidden': true, focusable: 'false' as const,
};
const stroke = {
  stroke: 'currentColor', strokeWidth: 1.4,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

/** Repository: a branch forking off a trunk. */
export function RepoIcon() {
  return (
    <svg {...base}>
      <circle cx="4.5" cy="3.5" r="1.6" {...stroke} />
      <circle cx="4.5" cy="12.5" r="1.6" {...stroke} />
      <circle cx="11.5" cy="6" r="1.6" {...stroke} />
      <path d="M4.5 5.1v5.8M9.9 6H8.2a3.7 3.7 0 00-3.7 3.7v1.2" {...stroke} />
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
