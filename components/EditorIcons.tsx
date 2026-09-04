import { useId, type SVGProps } from 'react';

// ============================================================
//  ONE SPEC for every icon in the editor — rail, panels, transport,
//  and everything that used to live inline in other components:
//
//   1. Optical box 14×14, inside a 20×20 grid (x3–17 · y3–17),
//      touching at least two opposite edges — no more Mockup at 8
//      wide next to Boards at 15.
//   2. A single viewBox: 0 0 20 20. `size` still controls the
//      rendered pixels (Export/Undo/Redo/Play/Pause stay smaller by
//      default), but every icon is now drawn on the same 20-unit grid.
//   3. stroke / stroke-width / fill / join / cap live ONCE here, on
//      the <svg>, and are inherited — a path only carries geometry
//      and, when secondary, opacity .5.
//   4. No corner radius anywhere: rx doesn't exist. Matches
//      --r-card / --r-nav / --r-seg / --r-chip, all 0px.
//   5. Two opacity levels only: 1 and .5.
//   6. Geometry on the 0.5 grid; a 2-unit minimum gutter between
//      neighbouring strokes so nothing merges at 20px.
//   7. Exceptions are named, not accidental: a curve only where the
//      curve IS the shape (Sun, Moon, Bell, the Undo/Redo loop, the
//      easing curve) — never as corner rounding. Perspective only on
//      the 3D icon. Fill only on the transport marks (Play/Pause),
//      which need mass at 14px.
// ============================================================

export type EditorIconProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & {
  size?: number;
};

function iconProps({ size = 20, ...props }: EditorIconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinejoin: 'miter',
    strokeLinecap: 'butt',
    'aria-hidden': true,
    focusable: false,
    ...props,
  } as const;
}

// Play/Pause are the rule-07 fill exception: transport marks need mass at 14px.
function iconPropsFilled({ size = 20, ...props }: EditorIconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'currentColor',
    stroke: 'none',
    'aria-hidden': true,
    focusable: false,
    ...props,
  } as const;
}

// ---------------------------------------------------------------
//  Rail — navigation
// ---------------------------------------------------------------

export function AddIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M10 3v14M3 10h14"/></svg>;
}

export function ProjectsIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M3 17V4h5.5l2 2H17v11Z"/></svg>;
}

// A featured card with two more receding behind it — which is literally what
// the Runway and Coverflow families do, so the icon states the section's
// content and its motion at once. A 2x2 grid, which this was, is the shape
// every dashboard uses for "library" and says nothing about this app.
// Gutters are 2 and 2.5, over the 2-unit minimum, so the thin cards stay
// separate at 20px instead of merging into a block.
export function LibraryIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M10 3h7v14h-7Z"/>
    <path d="M6.5 4.5h1.5v11H6.5ZM3 6h1.5v8H3Z" opacity=".5"/>
  </svg>;
}

// A screen on a stand: covers all four device slots (phone, laptop,
// tablet, display) instead of asserting "phone".
export function MockupIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M3 3h14v10H3Z"/>
    <path d="M10 13v4M6 17h8" opacity=".5"/>
  </svg>;
}

export function ExperimentalsIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M7 3h6M8.5 3v5L3.5 17h13L11.5 8V3"/>
    <path d="M6 13h8" opacity=".5"/>
  </svg>;
}

// Rule 07's perspective exception — the only isometric glyph, because
// this is the only section whose subject is perspective.
export function ThreeDIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M10 3l7 3.5v7L10 17l-7-3.5v-7Z"/>
    <path d="M3 6.5L10 10l7-3.5M10 10v7" opacity=".5"/>
  </svg>;
}

export function WebIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M7 6l-4 4 4 4M13 6l4 4-4 4"/>
    <path d="M11.5 3l-3 14" opacity=".5"/>
  </svg>;
}

// A board of ARRANGED cards, not a kanban of columns — three sizes in
// two directions, so it never reads as a row of columns next to Library.
export function BoardIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M3 3h8v7H3Z"/>
    <path d="M13 3h4v14h-4ZM3 12h8v5H3Z" opacity=".5"/>
  </svg>;
}

