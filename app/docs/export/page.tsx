import Link from 'next/link';

export const metadata = { title: 'Export' };

export default function ExportPage() {
  return (
    <>
      <p className="docs-eyebrow">Getting started</p>
      <h1>Export</h1>

      <p className="docs-lead">
        The default export path encodes in your browser from the same scene clock the
        preview uses. Formats and maximum resolution depend on the codecs and memory
        available on that device.
      </p>

      <h2>Formats</h2>
      <div className="docs-table-wrap">
        <table className="docs-table">
          <thead>
            <tr><th>Format</th><th>Encoder</th><th>Notes</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>MP4</strong></td>
              <td>WebCodecs, H.264 High 5.1</td>
              <td>Hardware encoder first. The default for anything going into another editor.</td>
            </tr>
            <tr>
              <td><strong>WebM</strong></td>
              <td>WebCodecs, VP9 profile 0</td>
              <td>Often smaller at similar quality; browser encoding support and editor compatibility vary.</td>
            </tr>
            <tr>
              <td><strong>GIF</strong></td>
              <td>Per-frame 256-colour palette, Floyd&ndash;Steinberg dithering</td>
              <td>A palette per frame, so gradients survive better than a GIF usually does.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Resolutions</h2>
      <p>
        720p, 1080p, 2K, 4K, or the exact pixel size of a custom canvas. The presets
        are defined by the <strong>shortest</strong> edge, so a vertical 1080p is
        1080&times;1920, not 1920&times;1080. Both 3D sections export through the same
        dialog, because the 2D and 3D renderers implement one capture contract. A listed
        size is an option, not a guarantee that every phone can encode it.
      </p>

      <h2>Why the loop does not pop</h2>
      <p>
        Every template quantizes its speed to a whole number of motion cycles per clip,
        so the last frame lands exactly where the first one starts. Conveyor families go
        further and match their period to the card count, so each image returns to its
        own slot. A few presets are one-shot by design — a drop-and-bounce has nowhere
        to loop back to — and those skip the rule rather than fake it.
      </p>
      <p>
        This is also why some presets change the clip length when you pick them: their
        cadence was measured in seconds per card, and at another duration the motion is
        simply a different motion.
      </p>

      <h2>The server route is off by default</h2>
      <p>
        There is an optional ffmpeg route for deployments that want it. It ships
        disabled, and it should stay that way on anything reachable from the internet
        until it is behind authentication and a queue — it has no auth, no rate limit
        and no cap on concurrent processes of its own. The browser path needs none of
        it.
      </p>

      <p className="docs-next">
        <Link href="/docs/controls/library">Library controls →</Link>
      </p>
    </>
  );
}
