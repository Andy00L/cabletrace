// Renders the front page's footage of the real console (docs/LOOKDEV.md, Landing footage): the Eagle S time-lapse in
// two crops, encoded as MP4 and WebM with posters, and three stills, all into public/landing/ as
// src/lib/landing/replay-footage.ts describes them.
// Usage: bun run footage [--base-url http://localhost:3190] [--only desktop|phone|stills] [--preview] [--skip-capture]
//   Without --base-url it builds the app and serves it on port 3190 itself, and stops it at the end.
//   --preview renders six frames of each crop (0, 25, 50, 75%, the cut, the end) into .scratch and encodes nothing.
//   --skip-capture encodes the frames already in .scratch/landing-footage.
// Exit codes: 0 everything rendered within its budget, 1 a file over its budget, 2 something could not be rendered.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";
import { EAGLE_S_2024 } from "../../src/data/cases/eagle-s-2024";
import { EAGLE_S_FOOTAGE, type FootageCrop } from "../../src/lib/landing/replay-footage";
import type { Result } from "../../src/lib/result";
import { signInOnce, TIER_LAUNCH } from "../lookdev/tier-launch";
import { resolveChromiumPath } from "../perf/chromium-path";
import { captureReplayCrop } from "./capture-replay";
import { encodeCrop, type EncodedFile } from "./encode-footage";
import { captureStills } from "./capture-stills";

// The port the script serves the production build on when it starts the server itself.
const SERVER_PORT = 3190;
const SERVER_READY_TIMEOUT_MS = 60_000;
const SCRATCH_DIRECTORY = path.join(".scratch", "landing-footage");
const PUBLIC_DIRECTORY = "public";
const CROPS: readonly FootageCrop[] = ["desktop", "phone"];
// The preview's shares of the time-lapse: its quarters, the C-Lion1 cut (16:44 of 10:00 to 17:00) and the end.
const PREVIEW_SHARES = [0, 0.25, 0.5, 0.75, 404 / 420, 1];

type CliOptions = { baseUrl: string | null; only: FootageCrop | "stills" | null; isPreview: boolean; shouldSkipCapture: boolean };

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

function parseCliOptions(argumentList: string[]): Result<CliOptions> {
  const only = readFlagValue(argumentList, "--only");
  if (only !== null && only !== "desktop" && only !== "phone" && only !== "stills") return { ok: false, reason: `--only must be desktop, phone or stills, got ${only}` };
  const baseUrl = readFlagValue(argumentList, "--base-url");
  if (baseUrl !== null && !URL.canParse(baseUrl)) return { ok: false, reason: `--base-url is not a URL: ${baseUrl}` };
  return { ok: true, value: { baseUrl: baseUrl?.replace(/\/$/, "") ?? null, only, isPreview: argumentList.includes("--preview"), shouldSkipCapture: argumentList.includes("--skip-capture") } };
}

/** Stops the server this run started: its process group, by its own pid. */
function stopServer(server: ChildProcess) {
  if (server.pid === undefined) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch (error) {
    console.error(`[stopServer] could not stop the server (pid ${server.pid}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Builds the app and serves it on SERVER_PORT; resolves once it answers. */
async function startServer(): Promise<Result<ChildProcess>> {
  console.log("[startServer] building the app (bun run build)");
  const build = spawnSync("bun", ["run", "build"], { stdio: "inherit" });
  if (build.status !== 0) return { ok: false, reason: "bun run build failed" };
  // In its own process group, so stopping it stops next start and the server process it runs, and nothing else.
  const server = spawn(path.join("node_modules", ".bin", "next"), ["start", "--port", String(SERVER_PORT)], { stdio: "ignore", detached: true });
  const startedAt = performance.now();
  while (performance.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
    try {
      const response = await fetch(`http://localhost:${SERVER_PORT}/`);
      if (response.ok) return { ok: true, value: server };
    } catch {
      // Not listening yet: try again.
    }
    await Bun.sleep(500);
  }
  stopServer(server);
  return { ok: false, reason: `the server did not answer on port ${SERVER_PORT} within ${SERVER_READY_TIMEOUT_MS / 1000} s` };
}

