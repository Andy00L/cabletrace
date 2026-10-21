// The director's visibility check (ui-console-2, section 6): for every case, at the start of its drag, at each cut and at
// the end of its drag, the console opens on that minute, the Director button hands it the camera, and every subject the
// director's shot promises (the ship, its anchor, the cut point; in the close-up the anchor and both torn ends) must sit
// inside the shot's safe area and out of the relief's way. Positions and sight lines come from the viewer's own lookdev
// hooks (viewer.ts: data-subjects, data-director-subjects, data-safe-area); the judge is visibility.ts.
// Usage: bun scripts/lookdev/visibility-check.ts <baseUrl> [--tier software|hardware|all] [--only <case slug part>] [--out <dir>]
// Exit codes: 0 every subject visible on every tier run; 1 a subject outside, hidden or missing; 2 a frame not rendered.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { CABLE_CASES } from "../../src/data/cases";
import { toReplaySceneInput } from "../../src/lib/cases/case-file";
import { formatMinute } from "../../src/lib/console/console-state";
import type { Result } from "../../src/lib/result";
import { resolveChromiumPath } from "../perf/chromium-path";
import { signInOnce, TIER_LAUNCH, type PlaywrightTierName, type SignedInState } from "./tier-launch";
import { judgeSubjects, listCheckMoments, parseNames, parseReportedSubjects, parseSafeArea, type SubjectVerdict } from "./visibility";

// The harness's frame (docs/LOOKDEV.md): 1,440 x 900 at device pixel ratio 1, reduced motion, so the director cuts
// straight to its shot and the close-up holds its still angle.
const VIEWPORT = { width: 1440, height: 900 };
const FRAME_TIMEOUT_MS = 120_000;
// The frame counts as settled once no frame has been drawn for this long.
const SETTLE_MS = 800;

type MomentResult = { tier: PlaywrightTierName; caseSlug: string; minute: string; shot: string; renderer: string; verdicts: SubjectVerdict[] };

function readFlag(argumentList: readonly string[], flag: string): string | null {
  const index = argumentList.indexOf(flag);
  return index === -1 ? null : (argumentList[index + 1] ?? null);
}

/** Marks every replay canvas for the lookdev hooks before its first frame (as run-lookdev.ts does; that file runs on import). */
function markLookdevCanvas() {
  const mark = () => {
    for (const canvas of document.querySelectorAll("canvas[data-renderer]")) {
      if (canvas instanceof HTMLCanvasElement && canvas.dataset.lookdev !== "on") canvas.dataset.lookdev = "on";
    }
  };
  new MutationObserver(mark).observe(document, { subtree: true, childList: true });
}

const readCanvasAttribute = (page: Page, name: string) => page.evaluate((attribute) => document.querySelector("canvas[data-renderer]")?.getAttribute(attribute) ?? "", name);

/** Waits until the canvas draws no new frame for SETTLE_MS. */
async function waitForStillFrame(page: Page) {
  await page.waitForFunction(
    (settleMs) => {
      const count = document.querySelector("canvas[data-renderer]")?.getAttribute("data-frame-count") ?? "";
      const seenCount: unknown = Reflect.get(window, "visibilitySeenCount");
      const seenSince: unknown = Reflect.get(window, "visibilitySeenSince");
      if (seenCount !== count || typeof seenSince !== "number") {
        Reflect.set(window, "visibilitySeenCount", count);
        Reflect.set(window, "visibilitySeenSince", performance.now());
        return false;
      }
      return performance.now() - seenSince >= settleMs;
    },
    SETTLE_MS,
    { timeout: FRAME_TIMEOUT_MS, polling: 100 },
  );
}

