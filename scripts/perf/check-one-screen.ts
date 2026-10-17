// Checks that the main pages fit one screen and that the 3D view owns it, in headless Chromium.
// Usage: bun scripts/perf/check-one-screen.ts <baseUrl> [--chromium /path/to/chrome]
// For each page and viewport it reports the document height against the viewport, any horizontal overflow, and on a
// case page the share of the viewport the 3D view covers (the whole view, and the part no panel floats over).
// Exit codes: 0 every target met, 1 a target missed, 2 the pages could not be measured.
import { chromium, type Browser } from "playwright";
import type { Result } from "../../src/lib/result";
import { resolveChromiumPath } from "./chromium-path";

// Targets (plan/prompts/ui-console.md, section 6): no page scroll at these sizes, and the 3D view covers at least
// 65% of a 1440 x 900 viewport.
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
] as const;
const ROUTES = ["/", "/cases", "/cases/eagle-s-2024", "/cases/yi-peng-3-2024"] as const;
const STAGE_SHARE_TARGET = 0.65;
const STAGE_TARGET_VIEWPORT = { width: 1440, height: 900 };
// One pixel of rounding is not a scrollbar.
const OVERFLOW_TOLERANCE_PX = 1;
const NAVIGATION_TIMEOUT_MS = 60_000;
// Time for the console's client layout to replace its server fallback and for fonts to settle.
const SETTLE_MS = 1500;

type Measurement = {
  route: string;
  viewport: string;
  documentHeight: number;
  viewportHeight: number;
  documentWidth: number;
  viewportWidth: number;
  /** Share of the viewport the 3D view covers, or null on a page without one. */
  stageShare: number | null;
  /** The same, minus any panel floating over the view. */
  clearStageShare: number | null;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

// Runs in the page: the document size, and the visible areas of the 3D view and of the panels over it.
function readLayout() {
  const viewportArea = window.innerWidth * window.innerHeight;
  const visibleRect = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return { left: Math.max(rect.left, 0), top: Math.max(rect.top, 0), width, height };
  };
  // Previous pages stay mounted but hidden after a client navigation, so only visible elements count.
  const stage = [...document.querySelectorAll('[data-testid="seabed-view"]')].find((element) => element.checkVisibility());
  let stageShare: number | null = null;
  let clearStageShare: number | null = null;
  if (stage) {
    const stageRect = visibleRect(stage);
    const stageArea = stageRect.width * stageRect.height;
    let coveredArea = 0;
    for (const panel of document.querySelectorAll('[data-overlays-stage="true"]')) {
      if (!panel.checkVisibility()) continue;
      const panelRect = visibleRect(panel);
      const overlapWidth = Math.max(0, Math.min(panelRect.left + panelRect.width, stageRect.left + stageRect.width) - Math.max(panelRect.left, stageRect.left));
      const overlapHeight = Math.max(0, Math.min(panelRect.top + panelRect.height, stageRect.top + stageRect.height) - Math.max(panelRect.top, stageRect.top));
      coveredArea += overlapWidth * overlapHeight;
    }
    stageShare = stageArea / viewportArea;
    clearStageShare = Math.max(0, stageArea - coveredArea) / viewportArea;
  }
  return {
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    stageShare,
    clearStageShare,
  };
}

async function measure(browser: Browser, baseUrl: string): Promise<Result<Measurement[]>> {
  const measurements: Measurement[] = [];
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    for (const route of ROUTES) {
      try {
        await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: NAVIGATION_TIMEOUT_MS });
        await page.waitForTimeout(SETTLE_MS);
        const layout = await page.evaluate(readLayout);
        measurements.push({ route, viewport: `${viewport.width}x${viewport.height}`, ...layout });
      } catch (error) {
        await context.close();
        return { ok: false, reason: `${route} at ${viewport.width}x${viewport.height}: ${describeError(error)}` };
      }
    }
    await context.close();
  }
  return { ok: true, value: measurements };
}

function formatShare(share: number | null): string {
  return share === null ? "-" : `${(share * 100).toFixed(1)}%`;
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const baseUrl = argumentList.find((argument) => !argument.startsWith("--") && URL.canParse(argument))?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("[checkOneScreen] pass the base URL, for example http://localhost:3100");
    return 2;
  }
  const chromiumPath = resolveChromiumPath(readFlagValue(argumentList, "--chromium") ?? process.env.PERF_CHROMIUM_PATH ?? null);
  if (!chromiumPath.ok) {
    console.error(`[checkOneScreen] ${chromiumPath.reason}`);
    return 2;
  }
  const browser = await chromium.launch({ executablePath: chromiumPath.value, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const measured = await measure(browser, baseUrl);
  await browser.close();
  if (!measured.ok) {
    console.error(`[checkOneScreen] ${measured.reason}`);
    return 2;
  }

  let missCount = 0;
  console.log("[checkOneScreen] route                    viewport   height/viewport  width/viewport  3D view  clear 3D  verdict");
  for (const row of measured.value) {
    const misses: string[] = [];
    if (row.documentHeight > row.viewportHeight + OVERFLOW_TOLERANCE_PX) misses.push("scrolls");
    if (row.documentWidth > row.viewportWidth + OVERFLOW_TOLERANCE_PX) misses.push("overflows sideways");
    const isStageTarget = row.viewport === `${STAGE_TARGET_VIEWPORT.width}x${STAGE_TARGET_VIEWPORT.height}` && row.route.startsWith("/cases/");
    if (isStageTarget && (row.stageShare ?? 0) < STAGE_SHARE_TARGET) misses.push(`3D view under ${STAGE_SHARE_TARGET * 100}%`);
    missCount += misses.length;
    console.log(
      `[checkOneScreen] ${row.route.padEnd(24)} ${row.viewport.padEnd(10)} ${`${row.documentHeight}/${row.viewportHeight}`.padEnd(16)} ${`${row.documentWidth}/${row.viewportWidth}`.padEnd(15)} ${formatShare(row.stageShare).padEnd(8)} ${formatShare(row.clearStageShare).padEnd(9)} ${misses.length === 0 ? "ok" : misses.join(", ")}`,
    );
  }
  console.log(missCount === 0 ? "[checkOneScreen] every target met" : `[checkOneScreen] ${missCount} target(s) missed`);
  return missCount === 0 ? 0 : 1;
}

process.exit(await main());
