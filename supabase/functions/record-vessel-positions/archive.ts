// The recorder's daily archive task (pg_cron sends {"task":"archive"}): moves complete UTC days of the archived
// regions into compressed files in Storage before public.prune_vessel_positions drops them from the hot table, keeps
// every alert's ship track forever, and deletes day files past their retention. Layout and limits:
// src/lib/regions/archive-layout.ts. Database and Storage come in as ports, so the tests run this exact code.
import type { Result } from "../../../src/lib/result.ts";
import { gzipBytes } from "../../../src/lib/live/frame-compression.ts";
import {
  ARCHIVE_DAY_RETENTION_DAYS,
  ARCHIVE_DAYS_PER_RUN,
  ARCHIVE_TRACKS_PER_RUN,
  dayArchivePath,
  detectionArchivePath,
} from "@/lib/regions/archive-layout";

export type PendingDay = { regionId: string; day: string };
export type PendingTrack = { detectionId: number; regionId: string };
/** One row of public.position_archives. */
export type ArchiveEntry = { objectPath: string; regionId: string; kind: "day" | "detection"; day: string | null; detectionId: number | null; rowCount: number; byteCount: number };

export type ArchivePorts = {
  listPendingDays: (maxDays: number) => Promise<Result<PendingDay[]>>;
  // The JSON document of public.position_archive_document or public.track_archive_document.
  readDayDocument: (day: PendingDay) => Promise<Result<unknown>>;
  listPendingTracks: (maxTracks: number) => Promise<Result<PendingTrack[]>>;
  readTrackDocument: (track: PendingTrack) => Promise<Result<unknown>>;
  writeObject: (objectPath: string, bytes: Uint8Array) => Promise<Result<null>>;
  recordArchive: (entry: ArchiveEntry) => Promise<Result<null>>;
  listExpiredDays: (retentionDays: number) => Promise<Result<string[]>>;
  deleteObjects: (objectPaths: string[]) => Promise<Result<null>>;
  forgetArchives: (objectPaths: string[]) => Promise<Result<null>>;
};

export type ArchiveSummary = { daysArchived: number; tracksKept: number; rowsArchived: number; bytesWritten: number; expiredDeleted: number; errors: string[] };

function readRowCount(document: unknown): number | null {
  if (typeof document !== "object" || document === null || !("rowCount" in document)) return null;
  const { rowCount } = document;
  return typeof rowCount === "number" && Number.isInteger(rowCount) && rowCount >= 0 ? rowCount : null;
}

/** Compresses and uploads one document, then records it; the record is what lets the prune drop the hot rows. */
async function storeDocument(ports: ArchivePorts, document: Result<unknown>, entry: Omit<ArchiveEntry, "rowCount" | "byteCount">): Promise<Result<ArchiveEntry>> {
  if (!document.ok) return document;
  const rowCount = readRowCount(document.value);
  if (rowCount === null) return { ok: false, reason: `${entry.objectPath}: the archive document has no row count` };
  const compressed = await gzipBytes(new TextEncoder().encode(JSON.stringify(document.value)));
  if (!compressed.ok) return compressed;
  const written = await ports.writeObject(entry.objectPath, compressed.value);
  if (!written.ok) return written;
  const archived: ArchiveEntry = { ...entry, rowCount, byteCount: compressed.value.byteLength };
  const recorded = await ports.recordArchive(archived);
  return recorded.ok ? { ok: true, value: archived } : recorded;
}

/** Runs one archive pass. Never throws; failures land in `errors`, and an unarchived day simply stays hot until the next run. */
export async function archivePositions(ports: ArchivePorts): Promise<ArchiveSummary> {
  const summary: ArchiveSummary = { daysArchived: 0, tracksKept: 0, rowsArchived: 0, bytesWritten: 0, expiredDeleted: 0, errors: [] };
  const count = (archived: ArchiveEntry) => {
    summary.rowsArchived += archived.rowCount;
    summary.bytesWritten += archived.byteCount;
  };

  const days = await ports.listPendingDays(ARCHIVE_DAYS_PER_RUN);
  if (!days.ok) summary.errors.push(days.reason);
  for (const pending of days.ok ? days.value : []) {
    const objectPath = dayArchivePath(pending.regionId, pending.day);
    if (objectPath === null) {
      summary.errors.push(`pending day ${pending.day} of ${pending.regionId} is not a date`);
      continue;
    }
    const archived = await storeDocument(ports, await ports.readDayDocument(pending), { objectPath, regionId: pending.regionId, kind: "day", day: pending.day, detectionId: null });
    if (!archived.ok) summary.errors.push(archived.reason);
    else {
      summary.daysArchived += 1;
      count(archived.value);
    }
  }

  const tracks = await ports.listPendingTracks(ARCHIVE_TRACKS_PER_RUN);
  if (!tracks.ok) summary.errors.push(tracks.reason);
  for (const pending of tracks.ok ? tracks.value : []) {
    const objectPath = detectionArchivePath(pending.detectionId);
    const archived = await storeDocument(ports, await ports.readTrackDocument(pending), { objectPath, regionId: pending.regionId, kind: "detection", day: null, detectionId: pending.detectionId });
    if (!archived.ok) summary.errors.push(archived.reason);
    else {
      summary.tracksKept += 1;
      count(archived.value);
    }
  }

  const expired = await ports.listExpiredDays(ARCHIVE_DAY_RETENTION_DAYS);
  if (!expired.ok) summary.errors.push(expired.reason);
  else if (expired.value.length > 0) {
    // Files first, rows second: a failed delete leaves the row, so the next run tries the file again.
    const deleted = await ports.deleteObjects(expired.value);
    const forgotten = deleted.ok ? await ports.forgetArchives(expired.value) : deleted;
    if (!forgotten.ok) summary.errors.push(forgotten.reason);
    else summary.expiredDeleted = expired.value.length;
  }
  return summary;
}
