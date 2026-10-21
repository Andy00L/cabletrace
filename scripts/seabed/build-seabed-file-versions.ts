// Writes src/lib/seabed/seabed-file-versions.ts: a content hash of every file in public/seabed, which the 3D replay puts
// in each file's URL (seabed-urls.ts). Run it after build-seabed.ts or build-terrain-worker.ts change a file there; the
// unit test src/lib/seabed/seabed-file-versions.test.ts fails until then.
// Usage: bun scripts/seabed/build-seabed-file-versions.ts
import { writeFileSync } from "node:fs";
import { measureSeabedFileVersions, SEABED_FILE_VERSIONS_PATH, writeSeabedFileVersionsModule } from "./seabed-file-versions";

const versions = measureSeabedFileVersions();
writeFileSync(SEABED_FILE_VERSIONS_PATH, writeSeabedFileVersionsModule(versions));
console.log(`[buildSeabedFileVersions] wrote ${versions.length} versions to ${SEABED_FILE_VERSIONS_PATH}`);
