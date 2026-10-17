import type { CableLine, DepthLookup, Detection } from "@/lib/detection/detection-types";
import type { ShipTrack } from "@/lib/detection/detection-inputs";
import { assessTrack, compareDetections } from "@/lib/detection/detect-anchor-drag";

// One detector pass over every recorded ship, shared by the edge function (every 5 minutes) and the backtest replay,
// so the false-alert rate the backtest measures is the rate the live schedule produces.

// The edge function reads this much history on every call: a run of up to a few hours plus the 3 hours after it that
// the speed-deficit rule may compare against (REFERENCE_AFTER_MS in drag-rules.ts).
export const DETECTION_LOOKBACK_MS = 6 * 60 * 60 * 1000;
// pg_cron calls the edge function this often (supabase/migrations/20261018300000_detections.sql).
export const DETECTION_INTERVAL_MS = 5 * 60 * 1000;

export type FleetDetection = { mmsi: number; detection: Detection };
export type FleetSummary = { shipCount: number; notEligibleCount: number; insufficientDataCount: number; detections: FleetDetection[] };

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
