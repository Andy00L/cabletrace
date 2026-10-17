// Ship frame collector for the /live globe. pg_cron calls it on the schedule in
// supabase/migrations/20261018400100_ship_frames_schedule.sql; each call listens to aisstream.io,
// adds Fintraffic Digitraffic, and writes one frame to the public ship-frames bucket (collect.ts).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { REGIONS } from "@/data/regions";
import { selectRegionsBySource } from "@/lib/regions/region";
import type { Result } from "../../../src/lib/result.ts";
import { listenToAisstream } from "./aisstream-listener.ts";
import { collectShipFrame } from "./collect.ts";
import { fetchDigitrafficLocations, fetchDigitrafficVessels } from "./digitraffic-client.ts";
import { createCrossSourceStore, createFrameStore, createShipStaticStore } from "./supabase-ports.ts";

// One run per 10-minute slot, listening 105 s. The free plan allows 2 s of CPU and 150 s of wall clock
// per request (supabase.com/docs/guides/functions/limits): the CPU harness measured 610 to 640 ms of
// process CPU for a 105 s run at 73 to 85 messages a second, 107 to 113 ms of it in the message
// handlers (2026-10-17), and 105 s plus Digitraffic (15 s timeout) and the uploads stays under 150 s. Fewer, longer runs because every run downloads the newest frame
// (about 120 to 230 KB) to merge into: once a minute that would be 5 to 10 GB of egress a month.
const LISTEN_MS = 105_000;
// Where both feeds report, each run compares them (src/lib/live/cross-source.ts): the regions recorded from Digitraffic,
// which the world-wide aisstream capture covers too.
const CROSS_CHECK_REGIONS = selectRegionsBySource(REGIONS, "digitraffic").map((region) => ({ id: region.id, box: region.box }));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Same setup as supabase/functions/record-vessel-positions/index.ts: the secret key arrives as JSON.
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

Deno.serve(async (request) => {
  // pg_cron sends the recorder's shared secret (Vault recorder_secret, function secret RECORDER_SECRET).
  const expectedSecret = Deno.env.get("RECORDER_SECRET");
  const receivedSecret = request.headers.get("x-recorder-secret");
  if (!expectedSecret || !receivedSecret || !isSameSecret(receivedSecret, expectedSecret)) {
    return Response.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const apiKey = Deno.env.get("AISSTREAM_API_KEY");
  if (!apiKey) {
    console.error("[collectShipFrames] AISSTREAM_API_KEY missing");
    return Response.json({ ok: false, reason: "AISSTREAM_API_KEY missing" }, { status: 500 });
  }
  const databaseResult = createDatabaseClient();
  if (!databaseResult.ok) {
    console.error(`[collectShipFrames] ${databaseResult.reason}`);
    return Response.json({ ok: false, reason: databaseResult.reason }, { status: 500 });
  }
  const database = databaseResult.value;

  const summary = await collectShipFrame(
    {
      frames: createFrameStore(database),
      statics: createShipStaticStore(database),
      listen: ({ listenMs, onMessageText }) => listenToAisstream({ apiKey, listenMs, onMessageText }),
      fetchDigitrafficLocations,
      fetchDigitrafficVessels: () => fetchDigitrafficVessels(),
      storeCrossSourceSamples: createCrossSourceStore(database),
      nowMs: () => Date.now(),
    },
    { listenMs: LISTEN_MS, crossCheckRegions: CROSS_CHECK_REGIONS },
  );

  const crossSource = summary.crossSource.map((sample) => `${sample.regionId} ${sample.sharedShips}/${sample.aisstreamShips} shared, ${sample.matchedPairs} pairs`).join("; ");
  const outline = `${summary.shipCount} ships (${summary.aisstreamShips} aisstream, ${summary.digitrafficShips} Digitraffic), ${summary.compressedBytes} bytes to ${summary.framePath ?? "nowhere"}; cross-source: ${crossSource || "none"}`;
  if (summary.ok) console.log(`[collectShipFrames] ${outline}`);
  else console.error(`[collectShipFrames] ${outline}; errors: ${summary.errors.join("; ")}`);
  return Response.json(summary, { status: summary.framePath === null ? 500 : 200 });
});
