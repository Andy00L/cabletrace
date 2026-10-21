import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bundleTerrainWorker } from "../../../../scripts/seabed/terrain-worker-build";
import { TERRAIN_WORKER_FILE } from "@/lib/seabed/scene/terrain-worker-bundle";

test("the committed terrain worker bundle matches its source (else run bun scripts/seabed/build-terrain-worker.ts)", async () => {
  const bundled = await bundleTerrainWorker();
  expect(bundled.ok ? null : bundled.reason).toBeNull();
  const committed = readFileSync(path.join(import.meta.dir, "../../../../public/seabed", TERRAIN_WORKER_FILE), "utf8");
  expect(bundled.ok && bundled.value === committed).toBe(true);
});