// ---------------------------------------------------------------
//  Rail — footer
// ---------------------------------------------------------------

export function BellIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M5 14.5V9a5 5 0 0 1 10 0v5.5M3 14.5h14"/>
    <path d="M8.5 17h3" opacity=".5"/>
  </svg>;
}

// Bigger disc (r 3.5 -> 4) and rays that vary in length — cardinals reach
// further than diagonals, so it reads as a burst instead of eight identical
// ticks. The gap off the disc is 2.2 all the way round, and the tips are
// allowed past the 14x14 optical box other icons keep to — a sunburst is the
// one shape that reads better breaking its own frame. Widening the gap means
// pushing the tips out too, or the rays shorten into stubs.
export function SunIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M14 10A4 4 0 0 1 6 10A4 4 0 0 1 14 10Z"/>
    <path d="M10 3.8V1.5M10 16.2V18.5M3.8 10H1.5M16.2 10H18.5M14.4 5.6l1.1-1.1M14.4 14.4l1.1 1.1M5.6 14.4l-1.1 1.1M5.6 5.6l-1.1-1.1" opacity=".5"/>
  </svg>;
}

export function MoonIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M16.1 12.8A8 8 0 0 1 7.2 3.9A6.55 6.55 0 1 0 16.1 12.8Z"/></svg>;
}

// ---------------------------------------------------------------
//  The theme toggle, as ONE morphing glyph instead of two icons
//  swapped by a ternary — a swap has nothing to animate.
//
//  The disc grows, a bite slides over it and carves the crescent,
//  and the rays retract. Two stroked rings mask each other: the disc
//  shows only OUTSIDE the bite (the crescent's outer arc) and the
//  bite shows only INSIDE the disc (its inner arc), so together they
//  close the shape. Three things that geometry forced, all measured:
//
//   · The bite sits 7.5 from the disc centre, not closer. That is the
//     angle the two arcs cross at (108°); at 4.67 they cross at 137°,
//     a graze that leaves a long forked tip instead of a cusp.
//   · The bite parks 12.6 away in the sun state. Under 11.25 it
//     notches the disc's stroke; much farther and it only reaches the
//     disc in the last quarter, so the moon snaps in instead of forming.
//   · The masks sit on the STATIC <g> with the transform on the child.
//     A mask is resolved in its own element's space, so putting it on
//     the moving ring makes the mask travel along and leaves a sliver
//     of ring showing in the sun.
//
//  Keyed off :root[data-theme="dark"] in app/globals.css. The moon is
//  the BASE state because the button shows the theme you are going to:
//  light theme offers the moon, dark theme offers the sun.
// ---------------------------------------------------------------

export function ThemeGlyph(props: EditorIconProps) {
  const uid = useId();
  const cut = `theme-cut-${uid}`;
  const inside = `theme-in-${uid}`;
  return (
    <svg {...iconProps(props)} className="theme-glyph">
      <defs>
        {/* hide the disc where the bite covers it */}
        <mask id={cut} maskUnits="userSpaceOnUse" x="-14" y="-14" width="48" height="48">
          <rect x="-14" y="-14" width="48" height="48" fill="#fff"/>
          <circle className="bite" cx="15.3" cy="4.7" r="6.5" fill="#000"/>
        </mask>
        {/* show the bite's ring only where it falls inside the disc */}
        <mask id={inside} maskUnits="userSpaceOnUse" x="-14" y="-14" width="48" height="48">
          <circle className="disc" cx="10" cy="10" r="4" fill="#fff"/>
        </mask>
      </defs>
      <g mask={`url(#${cut})`}><circle className="disc" cx="10" cy="10" r="4"/></g>
      <g mask={`url(#${inside})`}><circle className="bite" cx="15.3" cy="4.7" r="6.5"/></g>
      <g className="rays" opacity=".5">
        <path d="M10 3.8V1.5M10 16.2V18.5M3.8 10H1.5M16.2 10H18.5M14.4 5.6l1.1-1.1M14.4 14.4l1.1 1.1M5.6 14.4l-1.1 1.1M5.6 5.6l-1.1-1.1"/>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------
//  Panels
// ---------------------------------------------------------------

// Frame plus the mountain silhouette, and no sun. The 1.5-unit square that
// used to stand in for one did not read as a sun — a sun needs a ray or a
// curve to identify it, and at 20px that square was just a speck in the
// corner.
export function MediaIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M3 3h14v14H3Z"/>
    <path d="M3 13.5l4-4 3.5 3.5L14 9.5l3 3" opacity=".5"/>
  </svg>;
}

export function AdjustIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M7 3.5h2v3H7ZM12 8.5h2v3h-2ZM5.5 13.5h2v3h-2Z"/>
    <path d="M3 5h4M9 5h8M3 10h9M14 10h3M3 15h2.5M7.5 15H17" opacity=".5"/>
  </svg>;
}

