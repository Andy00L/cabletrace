import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Result } from "../../src/lib/result";

// Bundles the ship turntable (turntable-page.ts) with three.js into one script beside a bare HTML page, so the harness
// can open it from a file: no server, no route in the app.

const ENTRY_PATH = path.join(import.meta.dir, "turntable-page.ts");

/** Writes the turntable page under `outDirectory` and returns its file URL. */
export async function buildTurntablePage(outDirectory: string): Promise<Result<string>> {
  const pageDirectory = path.resolve(outDirectory, "turntable");
  mkdirSync(pageDirectory, { recursive: true });
  const built = await Bun.build({ entrypoints: [ENTRY_PATH], outdir: pageDirectory, target: "browser", format: "iife", naming: "turntable.js", minify: true });
  if (!built.success) return { ok: false, reason: built.logs.map((log) => String(log)).join("\n") };
  const htmlPath = path.join(pageDirectory, "index.html");
  writeFileSync(htmlPath, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;position:relative;background:#F3F3F1"><script src="turntable.js"></script></body></html>\n');
  return { ok: true, value: `file://${htmlPath}` };
}
