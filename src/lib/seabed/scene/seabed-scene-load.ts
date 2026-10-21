import type { Result } from "@/lib/result";
import { buildSeabedScene, TERRAIN_STEPS, type SeabedScene } from "@/lib/seabed/scene/seabed-scene";
import type { TerrainGrid } from "@/lib/seabed/scene/terrain-grid";
import { TERRAIN_WORKER_FILE } from "@/lib/seabed/scene/terrain-worker-bundle";
import { loadSeabedData, parseSeabedFeatures, type SeabedData } from "@/lib/seabed/seabed-data";
import { readSeabedFileUrl, readSeabedFileUrls } from "@/lib/seabed/seabed-urls";
import { isCompactScreen } from "@/lib/render/compact-screen";
import type { TerrainWorkerRequest } from "@/lib/seabed/scene/terrain-worker";

// Loads a seabed area for the 3D replay: the area's terrain worker (terrain-worker.ts, served as the bundle
// TERRAIN_WORKER_FILE at its versioned URL) fetches the files, decodes them and builds the terrain's arrays while the
// main thread renders the console and opens the WebGL context; where workers are unavailable or fail, the main thread does it. The fetch starts
// while the console renders (warmSeabedArea), before the renderer tier says which grid step to build, so no step is
// built for nothing. Each area and step is loaded once per page and kept, and the area's worker stays, so opening
// another case on the same seabed area (or coming back after a client navigation) neither fetches nor builds again,
// and a second grid step is built from the files the worker holds. A failed load is not kept, so a retry starts over.
// Three-free.

const loadedScenes = new Map<string, Promise<Result<SeabedScene>>>();
// The main-thread fallback's decoded files per area, once it has fetched them.
const mainThreadAreas = new Map<string, Promise<Result<SeabedData>>>();

/** An area's worker and the builds it owes, by grid step. */
type AreaWorker = { worker: Worker; pendingBuilds: Map<number, (answer: Result<SeabedScene>) => void> };
const areaWorkers = new Map<string, AreaWorker>();

function isFloat32Array(value: unknown): value is Float32Array {
  return value instanceof Float32Array;
}

/** Checks a terrain that crossed the thread boundary (it arrives as unknown). */
function parseTerrainGrid(value: unknown): TerrainGrid | null {
  if (typeof value !== "object" || value === null) return null;
  const grid: unknown = Reflect.get(value, "grid");
  const indices: unknown = Reflect.get(value, "indices");
  const [elevations, positions, normals, uvs, colors, occlusion] = ["elevations", "positions", "normals", "uvs", "colors", "occlusion"].map((name) => Reflect.get(value, name));
  if (typeof grid !== "object" || grid === null) return null;
  const width: unknown = Reflect.get(grid, "width");
  const height: unknown = Reflect.get(grid, "height");
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!(indices instanceof Uint32Array || indices instanceof Uint16Array)) return null;
  if (!isFloat32Array(elevations) || !isFloat32Array(positions) || !isFloat32Array(normals) || !isFloat32Array(uvs) || !isFloat32Array(colors) || !isFloat32Array(occlusion)) return null;
  return { grid: { width, height }, elevations, positions, normals, uvs, colors, occlusion, indices };
}

/** Checks a build's answer from the worker (it arrives as unknown): its step, and the scene or the reason it failed. */
function parseWorkerAnswer(message: unknown): { step: number; answer: Result<SeabedScene> } | null {
  if (typeof message !== "object" || message === null) return null;
  const step: unknown = Reflect.get(message, "step");
  const answer: unknown = Reflect.get(message, "answer");
  if (typeof step !== "number" || typeof answer !== "object" || answer === null) return null;
  if (Reflect.get(answer, "ok") !== true) return { step, answer: { ok: false, reason: String(Reflect.get(answer, "reason")) } };
  const value: unknown = Reflect.get(answer, "value");
  const scene: unknown = typeof value === "object" && value !== null ? Reflect.get(value, "scene") : null;
  if (typeof scene !== "object" || scene === null) return { step, answer: { ok: false, reason: "the worker answered no scene" } };
  const features = parseSeabedFeatures(Reflect.get(scene, "features"));
  const terrain = parseTerrainGrid(Reflect.get(scene, "terrain"));
  if (!features.ok) return { step, answer: features };
  if (!terrain) return { step, answer: { ok: false, reason: "the worker answered a malformed terrain" } };
  return { step, answer: { ok: true, value: { features: features.value, terrain } } };
}

