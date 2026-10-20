import { APPROACH_LEAD_MS, CUT_HOLD_MS } from "@/lib/seabed/scene/director/shots";

// The replay clock slows around each cut so the approach and the close-up can be watched (Andy's approval, 20 Oct
// 2026): thirty times slower from the approach's start (6 minutes before the cut) to the close-up's end (2 minutes
// after). On Eagle S, whose 13-hour window plays in 40 s, those 8 minutes take about 12 s instead of 0.4 s. The pace
// eases in and out over a ramp on each side, so the ship does not stop dead: the pace changes geometrically there.

export const CUT_SLOW_FACTOR = 30;
/** Replay time over which the pace eases between normal and slow, on each side of a slow stretch. */
export const PACE_RAMP_MS = 2 * 60_000;

const SLOWEST_PACE = 1 / CUT_SLOW_FACTOR;

/**
 * The clock's pace at a replay moment: 1 at normal speed, 1/30 within 6 minutes before and 2 minutes after a cut,
 * and in between on the ramps. Overlapping stretches take the slower pace.
 */
export function readReplayPace(cutTimesMs: readonly number[], atMs: number): number {
  let pace = 1;
  for (const cutMs of cutTimesMs) {
    const slowStartMs = cutMs - APPROACH_LEAD_MS;
    const slowEndMs = cutMs + CUT_HOLD_MS;
    const outsideMs = atMs < slowStartMs ? slowStartMs - atMs : atMs > slowEndMs ? atMs - slowEndMs : 0;
    if (outsideMs >= PACE_RAMP_MS) continue;
    // Geometric between the slow pace (at the stretch's edge) and the normal pace (at the ramp's far end).
    const cutPace = SLOWEST_PACE ** (1 - outsideMs / PACE_RAMP_MS);
    pace = Math.min(pace, cutPace);
  }
  return pace;
}
