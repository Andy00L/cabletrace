import { readFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife } from "next/cache";
import { parseSeabedFeatures, type SeabedFeatures } from "@/lib/seabed/seabed-data";

/** Which kinds of line an area's 3D view draws, so its legend names only those (the southern Red Sea has no pipeline). */
export type DrawnLineKinds = { hasCables: boolean; hasPipelines: boolean };

/**
 * The credits a seabed area's file records for its depth, land, cables and pipelines, its elevation range
 * (scripts/seabed/build-seabed.ts writes both) and the kinds of line it draws, read at build time for the replay's
 * credit line, scale note and legend. Null when the file cannot be read or parsed.
 */
export async function loadSeabedSummary(area: string): Promise<(Pick<SeabedFeatures, "sources" | "elevationRange"> & { drawnLineKinds: DrawnLineKinds }) | null> {
  "use cache";
  cacheLife("max");
  try {
    const featuresText = await readFile(path.join(process.cwd(), "public", "seabed", `${area}-seabed.json`), "utf8");
    const features = parseSeabedFeatures(JSON.parse(featuresText));
    if (!features.ok) {
      console.error(`[loadSeabedSummary] ${area}: ${features.reason}`);
      return null;
    }
    const { lines } = features.value;
    const drawnLineKinds = { hasCables: lines.some((line) => line.kind !== "pipeline"), hasPipelines: lines.some((line) => line.kind === "pipeline") };
    return { sources: features.value.sources, elevationRange: features.value.elevationRange, drawnLineKinds };
  } catch (error) {
    console.error(`[loadSeabedSummary] ${area}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
