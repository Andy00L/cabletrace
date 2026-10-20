// Bundles the terrain worker (src/lib/seabed/scene/terrain-worker.ts) into public/seabed/terrain-worker.js, the file
// the 3D replay starts its worker from. Run it after changing the worker or anything it imports; the unit test
// src/lib/seabed/scene/terrain-worker-bundle.test.ts fails while the committed bundle is out of date.
// Usage: bun scripts/seabed/build-terrain-worker.ts
// Exit codes: 0 written, 1 the bundle could not be built.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { bundleTerrainWorker } from "./terrain-worker-build";
import { TERRAIN_WORKER_PATH } from "../../src/lib/seabed/scene/terrain-worker-bundle";

const bundled = await bundleTerrainWorker();
if (!bundled.ok) {
  console.error(`[buildTerrainWorker] ${bundled.reason}`);
  process.exit(1);
}
const target = path.join("public", TERRAIN_WORKER_PATH);
await writeFile(target, bundled.value);
console.log(`[buildTerrainWorker] wrote ${target}, ${bundled.value.length} bytes`);
