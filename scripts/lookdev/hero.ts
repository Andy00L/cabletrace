// The hero shot: Eagle S under way with its wake from a low angle (hero-scene.ts), rendered on the Playwright tiers.
// The page is bundled with Bun.build and served through Playwright routes, with the app's public/ folder behind it so
// the scene loads its textures from the same paths as the replay.
// Usage: bun scripts/lookdev/hero.ts [--tier software|hardware|all] [--out <dir>] [--chromium /path/to/chrome]
//        [--query "?water=b" | "?bench"]   (the second water look; or time 300 frames of three ships and their wakes)
// Writes <out>/<tier>/eagle-s-2024-hero.png (default out: .scratch/lookdev). Exit codes: 0 drawn, 2 not drawn.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Route } from "playwright";
import type { Result } from "../../src/lib/result";
import { resolveChromiumPath } from "../perf/chromium-path";
import { HERO_FRAME } from "./hero-scene";
import { TIER_LAUNCH, type PlaywrightTierName } from "./tier-launch";
import { bundleTurntable } from "./turntable";

export const HERO_SHOT_NAME = "eagle-s-2024-hero";
// The page's made-up origin: every request to it is answered from the bundle or from public/.
const PAGE_ORIGIN = "http://lookdev.hero";
const FRAME_TIMEOUT_MS = 120_000;
const CONTENT_TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".bin": "application/octet-stream" };

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

/** Answers a request to the page origin from the page's bundle folder, else from public/, else with a 404. */
async function serveFromDisk(route: Route, pageDirectory: string) {
  const requestPath = decodeURIComponent(new URL(route.request().url()).pathname);
  const candidates = [path.join(pageDirectory, requestPath), path.join("public", requestPath)];
  const found = candidates.find((candidate) => existsSync(candidate) && !candidate.endsWith(path.sep));
  if (!found) {
    await route.fulfill({ status: 404, body: "not found" });
    return;
  }
  await route.fulfill({ status: 200, body: readFileSync(found), contentType: CONTENT_TYPES[path.extname(found)] ?? "application/octet-stream" });
}

/** `query`: the page's query string, "?water=b" for the second water look, "?bench" to time three ships' frames. */
async function captureHero(tier: PlaywrightTierName, chromiumPath: string, pageDirectory: string, outDirectory: string, options: { query: string; name: string }): Promise<Result<string>> {
  const launch = TIER_LAUNCH[tier];
  const browser = await chromium.launch({ executablePath: chromiumPath, args: launch.args, env: { ...process.env, ...launch.env } });
  try {
    const context = await browser.newContext({ viewport: { width: HERO_FRAME.widthPx, height: HERO_FRAME.heightPx }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    await context.route(`${PAGE_ORIGIN}/**`, (route) => serveFromDisk(route, pageDirectory));
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`[captureHero] page: ${message.text()}`);
    });
    const startedAt = performance.now();
    await page.goto(`${PAGE_ORIGIN}/index.html${options.query}`, { waitUntil: "load", timeout: FRAME_TIMEOUT_MS });
    await page.waitForSelector("body[data-state]", { state: "attached", timeout: FRAME_TIMEOUT_MS });
    const pageState = await page.evaluate(() => document.body.dataset.state ?? "");
    if (pageState !== "ready") return { ok: false, reason: "the hero page failed to draw (see its console)" };
    const rendererKind = await page.evaluate(() => document.querySelector("canvas[data-renderer]")?.getAttribute("data-renderer") ?? "unknown");
    if (rendererKind !== tier) return { ok: false, reason: `asked for the ${tier} tier, the page drew on ${rendererKind}` };
    const framePng = await page.locator("canvas[data-renderer]").screenshot({ animations: "disabled" });
    const tierOut = path.join(outDirectory, tier);
    mkdirSync(tierOut, { recursive: true });
    const framePath = path.join(tierOut, `${options.name}.png`);
    writeFileSync(framePath, framePng);
    console.log(`[captureHero] ${tier} ${options.name} drawn in ${Math.round(performance.now() - startedAt)} ms: ${framePath}`);
    const bench = await page.evaluate(() => document.body.dataset.bench ?? "");
    if (bench) console.log(`[captureHero] ${tier} frame bench (three ships and their wakes, 1440 x 900): ${bench}`);
    return { ok: true, value: framePath };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const tierFlag = readFlagValue(argumentList, "--tier") ?? "all";
  if (tierFlag !== "all" && tierFlag !== "software" && tierFlag !== "hardware") {
    console.error(`[captureHero] --tier must be software, hardware or all, got ${tierFlag}`);
    return 2;
  }
  const tiers: PlaywrightTierName[] = tierFlag === "all" ? ["software", "hardware"] : [tierFlag];
  const outDirectory = readFlagValue(argumentList, "--out") ?? path.join(".scratch", "lookdev");
  const chromiumPath = resolveChromiumPath(readFlagValue(argumentList, "--chromium") ?? process.env.PERF_CHROMIUM_PATH ?? null);
  if (!chromiumPath.ok) {
    console.error(`[captureHero] ${chromiumPath.reason}`);
    return 2;
  }
  const pagePath = await bundleTurntable("hero-page.ts", path.resolve(outDirectory, "hero"));
  if (!pagePath.ok) {
    console.error(`[captureHero] the hero page did not bundle: ${pagePath.reason}`);
    return 2;
  }
  let hasFailure = false;
  for (const tier of tiers) {
    const query = readFlagValue(argumentList, "--query") ?? "";
    const name = query.includes("bench") ? `${HERO_SHOT_NAME}-bench` : query.includes("water=b") ? `${HERO_SHOT_NAME}-water-b` : HERO_SHOT_NAME;
    const captured = await captureHero(tier, chromiumPath.value, path.dirname(pagePath.value), outDirectory, { query, name });
    if (!captured.ok) {
      console.error(`[captureHero] ${tier}: ${captured.reason}`);
      hasFailure = true;
    }
  }
  return hasFailure ? 2 : 0;
}

if (import.meta.main) process.exit(await main());
