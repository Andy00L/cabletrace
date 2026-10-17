import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife } from "next/cache";
import type { WatchedLine } from "@/lib/globe/watched-line";
import { parseSeabedFeatures } from "@/lib/seabed/seabed-data";

const SEABED_FILE_SUFFIX = "-seabed.json";
// Points closer than this (degrees, about 1 km) to the last kept one are dropped: from orbit to a regional view the
// globe needs a fraction of the replay's detail.
const MIN_POINT_SPACING_DEGREES = 0.01;

function thinPoints(points: readonly [number, number][]): number[] {
  const kept: number[] = [];
  let lastLongitude = Number.NaN;
  let lastLatitude = Number.NaN;
  points.forEach(([longitude, latitude], index) => {
    const isLast = index === points.length - 1;
    if (!isLast && Math.hypot(longitude - lastLongitude, latitude - lastLatitude) < MIN_POINT_SPACING_DEGREES) return;
    kept.push(longitude, latitude);
    lastLongitude = longitude;
    lastLatitude = latitude;
  });
  return kept;
}

/**
 * Every cable and pipeline in the replays' seabed areas (public/seabed), read at build time. Areas overlap, so a line
 * clipped to two areas comes back twice; the globe draws both, which looks the same as one.
 */
export async function loadWatchedLines(): Promise<WatchedLine[]> {
  "use cache";
  cacheLife("max");
  const seabedDir = path.join(process.cwd(), "public", "seabed");
  let fileNames: string[];
  try {
    fileNames = (await readdir(seabedDir)).filter((fileName) => fileName.endsWith(SEABED_FILE_SUFFIX)).sort();
  } catch (error) {
    console.error(`[loadWatchedLines] ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  const lines: WatchedLine[] = [];
  for (const fileName of fileNames) {
    try {
      const features = parseSeabedFeatures(JSON.parse(await readFile(path.join(seabedDir, fileName), "utf8")));
      if (!features.ok) {
        console.error(`[loadWatchedLines] ${fileName}: ${features.reason}`);
        continue;
      }
      for (const line of features.value.lines) {
        const points = thinPoints(line.points);
        if (points.length >= 4) lines.push({ name: line.name, kind: line.kind, points });
      }
    } catch (error) {
      console.error(`[loadWatchedLines] ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return lines;
}
