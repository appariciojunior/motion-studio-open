import type { ControlDef } from '@/lib/types';
import type { CameraStop, SceneCameraState } from '@/lib/sceneCamera';
import { cameraStopKeys, MAX_CAMERA_STOPS, SCENE_CAMERA_ON } from '@/lib/sceneCamera';

/**
 * Camera moves you CHOOSE, instead of a path you build.
 *
 * Why this exists, and why the pad is no longer the front door.
 *
 * The pad asked for coordinates over time — positions, zooms, order — which is
 * the only control in this app that asks for that, and it is the hardest thing
 * in it. Reported three times as confusing, and the reports were right.
 *
 * Reading the reference tool settled the direction. Its store carries 204
 * families and the section titles across ALL of them are Scene, Animation,
 * Physics, Style, Proximity, Effects and Path — where that Path is
 * pathStretchX/Y/Tilt, the CARDS' path, not the camera's. Its whole camera
 * surface is static sliders folded into each template: perspective in 99
 * families, offsetX/Y in 137, distance in 78, rotationX/Y/Z in 62, orbitRadius
 * in 41, zoom in 4. The one place a different viewpoint matters it is named and
 * one click: `cameraView`, a toggle between `side` and `down`, in 9 families.
 *
 * They never ask anyone to author a camera path. Neither should we, by default.
 * A move is a choice with at most two knobs, and the stops, the timing and the
 * easing are authored here from measurements taken off the reference clip: a
 * 22x ratio between its slowest and fastest frame, a leg whose fastest moment
 * sits at its own middle, leg durations proportional to distance.
 *
 * A move GENERATES stops. It is not a second runtime — choosing one writes the
 * same `_camStopN` keys the pad writes, so the engine underneath is untouched
 * and the path stays editable by hand afterwards.
 */

export const CAMERA_MOVE_KEY = '_camMove';
export const CAMERA_MOVE_AMOUNT = '_camMoveAmount';
export const CAMERA_MOVE_DIR = '_camMoveDir';

/** What the move becomes once you hand-edit the path: these stops came from you. */
export const CUSTOM_MOVE = 'custom';

export const CAMERA_MOVE_AMOUNT_CONTROL: ControlDef = {
  key: CAMERA_MOVE_AMOUNT, label: 'Amount', type: 'slider',
  min: 10, max: 100, step: 1, default: 60, unit: '%',
  description: 'How far the move goes. The shape of it does not change, only its size.',
};

export const CAMERA_MOVE_DIR_CONTROL: ControlDef = {
  key: CAMERA_MOVE_DIR, label: 'Towards', type: 'pills',
  options: ['centre', 'left', 'right', 'up', 'down'], default: 'centre',
  description: 'Where the camera ends up looking.',
};

export interface CameraMove {
  id: string;
  label: string;
  hint: string;
  /** At most two, and the panel shows exactly these. */
  knobs: ControlDef[];
  build: (amount: number, dir: string) => {
    shot: { zoom: number; x: number; y: number };
    stops: CameraStop[];
  };
}

// How far off-centre a move is allowed to look.
//
// The first version derived this from the zoom — |pan| <= (zoom - 1) / 2,
// which is where the camera's frame stops fitting inside ONE frame of scene.
// That guard is obsolete and it made every move crawl: a Survey at 60% moved
// its stops by three or four per cent and the frames drew on top of each
// other. A lattice template now BUILDS the extra scene the camera asks for
// (ctx.coverage), and the renderer culls against the camera frame rather than
// the canvas, so looking past the original frame is a supported thing to do.
//
// The cap is the reference clip's own excursion instead: it covered 37% of a
// frame across and 29% down, so 35% is a full-strength move.
const REACH = 35;
const reach = (amount: number) => REACH * (amount / 100);

const towards = (dir: string, amount: number) => {
  const d = reach(amount);
  // The pad moves the PICTURE, so a camera looking right shifts it left.
  switch (dir) {
    case 'left': return { x: d, y: 0 };
    case 'right': return { x: -d, y: 0 };
    case 'up': return { x: 0, y: d };
    case 'down': return { x: 0, y: -d };
    default: return { x: 0, y: 0 };
  }
};

const PUSH_IN: CameraMove = {
  id: 'push',
  label: 'Push in',
  hint: 'Opens on the whole scene and closes on one part of it.',
  knobs: [CAMERA_MOVE_AMOUNT_CONTROL, CAMERA_MOVE_DIR_CONTROL],
  build: (amount, dir) => {
    const fim = Math.round(105 + amount * 1.15);   // 60 -> 174%, 100 -> 220%
    const p = towards(dir, amount);
    return { shot: { zoom: 100, x: 0, y: 0 }, stops: [{ x: p.x, y: p.y, zoom: fim }] };
  },
};

const PULL_BACK: CameraMove = {
  id: 'pull',
  label: 'Pull back',
  hint: 'Opens close on one part and widens out onto the whole scene.',
  knobs: [CAMERA_MOVE_AMOUNT_CONTROL, CAMERA_MOVE_DIR_CONTROL],
  build: (amount, dir) => {
    const ini = Math.round(105 + amount * 1.15);
    const p = towards(dir, amount);
    return { shot: { zoom: ini, x: p.x, y: p.y }, stops: [{ x: 0, y: 0, zoom: 100 }] };
  },
};

