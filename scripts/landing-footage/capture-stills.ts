// The three stills of the real console for the front page (replay-footage.ts, CONSOLE_STILLS), taken at 1,200 x 750
// CSS px and a device pixel ratio of 2, written as AVIF and WebP at every width the manifest lists:
// - vessel: the Vessel view at 13:00 UTC, the anchor dragging, the anchor cam at rest showing it on the seabed (grown
//   to 640 px, it hid the ship);
// - closeup: At the cut, Estlink 2 a minute after it tripped (10:27 UTC), the cut marked in alarm red;
// - globe: /live as it opens, the recorded day's latest frame over the seas the recorder's feeds hear.
// The two console stills keep the stage and its picture overlays, as the time-lapse does.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { CONSOLE_STILLS, findConsoleStillPath, type ConsoleStillName } from "../../src/lib/landing/replay-footage";
import type { Result } from "../../src/lib/result";
import type { SignedInState } from "../lookdev/tier-launch";
import { describeContextOptions, openConsolePage, type PageLayout } from "./console-page";
import { toPublicPath, writeImagePair, type EncodedFile } from "./encode-footage";

const STILL_LAYOUT: PageLayout = { width: 1200, height: 750, deviceScaleFactor: 2 };
// The console stills' moments (UTC, 25 Dec 2024): the drag at mid-gulf, and a minute after Estlink 2 tripped (10:26).
const VESSEL_AT_UTC = "2024-12-25T13:00:00Z";
const CLOSEUP_AT_UTC = "2024-12-25T10:27:00Z";
const LOAD_TIMEOUT_MS = 120_000;
// The globe keeps easing its labels and fading ships in for a moment after it reports ready (ms).
const GLOBE_SETTLE_MS = 5000;
// Room the live page's rail takes at the globe's right edge (CSS px: its inset), left out of the still.
const RAIL_GAP_PX = 16;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Draws one console still and returns its PNG. */
async function captureConsoleStill(input: { browser: Browser; signedIn: SignedInState; baseUrl: string; windowStartMs: number; view: "vessel" | "closeup"; atMs: number }): Promise<Result<Buffer>> {
  const { browser, signedIn, baseUrl, windowStartMs, view, atMs } = input;
  const context = await browser.newContext(describeContextOptions(STILL_LAYOUT, signedIn));
  try {
    const opened = await openConsolePage({ context, baseUrl, caseSlug: "eagle-s-2024", windowStartMs, view, openAtMs: atMs, expectedRenderer: "hardware" });
    if (!opened.ok) return opened;
    const consolePage = opened.value;
    if (view === "vessel" && (await consolePage.page.locator('[data-testid="anchor-cam"]').count()) === 0) {
      return { ok: false, reason: "the anchor cam is not on screen at the vessel still's moment" };
    }
    const drawn = await consolePage.drawFrame(atMs, null);
    if (!drawn.ok) return drawn;
    // The follow camera of the Vessel view takes one more frame after a new moment (viewer.ts); let every frame land.
    await consolePage.page.waitForTimeout(1500);
    return { ok: true, value: await consolePage.takeScreenshot() };
  } finally {
    await context.close();
  }
}

/** Waits until the live globe has drawn its frame on the GPU tier and stopped loading. */
async function waitForGlobe(page: Page): Promise<Result<null>> {
  try {
    await page.waitForSelector('[data-testid="live-globe-view"][data-state="ready"]', { timeout: LOAD_TIMEOUT_MS });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="live-globe"]')?.getAttribute("data-ship-count")) > 0, null, { timeout: LOAD_TIMEOUT_MS, polling: 200 });
    const renderer = await page.evaluate(() => document.querySelector('[data-testid="live-globe"] canvas[data-renderer]')?.getAttribute("data-renderer") ?? "none");
    if (renderer !== "hardware") return { ok: false, reason: `the globe drew on the ${renderer} tier, not hardware` };
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(GLOBE_SETTLE_MS);
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, reason: `the live globe did not load: ${describeError(error)}` };
  }
}

// The globe's own overlays stay (the "recorded day" note, the legend); its controls go, as on the console stills.
const GLOBE_CONTROLS_CSS = `
  [data-testid="live-globe"] { border-radius: 0 !important; box-shadow: none !important; }
  [data-testid="live-tier"], [data-testid="live-credits"], [data-testid="live-globe"] > div:has(> button[aria-label="Reset the view"]) { display: none !important; }
`;

/**
 * The live globe: the page is sized so the part of the globe its rail leaves clear (where the globe centres itself)
 * is the still's 1,200 x 750, and only that part is taken.
 */
