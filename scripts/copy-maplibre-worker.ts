// Copies MapLibre's web worker into public/ so the app can serve it (see src/lib/map/maplibre-worker.ts).
// The package.json `dev` and `build` scripts run it first.
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { MAPLIBRE_WORKER_PATH } from "../src/lib/map/maplibre-worker";

const WORKER_SOURCE = "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs";
const workerTarget = path.join("public", MAPLIBRE_WORKER_PATH);

try {
  await mkdir(path.dirname(workerTarget), { recursive: true });
  await copyFile(WORKER_SOURCE, workerTarget);
  console.log(`[copyMaplibreWorker] ${WORKER_SOURCE} -> ${workerTarget}`);
} catch (error) {
  console.error(`[copyMaplibreWorker] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
