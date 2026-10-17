import { formatUtcClock } from "@/lib/replay/format-utc";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";

export type AnchorStatus = { kind: "none" | "before" | "dragging" | "after"; text: string };

/** What the anchor is doing at a replay moment, in the words the status island shows. */
export function describeAnchorStatus(input: Pick<ReplaySceneInput, "dragWindow">, atMs: number): AnchorStatus {
  const dragWindow = input.dragWindow;
  if (!dragWindow) return { kind: "none", text: "No anchor drag in this case" };
  if (atMs < dragWindow.startMs) return { kind: "before", text: `Drag starts at ${formatUtcClock(dragWindow.startMs)}` };
  if (atMs <= dragWindow.endMs) return { kind: "dragging", text: "Anchor dragging on the seabed" };
  return { kind: "after", text: `Drag ended at ${formatUtcClock(dragWindow.endMs)}` };
}