export function CanvasIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M3 3h14v14H3Z"/>
    <path d="M7.5 3v14M12.5 3v14M3 7.5h14M3 12.5h14" opacity=".5"/>
  </svg>;
}

// Stem on top, dot on bottom — inverted from the standard lowercase-i
// A literal lowercase "i": dot on top, stem below — and the EXACT vertical
// mirror of AlertIcon about y=10, same dot (1.2) and same stem (5) in the
// opposite arrangement. Telling them apart by proportion, which is what this
// used to do, fails at 18px: both were stem-over-dot and read as the same
// glyph. Mirroring is the only difference that survives the size.
// The dot is filled rather than stroked — a stroke-only square that small
// would leave its centre hollow.
export function InfoIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M17 10A7 7 0 1 1 3 10A7 7 0 1 1 17 10Z"/>
    <path d="M9.4 6.2h1.2v1.2h-1.2Z" fill="currentColor" stroke="none" opacity=".5"/>
    <path d="M10 9V14" opacity=".5"/>
  </svg>;
}

export function ChevronDownIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M3 7l7 6 7-6"/></svg>;
}

export function BackIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M13 3l-6 7 6 7"/></svg>;
}

// ---------------------------------------------------------------
//  Transport & history — same 20x20 grid as everything else now;
//  `size` keeps them rendering smaller by default, for tight toolbars.
// ---------------------------------------------------------------

export function ExportIcon(props: EditorIconProps) {
  return <svg {...iconProps({ size: 14, ...props })}>
    <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5"/>
    <path d="M3 17h14" opacity=".5"/>
  </svg>;
}

// Rule 07's curve exception — the loop is the shape, not corner rounding.
export function UndoIcon(props: EditorIconProps) {
  return <svg {...iconProps({ size: 15, ...props })}>
    <path d="M6.5 3.5L3 7l3.5 3.5"/>
    <path d="M3 7h9a4.5 4.5 0 0 1 0 9H7" opacity=".5"/>
  </svg>;
}

export function RedoIcon(props: EditorIconProps) {
  return <svg {...iconProps({ size: 15, ...props })}>
    <path d="M13.5 3.5L17 7l-3.5 3.5"/>
    <path d="M17 7H8a4.5 4.5 0 0 0 0 9h5" opacity=".5"/>
  </svg>;
}

// Rule 07's fill exception — transport marks need mass at 14px.
export function PlayIcon(props: EditorIconProps) {
  return <svg {...iconPropsFilled({ size: 14, ...props })}><path d="M5 3.5L17 10L5 16.5Z"/></svg>;
}

export function PauseIcon(props: EditorIconProps) {
  return <svg {...iconPropsFilled({ size: 14, ...props })}><path d="M3.5 3.5h5v13h-5ZM11.5 3.5h5v13h-5Z"/></svg>;
}

// ---------------------------------------------------------------
//  Actions — previously copy-pasted inline in 2-3 components each,
//  each copy drifting a little. Now one definition, imported.
// ---------------------------------------------------------------

export function PencilIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M12.5 3.5l4 4L7 17H3v-4L12.5 3.5Z"/>
    <path d="M10.5 5.5l4 4" opacity=".5"/>
  </svg>;
}

export function DuplicateIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M7 7h10v10H7Z"/>
    <path d="M3 3h10v10H3Z" opacity=".5"/>
  </svg>;
}

