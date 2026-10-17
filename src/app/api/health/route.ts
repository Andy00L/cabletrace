import { connection } from "next/server";
import { checkCollectorHealth, type CollectorHealth } from "@/lib/health/collector-health";
import { checkCrossSource, CROSS_SOURCE_STATUS_HOURS, type RegionCrossSource } from "@/lib/health/cross-source-health";
import { fetchRecorderSummary, judgeRecorderHealth } from "@/lib/recorder/recorder-summary";

// Rounds a share to 3 decimals for the response.
function roundShare(share: number | null): number | null {
  return share === null ? null : Math.round(share * 1000) / 1000;
}

function toCrossSourceReport(region: RegionCrossSource) {
  return {
    regionId: region.regionId,
    verdict: region.verdict,
    hours: CROSS_SOURCE_STATUS_HOURS,
    samples: region.sampleCount,
    shipAgreementShare: roundShare(region.shipAgreementShare),
    matchedPairs: region.matchedPairs,
    positionAgreementShare: roundShare(region.positionAgreementShare),
    reasons: region.reasons,
  };
}

// GET /api/health: answers whenever the app is up, and says whether the two recorders still write: the near-cable
// recorder of the eight regions (every minute) and the world ship collector behind /live (every 10 minutes).
// "status" is "ok" only while both do; the reason for any other state goes to the logs, not the response.
// `crossSource` says whether aisstream and Digitraffic agree where both cover a region; a disagreement is reported
// there, beside the status, because it measures the feeds, not whether CableTrace runs.
export async function GET() {
  await connection();
  const [summary, collector, crossSource] = await Promise.all([fetchRecorderSummary(), checkCollectorHealth(Date.now()), checkCrossSource()]);
  if (!collector.ok) console.error(`[GET /api/health] collector: ${collector.reason}`);
  if (!crossSource.ok) console.error(`[GET /api/health] cross-source: ${crossSource.reason}`);
  const collectorReport: CollectorHealth | { state: "unreachable" } = collector.ok ? collector.value : { state: "unreachable" };
  const crossSourceReport = crossSource.ok ? crossSource.value.map(toCrossSourceReport) : { state: "unreachable" };
  const isCollecting = collector.ok && collector.value.state === "collecting";
  if (!summary.ok) {
    console.error(`[GET /api/health] ${summary.reason}`);
    return Response.json({ status: "degraded", app: "up", recorder: { state: "unreachable" }, collector: collectorReport, crossSource: crossSourceReport });
  }
  const health = judgeRecorderHealth(summary.value);
  return Response.json({
    status: health.kind === "recording" && isCollecting ? "ok" : "degraded",
    app: "up",
    collector: collectorReport,
    crossSource: crossSourceReport,
    recorder: {
      state: health.kind,
      lastRunAt: summary.value.lastRunAt?.toISOString() ?? null,
      minutesSinceLastRun: health.kind === "never-ran" ? null : health.minutesSinceLastRun,
      positionsLastHour: summary.value.positionsLastHour,
      shipsLastHour: summary.value.shipsLastHour,
      cablesWatched: summary.value.cablesWatched,
    },
  });
}
