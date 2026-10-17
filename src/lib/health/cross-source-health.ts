import { judgeSamples, parseCrossSourceRows, type CrossSourceSample, type CrossSourceVerdict } from "@/lib/live/cross-source";
import type { Result } from "@/lib/result";

// The cross-source check on the status surfaces (/api/health and the home page's recorder card): where aisstream and
// Digitraffic both cover a region, a disagreement beyond the tolerances in src/lib/live/cross-source.ts shows as an
// alert instead of a silent number (ambition-pass 4.1). scripts/regions/cross-source.ts judges longer spans.

// The span the status surfaces judge: 6 hours is 36 samples of the Gulf of Finland, about 5 KB from the database.
export const CROSS_SOURCE_STATUS_HOURS = 6;
// public.cross_source_samples_since reads at most 7 days (supabase/migrations/20261019500000_regional_recording.sql).
export const CROSS_SOURCE_MAX_HOURS = 168;
const FETCH_TIMEOUT_MS = 8_000;

export type RegionCrossSource = { regionId: string } & CrossSourceVerdict;

/** The samples of the last `hours`, through the capped public function (the table itself has no public read). */
export async function fetchCrossSourceSamples(hours: number, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<Result<CrossSourceSample[]>> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!projectUrl || !publishableKey) return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set" };
  try {
    const response = await fetch(`${projectUrl.replace(/\/+$/u, "")}/rest/v1/rpc/cross_source_samples_since`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ since_hours: hours }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, reason: `cross_source_samples_since answered ${response.status}` };
    return parseCrossSourceRows(await response.json());
  } catch (error) {
    return { ok: false, reason: `cross_source_samples_since unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Judges each region's samples separately, in the order the regions first appear. */
export function judgeByRegion(samples: readonly CrossSourceSample[]): RegionCrossSource[] {
  const regionIds = [...new Set(samples.map((sample) => sample.regionId))];
  return regionIds.map((regionId) => ({ regionId, ...judgeSamples(samples.filter((sample) => sample.regionId === regionId)) }));
}

/** The verdict per compared region over the last CROSS_SOURCE_STATUS_HOURS. */
export async function checkCrossSource(): Promise<Result<RegionCrossSource[]>> {
  const samples = await fetchCrossSourceSamples(CROSS_SOURCE_STATUS_HOURS);
  return samples.ok ? { ok: true, value: judgeByRegion(samples.value) } : samples;
}
