// Cross-source check, the live layer's outside judge (ambition-pass 4.1): do aisstream and Digitraffic agree over the
// Gulf of Finland? Every frame collector run compares the aisstream capture behind its frame with the Digitraffic
// snapshot it fetched for the same frame and stores one sample (src/lib/live/cross-source.ts,
// public.cross_source_samples). This script judges the samples of the last hours against the stated tolerances:
//   ships   at least 90% of the ships aisstream hears in the Gulf are in Digitraffic's 30-minute snapshot
//   places  at least 95% of matched reports (stamped at most 2 minutes apart) lie within 250 m of each other after
//           dead reckoning, over at least 20 matched pairs
// Usage: bun scripts/regions/cross-source.ts [hours, default 24] [region id, default every region compared]
// Needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (the site's public read key).
// Exit codes: 0 the feeds agree, 1 they disagree beyond tolerance, 2 could not judge (no access, too few samples).
import { judgeSamples, parseCrossSourceRows, type CrossSourceSample } from "@/lib/live/cross-source";
import type { Result } from "@/lib/result";

const DEFAULT_HOURS = 24;
const FETCH_TIMEOUT_MS = 20_000;
const SAMPLE_COLUMNS =
  "region_id,sampled_at,window_seconds,aisstream_ships,digitraffic_ships,shared_ships,aisstream_only_ships,matched_pairs,median_offset_metres,p95_offset_metres,within_tolerance_share";

async function fetchSamples(sinceIso: string, regionId: string | null): Promise<Result<CrossSourceSample[]>> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!projectUrl || !publishableKey) return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set" };
  const query = new URLSearchParams({ select: SAMPLE_COLUMNS, sampled_at: `gte.${sinceIso}`, order: "sampled_at.asc" });
  if (regionId !== null) query.set("region_id", `eq.${regionId}`);
  try {
    const response = await fetch(`${projectUrl.replace(/\/+$/u, "")}/rest/v1/cross_source_samples?${query.toString()}`, {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: `cross_source_samples answered ${response.status}` };
    return parseCrossSourceRows(await response.json());
  } catch (error) {
    return { ok: false, reason: `cross_source_samples unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function formatShare(share: number | null): string {
  return share === null ? "n/a" : `${(share * 100).toFixed(1)}%`;
}

async function main(): Promise<number> {
  const [hoursText, regionArgument] = process.argv.slice(2);
  const hours = hoursText === undefined ? DEFAULT_HOURS : Number(hoursText);
  if (!(hours > 0 && hours <= 14 * 24)) {
    console.error("[crossSource] usage: bun scripts/regions/cross-source.ts [hours 1 to 336] [region id]");
    return 2;
  }
  // performance.timeOrigin plus now() rather than Date.now(): this machine's wall clock is known to drift.
  const sinceIso = new Date(performance.timeOrigin + performance.now() - hours * 3_600_000).toISOString();
  const samples = await fetchSamples(sinceIso, regionArgument ?? null);
  if (!samples.ok) {
    console.error(`[crossSource] ${samples.reason}`);
    return 2;
  }
  const regionIds = [...new Set(samples.value.map((sample) => sample.regionId))];
  if (regionIds.length === 0) {
    console.error(`[crossSource] no samples since ${sinceIso}`);
    return 2;
  }
  let exitCode = 0;
  for (const regionId of regionIds) {
    const verdict = judgeSamples(samples.value.filter((sample) => sample.regionId === regionId));
    console.log(
      `[crossSource] ${regionId}: ${verdict.verdict} over ${verdict.sampleCount} samples; ships ${verdict.sharedShips}/${verdict.aisstreamShips} in both (${formatShare(verdict.shipAgreementShare)}); ` +
        `${verdict.matchedPairs} matched pairs, ${formatShare(verdict.positionAgreementShare)} within tolerance`,
    );
    verdict.reasons.forEach((reason) => console.log(`[crossSource]   ${reason}`));
    const code = verdict.verdict === "agree" ? 0 : verdict.verdict === "disagree" ? 1 : 2;
    // A disagreement anywhere outranks "no data" elsewhere.
    exitCode = exitCode === 1 || code === 1 ? 1 : Math.max(exitCode, code);
  }
  return exitCode;
}

process.exit(await main());
