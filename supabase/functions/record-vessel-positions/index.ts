// Live recorder: fetches the latest AIS positions from Finnish Digitraffic, keeps the ones inside the
// Gulf of Finland, and hands them to public.ingest_vessel_positions, which stores those within 3 km of a
// cable. Called every minute by pg_cron (supabase/migrations/20261017020200_recorder_schedule.sql).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Digitraffic marine API (CC BY 4.0): https://www.digitraffic.fi/en/marine-traffic/
const LOCATIONS_URL = "https://meri.digitraffic.fi/api/ais/v1/locations";
const VESSELS_URL = "https://meri.digitraffic.fi/api/ais/v1/vessels";
// Digitraffic asks every client to identify itself with this header.
const DIGITRAFFIC_USER = "CableTrace/0.1 (github.com/Andy00L/cabletrace)";
// Gulf of Finland box in degrees: the region CableTrace watches.
const REGION = { west: 22.0, east: 30.5, south: 59.0, north: 60.8 };
// AIS "not available" codes (ITU-R M.1371): speed 102.3 kn, course 360, heading 511, rate of turn -128.
const SPEED_NOT_AVAILABLE = 102.3;
const COURSE_NOT_AVAILABLE = 360;
const HEADING_NOT_AVAILABLE = 511;
const TURN_RATE_NOT_AVAILABLE = -128;
// Reports are re-requested with this overlap so a slow call never leaves a gap; duplicates are ignored by the primary key.
const RESUME_OVERLAP_MS = 5_000;
// Static vessel data changes slowly: refresh it at most once an hour.
const VESSEL_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

type PositionReport = {
  mmsi: number;
  reportedAtMs: number;
  longitude: number;
  latitude: number;
  speedKnots: number | null;
  courseDegrees: number | null;
  headingDegrees: number | null;
  navigationStatus: number | null;
  turnRate: number | null;
};

type VesselRecord = {
  mmsi: number;
  name: string | null;
  shipType: number | null;
  callSign: string | null;
  imo: number | null;
  destination: string | null;
  draughtMetres: number | null;
};

type Result<Value> = { ok: true; value: Value } | { ok: false; reason: string };

