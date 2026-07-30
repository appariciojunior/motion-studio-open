// ============================================================
//  BOARD MODE — SAVE / LOAD A SESSION AS JSON
//  Serializes everything the right bar drives — the board arrangement AND the
//  chosen animation (template + its values + easing + duration) — into one
//  portable object. Download it, keep it, paste it back next session to land
//  on exactly the same screen.
//
//  It reads/writes the two stores directly (getState/setState). Applying the
//  scene through setState rather than setActiveTemplate is deliberate:
//  setActiveTemplate resets the value bag to defaults, which would throw away
//  the saved tweaks we are trying to restore.
// ============================================================

import { useSceneStore } from '@/store/useSceneStore';
import { useBoardStore } from '@/store/useBoardStore';
import { getTemplate } from '@/templates';
import type { EasingSpec } from './easing';
import type { BoardValues, BoardPerCard } from './boardPose';

export const BOARD_PROJECT_VERSION = 1;

export interface BoardProject {
  app: 'motion-studio';
  kind: 'board-project';
  version: number;
  board: {
    count: number;
    board: BoardValues;
    perCard: BoardPerCard;
    motionOn: boolean;
    hoverPlay?: boolean;
    hoverMs?: number;
    hoverScope?: 'board' | 'card';
    hoverRadius?: number;
    hoverSide?: 'both' | 'left' | 'right';
    liftOn?: boolean;
    frameW?: number;
    frameH?: number;
  };
  scene: {
    activeTemplateId: string;
    values: Record<string, any>;
    easing: EasingSpec;
    duration: number;
  };
}

// Snapshot the current board + scene into a plain object.
export function buildBoardProject(): BoardProject {
  const bs = useBoardStore.getState();
  const st = useSceneStore.getState();
  return {
    app: 'motion-studio',
    kind: 'board-project',
    version: BOARD_PROJECT_VERSION,
    board: {
      count: bs.count,
      board: bs.board,
      perCard: bs.perCard,
      motionOn: bs.motionOn,
      hoverPlay: bs.hoverPlay,
      hoverMs: bs.hoverMs,
      hoverScope: bs.hoverScope,
      hoverRadius: bs.hoverRadius,
      hoverSide: bs.hoverSide,
      liftOn: bs.liftOn,
      frameW: bs.frameW,
      frameH: bs.frameH,
    },
    scene: {
      activeTemplateId: st.activeTemplateId,
      values: st.values,
      easing: st.easing,
      duration: st.duration,
    },
  };
}

export function serializeBoardProject(): string {
  return JSON.stringify(buildBoardProject(), null, 2);
}

export type ParseResult =
  | { ok: true; project: BoardProject }
  | { ok: false; error: string };

// Parse + validate a pasted/uploaded string. Lenient about the wrapper fields
// but strict enough to refuse an unrelated JSON blob.
export function parseBoardProject(text: string): ParseResult {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch (e: any) {
    return { ok: false, error: `Not valid JSON: ${e?.message ?? String(e)}` };
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'Empty or non-object JSON.' };
  if (data.kind !== 'board-project') {
    return { ok: false, error: 'This is not a board project file (missing kind: "board-project").' };
  }
  if (!data.board || !data.scene) return { ok: false, error: 'Missing board or scene section.' };
  if (typeof data.scene.activeTemplateId !== 'string') {
    return { ok: false, error: 'Missing scene.activeTemplateId.' };
  }
  return { ok: true, project: data as BoardProject };
}

// Apply a parsed project to the live stores — restoring the screen.
export function applyBoardProject(p: BoardProject) {
  const b = p.board ?? ({} as BoardProject['board']);
  useBoardStore.setState({
    count: b.count ?? 3,
    board: b.board,
    perCard: b.perCard ?? {},
    motionOn: !!b.motionOn,
    hoverPlay: !!b.hoverPlay,
    hoverMs: b.hoverMs ?? 350,
    hoverScope: b.hoverScope === 'card' ? 'card' : 'board',
    hoverRadius: b.hoverRadius ?? 1,
    hoverSide: b.hoverSide ?? 'both',
    liftOn: b.liftOn ?? true,
    frameW: b.frameW ?? 1440,
    frameH: b.frameH ?? 720,
  });

  const s = p.scene;
  // Guard the template id: a project saved against a template that no longer
  // exists falls back to whatever getTemplate resolves, and we store that id so
  // the panels don't point at a phantom.
  const tpl = getTemplate(s.activeTemplateId);
  // Route the motion through patchTrack rather than setState: the top-level
  // activeTemplateId/values/easing are a projection of the ACTIVE TRACK, so
  // writing them directly would leave the track (what the renderer reads) stale.
  // A board project carries one motion, so it lands on the active track.
  const st = useSceneStore.getState();
  st.patchTrack(st.activeTrackId, {
    templateId: tpl.meta.id,
    values: s.values ?? {},
    easing: s.easing,
  });
  useSceneStore.setState({ duration: s.duration ?? 8, frame: 0 });
}
