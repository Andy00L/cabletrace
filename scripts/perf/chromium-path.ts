import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import type { Result } from "../../src/lib/result";

// Playwright's own Chromium build when it is installed, otherwise the newest build in the Playwright cache.
// The project pins playwright 1.58.2, whose build may not be the one downloaded on this machine.
export function resolveChromiumPath(requestedPath: string | null): Result<string> {
  if (requestedPath !== null) {
    return existsSync(requestedPath) ? { ok: true, value: requestedPath } : { ok: false, reason: `no Chromium at ${requestedPath}` };
  }
  const bundledPath = chromium.executablePath();
  if (existsSync(bundledPath)) return { ok: true, value: bundledPath };
  const cacheDirectory = path.join(os.homedir(), ".cache", "ms-playwright");
  const cachedBuilds = existsSync(cacheDirectory)
    ? readdirSync(cacheDirectory)
        .filter((entryName) => /^chromium-\d+$/.test(entryName))
        .sort((first, second) => Number(second.split("-")[1]) - Number(first.split("-")[1]))
    : [];
  for (const buildName of cachedBuilds) {
    const candidatePath = path.join(cacheDirectory, buildName, "chrome-linux64", "chrome");
    if (existsSync(candidatePath)) return { ok: true, value: candidatePath };
  }
  return { ok: false, reason: "no Chromium found; pass --chromium or set PERF_CHROMIUM_PATH" };
}
