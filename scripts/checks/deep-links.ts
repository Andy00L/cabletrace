// Checks that a shared console link reopens the same moment, view, mode and card (plan/prompts/ui-console.md,
// section 6), and that the browser's Back button closes the last card opened instead of leaving the case.
// Usage: bun scripts/checks/deep-links.ts <baseUrl> [--case <slug>] [--viewport 1440x900] [--chromium <path>]
// The expected state of every link comes from the console's own codec (src/lib/console/console-state.ts).
// Exit codes: 0 every link and Back step passes, 1 one failed, 2 the run itself failed.
import type { Page } from "playwright";
import { toConsoleCase, type ConsoleCase } from "../../src/lib/cases/case-console";
import { toReplaySceneInput, type CableCase } from "../../src/lib/cases/case-file";
import { formatConsoleState, formatMinute, parseConsoleState, type ConsoleContext, type ConsoleLayer, type ConsoleMode, type ConsoleState } from "../../src/lib/console/console-state";
import type { Result } from "../../src/lib/result";
import { formatUtcClock } from "../../src/lib/replay/format-utc";
import type { SeabedViewName } from "../../src/lib/seabed/scene/viewer";
import { describeError, LAYER_SETTLE_MS, LAYER_TEST_IDS, launchBrowser, openConsole, parseCheckArguments } from "./console-page";

// The buttons' names in the view and mode switches; a phone shows the short view names.
// sourceRef: VIEW_OPTIONS and COMPACT_VIEW_OPTIONS in src/components/console/StageOverlays.tsx, MODE_OPTIONS in
// src/components/console/ConsoleTopBar.tsx.
const VIEW_LABELS: Record<SeabedViewName, readonly string[]> = { overview: ["Overview"], top: ["From above", "Above"], vessel: ["Vessel"], closeup: ["At the cut", "Cut"] };
const MODE_LABELS: Record<ConsoleMode, string> = { replay: "Replay", ship: "Ship", evidence: "Evidence" };

type LinkCase = { name: string; query: string };
type SeenState = { clock: string; viewLabel: string | null; modeLabel: string | null; openLayers: string[]; layerText: string; query: string };

/** The codec context for a case, built the way ReplayConsole builds it. */
function toUrlContext(cableCase: CableCase, consoleCase: ConsoleCase): ConsoleContext {
  const input = toReplaySceneInput(cableCase);
  return {
    windowStartMs: input.windowStartMs,
    windowEndMs: input.windowEndMs,
    openingMs: Math.min(input.windowEndMs, Math.max(input.windowStartMs, input.track[0]?.atMs ?? input.windowStartMs)),
    cutSlugs: consoleCase.cuts.map((cut) => cut.slug),
    placementCount: consoleCase.positions.length,
    sourceIds: consoleCase.sources.map((source) => source.id),
  };
}

/** Links that set every key, one per layer kind the case has, plus one with values the codec must reject. */
function listLinks(consoleCase: ConsoleCase, context: ConsoleContext): LinkCase[] {
  const [firstCut] = consoleCase.cuts;
  const middleMinute = formatMinute((context.windowStartMs + context.windowEndMs) / 2);
  const firstSource = consoleCase.sources[0];
  const links: LinkCase[] = [
    { name: "cut card at the cut", query: `t=${formatMinute(firstCut.atMs)}&view=closeup&mode=evidence&layer=cut-${firstCut.slug}` },
    { name: "vessel card following the ship", query: `t=${middleMinute}&view=vessel&mode=ship&layer=vessel` },
    { name: "sources sheet from above", query: `t=${formatMinute(context.windowEndMs)}&view=top&mode=evidence&layer=sources` },
    { name: "shortcuts", query: `t=${formatMinute(context.windowStartMs)}&layer=shortcuts` },
    // Values the codec does not know fall back to the defaults instead of failing the page.
    { name: "unknown values", query: "t=yesterday&view=sideways&mode=cinema&layer=cut-nowhere" },
  ];
  if (firstSource) links.push({ name: "source card", query: `t=${middleMinute}&mode=evidence&layer=source-${firstSource.id}` });
  if (consoleCase.positions.length > 0) links.push({ name: "placement card", query: `mode=evidence&layer=placement-${consoleCase.positions.length - 1}` });
  if (consoleCase.aftermath.length > 0) links.push({ name: "aftermath dialog", query: "mode=evidence&layer=aftermath" });
  return links;
}