async function checkMoment(browser: Browser, signedIn: SignedInState, baseUrl: string, tier: PlaywrightTierName, caseSlug: string, atMs: number): Promise<Result<MomentResult>> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce", storageState: signedIn });
  await context.addInitScript(markLookdevCanvas);
  const page = await context.newPage();
  const minute = formatMinute(atMs);
  try {
    await page.goto(`${baseUrl}/cases/${caseSlug}?t=${minute}`, { waitUntil: "load", timeout: FRAME_TIMEOUT_MS });
    await page.waitForSelector('[data-testid="seabed-view"][data-state="ready"]', { timeout: FRAME_TIMEOUT_MS });
    await page.waitForFunction(() => document.querySelector("canvas[data-renderer]")?.getAttribute("data-pending-assets") === "0", null, { timeout: FRAME_TIMEOUT_MS });
    const renderer = await readCanvasAttribute(page, "data-renderer");
    if (renderer !== tier) return { ok: false, reason: `asked for the ${tier} tier, the page drew on ${renderer}` };
    // A link with a moment opens with the director off: the Director button hands it the camera.
    await page.getByTestId("director-toggle").click();
    await page.waitForFunction(() => document.querySelector("canvas[data-renderer]")?.hasAttribute("data-director-shot") ?? false, null, { timeout: FRAME_TIMEOUT_MS });
    await waitForStillFrame(page);
    const shot = await readCanvasAttribute(page, "data-director-shot");
    const safeArea = parseSafeArea(await readCanvasAttribute(page, "data-safe-area"));
    if (!safeArea) return { ok: false, reason: "the canvas reported no safe area" };
    const promised = parseNames(await readCanvasAttribute(page, "data-director-subjects"));
    if (promised.length === 0) return { ok: false, reason: `the ${shot} shot promised no subject` };
    const verdicts = judgeSubjects(promised, parseReportedSubjects(await readCanvasAttribute(page, "data-subjects")), safeArea);
    return { ok: true, value: { tier, caseSlug, minute, shot, renderer, verdicts } };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await context.close();
  }
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const baseUrl = argumentList.find((argument) => URL.canParse(argument))?.replace(/\/$/, "");
  const tierFlag = readFlag(argumentList, "--tier") ?? "all";
  const only = readFlag(argumentList, "--only") ?? "";
  const outDirectory = readFlag(argumentList, "--out") ?? ".scratch/visibility";
  if (!baseUrl || !["software", "hardware", "all"].includes(tierFlag)) {
    console.error("[visibilityCheck] usage: bun scripts/lookdev/visibility-check.ts <baseUrl> [--tier software|hardware|all] [--only <case>] [--out <dir>]");
    return 2;
  }
  const chromiumPath = resolveChromiumPath(null);
  if (!chromiumPath.ok) {
    console.error(`[visibilityCheck] ${chromiumPath.reason}`);
    return 2;
  }
  const tiers: PlaywrightTierName[] = tierFlag === "all" ? ["software", "hardware"] : tierFlag === "software" ? ["software"] : ["hardware"];
  const cases = CABLE_CASES.filter((cableCase) => cableCase.slug.includes(only));
  const results: MomentResult[] = [];
  let renderFailureCount = 0;
  for (const tier of tiers) {
    const launch = TIER_LAUNCH[tier];
    const browser = await chromium.launch({ executablePath: chromiumPath.value, args: launch.args, env: { ...process.env, ...launch.env } });
    const signedIn = await signInOnce(browser, baseUrl);
    if (!signedIn.ok) {
      console.error(`[visibilityCheck] ${signedIn.reason}`);
      await browser.close();
      return 2;
    }
    for (const cableCase of cases) {
      for (const atMs of listCheckMoments(toReplaySceneInput(cableCase))) {
        const checked = await checkMoment(browser, signedIn.value, baseUrl, tier, cableCase.slug, atMs);
        if (!checked.ok) {
          renderFailureCount += 1;
          console.error(`[visibilityCheck] ${tier} ${cableCase.slug} ${formatMinute(atMs)}: not rendered: ${checked.reason}`);
          continue;
        }
        results.push(checked.value);
        const failed = checked.value.verdicts.filter((verdict) => verdict.result !== "visible");
        const summary = failed.length === 0 ? "all visible" : failed.map((verdict) => `${verdict.name} ${verdict.result}`).join(", ");
        console.log(`[visibilityCheck] ${tier} ${cableCase.slug} ${checked.value.minute} ${checked.value.shot}: ${checked.value.verdicts.length - failed.length}/${checked.value.verdicts.length} (${summary})`);
      }
    }
    await browser.close();
  }
  mkdirSync(outDirectory, { recursive: true });
  const reportPath = path.join(outDirectory, "visibility-report.json");
  writeFileSync(reportPath, `${JSON.stringify(results, null, 2)}\n`);
  for (const tier of tiers) {
    const verdicts = results.filter((result) => result.tier === tier).flatMap((result) => result.verdicts);
    const visibleCount = verdicts.filter((verdict) => verdict.result === "visible").length;
    console.log(`[visibilityCheck] ${tier}: ${visibleCount} of ${verdicts.length} subjects visible (${verdicts.length === 0 ? 0 : Math.round((visibleCount / verdicts.length) * 1000) / 10}%)`);
  }
  console.log(`[visibilityCheck] report in ${reportPath}`);
  if (renderFailureCount > 0) return 2;
  return results.every((result) => result.verdicts.every((verdict) => verdict.result === "visible")) ? 0 : 1;
}

process.exit(await main());
