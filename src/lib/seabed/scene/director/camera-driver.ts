import { createShotDirector, type DirectorCommand } from "@/lib/seabed/scene/director/director";
import { chooseLeastHiddenPose, listShotSubjectNames, planShotFraming, poseAnchorCam, poseBridgeView } from "@/lib/seabed/scene/director/framing";
import type { ShotList } from "@/lib/seabed/scene/director/shots";
import type { CameraPose, DirectorSubjects, DirectorViewerPort, SafeArea, SecondView, ViewerFrame } from "@/lib/seabed/scene/director/viewer-port";

// Runs the cameras frame by frame through the viewer's port: the director's shots, the ship cameras the vessel card
// offers, or nothing when the user holds the camera; and the anchor cam window's picture. No React, no DOM of its own:
// the console sets the mode and the window, the viewer calls in before each frame.

/** The ship cameras of the vessel card (board 22): following it, from its bridge, or from behind its anchor. */
export type ShipCamera = "follow" | "bridge" | "anchor";

export type CameraMode = { kind: "director" } | { kind: "ship"; camera: ShipCamera } | { kind: "user" };

/** Insets from the canvas edges, in CSS px. */
export type SafeInsets = { left: number; top: number; right: number; bottom: number };

/** The anchor cam window's canvas and its size in CSS px. */
export type AnchorWindow = Omit<SecondView, "readPose">;

export type CameraDriver = {
  setMode: (mode: CameraMode) => void;
  /** Opens the anchor cam's picture in the window, or closes it (null): its render pass exists only while open. */
  setAnchorWindow: (anchorWindow: AnchorWindow | null) => void;
  dispose: () => void;
};

type DriverOptions = {
  port: DirectorViewerPort;
  shots: ShotList;
  prefersReducedMotion: boolean;
  /** The labels of the case's cuts, in case order, for the subjects' names. */
  cutLabels: readonly string[];
  /**
   * How far in from each edge of the canvas the controls and cards reach (CSS px), read each frame: the rail and the
   * anchor cam come and go. The safe area is what they leave.
   */
  readSafeInsets: () => SafeInsets;
};

/** The whole canvas as a safe area: the anchor cam window has no controls over its picture. */
function readWholeArea(widthPx: number, heightPx: number): SafeArea {
  return { left: 0, top: 0, right: widthPx, bottom: heightPx };
}

/** The follow framing of the ship, chain and anchor at a window's size, for the window when it is swapped with the main view. */
function frameFollowInWindow(subjects: DirectorSubjects, anchorWindow: AnchorWindow, fovDegrees: number, port: DirectorViewerPort): CameraPose | null {
  const framing = planShotFraming({ kind: "follow", startMs: 0, endMs: 0 }, subjects);
  if (!framing) return null;
  const canvas = { widthPx: anchorWindow.widthPx, heightPx: anchorWindow.heightPx };
  return chooseLeastHiddenPose({ framing, fovDegrees, canvas, safeArea: readWholeArea(canvas.widthPx, canvas.heightPx), isHidden: port.isHiddenByRelief })?.pose ?? null;
}

export function createCameraDriver({ port, shots, prefersReducedMotion, cutLabels, readSafeInsets }: DriverOptions): CameraDriver {
  const director = createShotDirector({ shots, prefersReducedMotion });
  let mode: CameraMode = { kind: "user" };
  let anchorWindow: AnchorWindow | null = null;
  // The last frame's inputs: a frame whose replay moment, canvas and safe area are unchanged, with the camera at rest,
  // needs no new command (a paused replay draws no frames on a calm scene, and costs nothing on the others).
  let lastFrameKey = "";
  let lastCommand: DirectorCommand | null = null;

  function driveDirector(frame: ViewerFrame, subjects: DirectorSubjects) {
    const canvas = port.readCanvasSize();
    const insets = readSafeInsets();
    const safeArea: SafeArea = { left: insets.left, top: insets.top, right: Math.max(insets.left + 1, canvas.widthPx - insets.right), bottom: Math.max(insets.top + 1, canvas.heightPx - insets.bottom) };
    const frameKey = `${frame.atMs}|${canvas.widthPx}x${canvas.heightPx}|${safeArea.left},${safeArea.top},${safeArea.right},${safeArea.bottom}`;
    if (frameKey === lastFrameKey && lastCommand && !lastCommand.isMoving) return;
    lastFrameKey = frameKey;
    const command = director.update({
      atMs: frame.atMs,
      nowMs: frame.nowMs,
      subjects,
      canvas,
      safeArea,
      fovDegrees: port.readOverviewFovDegrees(),
      currentPose: port.readCameraPose(),
      isHidden: port.isHiddenByRelief,
    });
    lastCommand = command;
    if (command.view === "closeup") {
      port.setCameraPose(null);
      port.setCloseUpOrbit(command.closeUpOrbitDegrees);
    } else {
      port.setCloseUpOrbit(null);
      port.setCameraPose(command.pose);
    }
    port.recordDirection({ shotKind: command.shot.kind, subjectNames: listShotSubjectNames(command.shot, subjects, cutLabels), safeArea });
  }

  function driveShipCamera(camera: ShipCamera, subjects: DirectorSubjects) {
    port.setCloseUpOrbit(null);
    if (camera === "bridge") port.setCameraPose(subjects.vessel ? poseBridgeView(subjects.vessel) : null);
    else if (camera === "anchor") port.setCameraPose(subjects.anchor ? poseAnchorCam(subjects.anchor) : null);
    // Following is the viewer's own follow camera.
    else port.setCameraPose(null);
  }

  const unsubscribe = port.onBeforeFrame((frame) => {
    switch (mode.kind) {
      case "director":
        driveDirector(frame, port.readSubjects());
        return;
      case "ship":
        driveShipCamera(mode.camera, port.readSubjects());
        return;
      case "user":
        return;
      default: {
        const unhandledMode: never = mode;
        return unhandledMode;
      }
    }
  });

  function readWindowPose(): CameraPose | null {
    const openWindow = anchorWindow;
    if (!openWindow) return null;
    const subjects = port.readSubjects();
    // Swapped: the main view looks from behind the anchor, so the window follows the ship.
    if (mode.kind === "ship" && mode.camera === "anchor") return frameFollowInWindow(subjects, openWindow, port.readOverviewFovDegrees(), port);
    return subjects.anchor ? poseAnchorCam(subjects.anchor) : null;
  }

  return {
    setMode(nextMode) {
      const wasDirecting = mode.kind === "director";
      mode = nextMode;
      lastFrameKey = "";
      if (nextMode.kind === "director") {
        if (!wasDirecting) director.resume();
        return;
      }
      port.recordDirection(null);
      port.setCloseUpOrbit(null);
      if (nextMode.kind === "user") port.setCameraPose(null);
    },
    setAnchorWindow(nextWindow) {
      anchorWindow = nextWindow;
      port.setSecondView(nextWindow ? { ...nextWindow, readPose: readWindowPose } : null);
    },
    dispose() {
      unsubscribe();
      port.setSecondView(null);
      port.setCameraPose(null);
      port.setCloseUpOrbit(null);
      port.recordDirection(null);
    },
  };
}
