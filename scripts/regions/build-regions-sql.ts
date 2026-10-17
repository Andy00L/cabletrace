// Prints the public.watched_regions upsert for the registry (src/data/regions). Paste it into a new migration when a
// region or a threshold changes; src/lib/regions/region-sql.test.ts fails while the newest migration holding it is stale.
// Usage: bun scripts/regions/build-regions-sql.ts
// Exit codes: 0 printed, 1 the registry has problems (listed).
import { REGIONS } from "@/data/regions";
import { LIVE_SOURCES } from "@/data/regions/sources";
import { findRegistryProblems } from "@/lib/regions/region";
import { buildWatchedRegionsSql } from "@/lib/regions/region-sql";

function main(): number {
  const problems = findRegistryProblems(REGIONS);
  if (problems.length > 0) {
    problems.forEach((problem) => console.error(`[buildRegionsSql] ${problem}`));
    return 1;
  }
  console.log(buildWatchedRegionsSql(REGIONS, LIVE_SOURCES));
  return 0;
}

process.exit(main());
