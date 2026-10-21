// Warm case opens on the GPU tier: in one tab, opens the other case first, goes back to /cases (a client navigation),
// then clicks the measured case and times until its 3D view (the visible one: Next keeps the page it left mounted and
// hidden) says ready. The scripts, the first area's files and, on WebGL, the kept renderer (renderer-pool.ts) are in
// hand; the measured case's seabed area is not. Signed in once per browser (signInOnce).
// Usage: bun scripts/perf/case-click-warm.ts <baseUrl> [--runs 5] [--chromium /path/to/chrome]
// Exit codes: 0 measured, 2 could not measure.
import { chromium, type Page } from "playwright";
import { signInOnce, TIER_LAUNCH } from "../lookdev/tier-launch";
import { resolveChromiumPath } from "./chromium-path";

// Each measured case, and the case opened before it in the same tab.
const PAIRS = [
  { measured: "eagle-s-2024", first: "yi-peng-3-2024" },
  { measured: "yi-peng-3-2024", first: "eagle-s-2024" },
] as const;
const VIEWPORT = { width: 1440, height: 900 };
const READY_TIMEOUT_MS = 60_000;
// Time on the first case before going back, and on /cases before the click (ms): the first case's refinement and the
// list's own work settle, as a reader's would.
const FIRST_CASE_DWELL_MS = 2000;
const LIST_DWELL_MS = 800;

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

/** Clicks the case's card and times until that case's visible 3D view says ready (ms). */
async function openCase(page: Page, baseUrl: string, slug: string): Promise<number> {
  const card = page.locator(`a[href="/cases/${slug}"]:visible`).first();
  await card.waitFor();
  const startedAt = performance.now();
  await card.click();
  await page.waitForURL(`${baseUrl}/cases/${slug}`);
  await page.locator('[data-testid="seabed-view"][data-state="ready"]:visible').waitFor({ timeout: READY_TIMEOUT_MS });
  return performance.now() - startedAt;
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const baseUrl = argumentList.find((argument) => !argument.startsWith("--") && URL.canParse(argument))?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("[caseClickWarm] pass the base URL, for example http://localhost:3141");
    return 2;
  }
  const runCount = Number(readFlagValue(argumentList, "--runs") ?? "5");
  const chromiumPath = resolveChromiumPath(readFlagValue(argumentList, "--chromium") ?? process.env.PERF_CHROMIUM_PATH ?? null);
  if (!chromiumPath.ok) {
    console.error(`[caseClickWarm] ${chromiumPath.reason}`);
    return 2;
  }
  const launch = TIER_LAUNCH.hardware;
  const browser = await chromium.launch({ executablePath: chromiumPath.value, args: launch.args, env: { ...process.env, ...launch.env } });
  const samples = new Map<string, number[]>();
  try {
    const signedIn = await signInOnce(browser, baseUrl);
    if (!signedIn.ok) {
      console.error(`[caseClickWarm] could not sign in: ${signedIn.reason}`);
      return 2;
    }
    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      for (const { measured, first } of PAIRS) {
        const context = await browser.newContext({ viewport: VIEWPORT, storageState: signedIn.value });
        try {
          const page = await context.newPage();
          await page.goto(`${baseUrl}/cases`, { waitUntil: "networkidle" });
          await openCase(page, baseUrl, first);
          await page.waitForTimeout(FIRST_CASE_DWELL_MS);
          await page.goBack();
          await page.waitForURL(`${baseUrl}/cases`);
          await page.waitForTimeout(LIST_DWELL_MS);
          const readyMs = await openCase(page, baseUrl, measured);
          samples.set(measured, [...(samples.get(measured) ?? []), readyMs]);
          console.log(`[caseClickWarm] run ${runIndex + 1}: ${measured} after ${first} ready in ${Math.round(readyMs)} ms`);
        } finally {
          await context.close();
        }
      }
    }
  } catch (error) {
    console.error(`[caseClickWarm] could not measure: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    await browser.close();
  }
  for (const [slug, values] of samples) {
    const sorted = [...values].sort((first, second) => first - second);
    console.log(`[caseClickWarm] ${slug}: median ${Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0)} ms (${Math.round(sorted[0] ?? 0)}-${Math.round(sorted[sorted.length - 1] ?? 0)})`);
  }
  return 0;
}

if (import.meta.main) process.exit(await main());
