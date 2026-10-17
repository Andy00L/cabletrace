import { connection } from "next/server";
import { fetchRecorderSummary, judgeRecorderHealth } from "@/lib/recorder/recorder-summary";

// GET /api/health: answers whenever the app is up, and says whether the live ship recorder is still writing.
// "status" is "ok" only while the recorder is recording; the reason for any other state goes to the logs, not the response.
export async function GET() {
  await connection();
  const summary = await fetchRecorderSummary();
  if (!summary.ok) {
    console.error(`[GET /api/health] ${summary.reason}`);
    return Response.json({ status: "degraded", app: "up", recorder: { state: "unreachable" } });
  }
  const health = judgeRecorderHealth(summary.value);
  return Response.json({
    status: health.kind === "recording" ? "ok" : "degraded",
    app: "up",
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
