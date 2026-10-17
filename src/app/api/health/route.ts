import { connection } from "next/server";
import { checkCollectorHealth, type CollectorHealth } from "@/lib/health/collector-health";
import { fetchRecorderSummary, judgeRecorderHealth } from "@/lib/recorder/recorder-summary";

// GET /api/health: answers whenever the app is up, and says whether the two recorders still write: the Gulf of
// Finland near-cable recorder (every minute) and the world ship collector behind /live (every 10 minutes).
// "status" is "ok" only while both do; the reason for any other state goes to the logs, not the response.
export async function GET() {
  await connection();
  const [summary, collector] = await Promise.all([fetchRecorderSummary(), checkCollectorHealth(Date.now())]);
  if (!collector.ok) console.error(`[GET /api/health] collector: ${collector.reason}`);
  const collectorReport: CollectorHealth | { state: "unreachable" } = collector.ok ? collector.value : { state: "unreachable" };
  const isCollecting = collector.ok && collector.value.state === "collecting";
  if (!summary.ok) {
    console.error(`[GET /api/health] ${summary.reason}`);
    return Response.json({ status: "degraded", app: "up", recorder: { state: "unreachable" }, collector: collectorReport });
  }
  const health = judgeRecorderHealth(summary.value);
  return Response.json({
    status: health.kind === "recording" && isCollecting ? "ok" : "degraded",
    app: "up",
    collector: collectorReport,
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
