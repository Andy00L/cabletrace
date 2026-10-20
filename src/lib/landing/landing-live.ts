import { cacheLife } from "next/cache";
import { REGIONS } from "@/data/regions";
import { fetchHeardRegionIds, fetchTickerCrossings, type CloseCrossing } from "@/lib/landing/live-watch";
import { fetchRecorderSummary, judgeRecorderHealth, type RecorderHealth, type RecorderSummary } from "@/lib/recorder/recorder-summary";
import type { Result } from "@/lib/result";

export type LandingLive = {
  /** When these reads ran; the card says "as of" this time, since the page is cached. */
  readAt: Date;
  recorder: Result<{ summary: RecorderSummary; health: RecorderHealth }>;
  crossings: Result<CloseCrossing[]>;
  heardRegionIds: Result<string[]>;
};

/**
 * Everything live the landing shows, read once a minute at most: the landing is public, so every visitor shares one
 * set of reads (about 7 KB from the database) instead of each paying for their own. The recorder runs once a minute,
 * so nothing fresher exists to show.
 */
export async function loadLandingLive(): Promise<LandingLive> {
  "use cache";
  // Fresh for a minute, refreshed in the background after that, never older than 10 minutes. A stale time of at least
  // 30 s keeps it in the prerendered page (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheLife.md).
  cacheLife({ stale: 60, revalidate: 60, expire: 600 });
  const readAt = new Date();
  const [summary, crossings, heardRegionIds] = await Promise.all([
    fetchRecorderSummary(),
    fetchTickerCrossings(readAt),
    fetchHeardRegionIds(
      readAt,
      REGIONS.map((region) => region.id),
    ),
  ]);
  if (!summary.ok) console.error(`[loadLandingLive] recorder: ${summary.reason}`);
  if (!crossings.ok) console.error(`[loadLandingLive] crossings: ${crossings.reason}`);
  if (!heardRegionIds.ok) console.error(`[loadLandingLive] regions: ${heardRegionIds.reason}`);
  const recorder: LandingLive["recorder"] = summary.ok ? { ok: true, value: { summary: summary.value, health: judgeRecorderHealth(summary.value) } } : summary;
  return { readAt, recorder, crossings, heardRegionIds };
}