export function TrashIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M3 6h14M5 6l1 11h8l1-11"/>
    <path d="M8 6V3.5h4V6" opacity=".5"/>
  </svg>;
}

export function CloseIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M3 3l14 14M17 3L3 17"/></svg>;
}

export function SearchIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M13.5 8.5A5 5 0 1 1 3.5 8.5A5 5 0 1 1 13.5 8.5Z"/>
    <path d="M12.5 12.5L17 17" opacity=".5"/>
  </svg>;
}

export function HeartIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M10 16.5C10 16.5 3 12 3 7.5A3.5 3.5 0 0 1 10 6A3.5 3.5 0 0 1 17 7.5C17 12 10 16.5 10 16.5Z"/>
  </svg>;
}

export function CropIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M6.5 3v10.5H17"/>
    <path d="M3 6.5h10.5V17" opacity=".5"/>
  </svg>;
}

// The drag-reorder handle: two columns of dots, filled (not stroked — a
// grip is a texture, not a contour, so it stays outside rule 03's stroke-only
// default the same way Play/Pause do).
export function GripIcon(props: EditorIconProps) {
  return <svg {...iconPropsFilled(props)}>
    <circle cx="7" cy="5" r="1.1"/><circle cx="13" cy="5" r="1.1"/>
    <circle cx="7" cy="10" r="1.1"/><circle cx="13" cy="10" r="1.1"/>
    <circle cx="7" cy="15" r="1.1"/><circle cx="13" cy="15" r="1.1"/>
  </svg>;
}

// ---------------------------------------------------------------
//  State & visibility
// ---------------------------------------------------------------

export function EyeIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M3 10A8 8 0 0 1 17 10A8 8 0 0 1 3 10Z"/>
    <path d="M12 10A2 2 0 0 1 8 10A2 2 0 0 1 12 10Z" opacity=".5"/>
  </svg>;
}

export function EyeOffIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M3.5 16.5L16.5 3.5"/>
    <path d="M3 10A8 8 0 0 1 17 10A8 8 0 0 1 3 10ZM12 10A2 2 0 0 1 8 10A2 2 0 0 1 12 10Z" opacity=".5"/>
  </svg>;
}

// Filled dot, same reasoning as InfoIcon: a stroke-only square that small
// reads as a hollow ring instead of a point.
export function AlertIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M17 10A7 7 0 1 1 3 10A7 7 0 1 1 17 10Z"/>
    <path d="M10 6v5" opacity=".5"/>
    <path d="M9.4 12.6h1.2v1.2h-1.2Z" fill="currentColor" stroke="none" opacity=".5"/>
  </svg>;
}

export function FullscreenIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M3 7V3h4M17 7V3h-4M3 13v4h4M17 13v4h-4"/></svg>;
}

// Two plates of the SAME size on a true 2:1 isometric (half-width 7, half-
// height 3.5), the lower one drawn as just the V that the upper plate does
// not cover — that is what makes it read as a stack. Two different sizes
// with a gap, which is what this was, reads as an arrow instead.
// Isometric here is a second named perspective exception to rule 07: a
// stack of planes is a depth concept the same way the 3D shelf is.
export function LayersIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M10 4.5L17 8L10 11.5L3 8Z"/>
    <path d="M3 12L10 15.5L17 12"/>
  </svg>;
}

// ---------------------------------------------------------------
//  Navigation & editor
// ---------------------------------------------------------------

export function ChevronUpIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M3 13l7-6 7 6"/></svg>;
}

export function ChevronRightIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}><path d="M7 3l6 7-6 7"/></svg>;
}

// Rule 07's curve exception — the loop is the shape, not corner rounding.
// Both arc endpoints sit exactly on the r=7 circle centred at (10,10): with
// endpoints off the radius, SVG silently scales the radius up to reach them,
// which is what pushed this glyph outside the 14x14 box (y 2 -> 17.58).
export function ResetIcon(props: EditorIconProps) {
  return <svg {...iconProps(props)}>
    <path d="M3 10A7 7 0 1 1 5.05 14.95"/>
    <path d="M3 10V6.5M3 10H6.5" opacity=".5"/>
  </svg>;
}
