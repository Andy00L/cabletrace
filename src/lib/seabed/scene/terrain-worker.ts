/// <reference lib="webworker" />
import type { Result } from "@/lib/result";
import { buildSeabedScene } from "@/lib/seabed/scene/seabed-scene";
import { listTerrainGridBuffers } from "@/lib/seabed/scene/terrain-grid";
import { loadSeabedData, type SeabedData } from "@/lib/seabed/seabed-data";

// The terrain worker: fetches and decodes a seabed area's files, then builds the overview terrain's arrays
// (seabed-scene.ts) off the main thread, so the page renders the console and opens its WebGL context meanwhile, and
// hands them back without a copy. One worker per area lives as long as the page (seabed-scene-load.ts starts it): the
// page asks it to fetch while the console renders, before the renderer tier, and so the grid step, is known, then asks
// for the step; another step later (another case on the same area) is built from the files it already holds.
// Served as a Bun bundle (terrain-worker-bundle.ts): rebuild it with bun scripts/seabed/build-terrain-worker.ts after a
// change.

declare const self: DedicatedWorkerGlobalScope;

/** Start fetching the area's files, or build its terrain at the grid step a renderer tier draws (fetching first if needed). */
export type TerrainWorkerRequest = { kind: "fetch"; area: string } | { kind: "build"; area: string; step: number };

/** The answer to a build, tagged with its step so the page matches it to its request. */
export type TerrainWorkerAnswer = { step: number; answer: Result<{ scene: ReturnType<typeof buildSeabedScene> }> };

// Each area's decoded files (one area per worker in practice); a failed fetch is dropped so the next build retries.
const decodedAreas = new Map<string, Promise<Result<SeabedData>>>();

function readArea(area: string): Promise<Result<SeabedData>> {
  const known = decodedAreas.get(area);
  if (known) return known;
  const loading = loadSeabedData(area).then((loaded) => {
    if (!loaded.ok) decodedAreas.delete(area);
    return loaded;
  });
  decodedAreas.set(area, loading);
  return loading;
}

self.onmessage = async (event: MessageEvent<TerrainWorkerRequest>) => {
  const request = event.data;
  const loaded = await readArea(request.area);
  if (request.kind === "fetch") return;
  if (!loaded.ok) {
    self.postMessage({ step: request.step, answer: loaded } satisfies TerrainWorkerAnswer);
    return;
  }
  const scene = buildSeabedScene(loaded.value, request.step);
  // Sent without a copy, except the decoded elevations themselves (a grid with no smoothing can be that very array):
  // the worker keeps those for the next step, so they are copied.
  const keptBuffer = loaded.value.elevations.buffer;
  const transfers = listTerrainGridBuffers(scene.terrain).filter((buffer) => buffer !== keptBuffer);
  self.postMessage({ step: request.step, answer: { ok: true, value: { scene } } } satisfies TerrainWorkerAnswer, transfers);
};
