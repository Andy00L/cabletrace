import type { Result } from "@/lib/result";
import { buildSeabedScene, type SeabedScene } from "@/lib/seabed/scene/seabed-scene";
import type { TerrainGrid } from "@/lib/seabed/scene/terrain-grid";
import { TERRAIN_WORKER_PATH } from "@/lib/seabed/scene/terrain-worker-bundle";
import { loadSeabedData, parseSeabedFeatures } from "@/lib/seabed/seabed-data";

// Loads a seabed area for the 3D replay: the terrain worker (terrain-worker.ts, served as the bundle at
// TERRAIN_WORKER_PATH) fetches the files, decodes them and builds the terrain's arrays while the main thread renders the
// console and opens the WebGL context; where workers are unavailable or fail, the main thread does it. Each area and
// step is loaded once per page and kept, so opening another case on the same seabed area (or coming back after a
// client navigation) neither fetches nor builds again. A failed load is not kept, so a retry starts over. Three-free.

const loadedScenes = new Map<string, Promise<Result<SeabedScene>>>();

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

/** Checks the worker's answer: a scene, or its reason for failing. */
function parseWorkerAnswer(answer: unknown): Result<SeabedScene> {
  if (typeof answer !== "object" || answer === null) return { ok: false, reason: "the worker answered nothing" };
  if (Reflect.get(answer, "ok") !== true) return { ok: false, reason: String(Reflect.get(answer, "reason")) };
  const scene: unknown = Reflect.get(answer, "value");
  if (typeof scene !== "object" || scene === null) return { ok: false, reason: "the worker answered no scene" };
  const features = parseSeabedFeatures(Reflect.get(scene, "features"));
  const terrain = parseTerrainGrid(Reflect.get(scene, "terrain"));
  if (!features.ok) return features;
  return terrain ? { ok: true, value: { features: features.value, terrain } } : { ok: false, reason: "the worker answered a malformed terrain" };
}

function loadInWorker(area: string, step: number): Promise<Result<SeabedScene>> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(TERRAIN_WORKER_PATH);
    } catch (error) {
      resolve({ ok: false, reason: `no worker: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    worker.onmessage = (event: MessageEvent<unknown>) => {
      worker.terminate();
      resolve(parseWorkerAnswer(event.data));
    };
    worker.onerror = (event) => {
      worker.terminate();
      resolve({ ok: false, reason: `the worker failed: ${event.message}` });
    };
    worker.postMessage({ area, step });
  });
}

async function loadOnMainThread(area: string, step: number): Promise<Result<SeabedScene>> {
  const loaded = await loadSeabedData(area);
  return loaded.ok ? { ok: true, value: buildSeabedScene(loaded.value, step) } : loaded;
}

async function loadWithFallback(area: string, step: number): Promise<Result<SeabedScene>> {
  if (typeof Worker === "undefined") return loadOnMainThread(area, step);
  const inWorker = await loadInWorker(area, step);
  if (inWorker.ok) return inWorker;
  console.warn(`[loadSeabedScene] the worker did not build ${area}, building on the main thread: ${inWorker.reason}`);
  return loadOnMainThread(area, step);
}

/**
 * The seabed area `area` with its terrain at grid `step` (seabed-scene.ts, TERRAIN_STEPS), loaded once per page. Safe
 * to call while rendering, to start the download early: a second call returns the first one's promise. Never rejects.
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