/** Ends an area's worker, answering every build it still owes with `reason`; the next load of the area starts a new one. */
function dropAreaWorker(area: string, reason: string) {
  const areaWorker = areaWorkers.get(area);
  if (!areaWorker) return;
  areaWorkers.delete(area);
  areaWorker.worker.terminate();
  areaWorker.pendingBuilds.forEach((resolve) => resolve({ ok: false, reason }));
}

/** The area's worker, started (and asked to fetch the files) on first use; null where workers cannot start. */
function readAreaWorker(area: string): AreaWorker | null {
  const known = areaWorkers.get(area);
  if (known) return known;
  if (typeof Worker === "undefined") return null;
  let worker: Worker;
  try {
    worker = new Worker(readSeabedFileUrl(TERRAIN_WORKER_FILE));
  } catch (error) {
    console.warn(`[readAreaWorker] no worker for ${area}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const areaWorker: AreaWorker = { worker, pendingBuilds: new Map() };
  worker.onmessage = (event: MessageEvent<unknown>) => {
    const parsed = parseWorkerAnswer(event.data);
    if (!parsed) return dropAreaWorker(area, "the worker answered something unreadable");
    areaWorker.pendingBuilds.get(parsed.step)?.(parsed.answer);
    areaWorker.pendingBuilds.delete(parsed.step);
  };
  worker.onerror = (event) => dropAreaWorker(area, `the worker failed: ${event.message}`);
  areaWorkers.set(area, areaWorker);
  // Most pages draw on a GPU (a phone with the compact grid): the worker builds that step as soon as the files are in,
  // unless asked for another.
  const likelyStep = isCompactScreen() ? TERRAIN_STEPS.compact : TERRAIN_STEPS.gpu;
  worker.postMessage({ kind: "fetch", area, urls: readSeabedFileUrls(area), likelyStep } satisfies TerrainWorkerRequest);
  return areaWorker;
}

function buildInWorker(areaWorker: AreaWorker, area: string, step: number): Promise<Result<SeabedScene>> {
  return new Promise((resolve) => {
    areaWorker.pendingBuilds.set(step, resolve);
    areaWorker.worker.postMessage({ kind: "build", area, step } satisfies TerrainWorkerRequest);
  });
}

async function loadOnMainThread(area: string, step: number): Promise<Result<SeabedScene>> {
  const loading = mainThreadAreas.get(area) ?? loadSeabedData(readSeabedFileUrls(area));
  mainThreadAreas.set(area, loading);
  const loaded = await loading;
  if (!loaded.ok) {
    mainThreadAreas.delete(area);
    return loaded;
  }
  return { ok: true, value: buildSeabedScene(loaded.value, step) };
}

async function loadWithFallback(area: string, step: number): Promise<Result<SeabedScene>> {
  const areaWorker = readAreaWorker(area);
  if (!areaWorker) return loadOnMainThread(area, step);
  const inWorker = await buildInWorker(areaWorker, area, step);
  if (inWorker.ok) return inWorker;
  // A fetch the server refused fails on the main thread too; anything else (no worker script, a crash) may not.
  dropAreaWorker(area, inWorker.reason);
  console.warn(`[loadSeabedScene] the worker did not build ${area}, building on the main thread: ${inWorker.reason}`);
  return loadOnMainThread(area, step);
}

/**
 * Starts fetching and decoding seabed area `area` in its worker, before the grid step is known. Safe to call while
 * rendering: the worker starts once per area.
 */
export function warmSeabedArea(area: string) {
  readAreaWorker(area);
}

/**
 * The seabed area `area` with its terrain at grid `step` (seabed-scene.ts, TERRAIN_STEPS), loaded once per page: a
 * second call returns the first one's promise. Never rejects.
 */
export function loadSeabedScene(area: string, step: number): Promise<Result<SeabedScene>> {
  const key = `${area}@${step}`;
  const pending = loadedScenes.get(key);
  if (pending) return pending;
  const loading = loadWithFallback(area, step).then((loaded) => {
    if (!loaded.ok) loadedScenes.delete(key);
    return loaded;
  });
  loadedScenes.set(key, loading);
  return loading;
}
