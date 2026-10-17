import { cacheLife } from "next/cache";
import { buildCaseSketch, type CaseSketch } from "@/lib/cases/case-sketch";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import { readSeabedFiles } from "@/lib/seabed/read-seabed-files";

/**
 * The case-list sketch for one replay input, read from the seabed files at build time and cached, so the case
 * list prerenders. The files only change with a deploy, so the longest built-in lifetime applies. Null when the
 * seabed files cannot be read: the card then shows its text without the map.
 */
export async function loadCaseSketch(input: ReplaySceneInput): Promise<CaseSketch | null> {
  "use cache";
  cacheLife("max");
  const seabed = await readSeabedFiles(input.seabedArea);
  if (!seabed.ok) {
    console.error(`[loadCaseSketch] ${seabed.reason}`);
    return null;
  }
  return buildCaseSketch(seabed.value, input);
}