type RunSummary = {
  receivedCount: number;
  inRegionCount: number;
  storedCount: number;
  vesselsUpdatedCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function withoutCode(value: number | null, notAvailableCode: number): number | null {
  return value === null || value === notAvailableCode ? null : value;
}

function isInRegion(longitude: number, latitude: number): boolean {
  return longitude >= REGION.west && longitude <= REGION.east && latitude >= REGION.south && latitude <= REGION.north;
}

// Turns one Digitraffic GeoJSON feature into a position report, or null when it is malformed.
function parseLocationFeature(feature: unknown): PositionReport | null {
  if (!isRecord(feature) || !isRecord(feature.geometry) || !isRecord(feature.properties)) return null;
  const coordinates = feature.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [longitude, latitude] = coordinates;
  if (typeof longitude !== "number" || typeof latitude !== "number") return null;
  const properties = feature.properties;
  const mmsi = readNumber(properties, "mmsi");
  const reportedAtMs = readNumber(properties, "timestampExternal");
  if (mmsi === null || reportedAtMs === null) return null;
  return {
    mmsi,
    reportedAtMs,
    longitude,
    latitude,
    speedKnots: withoutCode(readNumber(properties, "sog"), SPEED_NOT_AVAILABLE),
    courseDegrees: withoutCode(readNumber(properties, "cog"), COURSE_NOT_AVAILABLE),
    headingDegrees: withoutCode(readNumber(properties, "heading"), HEADING_NOT_AVAILABLE),
    navigationStatus: readNumber(properties, "navStat"),
    turnRate: withoutCode(readNumber(properties, "rot"), TURN_RATE_NOT_AVAILABLE),
  };
}

// Digitraffic sends draught in tenths of a metre (AIS message 5); 0 means unknown.
function parseVessel(entry: unknown): VesselRecord | null {
  if (!isRecord(entry)) return null;
  const mmsi = readNumber(entry, "mmsi");
  if (mmsi === null) return null;
  const draughtTenths = readNumber(entry, "draught");
  return {
    mmsi,
    name: readText(entry, "name"),
    shipType: readNumber(entry, "shipType"),
    callSign: readText(entry, "callSign"),
    imo: readNumber(entry, "imo"),
    destination: readText(entry, "destination"),
    draughtMetres: draughtTenths === null || draughtTenths === 0 ? null : draughtTenths / 10,
  };
}

async function fetchDigitraffic(baseUrl: string, fromMs: number | null): Promise<Result<unknown>> {
  const url = fromMs === null ? baseUrl : `${baseUrl}?from=${Math.floor(fromMs)}`;
  try {
    const response = await fetch(url, {
      headers: { "Accept-Encoding": "gzip", "Digitraffic-User": DIGITRAFFIC_USER },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: `Digitraffic answered ${response.status} for ${baseUrl}` };
    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, reason: `Digitraffic unreachable for ${baseUrl}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function readState(database: SupabaseClient): Promise<Result<{ lastReportMs: number | null; lastVesselRefreshMs: number | null }>> {
  const { data, error } = await database.from("recorder_state").select("last_report_ms, last_vessel_refresh_ms").eq("id", 1).single();
  if (error || !isRecord(data)) return { ok: false, reason: `recorder_state unreadable: ${error?.message ?? "no row"}` };
  return { ok: true, value: { lastReportMs: readNumber(data, "last_report_ms"), lastVesselRefreshMs: readNumber(data, "last_vessel_refresh_ms") } };
}

async function recordPositions(database: SupabaseClient, lastReportMs: number | null): Promise<Result<{ summary: Omit<RunSummary, "vesselsUpdatedCount">; newestReportMs: number | null }>> {
  const fetched = await fetchDigitraffic(LOCATIONS_URL, lastReportMs === null ? null : lastReportMs - RESUME_OVERLAP_MS);
  if (!fetched.ok) return fetched;
  if (!isRecord(fetched.value) || !Array.isArray(fetched.value.features)) return { ok: false, reason: "Digitraffic locations: no features array" };
  const reports = fetched.value.features.map(parseLocationFeature).filter((report): report is PositionReport => report !== null);
  const inRegion = reports.filter((report) => isInRegion(report.longitude, report.latitude));
  const newestReportMs = reports.reduce<number | null>((newest, report) => (newest === null || report.reportedAtMs > newest ? report.reportedAtMs : newest), lastReportMs);
  if (inRegion.length === 0) {
    return { ok: true, value: { summary: { receivedCount: reports.length, inRegionCount: 0, storedCount: 0 }, newestReportMs } };
  }
  const { data, error } = await database.rpc("ingest_vessel_positions", { reports: inRegion });
  if (error) return { ok: false, reason: `ingest_vessel_positions failed: ${error.message}` };
  const storedCount = typeof data === "number" ? data : 0;
  return { ok: true, value: { summary: { receivedCount: reports.length, inRegionCount: inRegion.length, storedCount }, newestReportMs } };
}

async function refreshVessels(database: SupabaseClient, lastRefreshMs: number | null, nowMs: number): Promise<Result<number>> {
  if (lastRefreshMs !== null && nowMs - lastRefreshMs < VESSEL_REFRESH_INTERVAL_MS) return { ok: true, value: 0 };
  const fetched = await fetchDigitraffic(VESSELS_URL, lastRefreshMs);
  if (!fetched.ok) return fetched;
  if (!Array.isArray(fetched.value)) return { ok: false, reason: "Digitraffic vessels: not an array" };
  const vessels = fetched.value.map(parseVessel).filter((vessel): vessel is VesselRecord => vessel !== null);
  if (vessels.length === 0) return { ok: true, value: 0 };
  const { data, error } = await database.rpc("upsert_vessels", { vessels });
  if (error) return { ok: false, reason: `upsert_vessels failed: ${error.message}` };
  return { ok: true, value: typeof data === "number" ? data : 0 };
}

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
  const nowMs = Date.now();

  const state = await readState(database);
  if (!state.ok) {
    await database.from("recorder_runs").insert({ error: state.reason });
    return Response.json({ ok: false, reason: state.reason }, { status: 500 });
  }

  const positions = await recordPositions(database, state.value.lastReportMs);
  const vessels = await refreshVessels(database, state.value.lastVesselRefreshMs, nowMs);
  const errors = [positions, vessels].filter((outcome): outcome is { ok: false; reason: string } => !outcome.ok).map((outcome) => outcome.reason);

  const summary: RunSummary = {
    receivedCount: positions.ok ? positions.value.summary.receivedCount : 0,
    inRegionCount: positions.ok ? positions.value.summary.inRegionCount : 0,
    storedCount: positions.ok ? positions.value.summary.storedCount : 0,
    vesselsUpdatedCount: vessels.ok ? vessels.value : 0,
  };

  await database.from("recorder_state").update({
    last_report_ms: positions.ok ? positions.value.newestReportMs : state.value.lastReportMs,
    last_vessel_refresh_ms: vessels.ok && (state.value.lastVesselRefreshMs === null || nowMs - state.value.lastVesselRefreshMs >= VESSEL_REFRESH_INTERVAL_MS) ? nowMs : state.value.lastVesselRefreshMs,
  }).eq("id", 1);

  await database.from("recorder_runs").insert({
    received_count: summary.receivedCount,
    in_region_count: summary.inRegionCount,
    stored_count: summary.storedCount,
    vessels_updated_count: summary.vesselsUpdatedCount,
    error: errors.length > 0 ? errors.join("; ") : null,
  });

  if (errors.length > 0) console.error(`[recordVesselPositions] ${errors.join("; ")}`);
  return Response.json({ ok: errors.length === 0, ...summary, errors });
});
