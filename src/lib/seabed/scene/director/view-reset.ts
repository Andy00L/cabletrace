import type { ShipCamera } from "@/lib/seabed/scene/director/camera-driver";
import type { SeabedViewName } from "@/lib/seabed/scene/viewer";

// What the stage's reset button does (StageOverlays). The view's own camera is what a reset puts back on its preset,
// so whatever else holds the camera (the director, a ship camera) lets go first: a held pose is drawn over any
// preset, which is how the button did nothing while the director directed (Eagle S at 23:00, 21 Oct 2026).

/**
 * `release`: who lets go of the camera before the view goes back to its preset. `nothing-to-reset`: the Vessel
 * view's own camera follows the ship and takes no orbit or zoom, so there is no framing of the reader's to undo.
 */
export type ViewReset = { kind: "reset"; releasesDirector: boolean; releasesShipCamera: boolean } | { kind: "nothing-to-reset" };

export function planViewReset({ view, isDirectorOn, shipCamera }: { view: SeabedViewName; isDirectorOn: boolean; shipCamera: ShipCamera }): ViewReset {
  // A ship camera other than Follow holds the Vessel view whenever the director does not (ReplayConsole,
  // cameraModeKey), so it goes back to Follow too: else the director would hand the camera to it.
  const hasShipCameraHold = view === "vessel" && shipCamera !== "follow";
  if (view === "vessel" && !isDirectorOn && !hasShipCameraHold) return { kind: "nothing-to-reset" };
  return { kind: "reset", releasesDirector: isDirectorOn, releasesShipCamera: hasShipCameraHold };
}
