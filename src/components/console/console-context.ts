"use client";

import { createContext, useContext } from "react";
import type { CaseSeries } from "@/lib/cases/case-series";
import type { ConsoleCase } from "@/lib/cases/case-console";
import type { ConsoleLayer, ConsoleMode, SeabedDetail } from "@/lib/console/console-state";
import type { ReplayClock } from "@/lib/replay/replay-clock";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { ShipCamera } from "@/lib/seabed/scene/director/camera-driver";
import type { DirectorViewerPort } from "@/lib/seabed/scene/director/viewer-port";
import type { SceneTarget } from "@/lib/seabed/scene/overview";
import type { SeabedViewName } from "@/lib/seabed/scene/viewer";

/** What every part of the replay console reads and the few ways it can change the console. */
export type ConsoleController = {
  input: ReplaySceneInput;
  consoleCase: ConsoleCase;
  series: CaseSeries | null;
  clock: ReplayClock;
  /** The view on screen: the director's shot while it directs, the view picked by the user otherwise. */
  view: SeabedViewName;
  /** True while the director picks the camera from the replay time (src/lib/seabed/scene/director). */
  isDirectorOn: boolean;
  /** Hands the camera to the director, or takes it back where the director left it. */
  setDirectorOn: (isOn: boolean) => void;
  /** The ship camera the vessel card picked (Follow, Bridge view, Anchor cam), drawn in the Vessel view. */
  shipCamera: ShipCamera;
  /** Picks a ship camera and moves to the Vessel view; null until the 3D view can draw them. */
  setShipCamera: ((camera: ShipCamera) => void) | null;
  /** True while the anchor cam is on screen at its large size (AnchorCamWindow): the status pill and rail make room. */
  isAnchorCamExpanded: boolean;
  setAnchorCamExpanded: (isExpanded: boolean) => void;
  /** The 3D view's port, for the readouts drawn from it (hover, the anchor cam's figures); null until it draws. */
  directorPort: DirectorViewerPort | null;
  mode: ConsoleMode;
  detail: SeabedDetail;
  layer: ConsoleLayer;
  /** Picks a view; the user picking one turns the director off. */
  setView: (view: SeabedViewName) => void;
  setMode: (mode: ConsoleMode) => void;
  setDetail: (detail: SeabedDetail) => void;
  /** Opens a card, sheet or dialog. `opener` is the control it sits next to; without one it opens over the stage. */
  openLayer: (layer: ConsoleLayer, opener?: HTMLElement | null) => void;
  closeLayer: () => void;
  /** Moves the replay to a moment and pauses nothing: playing continues from there. */
  seekTo: (atMs: number) => void;
  /** Slides the 3D camera to an object picked in a list (a cut, a placed position); does nothing where it cannot. */
  focusTarget: (target: SceneTarget) => void;
  /** SHA-256 of the case's canonical form, as the downloadable case file records it (src/lib/cases/case-export.ts). */
  caseFileSha256: string | null;
};

export const ConsoleControllerContext = createContext<ConsoleController | null>(null);

/** The console's shared state; only valid inside ReplayConsole. */
export function useConsole(): ConsoleController {
  const controller = useContext(ConsoleControllerContext);
  if (!controller) {
    // A programming error, not a runtime condition: every console part renders inside ReplayConsole.
    throw new Error("[useConsole] used outside ReplayConsole");
  }
  return controller;
}
