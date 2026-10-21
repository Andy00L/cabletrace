import type * as THREE from "three";
import { easeStandard, interpolatePose, planShotTransition, type ShotTransition } from "@/lib/seabed/scene/director/camera-moves";
import { chooseLeastHiddenPose, fitCameraToPoints, planShotFraming } from "@/lib/seabed/scene/director/framing";
import { isSameShot, pickShotAt, readShotView, type DirectorView, type Shot, type ShotList } from "@/lib/seabed/scene/director/shots";
import type { CameraPose, CanvasSize, DirectorSubjects, SafeArea } from "@/lib/seabed/scene/director/viewer-port";

// The director's state from frame to frame: which shot is on, which of its angles was chosen, and the flight into it.
// No DOM and no renderer: the viewer hands it each frame's subjects and applies the command it returns.

/** The close-up's slow orbit around the torn ends (degrees per second of wall time), and its still angle under reduced motion (board 21, S4). */
export const CLOSE_UP_ORBIT_DEGREES_PER_SECOND = 10;
export const CLOSE_UP_STILL_DEGREES = 35;
// While the chosen angle hides a subject, the director looks for a clearer one at most this often (wall ms), so the
// camera does not hop between angles from frame to frame.
const RECHOOSE_INTERVAL_MS = 1000;

/** What the director knows about the frame being drawn. */
export type DirectorFrame = {
  atMs: number;
  /** Wall time, performance.now() ms. */
  nowMs: number;
  subjects: DirectorSubjects;
  canvas: CanvasSize;
  safeArea: SafeArea;
  fovDegrees: number;
  /** The camera as last drawn, where a flight starts. */
  currentPose: CameraPose;
  isHidden: (point: THREE.Vector3, cameraPosition: THREE.Vector3) => boolean;
};

/**
 * What to draw: the shot's view and either the overview camera's pose, or (`pose` null) the view's own camera; in the
 * close-up, the orbit angle about its target.
 */
/** `isMoving` is true while the camera flies or orbits: the next frame needs a new command even if nothing else changed. */
export type DirectorCommand = { shot: Shot; view: DirectorView; pose: CameraPose | null; closeUpOrbitDegrees: number; isMoving: boolean };

export type ShotDirector = {
  update: (frame: DirectorFrame) => DirectorCommand;
  /** The user handed the camera back (the Director toggle): the next frame flies from wherever the camera is. */
  resume: () => void;
};

type ShotState = { shot: Shot; startedAtNowMs: number; transition: ShotTransition; fromPose: CameraPose; directionIndex: number; lastChosenAtNowMs: number };

export function createShotDirector({ shots, prefersReducedMotion }: { shots: ShotList; prefersReducedMotion: boolean }): ShotDirector {
  let state: ShotState | null = null;
  let isResuming = false;

  function chooseDirection(shot: Shot, frame: DirectorFrame): number {
    const framing = planShotFraming(shot, frame.subjects);
    if (!framing) return 0;
    const chosen = chooseLeastHiddenPose({ framing, fovDegrees: frame.fovDegrees, canvas: frame.canvas, safeArea: frame.safeArea, isHidden: frame.isHidden });
    return chosen?.directionIndex ?? 0;
  }

  function startShot(shot: Shot, frame: DirectorFrame): ShotState {
    const transition = planShotTransition(isResuming ? "user" : (state?.shot.kind ?? null), shot.kind, prefersReducedMotion);
    isResuming = false;
    return { shot, startedAtNowMs: frame.nowMs, transition, fromPose: frame.currentPose, directionIndex: chooseDirection(shot, frame), lastChosenAtNowMs: frame.nowMs };
  }

  function update(frame: DirectorFrame): DirectorCommand {
    const shot = pickShotAt(shots, frame.atMs);
    if (state === null || isResuming || !isSameShot(state.shot, shot)) state = startShot(shot, frame);
    const view = readShotView(shot);
    if (shot.kind === "cut") {
      const orbitDegrees = prefersReducedMotion ? CLOSE_UP_STILL_DEGREES : ((frame.nowMs - state.startedAtNowMs) / 1000) * CLOSE_UP_ORBIT_DEGREES_PER_SECOND;
      return { shot, view, pose: null, closeUpOrbitDegrees: orbitDegrees, isMoving: !prefersReducedMotion };
    }
    const framing = planShotFraming(shot, frame.subjects);
    if (!framing) return { shot, view, pose: null, closeUpOrbitDegrees: 0, isMoving: false };
    const fitFrom = (directionIndex: number) => {
      const direction = framing.directions[directionIndex] ?? framing.directions[0];
      return direction ? fitCameraToPoints({ points: framing.points, direction, fovDegrees: frame.fovDegrees, canvas: frame.canvas, safeArea: frame.safeArea }) : null;
    };
    let goal = fitFrom(state.directionIndex);
    // A subject went behind the relief: look for a clearer angle, at most once a RECHOOSE_INTERVAL_MS.
    const fittedPosition = goal?.position ?? null;
    const isAnyHidden = fittedPosition !== null && framing.points.some((point) => frame.isHidden(point, fittedPosition));
    if (isAnyHidden && frame.nowMs - state.lastChosenAtNowMs >= RECHOOSE_INTERVAL_MS) {
      state = { ...state, directionIndex: chooseDirection(shot, frame), lastChosenAtNowMs: frame.nowMs };
      goal = fitFrom(state.directionIndex);
    }
    if (!goal) return { shot, view, pose: null, closeUpOrbitDegrees: 0, isMoving: false };
    if (state.transition.kind === "flight") {
      const amount = (frame.nowMs - state.startedAtNowMs) / state.transition.durationMs;
      if (amount < 1) return { shot, view, pose: interpolatePose(state.fromPose, goal, easeStandard(amount)), closeUpOrbitDegrees: 0, isMoving: true };
    }
    return { shot, view, pose: goal, closeUpOrbitDegrees: 0, isMoving: false };
  }

  return {
    update,
    resume() {
      isResuming = true;
    },
  };
}
