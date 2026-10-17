// Replays the live recorder's Gulf of Finland traffic (public.vessel_positions) through the detector on the same
// 5-minute schedule and 6-hour lookback the edge function uses, and counts the distinct alerts it would have raised.
// Reads with SELECT statements only, through the Supabase Management API (SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF).
import type { Result } from "@/lib/result";
import type { DepthLookup } from "@/lib/detection/detection-types";
import { DETECTION_INTERVAL_MS, DETECTION_LOOKBACK_MS, assessFleet, type FleetDetection } from "@/lib/detection/assess-fleet";
import { parseDetectionInputs, type DetectionInputs, type ShipTrack } from "@/lib/detection/detection-inputs";

// The only Supabase project this script may read (CableTrace production).
const EXPECTED_PROJECT_REF = "ncmvzngspztgdvzbefjl";
const QUERY_URL = (projectRef: string) => `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
// The recorder has stored every minute since this time (the hourly row counts jump from 1 to 3,208 at 02:00 UTC on
// 17 Oct 2026); the handful of rows before it are setup tests.
export const RECORDER_START_MS = Date.parse("2026-10-17T02:22:00Z");
// Positions are fetched in 6-hour pages to keep each response a few megabytes.
const PAGE_MS = 6 * 60 * 60 * 1000;
// At most the last 7 days are replayed, so the run stays under a few minutes as the table grows to its 14 days.
const MAX_REPLAY_MS = 7 * 24 * 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Same payload shape as public.detection_inputs() in supabase/migrations/20261018300000_detections.sql, for a fixed
 * time span instead of the last hours. Keep the two in step.
 */
function buildInputsQuery(fromMs: number, toMs: number): string {
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  return `
    with window_positions as (
      select p.* from public.vessel_positions p
      where p.observed_at >= '${from}'::timestamptz and p.observed_at < '${to}'::timestamptz
    )
    select jsonb_build_object(
      'positions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'mmsi', p.mmsi,
          'atMs', floor(extract(epoch from p.observed_at) * 1000),
          'longitude', extensions.st_x(p.position::extensions.geometry),
          'latitude', extensions.st_y(p.position::extensions.geometry),
          'speedKnots', p.speed_knots,
          'courseDegrees', p.course_degrees,
          'headingDegrees', p.heading_degrees,
          'navigationStatus', p.navigation_status
        ) order by p.mmsi, p.observed_at)
        from window_positions p
      ), '[]'::jsonb),
      'vessels', coalesce((
        select jsonb_agg(jsonb_build_object('mmsi', v.mmsi, 'name', v.name, 'shipType', v.ship_type, 'draughtMetres', v.draught_metres))
        from public.vessels v
        where v.mmsi in (select distinct mmsi from window_positions)
      ), '[]'::jsonb),
      'cables', coalesce((
        select jsonb_agg(jsonb_build_object('name', c.name, 'kind', c.kind, 'route', extensions.st_asgeojson(c.route::extensions.geometry, 6)::jsonb) order by c.id)
        from public.cables c
      ), '[]'::jsonb)
    ) as payload`;
}

const LAST_POSITION_QUERY = "select (floor(extract(epoch from max(observed_at)) * 1000))::double precision as last_ms from public.vessel_positions";
const VESSEL_NAMES_QUERY = "select mmsi, name from public.vessels";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type QueryCredentials = { accessToken: string; projectRef: string };

/** Reads the credentials from the environment and refuses any project but CableTrace's. */
export function readQueryCredentials(): Result<QueryCredentials> {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!accessToken || !projectRef) return { ok: false, reason: "SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are not set" };
  if (projectRef !== EXPECTED_PROJECT_REF) return { ok: false, reason: `SUPABASE_PROJECT_REF is not the CableTrace project ${EXPECTED_PROJECT_REF}` };
  return { ok: true, value: { accessToken, projectRef } };
}

async function runSelect(credentials: QueryCredentials, query: string): Promise<Result<unknown[]>> {
  if (!/^\s*(select|with)\b/i.test(query)) return { ok: false, reason: "[runSelect] only SELECT statements are allowed" };
  try {
    const response = await fetch(QUERY_URL(credentials.projectRef), {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: `[runSelect] the query API answered ${response.status}` };
    const rows: unknown = await response.json();
    return Array.isArray(rows) ? { ok: true, value: rows } : { ok: false, reason: "[runSelect] the query API did not return rows" };
  } catch (error) {
    return { ok: false, reason: `[runSelect] the query API could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export type RecordedTraffic = { inputs: DetectionInputs; firstMs: number; lastMs: number; names: Map<number, string> };

