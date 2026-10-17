// Storage and database ports of the collector, backed by supabase-js with the project's secret key.
// Tables, functions and the bucket come from supabase/migrations/20261018200000_ship_frames.sql.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../../src/lib/result.ts";
import type { ShipStatic } from "../../../src/lib/live/ais-reports.ts";
import { FRAME_BUCKET, FRAMES_FOLDER, parseFrameObjectName, type StoredFrame } from "../../../src/lib/live/frame-layout.ts";
import type { FrameStore, ShipStaticStore } from "./collect.ts";

// Storage lists at most 1,000 objects per call; 47 hours of 10-minute frames is 282.
const LIST_PAGE_SIZE = 1_000;
const MAX_LIST_PAGES = 5;
// Storage removes at most 1,000 objects per call.
const DELETE_BATCH = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listFrames(database: SupabaseClient): Promise<Result<StoredFrame[]>> {
  const frames: StoredFrame[] = [];
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const { data, error } = await database.storage
      .from(FRAME_BUCKET)
      .list(FRAMES_FOLDER, { limit: LIST_PAGE_SIZE, offset: page * LIST_PAGE_SIZE, sortBy: { column: "name", order: "asc" } });
    if (error) return { ok: false, reason: `listing ${FRAME_BUCKET}/${FRAMES_FOLDER} failed: ${error.message}` };
    for (const file of data) {
      const slotStart = parseFrameObjectName(file.name);
      const metadata: unknown = file.metadata;
      const size = isRecord(metadata) ? metadata.size : undefined;
      // Folders and foreign files are skipped; the collector only manages names it wrote.
      if (slotStart.ok && typeof size === "number") frames.push({ slotStartMs: slotStart.value, bytes: size });
    }
    if (data.length < LIST_PAGE_SIZE) return { ok: true, value: frames };
  }
  return { ok: false, reason: `${FRAME_BUCKET}/${FRAMES_FOLDER} holds more than ${MAX_LIST_PAGES * LIST_PAGE_SIZE} objects` };
}

export function createFrameStore(database: SupabaseClient): FrameStore {
  const bucket = () => database.storage.from(FRAME_BUCKET);
  return {
    listFrames: () => listFrames(database),
    readObject: async (objectPath) => {
      const { data, error } = await bucket().download(objectPath);
      // Storage answers a missing object with {"error":"not_found","message":"Object not found"}.
      if (error && /not.?found/iu.test(error.message)) return { ok: true, value: null };
      if (error) return { ok: false, reason: `download of ${objectPath} failed: ${error.message}` };
      return { ok: true, value: new Uint8Array(await data.arrayBuffer()) };
    },
    writeObject: async (objectPath, bytes, contentType, cacheSeconds) => {
      const { error } = await bucket().upload(objectPath, bytes, { contentType, cacheControl: String(cacheSeconds), upsert: true });
      return error ? { ok: false, reason: `upload of ${objectPath} failed: ${error.message}` } : { ok: true, value: null };
    },
    deleteObjects: async (objectPaths) => {
      for (let batchStart = 0; batchStart < objectPaths.length; batchStart += DELETE_BATCH) {
        const { error } = await bucket().remove(objectPaths.slice(batchStart, batchStart + DELETE_BATCH));
        if (error) return { ok: false, reason: `delete of ${objectPaths.length} expired frames failed: ${error.message}` };
      }
      return { ok: true, value: null };
    },
  };
}

export function createShipStaticStore(database: SupabaseClient): ShipStaticStore {
  return {
    upsertStatics: async (statics: ShipStatic[]) => {
      const { data, error } = await database.rpc("upsert_live_ships", { ships: statics });
      if (error) return { ok: false, reason: `upsert_live_ships failed: ${error.message}` };
      return { ok: true, value: typeof data === "number" ? data : 0 };
    },
    readShipTypes: async (mmsis: number[]) => {
      const { data, error } = await database.rpc("live_ship_types", { mmsis });
      if (error) return { ok: false, reason: `live_ship_types failed: ${error.message}` };
      // Two parallel arrays rather than one object per row: about half the bytes on every call.
      const payload: unknown = data;
      const mmsiColumn: unknown = isRecord(payload) ? payload.mmsis : undefined;
      const typeColumn: unknown = isRecord(payload) ? payload.shipTypes : undefined;
      if (!Array.isArray(mmsiColumn) || !Array.isArray(typeColumn) || mmsiColumn.length !== typeColumn.length) {
        return { ok: false, reason: "live_ship_types returned an unexpected shape" };
      }
      const shipTypes = new Map<number, number>();
      mmsiColumn.forEach((mmsi: unknown, rowIndex) => {
        const shipType: unknown = typeColumn[rowIndex];
        if (typeof mmsi === "number" && typeof shipType === "number") shipTypes.set(mmsi, shipType);
      });
      return { ok: true, value: shipTypes };
    },
  };
}