/** Whether the run opens pages: it captures frames, or takes the stills. */
function needsBrowser(options: CliOptions): boolean {
  return !options.shouldSkipCapture || (!options.isPreview && (options.only === null || options.only === "stills"));
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

async function renderFootage(options: CliOptions, baseUrl: string): Promise<number> {
  const windowStartMs = Date.parse(EAGLE_S_2024.window.startUtc);
  const crops = CROPS.filter((crop) => options.only === null || options.only === crop);
  const encoded: EncodedFile[] = [];
  const chromiumPath = resolveChromiumPath(process.env.PERF_CHROMIUM_PATH ?? null);
  if (!chromiumPath.ok) {
    console.error(`[renderFootage] ${chromiumPath.reason}`);
    return 2;
  }
  // The hardware tier: ANGLE on the GPU through Mesa's d3d12 driver on WSL2 (tier-launch.ts), the best tier a
  // Playwright browser reaches here.
  const browser = needsBrowser(options) ? await chromium.launch({ executablePath: chromiumPath.value, args: TIER_LAUNCH.hardware.args, env: { ...process.env, ...TIER_LAUNCH.hardware.env } }) : null;
  try {
    const signedIn = browser ? await signInOnce(browser, baseUrl) : null;
    if (signedIn && !signedIn.ok) {
      console.error(`[renderFootage] could not sign in: ${signedIn.reason}`);
      return 2;
    }
    for (const crop of crops) {
      const framesDirectory = path.join(SCRATCH_DIRECTORY, options.isPreview ? "preview" : "frames", crop);
      if (!options.shouldSkipCapture && browser && signedIn) {
        const captured = await captureReplayCrop({ browser, signedIn: signedIn.value, baseUrl, footage: EAGLE_S_FOOTAGE, windowStartMs, crop, framesDirectory, previewShares: options.isPreview ? PREVIEW_SHARES : null });
        if (!captured.ok) {
          console.error(`[renderFootage] ${crop}: ${captured.reason}`);
          return 2;
        }
        console.log(`[renderFootage] ${crop}: ${captured.value} frames in ${framesDirectory}`);
      }
      if (options.isPreview) continue;
      const cropFiles = await encodeCrop({ footage: EAGLE_S_FOOTAGE, crop, framesDirectory, publicDirectory: PUBLIC_DIRECTORY });
      if (!cropFiles.ok) {
        console.error(`[renderFootage] ${crop}: ${cropFiles.reason}`);
        return 2;
      }
      encoded.push(...cropFiles.value);
    }
    if (!options.isPreview && browser && signedIn && (options.only === null || options.only === "stills")) {
      const stills = await captureStills({ browser, signedIn: signedIn.value, baseUrl, windowStartMs, publicDirectory: PUBLIC_DIRECTORY, scratchDirectory: SCRATCH_DIRECTORY });
      if (!stills.ok) {
        console.error(`[renderFootage] stills: ${stills.reason}`);
        return 2;
      }
      encoded.push(...stills.value);
    }
  } finally {
    await browser?.close();
  }
  for (const file of encoded) {
    const budget = file.budgetBytes === null ? "no budget" : `budget ${formatMegabytes(file.budgetBytes)}`;
    console.log(`[renderFootage] ${file.sitePath} ${formatMegabytes(file.bytes)} (${budget})${file.note ? `, ${file.note}` : ""}`);
  }
  const overBudget = encoded.filter((file) => file.budgetBytes !== null && file.bytes > file.budgetBytes);
  overBudget.forEach((file) => console.error(`[renderFootage] over budget: ${file.sitePath}`));
  return overBudget.length > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const options = parseCliOptions(process.argv.slice(2));
  if (!options.ok) {
    console.error(`[buildFootage] ${options.reason}`);
    return 2;
  }
  if (options.value.baseUrl !== null) return renderFootage(options.value, options.value.baseUrl);
  // Encoding frames already captured needs no page, so no server.
  if (!needsBrowser(options.value)) return renderFootage(options.value, `http://localhost:${SERVER_PORT}`);
  const server = await startServer();
  if (!server.ok) {
    console.error(`[buildFootage] ${server.reason}`);
    return 2;
  }
  try {
    return await renderFootage(options.value, `http://localhost:${SERVER_PORT}`);
  } finally {
    stopServer(server.value);
  }
}

if (import.meta.main) process.exit(await main());
