import type { Result } from "@/lib/result";

// The landing's live watch: the ships that passed closest to a watched cable in the last hour, and which regions the
// recorder heard from recently. Server-only: it reads public.vessel_positions with the secret key (the table is closed
// to the publishable key). Never import it from a "use client" file.

// A pass this close to a cable makes the ticker. The recorder keeps everything within 3 km (near_cable_metres in
// supabase/migrations/20261017020000_live_recorder.sql); 150 m is where an anchor could reach the cable from most ships.
export const CLOSE_PASS_METRES = 150;
// The ticker looks back this far, and a region counts as heard with a position this recent (minutes).
const TICKER_WINDOW_MINUTES = 60;
const HEARD_WINDOW_MINUTES = 15;
// Rows read per refresh: enough to fill the ticker after merging repeat passes, about 6 KB from the database.
const CLOSE_PASS_ROW_LIMIT = 40;
// The ticker shows this many passes.
export const TICKER_LENGTH = 3;
const FETCH_TIMEOUT_MS = 6_000;

export type CloseCrossing = {
  mmsi: number;
  cableName: string;
  regionId: string;
  speedKnots: number | null;
  distanceMetres: number;
  observedAt: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One row of the close-pass query (vessel_positions with its cable embedded), or null when it is malformed. */
function parseCrossingRow(row: unknown): CloseCrossing | null {
  if (!isRecord(row) || !isRecord(row.cables)) return null;
  const { mmsi, observed_at: observedAtText, speed_knots: speedKnots, cable_distance_metres: distanceMetres } = row;
  const { name: cableName, region_id: regionId } = row.cables;
  if (typeof mmsi !== "number" || !Number.isInteger(mmsi)) return null;
  if (typeof observedAtText !== "string" || typeof distanceMetres !== "number" || distanceMetres < 0) return null;
  if (typeof cableName !== "string" || typeof regionId !== "string") return null;
  if (speedKnots !== null && typeof speedKnots !== "number") return null;
  const observedAt = new Date(observedAtText);
  if (Number.isNaN(observedAt.getTime())) return null;
  return { mmsi, cableName, regionId, speedKnots, distanceMetres, observedAt };
}

/** Validates the close-pass rows; one bad row fails the whole read, so a schema change shows up instead of hiding. */
export function parseCrossingRows(payload: unknown): Result<CloseCrossing[]> {
  if (!Array.isArray(payload)) return { ok: false, reason: "close passes are not a list" };
  const crossings: CloseCrossing[] = [];
  for (const row of payload) {
    const crossing = parseCrossingRow(row);
    if (!crossing) return { ok: false, reason: "a close pass row is malformed" };
    crossings.push(crossing);
  }
  return { ok: true, value: crossings };
}

/**
 * The newest pass per ship and cable, newest first, cut to the ticker's length: a ship reporting every few seconds
 * along one cable shows once.
 */
export function pickTickerCrossings(crossings: readonly CloseCrossing[], length: number = TICKER_LENGTH): CloseCrossing[] {
  const newestFirst = [...crossings].sort((first, second) => second.observedAt.getTime() - first.observedAt.getTime());
  const seenKeys = new Set<string>();
  const picked: CloseCrossing[] = [];
  for (const crossing of newestFirst) {
    const key = `${crossing.mmsi}:${crossing.cableName}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    picked.push(crossing);
    if (picked.length === length) break;
  }
  return picked;
}

type SupabaseAccess = { projectUrl: string; secretKey: string };

function readSupabaseAccess(): Result<SupabaseAccess> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!projectUrl || !secretKey) return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are not set" };
  return { ok: true, value: { projectUrl: projectUrl.replace(/\/+$/u, ""), secretKey } };
}

async function readRows(access: SupabaseAccess, query: string): Promise<Result<unknown>> {
  try {
    const response = await fetch(`${access.projectUrl}/rest/v1/${query}`, {
      headers: { apikey: access.secretKey },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: `vessel_positions answered ${response.status}` };
    return { ok: true, value: await response.json() };
  } catch (error) {
    return { ok: false, reason: `vessel_positions unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function minutesBefore(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

/** The close passes of the last hour, newest first, as the ticker shows them. */
export async function fetchTickerCrossings(now: Date): Promise<Result<CloseCrossing[]>> {
  const access = readSupabaseAccess();
  if (!access.ok) return access;
  const query = [
    "vessel_positions?select=mmsi,observed_at,speed_knots,cable_distance_metres,cables(name,region_id)",
    `observed_at=gte.${minutesBefore(now, TICKER_WINDOW_MINUTES)}`,
    `cable_distance_metres=lt.${CLOSE_PASS_METRES}`,
    "order=observed_at.desc",
    `limit=${CLOSE_PASS_ROW_LIMIT}`,
  ].join("&");
  const rows = await readRows(access.value, query);
  if (!rows.ok) return rows;
  const crossings = parseCrossingRows(rows.value);
  return crossings.ok ? { ok: true, value: pickTickerCrossings(crossings.value) } : crossings;
}

/** Whether the recorder stored any position in a region in the last HEARD_WINDOW_MINUTES: one row at most per region. */
export async function fetchHeardRegionIds(now: Date, regionIds: readonly string[]): Promise<Result<string[]>> {
  const access = readSupabaseAccess();
  if (!access.ok) return access;
  const since = minutesBefore(now, HEARD_WINDOW_MINUTES);
  const answers = await Promise.all(
    regionIds.map(async (regionId) => {
      const query = `vessel_positions?select=observed_at,cables!inner(region_id)&cables.region_id=eq.${encodeURIComponent(regionId)}&observed_at=gte.${since}&limit=1`;
      const rows = await readRows(access.value, query);
      return { regionId, rows };
    }),
  );
  const failed = answers.find((answer) => !answer.rows.ok);
  if (failed && !failed.rows.ok) return { ok: false, reason: failed.rows.reason };
  return { ok: true, value: answers.filter((answer) => answer.rows.ok && Array.isArray(answer.rows.value) && answer.rows.value.length > 0).map((answer) => answer.regionId) };
}
