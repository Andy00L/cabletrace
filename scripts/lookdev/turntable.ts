import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Result } from "../../src/lib/result";

// Bundles the ship turntable with three.js into one script beside a bare HTML page: the WebGL page (turntable-page.ts)
// opens from a file, no server, no route in the app; the WebGPU page (turntable-webgpu-page.ts) is served by the WebGPU
// tier's proxy, since Windows Chrome reads it from there.

const PAGE_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;position:relative;background:#F3F3F1"><script src="turntable.js"></script></body></html>\n';

async function bundleTurntable(entryName: string, pageDirectory: string): Promise<Result<string>> {
  mkdirSync(pageDirectory, { recursive: true });
  const built = await Bun.build({ entrypoints: [path.join(import.meta.dir, entryName)], outdir: pageDirectory, target: "browser", format: "iife", naming: "turntable.js", minify: true });
  if (!built.success) return { ok: false, reason: built.logs.map((log) => String(log)).join("\n") };
  const htmlPath = path.join(pageDirectory, "index.html");
  writeFileSync(htmlPath, PAGE_HTML);
  return { ok: true, value: htmlPath };
}

/** Writes the WebGL turntable page under `outDirectory` and returns its file URL. */
export async function buildTurntablePage(outDirectory: string): Promise<Result<string>> {
  const built = await bundleTurntable("turntable-page.ts", path.resolve(outDirectory, "turntable"));
  return built.ok ? { ok: true, value: `file://${built.value}` } : built;
}

/** Writes the WebGPU turntable page under `outDirectory` and returns the folder the proxy serves it from. */
export async function buildWebGpuTurntablePage(outDirectory: string): Promise<Result<string>> {
  const pageDirectory = path.resolve(outDirectory, "turntable-webgpu");
  const built = await bundleTurntable("turntable-webgpu-page.ts", pageDirectory);
  return built.ok ? { ok: true, value: pageDirectory } : built;
}
