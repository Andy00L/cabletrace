"use client";

import { createContext, useContext } from "react";
import type { CaseSeries } from "@/lib/cases/case-series";
import type { ConsoleCase } from "@/lib/cases/case-console";
import type { ConsoleLayer, ConsoleMode, SeabedDetail } from "@/lib/console/console-state";
import type { ReplayClock } from "@/lib/replay/replay-clock";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { SceneTarget } from "@/lib/seabed/scene/overview";
import type { SeabedViewName } from "@/lib/seabed/scene/viewer";

/** What every part of the replay console reads and the few ways it can change the console. */
export type ConsoleController = {
  input: ReplaySceneInput;
  consoleCase: ConsoleCase;
  series: CaseSeries | null;
  clock: ReplayClock;
  view: SeabedViewName;
  mode: ConsoleMode;
  detail: SeabedDetail;
  layer: ConsoleLayer;
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
