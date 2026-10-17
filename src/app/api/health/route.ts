import { connection } from "next/server";
import { checkCollectorHealth, type CollectorHealth } from "@/lib/health/collector-health";
import { checkCrossSource } from "@/lib/health/cross-source-health";
import { fetchRecorderSummary, judgeRecorderHealth } from "@/lib/recorder/recorder-summary";

// The answer is cached at Vercel's CDN for 30 s (and served stale for 30 s more while it refreshes): each call reads
// Supabase three times, so an uncached endpoint would let anyone spend the free plan's 5 GB of monthly egress. The
// recorder runs every minute, so a 30 s old answer still says whether it runs.
const HEALTH_CACHE_HEADERS = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" };
// A query string would make each request a new cache key and reach Supabase (security re-review, 17 Oct 2026); the
// refusal itself is cached briefly.
const REFUSAL_CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60" };

// GET /api/health: answers whenever the app is up, and says whether the two recorders still write: the near-cable
// recorder of the eight regions (every minute) and the world ship collector behind /live (every 10 minutes).
// "status" is "ok" only while both do; the reason for any other state goes to the logs, not the response.
// `crossSource` says whether aisstream and Digitraffic agree where both cover a region; a disagreement is reported
// there, beside the status, because it measures the feeds, not whether CableTrace runs. The /live page reads it here
// (src/lib/health/feed-check-report.ts).
export async function GET(request: Request) {
  if (new URL(request.url).search !== "") return Response.json({ ok: false, reason: "the health check takes no query string" }, { status: 404, headers: REFUSAL_CACHE_HEADERS });
  await connection();
  const [summary, collector, crossSource] = await Promise.all([fetchRecorderSummary(), checkCollectorHealth(Date.now()), checkCrossSource()]);
  if (!collector.ok) console.error(`[GET /api/health] collector: ${collector.reason}`);
  if (!crossSource.ok) console.error(`[GET /api/health] cross-source: ${crossSource.reason}`);
  const collectorReport: CollectorHealth | { state: "unreachable" } = collector.ok ? collector.value : { state: "unreachable" };
  const crossSourceReport = crossSource.ok ? crossSource.value : { state: "unreachable" };
  const isCollecting = collector.ok && collector.value.state === "collecting";
  if (!summary.ok) {
    console.error(`[GET /api/health] ${summary.reason}`);
    return Response.json(
      { status: "degraded", app: "up", recorder: { state: "unreachable" }, collector: collectorReport, crossSource: crossSourceReport },
      { headers: HEALTH_CACHE_HEADERS },
    );
  }
  const health = judgeRecorderHealth(summary.value);
  const report = {
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
  };
  return Response.json(report, { headers: HEALTH_CACHE_HEADERS });
}
