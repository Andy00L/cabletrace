/// <reference lib="webworker" />
import { buildSeabedScene } from "@/lib/seabed/scene/seabed-scene";
import { listTerrainGridBuffers } from "@/lib/seabed/scene/terrain-grid";
import { loadSeabedData, type SeabedData } from "@/lib/seabed/seabed-data";

// The terrain worker: builds the overview terrain's arrays (seabed-scene.ts) off the main thread, so the page renders the
// console and opens its WebGL context meanwhile, and hands them back without a copy. Asked for an area it has not seen,
// it fetches and decodes the area's files itself and sends their elevations back too, so the page can build the same
// area at another grid step without fetching again. One request per worker; seabed-scene-load.ts starts it and ends it.
// Served as a Bun bundle (terrain-worker-bundle.ts): rebuild it with bun scripts/seabed/build-terrain-worker.ts after a
// change.

declare const self: DedicatedWorkerGlobalScope;

/** Fetch an area's files and build it, or build data the page already holds; either at the grid step its tier draws. */
export type TerrainWorkerRequest = { kind: "fetch"; area: string; step: number } | { kind: "build"; data: SeabedData; step: number };

self.onmessage = async (event: MessageEvent<TerrainWorkerRequest>) => {
  const request = event.data;
  const loaded = request.kind === "fetch" ? await loadSeabedData(request.area) : { ok: true as const, value: request.data };
  if (!loaded.ok) {
    self.postMessage({ ok: false, reason: loaded.reason });
    return;
  }
  const scene = buildSeabedScene(loaded.value, request.step);
  // The decoded elevations as published, for the page to keep (only when this worker fetched them).
  const decoded = request.kind === "fetch" ? { grid: loaded.value.features.grid, elevations: loaded.value.elevations } : null;
  // Sent without a copy too, unless the terrain's elevations are that very array (already in the list).
  const decodedBuffer = decoded && decoded.elevations !== scene.terrain.elevations && decoded.elevations.buffer instanceof ArrayBuffer ? decoded.elevations.buffer : null;
  const transfers = [...listTerrainGridBuffers(scene.terrain), ...(decodedBuffer ? [decodedBuffer] : [])];
  self.postMessage({ ok: true, value: { scene, decoded } }, transfers);
};
