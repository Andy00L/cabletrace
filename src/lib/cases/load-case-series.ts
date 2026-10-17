import { cacheLife } from "next/cache";
import { buildCaseSeries, type CaseSeries } from "@/lib/cases/case-series";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import { readSeabedFiles } from "@/lib/seabed/read-seabed-files";

/**
 * The replay charts for one case, read from the seabed files at build time and cached like the case sketches
 * (load-case-sketch.ts). Null when the seabed files cannot be read: the dock then shows the timeline without charts.
 */
export async function loadCaseSeries(input: ReplaySceneInput): Promise<CaseSeries | null> {
  "use cache";
  cacheLife("max");
  const seabed = await readSeabedFiles(input.seabedArea);
  if (!seabed.ok) {
    console.error(`[loadCaseSeries] ${seabed.reason}`);
    return null;
  }
  return buildCaseSeries(seabed.value, input);
}
