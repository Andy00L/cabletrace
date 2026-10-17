import type { Result } from "@/lib/result";

// The two public lookups the /live page makes with the publishable key: a ship's name and size
// (public.live_ship_details, supabase/migrations/20261018400000_ship_frames.sql) and the detector's recent results
// (public.recent_detections, supabase/migrations/20261018300000_detections.sql). Both answers are validated here.

export type ShipDetails = {
  mmsi: number;
  name: string | null;
  callSign: string | null;
  imo: number | null;
  shipType: number | null;
  lengthMetres: number | null;
  beamMetres: number | null;
  draughtMetres: number | null;
  destination: string | null;
  source: string;
  /** When a feed last sent this ship's static data (live_ships.updated_at), or null when the row does not say. */
  staticUpdatedMs: number | null;
};

export type DetectionSummary = {
  id: number;
  mmsi: number;
  name: string | null;
  level: "alert" | "watch";
  score: number;
  startMs: number;
  endMs: number;
  /** One plain sentence per rule that fired, strongest rule first as the detector stored them. */
  sentences: string[];
  cableNames: string[];
};

const REQUEST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTextOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

type ApiConfig = { projectUrl: string; publishableKey: string };

function readApiConfig(): Result<ApiConfig> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!projectUrl || !publishableKey) return { ok: false, reason: "the Supabase address or publishable key is not configured" };
  return { ok: true, value: { projectUrl: projectUrl.replace(/\/+$/u, ""), publishableKey } };
}

async function callFunction(functionName: string, body: Record<string, unknown>): Promise<Result<unknown>> {
  const config = readApiConfig();
  if (!config.ok) return config;
  try {
    const response = await fetch(`${config.value.projectUrl}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: { apikey: config.value.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: `${functionName} answered ${response.status}` };
    const payload: unknown = await response.json();
    return { ok: true, value: payload };
  } catch (error) {
    return { ok: false, reason: `${functionName} unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function parseShipDetails(row: unknown): ShipDetails | null {
  if (!isRecord(row)) return null;
  const mmsi = readNumberOrNull(row.mmsi);
  if (mmsi === null || typeof row.source !== "string") return null;
  return {
    mmsi,
    name: readTextOrNull(row.name),
    callSign: readTextOrNull(row.call_sign),
    imo: readNumberOrNull(row.imo),
    shipType: readNumberOrNull(row.ship_type),
    lengthMetres: readNumberOrNull(row.length_metres),
    beamMetres: readNumberOrNull(row.beam_metres),
    draughtMetres: readNumberOrNull(row.draught_metres),
    destination: readTextOrNull(row.destination),
    source: row.source,
    staticUpdatedMs: typeof row.updated_at === "string" && Number.isFinite(Date.parse(row.updated_at)) ? Date.parse(row.updated_at) : null,
  };
}

/** Name, type and size of one ship, or null when the feeds sent no static data for it in the last two days. */
export async function fetchShipDetails(mmsi: number): Promise<Result<ShipDetails | null>> {
  const answer = await callFunction("live_ship_details", { mmsis: [mmsi] });
  if (!answer.ok) return answer;
  if (!Array.isArray(answer.value)) return { ok: false, reason: "live_ship_details did not return rows" };
  const [row] = answer.value;
  return { ok: true, value: row === undefined ? null : parseShipDetails(row) };
}

// live_ship_details reads at most this many MMSIs a call (mmsis[1:200], supabase/migrations/20261018400000_ship_frames.sql).
const MAX_DETAILS_PER_CALL = 200;

/** Static details of up to 200 ships in one call, by MMSI; ships the feeds sent nothing for are absent. */
export async function fetchShipDetailsBatch(mmsis: readonly number[]): Promise<Result<Map<number, ShipDetails>>> {
  const requested = [...new Set(mmsis)].slice(0, MAX_DETAILS_PER_CALL);
  if (requested.length === 0) return { ok: true, value: new Map() };
  const answer = await callFunction("live_ship_details", { mmsis: requested });
  if (!answer.ok) return answer;
  if (!Array.isArray(answer.value)) return { ok: false, reason: "live_ship_details did not return rows" };
  const details = new Map<number, ShipDetails>();
  for (const row of answer.value) {
    const parsed = parseShipDetails(row);
    if (parsed) details.set(parsed.mmsi, parsed);
  }
  return { ok: true, value: details };
}

export function parseDetectionSummary(row: unknown): DetectionSummary | null {
  if (!isRecord(row)) return null;
  const id = readNumberOrNull(row.id);
  const mmsi = readNumberOrNull(row.mmsi);
  const score = readNumberOrNull(row.score);
  const startMs = typeof row.startAt === "string" ? Date.parse(row.startAt) : Number.NaN;
  const endMs = typeof row.endAt === "string" ? Date.parse(row.endAt) : Number.NaN;
  if (id === null || mmsi === null || score === null || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (row.level !== "alert" && row.level !== "watch") return null;
  const evidence = Array.isArray(row.evidence) ? row.evidence : [];
  const crossings = Array.isArray(row.cableCrossings) ? row.cableCrossings : [];
  return {
    id,
    mmsi,
    name: readTextOrNull(row.name),
    level: row.level,
    score,
    startMs,
    endMs,
    sentences: evidence.flatMap((item) => (isRecord(item) && typeof item.sentence === "string" ? [item.sentence] : [])),
    cableNames: [...new Set(crossings.flatMap((crossing) => (isRecord(crossing) && typeof crossing.cableName === "string" ? [crossing.cableName] : [])))],
  };
}

/** The detector's results whose window ended in the last day, alerts first. */
export async function fetchRecentDetections(): Promise<Result<DetectionSummary[]>> {
  const answer = await callFunction("recent_detections", { since_hours: 24 });
  if (!answer.ok) return answer;
  if (!Array.isArray(answer.value)) return { ok: false, reason: "recent_detections did not return a list" };
  const parsed = answer.value.map(parseDetectionSummary);
  const detections = parsed.filter((detection): detection is DetectionSummary => detection !== null);
  if (detections.length !== parsed.length) return { ok: false, reason: "recent_detections returned a malformed row" };
  return { ok: true, value: detections };
}
