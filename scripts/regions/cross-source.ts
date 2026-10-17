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
// public.cross_source_samples_since reads at most 7 days (supabase/migrations/20261019500000_regional_recording.sql).
const MAX_HOURS = 168;
const FETCH_TIMEOUT_MS = 20_000;

/** The samples of the last `hours`, through the capped public function (the table itself has no public read). */
async function fetchSamples(hours: number): Promise<Result<CrossSourceSample[]>> {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!projectUrl || !publishableKey) return { ok: false, reason: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set" };
  try {
    const response = await fetch(`${projectUrl.replace(/\/+$/u, "")}/rest/v1/rpc/cross_source_samples_since`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ since_hours: hours }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: `cross_source_samples_since answered ${response.status}` };
    return parseCrossSourceRows(await response.json());
  } catch (error) {
    return { ok: false, reason: `cross_source_samples_since unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function formatShare(share: number | null): string {
  return share === null ? "n/a" : `${(share * 100).toFixed(1)}%`;
}

async function main(): Promise<number> {
  const [hoursText, regionArgument] = process.argv.slice(2);
  const hours = hoursText === undefined ? DEFAULT_HOURS : Number(hoursText);
  if (!(Number.isInteger(hours) && hours >= 1 && hours <= MAX_HOURS)) {
    console.error(`[crossSource] usage: bun scripts/regions/cross-source.ts [whole hours 1 to ${MAX_HOURS}] [region id]`);
    return 2;
  }
  // The database's clock picks the window, not this machine's (its wall clock is known to drift).
  const samples = await fetchSamples(hours);
  if (!samples.ok) {
    console.error(`[crossSource] ${samples.reason}`);
    return 2;
  }
  const regionIds = [...new Set(samples.value.map((sample) => sample.regionId))].filter((regionId) => regionArgument === undefined || regionId === regionArgument);
  if (regionIds.length === 0) {
    console.error(`[crossSource] no samples in the last ${hours} hours${regionArgument === undefined ? "" : ` for ${regionArgument}`}`);
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
