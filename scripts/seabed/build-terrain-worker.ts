// Bundles the terrain worker (src/lib/seabed/scene/terrain-worker.ts) into public/seabed/terrain-worker.js, the file
// the 3D replay starts its worker from, then rewrites src/lib/seabed/seabed-file-versions.ts, since the bundle is
// fetched at a content-versioned URL. Run it after changing the worker or anything it imports; the unit tests
// terrain-worker-bundle.test.ts and seabed-file-versions.test.ts fail while either file is out of date.
// Usage: bun scripts/seabed/build-terrain-worker.ts
// Exit codes: 0 written, 1 the bundle could not be built.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { bundleTerrainWorker } from "./terrain-worker-build";
import { measureSeabedFileVersions, SEABED_FILE_VERSIONS_PATH, writeSeabedFileVersionsModule } from "./seabed-file-versions";
import { TERRAIN_WORKER_FILE } from "../../src/lib/seabed/scene/terrain-worker-bundle";

const bundled = await bundleTerrainWorker();
if (!bundled.ok) {
  console.error(`[buildTerrainWorker] ${bundled.reason}`);
  process.exit(1);
}
const target = path.join("public", "seabed", TERRAIN_WORKER_FILE);
writeFileSync(target, bundled.value);
writeFileSync(SEABED_FILE_VERSIONS_PATH, writeSeabedFileVersionsModule(measureSeabedFileVersions()));
console.log(`[buildTerrainWorker] wrote ${target}, ${bundled.value.length} bytes, and its version`);
