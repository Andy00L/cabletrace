// Anchor-drag detector: every 30 minutes (pg_cron, supabase/migrations/20261018300000_detections.sql) it reads the
// last 6 hours of recorded Gulf of Finland positions, runs the shared detector (src/lib/detection, imported through
// this folder's deno.json import map), and hands every alert- or watch-level detection to public.upsert_detections.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DETECTION_LOOKBACK_MS, assessFleet, type FleetDetection } from "@/lib/detection/assess-fleet";
import { parseDetectionInputs } from "@/lib/detection/detection-inputs";
import type { DepthLookup } from "@/lib/detection/detection-types";
import type { Result } from "@/lib/result";
import { toSeabedData } from "@/lib/seabed/seabed-data";
import { createElevationSampler, createProjection } from "@/lib/seabed/terrain";

// The depth grid of the recorder's region, served by the public site (public/seabed in the repository). Override with
// SEABED_BASE_URL. When it cannot be read, the detector runs with unknown depth and a wider layback band.
const DEFAULT_SEABED_BASE_URL = "https://cabletrace.vercel.app/seabed";
const SEABED_AREA = "gulf-of-finland";
const FETCH_TIMEOUT_MS = 15_000;
const MS_PER_MINUTE = 60_000;

type StoredDetection = FleetDetection["detection"] & { mmsi: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Same as supabase/functions/record-vessel-positions/index.ts; both belong in a supabase/functions/_shared module.
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

// Same as supabase/functions/record-vessel-positions/index.ts (see isSameSecret).
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

// Kept for the life of the worker: the grid does not change between calls.
let cachedDepthLookup: DepthLookup | null = null;

/** Fetches and decodes the depth grid once per worker; null (unknown depth) when it cannot be read. */
async function loadDepthLookup(): Promise<DepthLookup | null> {
  if (cachedDepthLookup) return cachedDepthLookup;
  const baseUrl = Deno.env.get("SEABED_BASE_URL") ?? DEFAULT_SEABED_BASE_URL;
  try {
    const [featuresResponse, terrainResponse] = await Promise.all([
      fetch(`${baseUrl}/${SEABED_AREA}-seabed.json`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      fetch(`${baseUrl}/${SEABED_AREA}-terrain.bin`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    ]);
    if (!featuresResponse.ok || !terrainResponse.ok) {
      console.error(`[loadDepthLookup] seabed files answered ${featuresResponse.status} and ${terrainResponse.status}`);
      return null;
    }
    const seabed = toSeabedData(await featuresResponse.json(), await terrainResponse.arrayBuffer());
    if (!seabed.ok) {
      console.error(`[loadDepthLookup] ${seabed.reason}`);
      return null;
    }
    const { region, grid } = seabed.value.features;
    const projection = createProjection(region);
    const sampleElevation = createElevationSampler(seabed.value.elevations, grid, projection);
    cachedDepthLookup = (longitude, latitude) => {
      if (longitude < region.west || longitude > region.east || latitude < region.south || latitude > region.north) return null;
      const scenePoint = projection.toScene(longitude, latitude);
      return sampleElevation(scenePoint.x, scenePoint.z);
    };
    return cachedDepthLookup;
  } catch (error) {
    console.error(`[loadDepthLookup] seabed files unreachable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function runDetector(database: SupabaseClient): Promise<Result<{ shipCount: number; detectionCount: number; storedCount: number; depthKnown: boolean }>> {
  const { data, error } = await database.rpc("detection_inputs", { lookback_minutes: DETECTION_LOOKBACK_MS / MS_PER_MINUTE });
  if (error) return { ok: false, reason: `detection_inputs failed: ${error.message}` };
  const inputs = parseDetectionInputs(data);
  if (!inputs.ok) return inputs;
  const depthAt = await loadDepthLookup();
  const summary = assessFleet({ tracks: inputs.value.tracks, cables: inputs.value.cables, depthAt });
  const detections: StoredDetection[] = summary.detections.map((found) => ({ mmsi: found.mmsi, ...found.detection }));
  if (detections.length === 0) return { ok: true, value: { shipCount: summary.shipCount, detectionCount: 0, storedCount: 0, depthKnown: depthAt !== null } };
  const stored = await database.rpc("upsert_detections", { detections });
  if (stored.error) return { ok: false, reason: `upsert_detections failed: ${stored.error.message}` };
  const storedCount = typeof stored.data === "number" ? stored.data : 0;
  return { ok: true, value: { shipCount: summary.shipCount, detectionCount: detections.length, storedCount, depthKnown: depthAt !== null } };
}

Deno.serve(async (request) => {
  const expectedSecret = Deno.env.get("DETECTOR_SECRET");
  const receivedSecret = request.headers.get("x-detector-secret");
  if (!expectedSecret || !receivedSecret || !isSameSecret(receivedSecret, expectedSecret)) {
    return Response.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }
  const databaseResult = createDatabaseClient();
  if (!databaseResult.ok) {
    console.error(`[detectAnchorDrag] ${databaseResult.reason}`);
    return Response.json({ ok: false, reason: databaseResult.reason }, { status: 500 });
  }
  const outcome = await runDetector(databaseResult.value);
  if (!outcome.ok) {
    console.error(`[detectAnchorDrag] ${outcome.reason}`);
    return Response.json({ ok: false, reason: outcome.reason }, { status: 500 });
  }
  console.log(`[detectAnchorDrag] ${outcome.value.shipCount} ships, ${outcome.value.detectionCount} detections, ${outcome.value.storedCount} stored`);
  return Response.json({ ok: true, ...outcome.value });
});
