import Link from 'next/link';

export const metadata = { title: 'Design and theming' };

export default function DesignPage() {
  return (
    <>
      <p className="docs-eyebrow">Changing it</p>
      <h1>Design and theming</h1>

      <p className="docs-lead">
        Every colour, radius, type size and layout metric in the editor lives in one
        token sheet. Restyling the whole app is an edit to that file — components never
        hardcode a colour, so there is nowhere else for one to hide.
      </p>

      <h2>One file</h2>
      <p>
        The sheet is <code>styles/tokens.css</code>. Everything else — panels, the
        timeline, the template cards, these docs pages — reads from it through{' '}
        <code>var(--token)</code>. If a change needs touching a component to recolour
        something, that component has a bug.
      </p>

      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Group</th><th>Governs</th></tr>
          </thead>
          <tbody>
            <tr><td>Surfaces</td><td>The stage and its dot grid, panels, input wells, card backgrounds, hairlines</td></tr>
            <tr><td>Text</td><td>The gray scale: active, body, labels, values, muted, faint</td></tr>
            <tr><td>Inverse</td><td>The dark-on-light pairs — Export button, play button, active segment</td></tr>
            <tr><td>Radii</td><td>Cards, controls, segments, chips. All <code>0px</code> today</td></tr>
            <tr><td>Type scale</td><td>Label, UI, meta, eyebrow and micro sizes with their line heights</td></tr>
            <tr><td>Spacing and layout</td><td>Panel padding, row gaps, and the fixed column widths of the editor grid</td></tr>
            <tr><td>Motion</td><td>The single UI transition duration</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Two examples</h2>
      <p>
        <strong>Round the corners.</strong> The design is square on purpose, and that is
        expressed as tokens rather than as an absence: the radius tokens are all{' '}
        <code>0px</code>. Set them to <code>6px</code> and every card, control, segment
        and chip rounds together, in both themes, with no component edited.
      </p>
      <p>
        <strong>Change the palette.</strong> The surface and text tokens are one block
        each. Replace their values and the whole editor moves, including the parts you
        did not think about — the timeline lanes, the thumbnail backdrops, the docs.
      </p>

      <h2>The dark theme is the same tokens</h2>
      <p>
        Dark is not a second stylesheet. It redefines the same token names under{' '}
        <code>{':root[data-theme="dark"]'}</code>, so anything built from tokens is
        already themed. The theme is written on the root element before first paint from
        the stored preference, so there is no flash of the wrong theme, and the toggle in
        the editor and the one in these docs write to the same place.
      </p>
      <p className="docs-note">
        The practical rule when adding UI: never give a colour its only definition
        outside the token sheet. A literal hex in a component is invisible in light mode
        review and wrong in dark mode.
      </p>

      <h2>There is no accent colour</h2>
      <p>
        This palette has none, and that is a decision, not an omission. &ldquo;Selected&rdquo;
        and &ldquo;on&rdquo; are said with <code>--fg</code> — the active template card
        border, the segmented thumb, a favourited heart, the marker beside the current
        page in this sidebar. A single hue introduced for one state would be the only
        colour in the interface and would read as an error rather than as emphasis.
      </p>
      <p>
        The one exception is the 3D view gizmo, whose red, green and blue axes are the
        established convention for X, Y and Z, and which sits on a user-set background
        rather than on a themed surface.
      </p>

      <p className="docs-next">
        <Link href="/docs/new-motion">New motion →</Link>
      </p>
    </>
  );
}
