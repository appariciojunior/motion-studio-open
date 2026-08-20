'use client';

import { useRef, useState } from 'react';

// ── Rotation trackball ──────────────────────────────────────────────────────
// One widget for all three model rotations, replacing the xypad that could only
// reach two of them.
//
//   · drag inside the disc  → X (vertical) and Y (horizontal)
//   · drag the outer ring   → Z, read straight off the pointer's angle
//   · the fields            → exact degrees, for the values a drag can't land on
//
// Everything is in degrees here and converted at the boundary, because that is
// what the panel shows and what the user types. Radians stay in the store.

const SIZE = 96;
const C = SIZE / 2;
const R_RING = 44;      // outer ring, owns Z
const R_DISC = 30;      // inner disc, owns X and Y
const DEG_PER_PX = 1.6; // drag sensitivity inside the disc

const clamp180 = (d: number) => Math.max(-180, Math.min(180, d));
const rad = (d: number) => (d * Math.PI) / 180;

type Vec3 = [number, number, number];

// Rx · Ry · Rz, which is what THREE.Euler's default 'XYZ' order builds — and
// three3d/mockup.ts sets the pivot with plain rotation.set(rotX, rotY, rotZ).
// Any other order here would draw an orientation the model does not have.
function rotate([x, y, z]: Vec3, rx: number, ry: number, rz: number): Vec3 {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const x1 = cz * x - sz * y, y1 = sz * x + cz * y, z1 = z;   // Rz
  const x2 = cy * x1 + sy * z1, y2 = y1, z2 = -sy * x1 + cy * z1; // Ry
  return [x2, cx * y2 - sx * z2, sx * y2 + cx * z2];           // Rx
}

// The three great circles of an orientation ball: equator, and the two
// meridians. Latitude/longitude grids read as noise at this size; three circles
// state the same pose and stay legible at 96px.
const SEGMENTS = 64;
const GREAT_CIRCLES: Vec3[][] = [
  Array.from({ length: SEGMENTS + 1 }, (_, i) => {          // equator, y = 0
    const t = (i / SEGMENTS) * Math.PI * 2;
    return [Math.cos(t), 0, Math.sin(t)] as Vec3;
  }),
  Array.from({ length: SEGMENTS + 1 }, (_, i) => {          // meridian, z = 0
    const t = (i / SEGMENTS) * Math.PI * 2;
    return [Math.cos(t), Math.sin(t), 0] as Vec3;
  }),
  Array.from({ length: SEGMENTS + 1 }, (_, i) => {          // meridian, x = 0
    const t = (i / SEGMENTS) * Math.PI * 2;
    return [0, Math.cos(t), Math.sin(t)] as Vec3;
  }),
];

// Orthographic: screen y grows downward, so it takes the sign. z is kept only
// to decide which half of each circle is facing the viewer — that split is the
// whole depth cue, and without it the wireframe reads as a flat spirograph.
const project = ([x, y, z]: Vec3) => ({ x: C + x * R_DISC, y: C - y * R_DISC, front: z >= 0 });

// One circle becomes runs of consecutive same-facing points, so the front half
// can be drawn solid over a dimmed back half.
function runs(points: Vec3[], rx: number, ry: number, rz: number) {
  const out: { front: boolean; d: string }[] = [];
  let cur: string[] = [];
  let curFront: boolean | null = null;
  for (const p of points) {
    const q = project(rotate(p, rx, ry, rz));
    if (curFront === null || q.front === curFront) {
      cur.push(`${cur.length ? 'L' : 'M'}${q.x.toFixed(2)} ${q.y.toFixed(2)}`);
      curFront = q.front;
    } else {
      // repeat the boundary point in both runs so the halves meet with no gap
      cur.push(`L${q.x.toFixed(2)} ${q.y.toFixed(2)}`);
      out.push({ front: curFront, d: cur.join('') });
      cur = [`M${q.x.toFixed(2)} ${q.y.toFixed(2)}`];
      curFront = q.front;
    }
  }
  if (cur.length > 1) out.push({ front: !!curFront, d: cur.join('') });
  return out;
}

export interface Rotation { x: number; y: number; z: number }

