import type { FeedCheckRegion } from "@/lib/health/feed-check-report";
import { POSITION_AGREEMENT_MIN_SHARE, POSITION_TOLERANCE_METRES, SHIP_AGREEMENT_MIN_SHARE } from "@/lib/live/cross-source";

export type FeedCheckState = { kind: "loading" } | { kind: "failed" } | { kind: "loaded"; regions: FeedCheckRegion[] };

function formatPercent(share: number | null): string {
  return share === null ? "n/a" : `${(share * 100).toFixed(share >= 0.995 && share < 1 ? 1 : 0)}%`;
}

/**
 * Where aisstream and Digitraffic both cover a region, whether they agree on its ships and positions over the last
 * hours (the live layer's outside judge, read from /api/health: src/lib/health/feed-check-report.ts). A disagreement shows as an alert
 * line; too few shared reports to judge, a failed read or the first load show nothing.
 */
export function FeedCheck({ state, regionNames }: { state: FeedCheckState; regionNames: Readonly<Record<string, string>> }) {
  if (state.kind !== "loaded") return null;
  const judged = state.regions.filter((region) => region.verdict !== "no-data");
  if (judged.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {judged.map((region) => {
        const doFeedsAgree = region.verdict === "agree";
        return (
          <li key={region.regionId} className="flex items-baseline gap-2 text-caption font-normal text-muted" data-testid="live-feed-check" data-state={region.verdict}>
            <span className={`size-1.5 flex-none -translate-y-px rounded-full ${doFeedsAgree ? "bg-live" : "bg-alarm"}`} aria-hidden="true" />
            <span>
              <span className="font-medium text-ink">{doFeedsAgree ? "Feeds agree" : "Feeds disagree"}</span> in the {regionNames[region.regionId] ?? region.regionId}:{" "}
              <span className="tabular-nums">{formatPercent(region.shipAgreementShare)}</span> of aisstream&apos;s moving ships are also in Digitraffic (target{" "}
              {formatPercent(SHIP_AGREEMENT_MIN_SHARE)}), and <span className="tabular-nums">{formatPercent(region.positionAgreementShare)}</span> of the
              shared positions lie within {POSITION_TOLERANCE_METRES} m (target {formatPercent(POSITION_AGREEMENT_MIN_SHARE)}).
            </span>
          </li>
        );
      })}
    </ul>
  );
}
