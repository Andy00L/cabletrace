/// <reference lib="webworker" />
import { buildSeabedScene } from "@/lib/seabed/scene/seabed-scene";
import { listTerrainGridBuffers } from "@/lib/seabed/scene/terrain-grid";
import { loadSeabedData } from "@/lib/seabed/seabed-data";

// The terrain worker: fetches a seabed area's files, decodes them and builds the overview terrain's arrays
// (seabed-scene.ts) off the main thread, so the page renders the console and opens its WebGL context meanwhile, then
// hands the arrays back without a copy. One request per worker; seabed-scene-load.ts starts it and ends it. Served as a
// Bun bundle (terrain-worker-bundle.ts): rebuild it with bun scripts/seabed/build-terrain-worker.ts after a change.

declare const self: DedicatedWorkerGlobalScope;

/** What the page asks for: an area and the grid step its tier draws. */
type TerrainWorkerRequest = { area: string; step: number };

self.onmessage = async (event: MessageEvent<TerrainWorkerRequest>) => {
  const loaded = await loadSeabedData(event.data.area);
  if (!loaded.ok) {
    self.postMessage({ ok: false, reason: loaded.reason });
    return;
  }
  const scene = buildSeabedScene(loaded.value, event.data.step);
  self.postMessage({ ok: true, value: scene }, listTerrainGridBuffers(scene.terrain));
};
