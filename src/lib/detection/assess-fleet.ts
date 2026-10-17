import type { CableLine, DepthLookup, Detection, TrackPoint } from "@/lib/detection/detection-types";
import type { ShipTrack } from "@/lib/detection/detection-inputs";
import { assessTrack, compareDetections } from "@/lib/detection/detect-anchor-drag";
import { DRAG_SPEED_MAX_KNOTS, DRAG_SPEED_MIN_KNOTS } from "@/lib/detection/drag-rules";

// One detector pass over every recorded ship, shared by the edge function (every 30 minutes) and the backtest replay,
// so the false-alert rate the backtest measures is the rate the live schedule produces.

// The edge function reads this much history on every call: a run of up to a few hours plus the 3 hours after it that
// the speed-deficit rule may compare against (REFERENCE_AFTER_MS in drag-rules.ts).
export const DETECTION_LOOKBACK_MS = 6 * 60 * 60 * 1000;
// pg_cron calls the edge function this often (supabase/migrations/20261018300000_detections.sql). Each call reads
// about 0.85 MB from the database (measured 17 Oct 2026: 92 candidate ships, 11,988 positions), which Supabase counts
// as egress: every 30 minutes is about 1.2 GB a month of the free plan's 5 GB; every 5 minutes would be 7.
export const DETECTION_INTERVAL_MS = 30 * 60 * 1000;

export type FleetDetection = { mmsi: number; detection: Detection };
export type FleetSummary = { shipCount: number; notEligibleCount: number; insufficientDataCount: number; detections: FleetDetection[] };

/**
 * Whether a ship's track can hold a detection at all, the test public.detection_inputs() applies in SQL before it
 * sends positions (keep the two in step). Every run point's speed is the median of three raw speeds (speedsOf in
 * drag-rules.ts), and a median of three is one of the three, so a run needs at least one report whose raw speed is
 * in the drag band, or has no reported speed (its raw speed is then derived from the move). Ships without one are
 * never flagged, so leaving them out changes no result; the backtest checks that on recorded traffic.
 */
export function isDetectionCandidate(track: readonly TrackPoint[]): boolean {
  return track.some((point) => point.speedKnots === null || (point.speedKnots >= DRAG_SPEED_MIN_KNOTS && point.speedKnots <= DRAG_SPEED_MAX_KNOTS));
}

/** Assesses every ship and ranks what fits, strongest evidence first. */
export function assessFleet(input: { tracks: readonly ShipTrack[]; cables: readonly CableLine[]; depthAt: DepthLookup | null }): FleetSummary {
  let notEligibleCount = 0;
  let insufficientDataCount = 0;
  const detections: FleetDetection[] = [];
  for (const shipTrack of input.tracks) {
    const assessment = assessTrack({ track: shipTrack.track, cables: input.cables, depthAt: input.depthAt, ship: shipTrack.ship });
    switch (assessment.kind) {
      case "not-eligible":
        notEligibleCount += 1;
        break;
      case "insufficient-data":
        insufficientDataCount += 1;
        break;
      case "no-fit":
        break;
      case "fits":
        detections.push(...assessment.detections.map((detection) => ({ mmsi: shipTrack.mmsi, detection })));
        break;
      default: {
        const unhandled: never = assessment;
        return unhandled;
      }
    }
  }
  detections.sort((first, second) => compareDetections(first.detection, second.detection));
  return { shipCount: input.tracks.length, notEligibleCount, insufficientDataCount, detections };
}