export default function RotationBall({
  value,
  onChange,
}: {
  value: Rotation;                    // degrees
  onChange: (next: Rotation) => void; // degrees
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: 'disc' | 'ring'; px: number; py: number; x: number; y: number } | null>(null);
  const [active, setActive] = useState<'disc' | 'ring' | null>(null);

  const rounded = { x: Math.round(value.x), y: Math.round(value.y), z: Math.round(value.z) };

  // Pointer position in the svg's own coordinates, so the maths is independent
  // of where the widget sits and of any page scroll.
  const local = (e: React.PointerEvent | PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE };
  };

  const angleAt = (px: number, py: number) => {
    // 0° at 12 o'clock, growing clockwise — the direction the handle appears to
    // travel, which is what someone dragging it expects.
    const deg = (Math.atan2(px - C, C - py) * 180) / Math.PI;
    return clamp180(Math.round(deg));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = local(e);
    const dist = Math.hypot(p.x - C, p.y - C);
    if (dist > R_RING + 8) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
    if (dist > R_DISC) {
      drag.current = { mode: 'ring', px: p.x, py: p.y, x: value.x, y: value.y };
      setActive('ring');
      onChange({ ...value, z: angleAt(p.x, p.y) });
    } else {
      drag.current = { mode: 'disc', px: p.x, py: p.y, x: value.x, y: value.y };
      setActive('disc');
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = local(e);
    if (d.mode === 'ring') {
      onChange({ ...value, z: angleAt(p.x, p.y) });
      return;
    }
    // Screen right rotates about Y, screen down rotates about X — the same
    // pairing the xypad used, so muscle memory survives the swap.
    onChange({
      x: clamp180(Math.round(d.x + (p.y - d.py) * DEG_PER_PX)),
      y: clamp180(Math.round(d.y + (p.x - d.px) * DEG_PER_PX)),
      z: value.z,
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    drag.current = null;
    setActive(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const bump = (dx: number, dy: number) => {
      e.preventDefault();
      onChange({ x: clamp180(rounded.x + dy * step), y: clamp180(rounded.y + dx * step), z: value.z });
    };
    if (e.key === 'ArrowLeft') bump(-1, 0);
    else if (e.key === 'ArrowRight') bump(1, 0);
    else if (e.key === 'ArrowUp') bump(0, -1);
    else if (e.key === 'ArrowDown') bump(0, 1);
  };

  const rx = rad(value.x), ry = rad(value.y), rz = rad(value.z);
  const wire = GREAT_CIRCLES.map((c) => runs(c, rx, ry, rz));
  // Where the model's own +Z ends up — "which way the front is pointing". It is
  // hidden when it swings behind the sphere, which is the honest answer.
  const facing = project(rotate([0, 0, 1], rx, ry, rz));
  const zRad = ((value.z - 90) * Math.PI) / 180;
  const handleX = C + Math.cos(zRad) * R_RING;
  const handleY = C + Math.sin(zRad) * R_RING;

  const field = (key: keyof Rotation, label: string) => (
    <label className="rb-field" key={key}>
      <span className="rb-axis">{label}</span>
      <input
        type="number"
        min={-180}
        max={180}
        step={1}
        value={rounded[key]}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange({ ...value, [key]: clamp180(n) });
        }}
      />
    </label>
  );

  const zeroed = rounded.x === 0 && rounded.y === 0 && rounded.z === 0;

  return (
    <div className="rb-row">
      <div className="rb-fields">
        {field('x', 'X')}
        {field('y', 'Y')}
        {field('z', 'Z')}
      </div>

      <svg
        ref={svgRef}
        className={`rb-ball ${active ? 'dragging' : ''}`}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        tabIndex={0}
        role="application"
        aria-label={`Model rotation. X ${rounded.x} degrees, Y ${rounded.y} degrees, Z ${rounded.z} degrees. Arrow keys rotate X and Y.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onChange({ x: 0, y: 0, z: 0 })}
      >
        <circle className="rb-ring" cx={C} cy={C} r={R_RING} />
        <circle className={`rb-disc ${active === 'disc' ? 'on' : ''}`} cx={C} cy={C} r={R_DISC} />

        {/* back halves first, so the front ones paint over them */}
        {wire.map((circle, ci) =>
          circle.filter((r) => !r.front).map((r, i) => (
            <path key={`b${ci}-${i}`} className="rb-wire-back" d={r.d} />
          )))}
        {wire.map((circle, ci) =>
          circle.filter((r) => r.front).map((r, i) => (
            <path key={`f${ci}-${i}`} className="rb-wire-front" d={r.d} />
          )))}

        <circle className={`rb-handle ${active === 'ring' ? 'on' : ''}`} cx={handleX} cy={handleY} r={5} />
        {facing.front && <circle className="rb-face" cx={facing.x} cy={facing.y} r={4.5} />}
      </svg>

      <button className="btn rb-reset" onClick={() => onChange({ x: 0, y: 0, z: 0 })} disabled={zeroed}>
        Reset
      </button>
    </div>
  );
}
