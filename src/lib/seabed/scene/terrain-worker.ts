/// <reference lib="webworker" />
import type { Result } from "@/lib/result";
import { buildSeabedScene, type SeabedScene } from "@/lib/seabed/scene/seabed-scene";
import { listTerrainGridBuffers } from "@/lib/seabed/scene/terrain-grid";
import { loadSeabedData, type SeabedData, type SeabedFileUrls } from "@/lib/seabed/seabed-data";

// The terrain worker: fetches and decodes a seabed area's files, then builds the overview terrain's arrays
// (seabed-scene.ts) off the main thread, so the page renders the console and opens its WebGL context meanwhile, and
// hands them back without a copy. One worker per area lives as long as the page (seabed-scene-load.ts starts it): the
// page asks it to fetch while the console renders, before the renderer tier, and so the grid step, is known. Once the
// files are in, and if the page has not named a step yet, the worker builds the likely one (the GPU tiers') on its
// own, so a fast download does not wait for the page; a page that then asks for another step gets it next. Another
// step later (another case on the same area) is built from the files it already holds.
// Served as a Bun bundle (terrain-worker-bundle.ts): rebuild it with bun scripts/seabed/build-terrain-worker.ts after a
// change.

declare const self: DedicatedWorkerGlobalScope;

/**
 * Start fetching the area's files (and build `likelyStep` once they are in, unless a step is asked for first), or
 * build the area's terrain at the grid step a renderer tier draws (fetching first if needed).
 */
export type TerrainWorkerRequest = { kind: "fetch"; area: string; urls: SeabedFileUrls; likelyStep: number } | { kind: "build"; area: string; step: number };

/** The answer to a build, tagged with its step so the page matches it to its request. */
export type TerrainWorkerAnswer = { step: number; answer: Result<{ scene: SeabedScene }> };

// Each area's decoded files (one area per worker in practice); a failed fetch is dropped so the next build retries.
const decodedAreas = new Map<string, Promise<Result<SeabedData>>>();
// Where each area's files are, from the page's fetch request (the URLs carry content versions this bundle cannot hold).
const areaUrls = new Map<string, SeabedFileUrls>();
// Each area and step's build, started by a request or ahead of one; dropped once sent (its arrays move to the page).
const builds = new Map<string, Promise<Result<SeabedScene>>>();
// Areas whose page has asked for a step: no build ahead of a request for those.
const askedAreas = new Set<string>();

function readArea(area: string): Promise<Result<SeabedData>> {
  const known = decodedAreas.get(area);
  if (known) return known;
  const urls = areaUrls.get(area);
  if (!urls) return Promise.resolve({ ok: false, reason: `the worker was asked for ${area} before its files` });
  const loading = loadSeabedData(urls).then((loaded) => {
    if (!loaded.ok) decodedAreas.delete(area);
    return loaded;
  });
  decodedAreas.set(area, loading);
  return loading;
}

function startBuild(area: string, step: number): Promise<Result<SeabedScene>> {
  const key = `${area}@${step}`;
  const known = builds.get(key);
  if (known) return known;
  const building = readArea(area).then((loaded): Result<SeabedScene> => (loaded.ok ? { ok: true, value: buildSeabedScene(loaded.value, step) } : loaded));
  builds.set(key, building);
  return building;
}

self.onmessage = async (event: MessageEvent<TerrainWorkerRequest>) => {
  const request = event.data;
  if (request.kind === "fetch") {
    areaUrls.set(request.area, request.urls);
    const loaded = await readArea(request.area);
    if (loaded.ok && !askedAreas.has(request.area)) void startBuild(request.area, request.likelyStep);
    return;
  }
  askedAreas.add(request.area);
  const built = await startBuild(request.area, request.step);
  builds.delete(`${request.area}@${request.step}`);
  if (!built.ok) {
    self.postMessage({ step: request.step, answer: built } satisfies TerrainWorkerAnswer);
    return;
  }
  // Sent without a copy, except the decoded elevations themselves (a grid with no smoothing can be that very array):
  // the worker keeps those for the next step, so they are copied.
  const decoded = await readArea(request.area);
  const keptBuffer = decoded.ok ? decoded.value.elevations.buffer : null;
  const transfers = listTerrainGridBuffers(built.value.terrain).filter((buffer) => buffer !== keptBuffer);
  self.postMessage({ step: request.step, answer: { ok: true, value: { scene: built.value } } } satisfies TerrainWorkerAnswer, transfers);
};
