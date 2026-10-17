import { readFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife } from "next/cache";
import { parseSeabedFeatures, type SeabedFeatures } from "@/lib/seabed/seabed-data";

/**
 * The credits a seabed area's file records for its depth, land, cables and pipelines, and its elevation range
 * (scripts/seabed/build-seabed.ts writes both), read at build time for the replay's credit line and scale note.
 * Null when the file cannot be read or parsed.
 */
export async function loadSeabedSummary(area: string): Promise<Pick<SeabedFeatures, "sources" | "elevationRange"> | null> {
  "use cache";
  cacheLife("max");
  try {
    const featuresText = await readFile(path.join(process.cwd(), "public", "seabed", `${area}-seabed.json`), "utf8");
    const features = parseSeabedFeatures(JSON.parse(featuresText));
    if (!features.ok) {
      console.error(`[loadSeabedSummary] ${area}: ${features.reason}`);
      return null;
    }
    return { sources: features.value.sources, elevationRange: features.value.elevationRange };
  } catch (error) {
    console.error(`[loadSeabedSummary] ${area}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