/** What the open layer must show: its test id and a line of its content. */
function describeExpectedLayer(layer: ConsoleLayer, consoleCase: ConsoleCase): { testId: string; text: string } | null {
  switch (layer.kind) {
    case "none":
      return null;
    case "vessel":
      return { testId: LAYER_TEST_IDS.vessel, text: consoleCase.vessel.name };
    case "cut":
      return { testId: LAYER_TEST_IDS.cut, text: `${consoleCase.cuts[layer.cutIndex]?.label ?? "?"} cut` };
    case "placement":
      return { testId: LAYER_TEST_IDS.placement, text: consoleCase.positions[layer.positionIndex]?.place ?? "?" };
    case "source":
      return { testId: LAYER_TEST_IDS.source, text: consoleCase.sources.find((source) => source.id === layer.sourceId)?.title ?? "?" };
    case "sources":
      return { testId: LAYER_TEST_IDS.sources, text: "Sources" };
    case "aftermath":
      return { testId: LAYER_TEST_IDS.aftermath, text: consoleCase.aftermath[0]?.title ?? "?" };
    case "shortcuts":
      return { testId: LAYER_TEST_IDS.shortcuts, text: "Keyboard shortcuts" };
    default: {
      const unhandledLayer: never = layer;
      return unhandledLayer;
    }
  }
}

/** Runs in the page: the clock, the pressed view and mode buttons, and every visible layer with its text. */
function readStateInPage(layerTestIds: string[]) {
  const isShown = (element: Element) => element.checkVisibility();
  const pressedIn = (testId: string) =>
    [...document.querySelectorAll(`[data-testid="${testId}"]`)]
      .filter(isShown)
      .flatMap((group) => [...group.querySelectorAll("button[aria-pressed='true']")].map((button) => (button.textContent ?? "").trim()))[0] ?? null;
  const openLayers = layerTestIds.flatMap((testId) => [...document.querySelectorAll(`[data-testid="${testId}"]`)].filter(isShown).map((element) => ({ testId, text: element instanceof HTMLElement ? element.innerText : "" })));
  return {
    clock: (document.querySelector('[data-testid="replay-clock"]')?.textContent ?? "").trim().slice(0, 5),
    viewLabel: pressedIn("view-switch"),
    modeLabel: pressedIn("mode-switch"),
    openLayers: openLayers.map((layer) => layer.testId),
    layerText: openLayers.map((layer) => layer.text).join("\n").replace(/\s+/g, " "),
    query: window.location.search,
  };
}

async function readState(page: Page): Promise<SeenState> {
  return page.evaluate(readStateInPage, Object.values(LAYER_TEST_IDS));
}

/** Compares what the page shows with the state the link encodes; returns every difference. */
function compareState(seen: SeenState, expected: ConsoleState, consoleCase: ConsoleCase, context: ConsoleContext): string[] {
  const differences: string[] = [];
  const expectedClock = formatUtcClock(expected.atMs);
  if (seen.clock !== expectedClock) differences.push(`clock ${seen.clock}, expected ${expectedClock}`);
  if (seen.viewLabel === null || !VIEW_LABELS[expected.view].includes(seen.viewLabel)) differences.push(`view "${seen.viewLabel}", expected ${expected.view}`);
  if (seen.modeLabel !== MODE_LABELS[expected.mode]) differences.push(`mode "${seen.modeLabel}", expected ${MODE_LABELS[expected.mode]}`);
  const expectedLayer = describeExpectedLayer(expected.layer, consoleCase);
  const expectedLayerIds = expectedLayer ? [expectedLayer.testId] : [];
  if (seen.openLayers.join(",") !== expectedLayerIds.join(",")) differences.push(`open layers [${seen.openLayers.join(", ")}], expected [${expectedLayerIds.join(", ")}]`);
  else if (expectedLayer && !seen.layerText.includes(expectedLayer.text)) differences.push(`${expectedLayer.testId} does not show "${expectedLayer.text}"`);
  // The address keeps the state: read back through the codec, it must name the same state.
  const keptState = formatConsoleState(parseConsoleState(new URLSearchParams(seen.query), context), context);
  const expectedQuery = formatConsoleState(expected, context);
  if (keptState !== expectedQuery) differences.push(`address now encodes "${keptState}", expected "${expectedQuery}"`);
  return differences;
}

async function checkLink(page: Page, baseUrl: string, cableCase: CableCase, link: LinkCase, consoleCase: ConsoleCase, context: ConsoleContext): Promise<string[]> {
  const opened = await openConsole(page, `${baseUrl}/cases/${cableCase.slug}?${link.query}`);
  if (!opened.ok) return [opened.reason];
  return compareState(await readState(page), parseConsoleState(new URLSearchParams(link.query), context), consoleCase, context);
}

/**
 * Back after opening layers: opens the vessel card from the ship's name, then the first cut's card from the timeline
 * (which replaces the history entry), and checks one Back closes the cut card and keeps the console open.
 */
