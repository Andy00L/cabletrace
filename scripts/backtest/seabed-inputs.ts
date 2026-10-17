// Cable lines and a depth lookup for one seabed area, read from public/seabed/<area>-seabed.json and
// <area>-terrain.bin with the same readers the case pages use (src/lib/seabed/read-seabed-files.ts).
import type { Result } from "@/lib/result";
import type { CableLine, DepthLookup } from "@/lib/detection/detection-types";
import { readSeabedFiles } from "@/lib/seabed/read-seabed-files";
import { createElevationSampler, createProjection } from "@/lib/seabed/terrain";

export type SeabedInputs = { cables: CableLine[]; depthAt: DepthLookup };

/** Loads an area's cables and depth grid; points outside the grid have no depth (null), never the nearest edge. */
export async function loadSeabedInputs(area: string): Promise<Result<SeabedInputs>> {
  const seabed = await readSeabedFiles(area);
  if (!seabed.ok) return seabed;
  const { region, grid, lines } = seabed.value.features;
  const projection = createProjection(region);
  const sampleElevation = createElevationSampler(seabed.value.elevations, grid, projection);
  const depthAt: DepthLookup = (longitude, latitude) => {
    if (longitude < region.west || longitude > region.east || latitude < region.south || latitude > region.north) return null;
    const scenePoint = projection.toScene(longitude, latitude);
    return sampleElevation(scenePoint.x, scenePoint.z);
  };
  const cables = lines.map((line) => ({ name: line.name, kind: line.kind, coordinates: line.points }));
  return { ok: true, value: { cables, depthAt } };
}
