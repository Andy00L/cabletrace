import { formatUtcClock } from "@/lib/replay/format-utc";
import { findHeldStretch, type ReplaySceneInput } from "@/lib/replay/replay-scene";

export type AnchorStatus = { kind: "none" | "before" | "dragging" | "after"; text: string };

/**
 * What the anchor is doing at a replay moment, in the words the status island shows. A case without a drag also says
 * when the ship is held at one placed point (findHeldStretch), so a ship that does not move reads as the record.
 */
export function describeAnchorStatus(input: Pick<ReplaySceneInput, "dragWindow" | "track">, atMs: number): AnchorStatus {
  const dragWindow = input.dragWindow;
  if (!dragWindow) return { kind: "none", text: findHeldStretch(input.track, atMs) ? "Ship held at one point, no anchor drag" : "No anchor drag in this case" };
  if (atMs < dragWindow.startMs) return { kind: "before", text: `Drag starts at ${formatUtcClock(dragWindow.startMs)}` };
  if (atMs <= dragWindow.endMs) return { kind: "dragging", text: "Anchor dragging on the seabed" };
  return { kind: "after", text: `Drag ended at ${formatUtcClock(dragWindow.endMs)}` };
}
