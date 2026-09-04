'use client';

import { useState } from 'react';
import { ControlRow } from '@/components/Controls';
import RotationBall from '@/components/RotationBall';
import { mockupGroups } from '@/three3d/mockupControls';

/**
 * The Mockup studio's panels, read from its real schema
 * (`three3d/mockupControls.ts`) — real ranges, real defaults, live.
 *
 * One block per panel, each paired with what it is for. An earlier cut dropped
 * all six into an auto-fill grid: measured, it collapsed to a single 450px
 * column 2099px tall, with Material and Lights at 592px each and no explanation
 * anywhere — a wall of sliders. The prose here is not invented; it is what the
 * schema's own comments say about why those defaults are what they are.
 */

interface PanelNote {
  /** One line under the panel name: what this panel governs. */
  governs: string;
  /** Paragraphs beside the controls. */
  body: string[];
}

const NOTES: Record<string, PanelNote> = {
  'Camera & Hardware': {
    governs: 'The lens, and the one part of the device that moves.',
    body: [
      'Field of View is the lens, not the camera position. Widening it fits more in the frame but also bends the device — a wide angle exaggerates the perspective on its edges, a narrow one flattens the whole thing toward an elevation drawing. If you want the device bigger without that distortion, move the camera instead, which is what the animation presets do.',
      'Laptop Lid only applies to the laptop slot, and it is the one piece of the hardware itself that animates: the presets keyframe it open or shut along the same pose timeline that carries the camera.',
    ],
  },
  Material: {
    governs: 'Overrides on top of the model’s own materials.',
    body: [
      'The device arrives with real materials of its own, and Use Model Materials keeps them. Everything below it is an override for when you deliberately turn that off — a tint, a glow, transparency, or the two diagnostic looks.',
      'Emissive is not lighting: it makes the body emit rather than reflect, so it stays bright no matter where the key light is. Wireframe and Flat Shading are there to inspect the mesh and the shading, not to ship a product shot.',
    ],
  },
  Screen: {
    governs: 'How the panel emits, and how much room it mirrors.',
    body: [
      'Brightness scales the screen’s own emission, so your artwork can hold up against a bright studio without being washed out by it.',
      'Glare defaults to zero on purpose. The studio environment has rectangular panels baked into it, and a mirror-smooth display returns one as a hard softbox — the single clearest tell that an image was rendered rather than photographed. Raise it when a glossy screen is the look you want, not as a default.',
    ],
  },
  Lights: {
    governs: 'The studio rig: direction, balance, reflection, exposure.',
    body: [
      'Light Direction X and Y are the two axes of a direction pad, and they are applied as an OFFSET on top of whatever the active animation preset is doing with the key light. So a preset can swing the light through a shot and your offset still means the same thing relative to it.',
      'Key, Fill and Ambient are the balance. A strong key against a low fill and ambient floor is what actually reads as sharp — enough contrast that the device’s edges and its finish stay defined instead of washing into a bright backdrop. Raising all three together just flattens the shot.',
      'Reflections is how much of the room the surfaces return. Exposure is the render’s own exposure, and it is the control on this page that changes the render itself rather than grading it afterwards.',
    ],
  },
  Adjustments: {
    governs: 'Post-grade on the rendered device, not lighting.',
    body: [
      'These are filters applied to the canvas after the device is rendered, and they touch the device only — the backdrop keeps its own colours.',
      'Which means: if the device looks too dark, Exposure up in Lights is the honest fix. Brightness here will lift it, and it will lift the noise and flatten the blacks with it. Use these for finishing, the way you would grade a photo.',
    ],
  },
  Ground: {
    governs: 'The contact shadow under the device.',
    body: [
      'Zero by default, because the default shot has no contact shadow at all: the device floats on a plain backdrop. Raising this introduces a ground plane for the device to sit on and cast onto.',
      'Worth knowing before you reach for it: a shadow needs a floor, and a floor is a real plane in the scene. On a pose that floats or tilts far, that plane can end up crossing the device rather than sitting under it — if you see a straight dark edge that does not follow the device’s shape, that is the ground, not the shadow.',
    ],
  },
};

export default function MockupControlGallery() {
  const [values, setValues] = useState<Record<string, any>>(() =>
    Object.fromEntries(mockupGroups.flatMap((g) => g.controls.map((c) => [c.key, c.default]))),
  );
  const [rotation, setRotation] = useState({ x: 0, y: -18, z: 0 });

  const set = (key: string) => (val: any) => setValues((v) => ({ ...v, [key]: val }));

  return (
    <div className="docs-mk">
      {mockupGroups.map((group, i) => {
        const note = NOTES[group.title];
        return (
          <section key={group.title} className="docs-mk-block">
            <div className="docs-mk-block-head">
              <span className="docs-mk-index">{String(i + 1).padStart(2, '0')}</span>
              <span className="docs-mk-name">{group.title}</span>
              <em>{group.controls.length} control{group.controls.length === 1 ? '' : 's'}</em>
            </div>

            <div className="docs-mk-body">
              <div className="docs-mk-panel">
                <div className="docs-mk-rows">
                  {group.controls.map((def) => (
                    <ControlRow key={def.key} def={def} value={values[def.key]} onChange={set(def.key)} />
                  ))}
                </div>
              </div>

              <div className="docs-mk-side">
                {note && <p className="docs-mk-governs">{note.governs}</p>}
                {note?.body.map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
              </div>
            </div>
          </section>
        );
      })}

      <section className="docs-mk-block">
        <div className="docs-mk-block-head">
          <span className="docs-mk-index">07</span>
          <span className="docs-mk-name">Orientation</span>
          <em>outside the vocabulary</em>
        </div>
        <div className="docs-mk-body">
          <div className="docs-mk-panel">
            <div className="docs-mk-rows">
              <RotationBall value={rotation} onChange={setRotation} />
            </div>
          </div>
          <div className="docs-mk-side">
            <p className="docs-mk-governs">Three rotations in one widget.</p>
            <p>
              Drag inside the disc for X and Y, drag the outer ring for Z, and type the
              fields for the degrees a drag cannot land on. It replaced an XY pad, which
              could only ever reach two of the three axes.
            </p>
            <p>
              Degrees here, radians in the store, converted at the boundary — because
              degrees are what you read and type, and radians are what the scene does
              maths with.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
