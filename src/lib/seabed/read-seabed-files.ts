import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Result } from "@/lib/result";
import { toSeabedData, type SeabedData } from "@/lib/seabed/seabed-data";

/**
 * Reads public/seabed/<area>-seabed.json and <area>-terrain.bin from disk, for pages that draw from the seabed
 * at build time (the case sketches). Server only: the browser loads the same files with loadSeabedData.
 */
export async function readSeabedFiles(area: string): Promise<Result<SeabedData>> {
  const seabedDir = path.join(process.cwd(), "public", "seabed");
  try {
    const [featuresText, terrain] = await Promise.all([readFile(path.join(seabedDir, `${area}-seabed.json`), "utf8"), readFile(path.join(seabedDir, `${area}-terrain.bin`))]);
    // Copied into its own ArrayBuffer: a Node Buffer may be a view into a larger shared pool.
    return toSeabedData(JSON.parse(featuresText), Uint8Array.from(terrain).buffer);
  } catch (error) {
    return { ok: false, reason: `[readSeabedFiles] ${area}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
