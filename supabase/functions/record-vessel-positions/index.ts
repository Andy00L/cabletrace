// Near-cable recorder for every watched region (src/data/regions). pg_cron calls it every minute to record
// (record.ts: Digitraffic for the Gulf of Finland, a regional aisstream listen for the other regions) and once a day
// with {"task":"archive"} to move old days into Storage (archive.ts). Schedules:
// supabase/migrations/20261019500000_regional_recording.sql and 20261019500100_position_archive.sql.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { REGIONS } from "@/data/regions";
import type { Result } from "../../../src/lib/result.ts";
import { listenToAisstream } from "../collect-ship-frames/aisstream-listener.ts";
import { fetchDigitrafficLocations, fetchDigitrafficVessels } from "../collect-ship-frames/digitraffic-client.ts";
import { AISSTREAM_POSITION_MESSAGE_TYPES } from "../../../src/lib/live/ais-reports.ts";
import { archivePositions } from "./archive.ts";
import { recordRegions } from "./record.ts";
import { createArchiveStore, createRecorderStore } from "./supabase-ports.ts";

// aisstream listening per minute. Moving class A ships report every 2 to 10 s and moving class B ships every 30 s
// (ITU-R M.1371-5, Table 1), so 40 s hears each of them at least once, and the run (listen plus ingest, about 45 s)
// ends before the next minute's call: with the frame collector's connection, never more than 2 of the 3 aisstream
// connections a key may hold. CPU stays small: aisstream heard a median 359 ships in the seven aisstream boxes per
// 17 Oct 2026 frame; at the world capture's 0.022 messages per ship a second (7,320 messages from 5,664 ships in 60 s)
// that is about 8 messages a second, against the 122 a second the collector handles in 610 to 640 ms of CPU.
const LISTEN_MS = 40_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Same setup as supabase/functions/collect-ship-frames/index.ts: the secret key arrives as JSON.
function createDatabaseClient(): Result<SupabaseClient> {
  const projectUrl = Deno.env.get("SUPABASE_URL");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!projectUrl || !secretKeys) return { ok: false, reason: "SUPABASE_URL or SUPABASE_SECRET_KEYS missing" };
  let parsedKeys: unknown;
  try {
    parsedKeys = JSON.parse(secretKeys);
  } catch {
    return { ok: false, reason: "SUPABASE_SECRET_KEYS is not JSON" };
  }
  const secretKey = isRecord(parsedKeys) ? parsedKeys.default : undefined;
  if (typeof secretKey !== "string") return { ok: false, reason: "SUPABASE_SECRET_KEYS has no default key" };
  return { ok: true, value: createClient(projectUrl, secretKey, { auth: { persistSession: false } }) };
}

// Constant-time comparison so the shared secret cannot be guessed byte by byte from response times.
function isSameSecret(received: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const receivedBytes = encoder.encode(received);
  const expectedBytes = encoder.encode(expected);
  let difference = receivedBytes.length ^ expectedBytes.length;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= (receivedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return difference === 0;
}

/** The task named in the request body; a missing or unreadable body means the minute's recording. */
async function readTask(request: Request): Promise<"record" | "archive"> {
  try {
    const body: unknown = await request.json();
    return isRecord(body) && body.task === "archive" ? "archive" : "record";
  } catch {
    return "record";
  }
}

Deno.serve(async (request) => {
  const expectedSecret = Deno.env.get("RECORDER_SECRET");
  const receivedSecret = request.headers.get("x-recorder-secret");
  if (!expectedSecret || !receivedSecret || !isSameSecret(receivedSecret, expectedSecret)) {
    return Response.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const databaseResult = createDatabaseClient();
  if (!databaseResult.ok) {
    console.error(`[recordVesselPositions] ${databaseResult.reason}`);
    return Response.json({ ok: false, reason: databaseResult.reason }, { status: 500 });
  }
  const database = databaseResult.value;

  if ((await readTask(request)) === "archive") {
    const summary = await archivePositions(createArchiveStore(database));
    const outline = `${summary.daysArchived} days and ${summary.tracksKept} tracks archived (${summary.rowsArchived} rows, ${summary.bytesWritten} bytes), ${summary.expiredDeleted} expired files deleted`;
    if (summary.errors.length > 0) console.error(`[archivePositions] ${outline}; errors: ${summary.errors.join("; ")}`);
    else console.log(`[archivePositions] ${outline}`);
    return Response.json({ ok: summary.errors.length === 0, ...summary });
  }

  // The key goes to the aisstream socket only, never to a log (collect-ship-frames/aisstream-listener.ts).
  const apiKey = Deno.env.get("AISSTREAM_API_KEY");
  const run = await recordRegions(
    {
      ...createRecorderStore(database),
      fetchDigitrafficLocations,
      fetchDigitrafficVessels,
      listenAisstream: apiKey
        ? ({ boundingBoxes, listenMs, onMessageText }) => listenToAisstream({ apiKey, listenMs, onMessageText, boundingBoxes, messageTypes: AISSTREAM_POSITION_MESSAGE_TYPES })
        : null,
      nowMs: () => Date.now(),
    },
    { regions: REGIONS, listenMs: LISTEN_MS },
  );
  if (run.errors.length > 0) console.error(`[recordVesselPositions] ${run.errors.join("; ")}`);
  return Response.json({ ok: run.errors.length === 0, ...run });
});