async function checkBack(page: Page, baseUrl: string, cableCase: CableCase): Promise<Result<null>> {
  const firstUrl = `${baseUrl}/cases/${cableCase.slug}`;
  const opened = await openConsole(page, firstUrl);
  if (!opened.ok) return opened;
  const visibleCount = (testId: string) => page.getByTestId(testId).filter({ visible: true }).count();
  try {
    const shipName = page.getByTestId("open-vessel-card").filter({ visible: true }).first();
    if ((await shipName.count()) === 0) {
      // On a phone the ship's name sits in the folded case panel.
      await page.getByRole("button", { name: "Open case panel" }).click();
      await page.waitForTimeout(LAYER_SETTLE_MS);
    }
    await page.getByTestId("open-vessel-card").filter({ visible: true }).first().click();
    await page.waitForTimeout(LAYER_SETTLE_MS);
    if ((await visibleCount(LAYER_TEST_IDS.vessel)) === 0 || !page.url().includes("layer=vessel")) return { ok: false, reason: `the ship's name did not open the vessel card (address ${page.url()})` };
    await page.goBack();
    await page.waitForTimeout(LAYER_SETTLE_MS);
    if ((await visibleCount(LAYER_TEST_IDS.vessel)) > 0 || page.url().includes("layer=")) return { ok: false, reason: `Back did not close the vessel card (address ${page.url()})` };
    if (!page.url().startsWith(firstUrl) || (await visibleCount("replay-console")) === 0) return { ok: false, reason: `Back left the console for ${page.url()}` };

    await page.getByTestId("open-vessel-card").filter({ visible: true }).first().click();
    await page.waitForTimeout(LAYER_SETTLE_MS);
    await page.getByTestId("timeline-cut-0").filter({ visible: true }).first().click();
    await page.waitForTimeout(LAYER_SETTLE_MS);
    if ((await visibleCount(LAYER_TEST_IDS.cut)) === 0 || !page.url().includes("layer=cut-")) return { ok: false, reason: `the timeline's first cut did not open its card (address ${page.url()})` };
    await page.goBack();
    await page.waitForTimeout(LAYER_SETTLE_MS);
    if ((await visibleCount(LAYER_TEST_IDS.cut)) > 0 || (await visibleCount(LAYER_TEST_IDS.vessel)) > 0 || page.url().includes("layer=")) return { ok: false, reason: `Back after vessel then cut card left a card open (address ${page.url()})` };
    if (!page.url().startsWith(firstUrl)) return { ok: false, reason: `Back left the console for ${page.url()}` };
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, reason: describeError(error) };
  }
}

async function main(): Promise<number> {
  const parsed = parseCheckArguments(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[deepLinks] ${parsed.reason}`);
    return 2;
  }
  const { baseUrl, chromiumPath, viewport, cases } = parsed.value;
  const browser = await launchBrowser(chromiumPath);
  if (!browser.ok) {
    console.error(`[deepLinks] ${browser.reason}`);
    return 2;
  }
  console.log(`[deepLinks] ${baseUrl} at ${viewport.width}x${viewport.height}, ${cases.length} case(s)`);
  let failureCount = 0;
  let checkCount = 0;
  try {
    const context = await browser.value.newContext({ viewport });
    const page = await context.newPage();
    for (const cableCase of cases) {
      const consoleCase = toConsoleCase(cableCase);
      const urlContext = toUrlContext(cableCase, consoleCase);
      const passed: string[] = [];
      for (const link of listLinks(consoleCase, urlContext)) {
        checkCount += 1;
        const differences = await checkLink(page, baseUrl, cableCase, link, consoleCase, urlContext);
        if (differences.length === 0) passed.push(link.name);
        else {
          failureCount += 1;
          console.log(`[deepLinks] ${cableCase.slug}: ${link.name} (?${link.query}) FAILED: ${differences.join("; ")}`);
        }
      }
      checkCount += 1;
      const back = await checkBack(page, baseUrl, cableCase);
      if (back.ok) passed.push("Back closes the last card");
      else {
        failureCount += 1;
        console.log(`[deepLinks] ${cableCase.slug}: Back FAILED: ${back.reason}`);
      }
      console.log(`[deepLinks] ${cableCase.slug}: passed ${passed.join(", ")}`);
    }
    await context.close();
  } finally {
    await browser.value.close();
  }
  console.log(failureCount === 0 ? `[deepLinks] all ${checkCount} checks passed` : `[deepLinks] ${failureCount} of ${checkCount} checks failed`);
  return failureCount === 0 ? 0 : 1;
}

// Anything thrown past main is a broken run, not a finding: exit 2.
process.exit(
  await main().catch((error: unknown) => {
    console.error(`[deepLinks] the run failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }),
);
