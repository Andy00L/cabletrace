import type { WatchedLine } from "@/lib/globe/watched-line";

// Andy's "red waves where a cable was cut that day" (world-watch.md section 2, approved 20 Oct 2026): a ripple on a
// watched cable when a fault signal's window overlaps the recorded day. A draft names the cable, not the spot, so the
// ripple sits on the cable's middle point and says only that a signal named this cable.

/** The fields of a draft case the ripple needs (src/lib/fault-signals/fault-api.ts, DraftCaseSummary). */
type DraftFault = { cableName: string; faultNotBeforeMs: number; faultNotAfterMs: number };

export type FaultRipple = { cableName: string; longitude: number; latitude: number };

/** The middle vertex of a line's flat [longitude, latitude, ...] points, or null for an empty line. */
function readMiddlePoint(line: WatchedLine): { longitude: number; latitude: number } | null {
  const pointCount = Math.floor(line.points.length / 2);
  if (pointCount === 0) return null;
  const middleOffset = Math.floor(pointCount / 2) * 2;
  const longitude = line.points[middleOffset];
  const latitude = line.points[middleOffset + 1];
  return longitude === undefined || latitude === undefined ? null : { longitude, latitude };
}

/** One ripple per watched cable a draft's fault window puts inside the day; a cable named twice ripples once. */
export function findFaultRipples(input: { drafts: readonly DraftFault[]; watchedLines: readonly WatchedLine[]; dayStartMs: number; dayEndMs: number }): FaultRipple[] {
  const ripples = new Map<string, FaultRipple>();
  for (const draft of input.drafts) {
    if (draft.faultNotAfterMs < input.dayStartMs || draft.faultNotBeforeMs > input.dayEndMs || ripples.has(draft.cableName)) continue;
    const line = input.watchedLines.find((candidate) => candidate.name === draft.cableName);
    const middle = line ? readMiddlePoint(line) : null;
    if (middle) ripples.set(draft.cableName, { cableName: draft.cableName, ...middle });
  }
  return [...ripples.values()];
}
