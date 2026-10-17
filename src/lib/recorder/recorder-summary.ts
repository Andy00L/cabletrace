import type { Result } from "@/lib/result";

// What public.recorder_summary() reports (supabase/migrations/20261017030000_recorder_summary.sql).
export type RecorderSummary = {
  checkedAt: Date;
  lastRunAt: Date | null;
  lastRunError: string | null;
  positionsLastHour: number;
  shipsLastHour: number;
  cablesWatched: number;
};

export type RecorderHealth =
  | { kind: "recording"; minutesSinceLastRun: number }
  | { kind: "failing"; minutesSinceLastRun: number; error: string }
  | { kind: "stale"; minutesSinceLastRun: number }
  | { kind: "never-ran" };

// pg_cron calls the recorder every minute (supabase/migrations/20261017020200_recorder_schedule.sql),
// so five minutes without a run means the schedule or the function stopped.
const STALE_AFTER_MINUTES = 5;
// A slow database must not hold the page or the health check for long.
const SUMMARY_TIMEOUT_MS = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCount(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

// Returns undefined when the value is not a parseable timestamp, null when it is absent.
function readTimestamp(source: Record<string, unknown>, key: string): Date | null | undefined {
  const value = source[key];
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp;
}

/** Validates the JSON returned by public.recorder_summary(). */
export function parseRecorderSummary(payload: unknown): Result<RecorderSummary> {
  if (!isRecord(payload)) return { ok: false, reason: "recorder summary is not an object" };
  const checkedAt = readTimestamp(payload, "checkedAt");
  const lastRunAt = readTimestamp(payload, "lastRunAt");
  const lastRunError = payload.lastRunError;
  const positionsLastHour = readCount(payload, "positionsLastHour");
  const shipsLastHour = readCount(payload, "shipsLastHour");
  const cablesWatched = readCount(payload, "cablesWatched");
  if (!checkedAt || lastRunAt === undefined) return { ok: false, reason: "recorder summary has a bad timestamp" };
  if (lastRunError !== null && typeof lastRunError !== "string") return { ok: false, reason: "recorder summary has a bad error field" };
  if (positionsLastHour === null || shipsLastHour === null || cablesWatched === null) {
    return { ok: false, reason: "recorder summary has a bad count" };
  }
  return { ok: true, value: { checkedAt, lastRunAt, lastRunError, positionsLastHour, shipsLastHour, cablesWatched } };
}

/** Judges the recorder against the database clock (checkedAt), so a skewed server clock cannot fake a stale state. */
export function judgeRecorderHealth(summary: RecorderSummary): RecorderHealth {
  if (summary.lastRunAt === null) return { kind: "never-ran" };
  const minutesSinceLastRun = Math.max(0, Math.floor((summary.checkedAt.getTime() - summary.lastRunAt.getTime()) / 60_000));
  if (minutesSinceLastRun >= STALE_AFTER_MINUTES) return { kind: "stale", minutesSinceLastRun };
  if (summary.lastRunError !== null) return { kind: "failing", minutesSinceLastRun, error: summary.lastRunError };
  return { kind: "recording", minutesSinceLastRun };
}

/** Reads the recorder summary through the Supabase Data API with the publishable key. */
export async function fetchRecorderSummary(): Promise<Result<RecorderSummary>> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!projectUrl || !publishableKey) return { ok: false, reason: "Supabase URL or publishable key is not configured" };
  try {
    const response = await fetch(`${projectUrl}/rest/v1/rpc/recorder_summary`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: `recorder_summary answered ${response.status}` };
    return parseRecorderSummary(await response.json());
  } catch (error) {
    return { ok: false, reason: `recorder_summary unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}
