import { readFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife } from "next/cache";
import { parseSeabedFeatures, type SeabedFeatures } from "@/lib/seabed/seabed-data";

/**
 * The credits a seabed area's file records for its depth, land, cables and pipelines (scripts/seabed/build-seabed.ts
 * writes them), read at build time for the replay's credit line. Null when the file cannot be read or parsed.
 */
export async function loadSeabedSources(area: string): Promise<SeabedFeatures["sources"] | null> {
  "use cache";
  cacheLife("max");
  try {
    const featuresText = await readFile(path.join(process.cwd(), "public", "seabed", `${area}-seabed.json`), "utf8");
    const features = parseSeabedFeatures(JSON.parse(featuresText));
    if (!features.ok) {
      console.error(`[loadSeabedSources] ${area}: ${features.reason}`);
      return null;
    }
    return features.value.sources;
  } catch (error) {
    console.error(`[loadSeabedSources] ${area}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
