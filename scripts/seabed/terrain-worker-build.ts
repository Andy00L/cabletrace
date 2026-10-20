import path from "node:path";
import type { Result } from "../../src/lib/result";
import { TERRAIN_WORKER_BANNER, TERRAIN_WORKER_ENTRY } from "../../src/lib/seabed/scene/terrain-worker-bundle";

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "../..");

/**
 * The terrain worker as one classic (non-module) script, minified, with its banner: what public/seabed/terrain-worker.js
 * must hold. Shared by the build script and the test that checks the committed file.
 */
export async function bundleTerrainWorker(): Promise<Result<string>> {
  const built = await Bun.build({ entrypoints: [path.join(REPOSITORY_ROOT, TERRAIN_WORKER_ENTRY)], target: "browser", format: "iife", minify: true, banner: TERRAIN_WORKER_BANNER });
  const output = built.outputs[0];
  if (!built.success || !output) return { ok: false, reason: built.logs.map((log) => String(log)).join("\n") || "Bun.build gave no output" };
  return { ok: true, value: await output.text() };
}
