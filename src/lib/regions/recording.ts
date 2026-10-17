// What the near-cable recorder (supabase/functions/record-vessel-positions) sends to public.ingest_vessel_positions
// each minute: reports from every region's own feeds, inside its box, one per ship and feed. The database then keeps
// those within the region's near-cable distance and thins stationary repeats with the region's thresholds
// (public.watched_regions). Everything here reads the registry; nothing branches on a region id.
import type { PositionDetail } from "@/lib/live/ais-reports";
import type { BoundingBox, LiveSourceId, Region } from "@/lib/regions/region";
import { isInsideBox, selectRegionsBySource } from "@/lib/regions/region";

/** One report as ingest_vessel_positions reads it (supabase/migrations/20261019200000_regional_recording.sql). */
export type RecorderReport = {
  mmsi: number;
  reportedAtMs: number;
  longitude: number;
  latitude: number;
  speedKnots: number | null;
  courseDegrees: number | null;
  headingDegrees: number | null;
  navigationStatus: number | null;
  turnRate: number | null;
  source: LiveSourceId;
};

export function toRecorderReport({ report, status }: PositionDetail): RecorderReport {
  return {
    mmsi: report.mmsi,
    reportedAtMs: report.reportedAtMs,
    longitude: report.longitude,
    latitude: report.latitude,
    speedKnots: report.speedKnots,
    courseDegrees: report.courseDegrees,
    headingDegrees: report.headingDegrees,
    navigationStatus: status.navigationStatus,
    turnRate: status.turnRate,
    source: report.source,
  };
}

/** The boxes a feed must cover for the recorder: those of the regions recorded from it. */
export function boxesForSource(regions: readonly Region[], sourceId: LiveSourceId): BoundingBox[] {
  return selectRegionsBySource(regions, sourceId).map((region) => region.box);
}

/**
 * Keeps the reports a region records: inside the box of a region that lists the report's feed. Of several reports of
 * one ship from one feed (aisstream sends one every 2 to 10 s), the newest stays, so a ship adds at most one position
 * a minute, the spacing the detector's rules were set on (src/lib/detection/drag-rules.ts).
 */
export function selectRecordableReports(regions: readonly Region[], reports: readonly RecorderReport[]): RecorderReport[] {
  const newestByShipAndSource = new Map<string, RecorderReport>();
  for (const report of reports) {
    const isRecorded = regions.some((region) => region.liveSources.includes(report.source) && isInsideBox(region.box, report.longitude, report.latitude));
    if (!isRecorded) continue;
    const key = `${report.source}:${report.mmsi}`;
    const known = newestByShipAndSource.get(key);
    if (known === undefined || report.reportedAtMs > known.reportedAtMs) newestByShipAndSource.set(key, report);
  }
  return [...newestByShipAndSource.values()].sort((first, second) => first.mmsi - second.mmsi || first.reportedAtMs - second.reportedAtMs);
}
