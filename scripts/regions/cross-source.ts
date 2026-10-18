// Cross-source check, the live layer's outside judge (ambition-pass 4.1): do aisstream and Digitraffic agree over the
// Gulf of Finland? Every frame collector run compares the aisstream capture behind its frame with the Digitraffic
// snapshot it fetched for the same frame and stores one sample (src/lib/live/cross-source.ts,
// public.cross_source_samples). This script judges the samples of the last hours against the stated tolerances:
//   ships   at least 90% of the ships aisstream hears in the Gulf that Digitraffic publishes (moving at 1 knot or
//           more, class A, not fishing) are in Digitraffic's 30-minute snapshot
//   places  at least 95% of matched reports (stamped at most 2 minutes apart) lie within 250 m of each other after
//           dead reckoning, over at least 20 matched pairs
// Usage: bun scripts/regions/cross-source.ts [hours, default 24] [region id, default every region compared]
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY: the samples function is closed to the publishable key
// (supabase/migrations/20261019600200_cross_source_server_only.sql).
// Exit codes: 0 the feeds agree, 1 they disagree beyond tolerance, 2 could not judge (no access, too few samples).
import { CROSS_SOURCE_MAX_HOURS, fetchCrossSourceSamples, judgeByRegion } from "@/lib/health/cross-source-health";

const DEFAULT_HOURS = 24;
// A long span reads up to about 150 KB, so it gets more time than the status surfaces' short read.
const FETCH_TIMEOUT_MS = 20_000;

function formatShare(share: number | null): string {
  return share === null ? "n/a" : `${(share * 100).toFixed(1)}%`;
}

async function main(): Promise<number> {
  const [hoursText, regionArgument] = process.argv.slice(2);
  const hours = hoursText === undefined ? DEFAULT_HOURS : Number(hoursText);
  if (!(Number.isInteger(hours) && hours >= 1 && hours <= CROSS_SOURCE_MAX_HOURS)) {
    console.error(`[crossSource] usage: bun scripts/regions/cross-source.ts [whole hours 1 to ${CROSS_SOURCE_MAX_HOURS}] [region id]`);
    return 2;
  }
  // The database's clock picks the window, not this machine's (its wall clock is known to drift).
  const samples = await fetchCrossSourceSamples(hours, FETCH_TIMEOUT_MS);
  if (!samples.ok) {
    console.error(`[crossSource] ${samples.reason}`);
    return 2;
  }
  const verdicts = judgeByRegion(samples.value).filter(({ regionId }) => regionArgument === undefined || regionId === regionArgument);
  if (verdicts.length === 0) {
    console.error(`[crossSource] no samples in the last ${hours} hours${regionArgument === undefined ? "" : ` for ${regionArgument}`}`);
    return 2;
  }
  let exitCode = 0;
  for (const { regionId, verdict } of verdicts) {
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
