import type { TrackGap, TrackPoint } from "@/lib/detection/detection-types";
import { distanceMetres, knotsFromMetres } from "@/lib/detection/geodesy";

// Engineering bound, not a measurement: no merchant ship sustains 50 knots, so a move that implies more is a bad
// or spoofed position, not motion.
const MAX_PLAUSIBLE_SPEED_KNOTS = 50;
// A jump must also be longer than this, in metres, so GPS jitter between reports a second apart is not called a jump.
const POSITION_JUMP_MIN_METRES = 1_000;
// After a jump, this many consecutive reports that agree with each other mean the ship really is there (the earlier
// positions were the bad ones, or the ship moved during a silence); fewer are discarded as the jump.
const RELOCATION_CONFIRM_COUNT = 3;
// Reports further apart than this (20 minutes, about 5.6 km at the 9-knot top of the drag band) are a silence:
// the detector never assumes what the ship did while it was not reporting.
export const MAX_REPORT_GAP_MS = 20 * 60 * 1000;

export type CleanTrack = {
  /** Valid reports in time order, jumps removed. */
  points: TrackPoint[];
  /** Removed jumps, and silences longer than MAX_REPORT_GAP_MS. */
  gaps: TrackGap[];
};

function isValidPoint(point: TrackPoint): boolean {
  return (
    Number.isFinite(point.atMs) &&
    Number.isFinite(point.longitude) &&
    Number.isFinite(point.latitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

function isPlausibleMove(from: TrackPoint, to: TrackPoint): boolean {
  const metres = distanceMetres(from, to);
  return metres < POSITION_JUMP_MIN_METRES || knotsFromMetres(metres, to.atMs - from.atMs) <= MAX_PLAUSIBLE_SPEED_KNOTS;
}

function areMutuallyPlausible(points: readonly TrackPoint[]): boolean {
  return points.every((point, index) => {
    const previous = points[index - 1];
    return previous === undefined || isPlausibleMove(previous, point);
  });
}

/** Sorts, drops malformed and duplicate-time reports, then removes position jumps. */
function rejectJumps(sortedPoints: readonly TrackPoint[]): { accepted: TrackPoint[]; jumpGaps: TrackGap[] } {
  const accepted: TrackPoint[] = [];
  const jumpGaps: TrackGap[] = [];
  let pending: TrackPoint[] = [];
  for (const point of sortedPoints) {
    const lastAccepted = accepted[accepted.length - 1];
    if (lastAccepted === undefined || isPlausibleMove(lastAccepted, point)) {
      if (lastAccepted !== undefined && pending.length > 0) jumpGaps.push({ fromMs: lastAccepted.atMs, toMs: point.atMs, cause: "position-jump" });
      accepted.push(point);
      pending = [];
      continue;
    }
    pending.push(point);
    if (pending.length >= RELOCATION_CONFIRM_COUNT && areMutuallyPlausible(pending)) {
      const [firstPending] = pending;
      if (firstPending) jumpGaps.push({ fromMs: lastAccepted.atMs, toMs: firstPending.atMs, cause: "position-jump" });
      accepted.push(...pending);
      pending = [];
    }
  }
  const lastAccepted = accepted[accepted.length - 1];
  const [firstPending] = pending;
  if (lastAccepted && firstPending) jumpGaps.push({ fromMs: lastAccepted.atMs, toMs: firstPending.atMs, cause: "position-jump" });
  return { accepted, jumpGaps };
}

/**
 * Turns raw reports into a track the rules can trust: time order, no malformed or duplicate reports, no spoofed
 * jumps, and the silences listed as gaps instead of being bridged.
 */
export function cleanTrack(rawPoints: readonly TrackPoint[]): CleanTrack {
  const sorted = rawPoints.filter(isValidPoint).sort((first, second) => first.atMs - second.atMs);
  const unique = sorted.filter((point, index) => sorted[index - 1]?.atMs !== point.atMs);
  const { accepted, jumpGaps } = rejectJumps(unique);
  const silenceGaps = accepted.flatMap((point, index): TrackGap[] => {
    const previous = accepted[index - 1];
    return previous && point.atMs - previous.atMs > MAX_REPORT_GAP_MS ? [{ fromMs: previous.atMs, toMs: point.atMs, cause: "silence" }] : [];
  });
  const gaps = [...jumpGaps, ...silenceGaps].sort((first, second) => first.fromMs - second.fromMs);
  return { points: accepted, gaps };
}
