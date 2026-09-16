import type { CustomPreset } from '@/store/useSceneStore';

/**
 * Composes that ship with the app.
 *
 * A compose is a scene plus the camera that films it, and until now the tab
 * that holds them could only ever be empty on a fresh install: it read
 * localStorage and nothing else, so there was nowhere for a compose to come
 * from except the user making one. These are the starting point — open one,
 * change it, save your own next to it.
 *
 * They are ordinary `CustomPreset`s with a reserved id prefix. That is the whole
 * mechanism: no second shape to keep in step with the first, and one applied to
 * a scene behaves exactly like one you saved yourself. The prefix only decides
 * whether the card offers a delete button, because deleting something that
 * comes back on the next reload is not a delete.
 */
export const SHIPPED_COMPOSE_PREFIX = 'compose_';

export const isShippedCompose = (id: string) => id.startsWith(SHIPPED_COMPOSE_PREFIX);

/**
 * `Contact Sheet` is the reference clip, measured rather than eyeballed: 210
 * frames tracked one to the next for scale and translation, then cut at the six
 * moments the camera slows down. The stops below are where it actually was at
 * each of those, in per-cent of a frame, with the zoom it had got to.
 *
 * The signs are NEGATED from the measurement, and that is the convention rather
 * than a correction: tracking a clip gives you how the picture moved, while the
 * pad says where the camera is pointing, and a camera panning right sends the
 * picture left. Rendering the compose with the raw numbers and measuring it the
 * same way caught it — x was out by +22 on average and by only -8 with the sign
 * flipped, and y flipped with it (measured -14 where the clip had +16).
 *
 * The wall underneath is the wall the clip has — its rows drift against each
 * other by 0.85 px/frame, which is our Weave, not our camera. So the camera
 * carries only the global move and the preset keeps its own weave; feeding the
 * drift into both would count it twice.
 */
const CONTACT_SHEET: CustomPreset = {
  id: `${SHIPPED_COMPOSE_PREFIX}contact_sheet`,
  name: 'Contact Sheet',
  templateId: 'wall-01',
  // Card size is the difference between a wall of documents and a texture.
  // Side by side with the clip, ours read as noise: the clip puts two to three
  // cards across the frame, each one readable, and we had four to five. 320
  // with a gap of 30 is a pitch of 270 on an 810 stage -- three across -- and
  // the gap is 11% of the pitch, which is the breathing the clip has.
  values: {
    cardSize: 320, gap: 30, rowsSkipped: 1,
    weave: 'varied', sweep: 0.3, hold: 0,
    speed: 0.3, cornerRadius: 0,
  },
  easing: { id: 'linear' },
  sceneCamera: {
    _camOn: 1,
    _camZoom: 100, _camPanX: 0, _camPanY: 0, _camOrbitX: 0, _camOrbitY: 0,
    _camStop2: { x: 37, y: -16 },  _camStop2Zoom: 123,
    _camStop3: { x: 8, y: 29 },    _camStop3Zoom: 72,
    _camStop4: { x: 3, y: 6 },     _camStop4Zoom: 70,
    _camStop5: { x: 11, y: 4 },    _camStop5Zoom: 80,
    _camStop6: { x: -11, y: 9 },   _camStop6Zoom: 95,
    _camStop7: { x: 0, y: 12 },    _camStop7Zoom: 108,
    _camStop8: { x: 2, y: 13 },    _camStop8Zoom: 113,
  },
};

/**
 * The same idea said in one move instead of seven: start on the whole wall and
 * push into one card. Here so the tab shows that a compose does not have to be
 * a tour — two stops is a camera too.
 */
const PUSH_IN: CustomPreset = {
  id: `${SHIPPED_COMPOSE_PREFIX}push_in`,
  name: 'Push In',
  templateId: 'wall-02',
  values: { cardSize: 360, gap: 28, speed: 0.2, hold: 0 },
  easing: { id: 'linear' },
  sceneCamera: {
    _camOn: 1,
    _camZoom: 80, _camPanX: 0, _camPanY: 0, _camOrbitX: 0, _camOrbitY: 0,
    _camStop2: { x: 18, y: -12 }, _camStop2Zoom: 210,
  },
};

/**
 * A pull back: the opposite reading of the same control, so the pair says the
 * zoom at a stop is a direction and not just an amount.
 */
const PULL_BACK: CustomPreset = {
  id: `${SHIPPED_COMPOSE_PREFIX}pull_back`,
  name: 'Pull Back',
  templateId: 'wall-03',
  values: { cardSize: 340, gap: 26, speed: 0.25, hold: 0 },
  easing: { id: 'linear' },
  sceneCamera: {
    _camOn: 1,
    _camZoom: 190, _camPanX: -22, _camPanY: 14, _camOrbitX: 0, _camOrbitY: 0,
    _camStop2: { x: 0, y: 0 }, _camStop2Zoom: 75,
  },
};

export const SHIPPED_COMPOSES: CustomPreset[] = [CONTACT_SHEET, PUSH_IN, PULL_BACK];