const CROSS: CameraMove = {
  id: 'cross',
  label: 'Cross',
  hint: 'Holds its distance and travels across the scene.',
  knobs: [CAMERA_MOVE_AMOUNT_CONTROL, {
    ...CAMERA_MOVE_DIR_CONTROL,
    label: 'Direction',
    options: ['left', 'right', 'up', 'down'],
    default: 'right',
  }],
  build: (amount, dir) => {
    // A cross has to be zoomed IN to have anywhere to go: at 110% the frame can
    // only move 5% of itself before its own edge is in shot.
    const z = Math.round(120 + amount * 0.3);      // 60 -> 138%, 100 -> 150%
    const vertical = dir === 'up' || dir === 'down';
    const sinal = dir === 'right' || dir === 'down' ? -1 : 1;
    const d = reach(amount);
    const de = vertical ? { x: 0, y: -sinal * d } : { x: -sinal * d, y: 0 };
    const para = vertical ? { x: 0, y: sinal * d } : { x: sinal * d, y: 0 };
    return { shot: { zoom: z, ...de }, stops: [{ ...para, zoom: z }] };
  },
};

const DRIFT: CameraMove = {
  id: 'drift',
  label: 'Drift',
  hint: 'Barely moves — a slow push with a lean, for a scene that is already busy.',
  knobs: [CAMERA_MOVE_AMOUNT_CONTROL],
  build: (amount) => {
    const ini = Math.round(104 + amount * 0.12);
    const fim = Math.round(ini + 6 + amount * 0.22);
    const d = reach(amount) * 0.35;
    return {
      shot: { zoom: ini, x: -d / 2, y: d / 3 },
      stops: [{ x: d / 2, y: -d / 3, zoom: fim }],
    };
  },
};

const SURVEY: CameraMove = {
  id: 'survey',
  label: 'Survey',
  hint: 'Visits several places in turn, settling on each. The move the reference clip makes.',
  knobs: [CAMERA_MOVE_AMOUNT_CONTROL],
  build: (amount) => {
    // The reference clip's own path, as measured: 210 frames tracked one to the
    // next, cut at the six moments its camera slowed down, read off in per-cent
    // of a frame with the zoom it had reached by then. Rebased so nothing drops
    // below 100% — on a wall built to the canvas the camera cannot pull back
    // past the scene — and scaled by Amount.
    const k = amount / 100;
    const base: CameraStop[] = [
      { x: 37, y: -16, zoom: 123 },
      { x: 8, y: 29, zoom: 72 },
      { x: 3, y: 6, zoom: 70 },
      { x: 11, y: 4, zoom: 80 },
      { x: -11, y: 9, zoom: 95 },
      { x: 0, y: 12, zoom: 108 },
    ];
    // Rebased so the widest stop sits at 100% rather than below it: this wall
    // is built to the canvas, and a camera wider than the canvas would be
    // looking at the edge of it even with coverage.
    const escala = 100 / 70;
    return {
      shot: { zoom: Math.round(100 * escala), x: 0, y: 0 },
      stops: base.slice(0, MAX_CAMERA_STOPS).map((s) => ({
        x: Math.round(s.x * k),
        y: Math.round(s.y * k),
        zoom: Math.round(s.zoom * escala),
      })),
    };
  },
};

export const CAMERA_MOVES: CameraMove[] = [PUSH_IN, PULL_BACK, CROSS, DRIFT, SURVEY];

export const cameraMoveById = (id: unknown): CameraMove | null =>
  CAMERA_MOVES.find((m) => m.id === id) ?? null;

/**
 * The patch that puts a move on a scene: the shot it starts from, its stops,
 * and nothing left of whatever was there before. Every stop slot up to the
 * ceiling is cleared, because a shorter move must not inherit the tail of a
 * longer one — that would leave the camera visiting somewhere nobody asked for.
 */
export function cameraMovePatch(
  moveId: string,
  amount: number,
  dir: string,
): Record<string, number | { x: number; y: number } | string | null> {
  const move = cameraMoveById(moveId);
  const patch: Record<string, number | { x: number; y: number } | string | null> = {
    [SCENE_CAMERA_ON]: 1,
    [CAMERA_MOVE_KEY]: moveId,
  };
  for (let i = 0; i < MAX_CAMERA_STOPS; i++) {
    const k = cameraStopKeys(i);
    patch[k.pad] = null;
    patch[k.zoom] = null;
  }
  if (!move) return patch;
  const { shot, stops } = move.build(amount, dir);
  patch._camZoom = Math.round(shot.zoom);
  patch._camPanX = Math.round(shot.x);
  patch._camPanY = Math.round(shot.y);
  stops.forEach((s, i) => {
    const k = cameraStopKeys(i);
    patch[k.pad] = { x: Math.round(s.x), y: Math.round(s.y) };
    patch[k.zoom] = Math.round(s.zoom);
  });
  return patch;
}

/** Reserved keys this module owns, for the sanitiser to carry through a save. */
export const CAMERA_MOVE_KEYS = [CAMERA_MOVE_KEY, CAMERA_MOVE_AMOUNT, CAMERA_MOVE_DIR] as const;

export type { SceneCameraState };