async function captureGlobeStill(input: { browser: Browser; signedIn: SignedInState; baseUrl: string }): Promise<Result<Buffer>> {
  const { browser, signedIn, baseUrl } = input;
  const context = await browser.newContext(describeContextOptions(STILL_LAYOUT, signedIn));
  try {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/live`, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
    await page.waitForSelector('[data-testid="live-globe-view"]', { timeout: LOAD_TIMEOUT_MS });
    await page.waitForSelector('[data-testid="live-moment"]', { timeout: LOAD_TIMEOUT_MS });
    const readClearArea = () =>
      page.evaluate((railGapPx) => {
        const globe = document.querySelector('[data-testid="live-globe"]')?.getBoundingClientRect();
        const rail = document.querySelector('[data-testid="live-moment"]')?.getBoundingClientRect();
        if (!globe || !rail) return null;
        return { left: globe.left, top: globe.top, width: rail.left - railGapPx - globe.left, height: globe.height };
      }, RAIL_GAP_PX);
    const firstArea = await readClearArea();
    if (!firstArea) return { ok: false, reason: "the live page has no globe or rail" };
    // Grow the window by what the clear area lacks, then measure again.
    await page.setViewportSize({ width: Math.round(STILL_LAYOUT.width + (STILL_LAYOUT.width - firstArea.width)), height: Math.round(STILL_LAYOUT.height + (STILL_LAYOUT.height - firstArea.height)) });
    const globeReady = await waitForGlobe(page);
    if (!globeReady.ok) return globeReady;
    await page.addStyleTag({ content: GLOBE_CONTROLS_CSS });
    await page.waitForTimeout(500);
    const area = await readClearArea();
    if (!area || Math.abs(area.width - STILL_LAYOUT.width) > 1 || Math.abs(area.height - STILL_LAYOUT.height) > 1) {
      return { ok: false, reason: `the globe's clear area is ${area ? `${area.width} x ${area.height}` : "missing"}, not ${STILL_LAYOUT.width} x ${STILL_LAYOUT.height}` };
    }
    const clip = { x: area.left, y: area.top, width: STILL_LAYOUT.width, height: STILL_LAYOUT.height };
    return { ok: true, value: await page.screenshot({ clip, animations: "disabled", caret: "hide" }) };
  } catch (error) {
    return { ok: false, reason: `the globe still failed: ${describeError(error)}` };
  } finally {
    await context.close();
  }
}

/** Takes the three stills, keeps their PNGs in `<scratchDirectory>/stills` and writes every width as AVIF and WebP. */
export async function captureStills(input: { browser: Browser; signedIn: SignedInState; baseUrl: string; windowStartMs: number; publicDirectory: string; scratchDirectory: string }): Promise<Result<EncodedFile[]>> {
  const { browser, signedIn, baseUrl, windowStartMs, publicDirectory, scratchDirectory } = input;
  const captures: Record<ConsoleStillName, () => Promise<Result<Buffer>>> = {
    vessel: () => captureConsoleStill({ browser, signedIn, baseUrl, windowStartMs, view: "vessel", atMs: Date.parse(VESSEL_AT_UTC) }),
    closeup: () => captureConsoleStill({ browser, signedIn, baseUrl, windowStartMs, view: "closeup", atMs: Date.parse(CLOSEUP_AT_UTC) }),
    globe: () => captureGlobeStill({ browser, signedIn, baseUrl }),
  };
  const stillsDirectory = path.join(scratchDirectory, "stills");
  mkdirSync(stillsDirectory, { recursive: true });
  const written: EncodedFile[] = [];
  for (const still of Object.values(CONSOLE_STILLS)) {
    const captured = await captures[still.name]();
    if (!captured.ok) return { ok: false, reason: `${still.name}: ${captured.reason}` };
    const sourcePath = path.join(stillsDirectory, `${still.name}.png`);
    writeFileSync(sourcePath, captured.value);
    for (const width of still.widths) {
      const avifSitePath = findConsoleStillPath(still.name, width, "avif");
      const webpSitePath = findConsoleStillPath(still.name, width, "webp");
      const sizes = await writeImagePair({ sourcePath, width: still.width, height: still.height, outputWidth: width, avifPath: toPublicPath(publicDirectory, avifSitePath), webpPath: toPublicPath(publicDirectory, webpSitePath) });
      written.push({ sitePath: avifSitePath, bytes: sizes.avifBytes, budgetBytes: null, note: `${still.name} still` });
      written.push({ sitePath: webpSitePath, bytes: sizes.webpBytes, budgetBytes: null, note: `${still.name} still` });
    }
    console.log(`[captureStills] ${still.name}: ${sourcePath}`);
  }
  return { ok: true, value: written };
}
