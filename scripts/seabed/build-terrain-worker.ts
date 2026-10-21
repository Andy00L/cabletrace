// Bundles the terrain worker (src/lib/seabed/scene/terrain-worker.ts) into public/seabed/terrain-worker.js, the file
// the 3D replay starts its worker from. Run it after changing the worker or anything it imports, then
// build-seabed-file-versions.ts (the bundle has a versioned URL); the unit test
// src/lib/seabed/scene/terrain-worker-bundle.test.ts fails while the committed bundle is out of date.
// Usage: bun scripts/seabed/build-terrain-worker.ts
// Exit codes: 0 written, 1 the bundle could not be built.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { bundleTerrainWorker } from "./terrain-worker-build";
import { TERRAIN_WORKER_FILE } from "../../src/lib/seabed/scene/terrain-worker-bundle";

const bundled = await bundleTerrainWorker();
if (!bundled.ok) {
  console.error(`[buildTerrainWorker] ${bundled.reason}`);
  process.exit(1);
}
const target = path.join("public", "seabed", TERRAIN_WORKER_FILE);
await writeFile(target, bundled.value);
console.log(`[buildTerrainWorker] wrote ${target}, ${bundled.value.length} bytes`);
