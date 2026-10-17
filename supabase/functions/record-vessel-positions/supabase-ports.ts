// Database and Storage ports of the recorder, backed by supabase-js with the project's secret key. Tables and functions:
// supabase/migrations/20261017020000_live_recorder.sql, 20261019200000_regional_recording.sql and
// 20261019200100_position_archive.sql.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../../src/lib/result.ts";
import { ARCHIVE_BUCKET, ARCHIVE_CONTENT_TYPE } from "@/lib/regions/archive-layout";
import type { ArchivePorts, PendingDay, PendingTrack } from "./archive.ts";
import type { RecorderPorts, RecorderState } from "./record.ts";

// Storage removes at most 1,000 objects per call.
const DELETE_BATCH = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumberOrNull(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function callRpc(database: SupabaseClient, name: string, args: Record<string, unknown>): Promise<Result<unknown>> {
  const { data, error } = await database.rpc(name, args);
  return error ? { ok: false, reason: `${name} failed: ${error.message}` } : { ok: true, value: data };
}

function parsePendingDays(payload: unknown): Result<PendingDay[]> {
  if (!Array.isArray(payload)) return { ok: false, reason: "pending_archive_days did not return an array" };
  const days = payload.flatMap((entry): PendingDay[] =>
    isRecord(entry) && typeof entry.regionId === "string" && typeof entry.day === "string" ? [{ regionId: entry.regionId, day: entry.day }] : [],
  );
  return days.length === payload.length ? { ok: true, value: days } : { ok: false, reason: "pending_archive_days returned a malformed entry" };
}

function parsePendingTracks(payload: unknown): Result<PendingTrack[]> {
  if (!Array.isArray(payload)) return { ok: false, reason: "pending_archive_tracks did not return an array" };
  const tracks = payload.flatMap((entry): PendingTrack[] =>
    isRecord(entry) && typeof entry.detectionId === "number" && typeof entry.regionId === "string" ? [{ detectionId: entry.detectionId, regionId: entry.regionId }] : [],
  );
  return tracks.length === payload.length ? { ok: true, value: tracks } : { ok: false, reason: "pending_archive_tracks returned a malformed entry" };
}

export function createRecorderStore(database: SupabaseClient): Pick<RecorderPorts, "readState" | "writeState" | "ingestReports" | "upsertVessels" | "insertRun"> {
  return {
    readState: async (): Promise<Result<RecorderState>> => {
      const { data, error } = await database.from("recorder_state").select("last_report_ms, last_vessel_refresh_ms").eq("id", 1).single();
      if (error || !isRecord(data)) return { ok: false, reason: `recorder_state unreadable: ${error?.message ?? "no row"}` };
      return { ok: true, value: { lastReportMs: readNumberOrNull(data, "last_report_ms"), lastVesselRefreshMs: readNumberOrNull(data, "last_vessel_refresh_ms") } };
    },
    writeState: async (state) => {
      const { error } = await database
        .from("recorder_state")
        .update({ last_report_ms: state.lastReportMs, last_vessel_refresh_ms: state.lastVesselRefreshMs })
        .eq("id", 1);
      return error ? { ok: false, reason: `recorder_state update failed: ${error.message}` } : { ok: true, value: null };
    },
    ingestReports: async (reports) => {
      const stored = await callRpc(database, "ingest_vessel_positions", { reports });
      return stored.ok ? { ok: true, value: typeof stored.value === "number" ? stored.value : 0 } : stored;
    },
    upsertVessels: async (vessels) => {
      const upserted = await callRpc(database, "upsert_vessels", { vessels });
      return upserted.ok ? { ok: true, value: typeof upserted.value === "number" ? upserted.value : 0 } : upserted;
    },
    insertRun: async (run) => {
      const { error } = await database.from("recorder_runs").insert({
        received_count: run.receivedCount,
        in_region_count: run.inRegionCount,
        stored_count: run.storedCount,
        vessels_updated_count: run.vesselsUpdatedCount,
        source_counts: run.sourceCounts,
        error: run.errors.length > 0 ? run.errors.join("; ") : null,
      });
      return error ? { ok: false, reason: `recorder_runs insert failed: ${error.message}` } : { ok: true, value: null };
    },
  };
}

export function createArchiveStore(database: SupabaseClient): ArchivePorts {
  const bucket = () => database.storage.from(ARCHIVE_BUCKET);
  return {
    listPendingDays: async (maxDays) => {
      const pending = await callRpc(database, "pending_archive_days", { max_days: maxDays });
      return pending.ok ? parsePendingDays(pending.value) : pending;
    },
    readDayDocument: (day) => callRpc(database, "position_archive_document", { target_region_id: day.regionId, target_day: day.day }),
    listPendingTracks: async (maxTracks) => {
      const pending = await callRpc(database, "pending_archive_tracks", { max_tracks: maxTracks });
      return pending.ok ? parsePendingTracks(pending.value) : pending;
    },
    readTrackDocument: (track) => callRpc(database, "track_archive_document", { target_detection_id: track.detectionId }),
    writeObject: async (objectPath, bytes) => {
      const { error } = await bucket().upload(objectPath, bytes, { contentType: ARCHIVE_CONTENT_TYPE, upsert: true });
      return error ? { ok: false, reason: `upload of ${objectPath} failed: ${error.message}` } : { ok: true, value: null };
    },
    recordArchive: async (entry) => {
      const recorded = await callRpc(database, "record_position_archive", { entry });
      return recorded.ok ? { ok: true, value: null } : recorded;
    },
    listExpiredDays: async (retentionDays) => {
      const expired = await callRpc(database, "expired_position_archives", { retention_days: retentionDays });
      if (!expired.ok) return expired;
      const paths = Array.isArray(expired.value) ? expired.value.filter((path): path is string => typeof path === "string") : null;
      return paths === null ? { ok: false, reason: "expired_position_archives did not return an array" } : { ok: true, value: paths };
    },
    deleteObjects: async (objectPaths) => {
      for (let batchStart = 0; batchStart < objectPaths.length; batchStart += DELETE_BATCH) {
        const { error } = await bucket().remove(objectPaths.slice(batchStart, batchStart + DELETE_BATCH));
        if (error) return { ok: false, reason: `delete of ${objectPaths.length} expired archives failed: ${error.message}` };
      }
      return { ok: true, value: null };
    },
    forgetArchives: async (objectPaths) => {
      const forgotten = await callRpc(database, "forget_position_archives", { object_paths: objectPaths });
      return forgotten.ok ? { ok: true, value: null } : forgotten;
    },
  };
}
