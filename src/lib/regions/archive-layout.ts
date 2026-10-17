// Where recorded positions go once they leave the hot table: compressed files in the private Supabase Storage bucket
// position-archive, written by the recorder's daily archive task (supabase/functions/record-vessel-positions/archive.ts).
//
//   bucket position-archive (private)
//     days/<region-id>/<YYYY-MM-DD>.json.gz   one UTC day of a region's positions, kept ARCHIVE_DAY_RETENTION_DAYS
//     detections/<detection-id>.json.gz       an alert's ship track, its window plus 3 hours either side, kept forever
//
// Only regions whose feeds set no retention cap are archived (public.watched_regions.is_archived): aisstream data is
// kept at most 2 days anywhere, archives included (src/data/regions/sources.ts).
// Each file is gzip-compressed JSON written by public.position_archive_document or public.track_archive_document
// (supabase/migrations/20261019500100_position_archive.sql): {version, kind, the day or the detection, columns, rows,
// rowCount}, and for a day the cables its rows name.

export const ARCHIVE_BUCKET = "position-archive";
// 30 days of daily files: a month to replay or re-run the detector on any day. A Gulf of Finland day file is about
// 1.4 MB (20.7 bytes a row measured, docs/REGIONS.md): about 41 MB of the free plan's 1 GB of Storage.
export const ARCHIVE_DAY_RETENTION_DAYS = 30;
// Per daily run, so one call stays far inside the edge function's 2 s of CPU (a Gulf day is about 66,000 rows).
export const ARCHIVE_DAYS_PER_RUN = 3;
export const ARCHIVE_TRACKS_PER_RUN = 20;
export const ARCHIVE_CONTENT_TYPE = "application/gzip";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** Object path of one region's UTC day; null when the day is not a calendar date in YYYY-MM-DD form. */
export function dayArchivePath(regionId: string, day: string): string | null {
  if (!DAY_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return `days/${regionId}/${day}.json.gz`;
}

export function detectionArchivePath(detectionId: number): string {
  return `detections/${detectionId}.json.gz`;
}
