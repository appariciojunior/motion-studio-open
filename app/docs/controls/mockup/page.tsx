import Link from 'next/link';
import MockupControlGallery from '../../_components/MockupControlGallery';
import { mockupGroups } from '@/three3d/mockupControls';

export const metadata = { title: 'Mockup controls' };

export default function MockupControlsPage() {
  const total = mockupGroups.reduce((n, g) => n + g.controls.length, 0);

  return (
    <>
      <p className="docs-eyebrow">Changing it</p>
      <h1>Mockup controls</h1>

      <p className="docs-lead">
        The studio is one scene, not two hundred, so its controls are declared once — as{' '}
        {mockupGroups.length} titled groups holding {total} controls, in{' '}
        <code>three3d/mockupControls.ts</code>. Every panel below is read from that file:
        real ranges, real defaults, live.
      </p>

      <p className="docs-note">
        This is the studio side. The motion side — declared per template, one panel per
        family — is <Link href="/docs/controls/library">Library controls</Link>.
      </p>

      <h2>How this differs from a template&rsquo;s panel</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th></th><th>Library</th><th>Mockup</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Declared by</td>
              <td>each template, in its own file</td>
              <td>the studio, in one schema file</td>
            </tr>
            <tr>
              <td>Shape</td>
              <td>a flat list; <code>section</code> on each entry groups the panel</td>
              <td>titled groups, each holding its own list</td>
            </tr>
            <tr>
              <td>Scope</td>
              <td>only that motion — hundreds of families, hundreds of panels</td>
              <td>one panel for the whole studio</td>
            </tr>
            <tr>
              <td>Reset</td>
              <td>picking a template wipes and refills from the declaration</td>
              <td>persistent; it is the studio&rsquo;s state, not a motion&rsquo;s</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        What the two share is the vocabulary and the renderer: the same nine types and the
        same row component, so a control looks and behaves identically in either place.
        Notice what the studio actually uses — almost all sliders, a few toggles, two
        colours. A 3D studio does not need a wider vocabulary than a 2D motion does, and it
        did not get one.
      </p>

      <h2>The studio&rsquo;s panels</h2>

      <MockupControlGallery />

      <h2>Two rules that cover all of them</h2>
      <ul className="docs-list">
        <li>
          <strong>The groups are declared, not derived.</strong> A motion control carries a{' '}
          <code>section</code> and the panel groups by it; a studio panel carries a title and
          holds its own controls. Adding a panel here means adding an object to the schema,
          not inventing a section name somewhere.
        </li>
        <li>
          <strong>Nothing resets.</strong> These values belong to the studio, so they survive
          switching device, finish and animation preset. Motion values are wiped on every
          template pick, by design — which is the sharpest difference between the two sides.
        </li>
      </ul>

      <h2>The one control that is not on this page</h2>
      <p>
        The <strong>view gizmo</strong>: six axis balls showing how the camera sits relative
        to the world, drag to orbit, double-click a ball to snap to that axis. Like the
        trackball above it refused the nine-type vocabulary for the same reason — it is
        spatial, and a list of words would make you translate language back into geometry.
      </p>
      <p>
        It is not mounted here because it needs a real camera rig to point at; it lives over
        the 3D stage in the editor. Its axis colours are the one place in the app that uses
        hue deliberately, following the red/green/blue convention for X/Y/Z — see{' '}
        <Link href="/docs/design">Design and theming</Link>.
      </p>

      <p className="docs-next">
        <Link href="/docs/easing">Easing →</Link>
      </p>
    </>
  );
}