/** Fetches every recorded position since the recorder started (at most the last 7 days), page by page. */
export async function fetchRecordedTraffic(credentials: QueryCredentials): Promise<Result<RecordedTraffic>> {
  const lastRows = await runSelect(credentials, LAST_POSITION_QUERY);
  if (!lastRows.ok) return lastRows;
  const [lastRow] = lastRows.value;
  const lastMs = isRecord(lastRow) && typeof lastRow.last_ms === "number" ? lastRow.last_ms : null;
  if (lastMs === null) return { ok: false, reason: "[fetchRecordedTraffic] the recorder has no positions" };
  const firstMs = Math.max(RECORDER_START_MS, lastMs - MAX_REPLAY_MS);
  const tracksByMmsi = new Map<number, ShipTrack>();
  let cables: DetectionInputs["cables"] = [];
  for (let pageStartMs = firstMs; pageStartMs <= lastMs; pageStartMs += PAGE_MS) {
    const page = await runSelect(credentials, buildInputsQuery(pageStartMs, Math.min(pageStartMs + PAGE_MS, lastMs + 1)));
    if (!page.ok) return page;
    const [row] = page.value;
    const parsed = parseDetectionInputs(isRecord(row) ? row.payload : null);
    if (!parsed.ok) return { ok: false, reason: `[fetchRecordedTraffic] ${parsed.reason}` };
    cables = parsed.value.cables;
    for (const shipTrack of parsed.value.tracks) {
      const existing = tracksByMmsi.get(shipTrack.mmsi);
      if (existing) existing.track.push(...shipTrack.track);
      else tracksByMmsi.set(shipTrack.mmsi, { ...shipTrack, track: [...shipTrack.track] });
    }
  }
  const nameRows = await runSelect(credentials, VESSEL_NAMES_QUERY);
  if (!nameRows.ok) return nameRows;
  const names = new Map<number, string>();
  for (const nameRow of nameRows.value) {
    if (isRecord(nameRow) && typeof nameRow.mmsi === "number" && typeof nameRow.name === "string") names.set(nameRow.mmsi, nameRow.name);
  }
  return { ok: true, value: { inputs: { tracks: [...tracksByMmsi.values()], cables }, firstMs, lastMs, names } };
}

/** One alert as the edge function would keep it: the same ship's overlapping windows merged across runs. */
export type AlertEvent = { mmsi: number; startMs: number; endMs: number; bestScore: number; best: FleetDetection; firstRaisedAtMs: number };

export type ReplayResult = { tickCount: number; coveredDays: number; alerts: AlertEvent[]; watchCount: number; positionCount: number; shipCount: number };

function mergeEvent(events: AlertEvent[], found: FleetDetection, tickMs: number): void {
  const { mmsi, detection } = found;
  const overlapping = events.find((event) => event.mmsi === mmsi && event.startMs <= detection.endMs && detection.startMs <= event.endMs);
  if (!overlapping) {
    events.push({ mmsi, startMs: detection.startMs, endMs: detection.endMs, bestScore: detection.score, best: found, firstRaisedAtMs: tickMs });
    return;
  }
  overlapping.startMs = Math.min(overlapping.startMs, detection.startMs);
  overlapping.endMs = Math.max(overlapping.endMs, detection.endMs);
  if (detection.score > overlapping.bestScore) {
    overlapping.bestScore = detection.score;
    overlapping.best = found;
  }
}

/** Runs the fleet detector at every 5-minute tick over the trailing 6 hours, like the live schedule. */
export function replayRecordedTraffic(traffic: RecordedTraffic, depthAt: DepthLookup | null): ReplayResult {
  const alerts: AlertEvent[] = [];
  const watches: AlertEvent[] = [];
  let tickCount = 0;
  const firstTickMs = traffic.firstMs + DETECTION_INTERVAL_MS;
  for (let tickMs = firstTickMs; tickMs <= traffic.lastMs + DETECTION_INTERVAL_MS; tickMs += DETECTION_INTERVAL_MS) {
    tickCount += 1;
    const windowStartMs = tickMs - DETECTION_LOOKBACK_MS;
    const tracks = traffic.inputs.tracks
      .map((shipTrack) => ({ ...shipTrack, track: shipTrack.track.filter((point) => point.atMs > windowStartMs && point.atMs <= tickMs) }))
      .filter((shipTrack) => shipTrack.track.length > 0);
    const summary = assessFleet({ tracks, cables: traffic.inputs.cables, depthAt });
    for (const found of summary.detections) mergeEvent(found.detection.level === "alert" ? alerts : watches, found, tickMs);
  }
  // An alert window that also produced watch-level runs counts once, as the alert.
  const watchOnly = watches.filter((watch) => !alerts.some((alert) => alert.mmsi === watch.mmsi && alert.startMs <= watch.endMs && watch.startMs <= alert.endMs));
  return {
    tickCount,
    coveredDays: (traffic.lastMs - traffic.firstMs) / MS_PER_DAY,
    alerts,
    watchCount: watchOnly.length,
    positionCount: traffic.inputs.tracks.reduce((sum, shipTrack) => sum + shipTrack.track.length, 0),
    shipCount: traffic.inputs.tracks.length,
  };
}
