// Checks the keyboard path through every console layer (plan/prompts/ui-console.md, section 6): from the console's
// first state, with Tab and Enter only, open the layer, check focus moved inside it, press Esc, check the layer
// closed and focus came back to the control that opened it.
// Usage: bun scripts/checks/keyboard-path.ts <baseUrl> [--case <slug>] [--viewport 1440x900] [--chromium <path>]
// Exit codes: 0 every layer passes in every case, 1 a layer failed, 2 the run itself failed.
import type { Locator, Page } from "playwright";
import type { Result } from "../../src/lib/result";
import { describeError, LAYER_SETTLE_MS, LAYER_TEST_IDS, launchBrowser, openConsole, parseCheckArguments, type LayerKind } from "./console-page";

// More Tab presses than any console has controls before its dock; past this the control is not on the Tab path.
const MAX_TABS = 300;
// The exit animation is 20% shorter than the 220 ms entry; a slow software renderer can stretch it.
const CLOSE_TIMEOUT_MS = 3000;
const FOCUS_RETURN_TIMEOUT_MS = 2000;

type Step = { label: string; locate: (page: Page) => Locator };
type LayerPath = { layer: LayerKind; steps: Step[] };

const visibleFirst = (locator: Locator) => locator.filter({ visible: true }).first();
const evidenceMode: Step = { label: "Evidence mode", locate: (page) => visibleFirst(page.getByRole("group", { name: "Mode" }).getByRole("button", { name: "Evidence" })) };

// Each layer and the controls that lead to it, located by data-testid, role and accessible name. The last step is the
// control the layer opens from, where focus must return.
const LAYER_PATHS: LayerPath[] = [
  { layer: "vessel", steps: [{ label: "the ship's name", locate: (page) => visibleFirst(page.getByTestId("open-vessel-card")) }] },
  { layer: "cut", steps: [{ label: "the first cut on the timeline", locate: (page) => visibleFirst(page.getByTestId("timeline-cut-0")) }] },
  { layer: "source", steps: [{ label: "the first source number in the event list", locate: (page) => visibleFirst(page.getByTestId("event-list").getByRole("button", { name: /^Source \d+$/ })) }] },
  { layer: "placement", steps: [evidenceMode, { label: "the first placed position", locate: (page) => visibleFirst(page.getByTestId("placement-card").locator("li > button")) }] },
  { layer: "sources", steps: [evidenceMode, { label: "All sources", locate: (page) => visibleFirst(page.getByTestId("open-sources")) }] },
  { layer: "aftermath", steps: [evidenceMode, { label: "What followed", locate: (page) => visibleFirst(page.getByTestId("open-aftermath")) }] },
  { layer: "shortcuts", steps: [{ label: "Keyboard shortcuts", locate: (page) => visibleFirst(page.getByRole("button", { name: "Keyboard shortcuts" })) }] },
];

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element === document.activeElement).catch(() => false);
}

/** Presses Tab until `target` has focus; returns how many presses it took. */
async function tabTo(page: Page, target: Locator): Promise<Result<number>> {
  for (let pressCount = 1; pressCount <= MAX_TABS; pressCount += 1) {
    await page.keyboard.press("Tab");
    if (await isFocused(target)) return { ok: true, value: pressCount };
  }
  return { ok: false, reason: `not reached in ${MAX_TABS} Tab presses` };
}

/**
 * Reaches a control with Tab and presses Enter. On a phone the rail's controls sit in a folded bottom sheet, so its
 * handle is opened first, with the keyboard too, when the control is not on screen.
 */
async function activate(page: Page, step: Step): Promise<Result<number>> {
  let pressCount = 0;
  const target = step.locate(page);
  if ((await target.count()) === 0) {
    const handle = visibleFirst(page.getByRole("button", { name: "Open case panel" }));
    if ((await handle.count()) === 0) return { ok: false, reason: `${step.label}: not on screen` };
    const handleTabs = await tabTo(page, handle);
    if (!handleTabs.ok) return { ok: false, reason: `the case panel handle: ${handleTabs.reason}` };
    await page.keyboard.press("Enter");
    await page.waitForTimeout(LAYER_SETTLE_MS);
    pressCount += handleTabs.value + 1;
  }
  const control = step.locate(page);
  const tabs = await tabTo(page, control);
  if (!tabs.ok) return { ok: false, reason: `${step.label}: ${tabs.reason}` };
  // Marked before it is pressed, so the focus check after Esc finds this very element, not a re-rendered copy.
  await control.evaluate((element) => {
    document.querySelectorAll("[data-keyboard-opener]").forEach((marked) => marked.removeAttribute("data-keyboard-opener"));
    element.setAttribute("data-keyboard-opener", "true");
  });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(LAYER_SETTLE_MS);
  return { ok: true, value: pressCount + tabs.value + 1 };
}

/** Walks one layer's path; returns the key presses it took to open it, or what went wrong. */
async function checkLayer(page: Page, firstUrl: string, path: LayerPath): Promise<Result<number>> {
  const opened = await openConsole(page, firstUrl);
  if (!opened.ok) return opened;
  let pressCount = 0;
  for (const step of path.steps) {
    const activated = await activate(page, step);
    if (!activated.ok) return activated;
    pressCount += activated.value;
  }
  const layer = visibleFirst(page.getByTestId(LAYER_TEST_IDS[path.layer]));
  if ((await layer.count()) === 0) return { ok: false, reason: "Enter did not open it" };
  const isFocusInside = await layer.evaluate((element) => element.contains(document.activeElement));
  if (!isFocusInside) return { ok: false, reason: `focus stayed outside the layer, on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "nothing")}` };
  await page.keyboard.press("Escape");
  const isClosed = await page
    .waitForFunction((testId) => ![...document.querySelectorAll(`[data-testid="${testId}"]`)].some((element) => element.checkVisibility()), LAYER_TEST_IDS[path.layer], { timeout: CLOSE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!isClosed) return { ok: false, reason: `Esc did not close it within ${CLOSE_TIMEOUT_MS} ms` };
  // Radix hands focus back in a task after the layer unmounts, so focus may still be on the body for a moment.
  const focusedOpener = await page
    .waitForFunction(() => document.activeElement?.getAttribute("data-keyboard-opener") === "true", null, { timeout: FOCUS_RETURN_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!focusedOpener) {
    const whereFocusIs = await page.evaluate(() => {
      const active = document.activeElement;
      const label = active === null || active === document.body ? "the page body" : `<${active.tagName.toLowerCase()}> "${(active.getAttribute("aria-label") ?? active.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60)}"`;
      const isOpenerGone = document.querySelector("[data-keyboard-opener]") === null;
      return `${label}${isOpenerGone ? "; the opener itself was replaced while the layer was open" : ""}`;
    });
    return { ok: false, reason: `focus did not return to the opener; it is on ${whereFocusIs}` };
  }
  return { ok: true, value: pressCount };
}

async function main(): Promise<number> {
  const parsed = parseCheckArguments(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[keyboardPath] ${parsed.reason}`);
    return 2;
  }
  const { baseUrl, chromiumPath, viewport, cases } = parsed.value;
  const browser = await launchBrowser(chromiumPath);
  if (!browser.ok) {
    console.error(`[keyboardPath] ${browser.reason}`);
    return 2;
  }
  console.log(`[keyboardPath] ${baseUrl} at ${viewport.width}x${viewport.height}, ${cases.length} case(s)`);
  let failureCount = 0;
  try {
    const context = await browser.value.newContext({ viewport });
    const page = await context.newPage();
    for (const cableCase of cases) {
      const firstUrl = `${baseUrl}/cases/${cableCase.slug}`;
      const results: string[] = [];
      for (const path of LAYER_PATHS) {
        // The case has nothing behind this control (a case without aftermath has no What followed row).
        if (path.layer === "aftermath" && cableCase.aftermath.length === 0) continue;
        let outcome: Result<number>;
        try {
          outcome = await checkLayer(page, firstUrl, path);
        } catch (error) {
          outcome = { ok: false, reason: describeError(error) };
        }
        if (outcome.ok) results.push(`${path.layer} ok (${outcome.value} keys)`);
        else {
          failureCount += 1;
          console.log(`[keyboardPath] ${cableCase.slug}: ${path.layer} FAILED: ${outcome.reason}`);
        }
      }
      console.log(`[keyboardPath] ${cableCase.slug}: ${results.join(", ")}`);
    }
    await context.close();
  } finally {
    await browser.value.close();
  }
  console.log(failureCount === 0 ? "[keyboardPath] every layer opens, takes focus, closes on Esc and returns focus" : `[keyboardPath] ${failureCount} layer check(s) failed`);
  return failureCount === 0 ? 0 : 1;
}

// Anything thrown past main is a broken run, not a finding: exit 2.
process.exit(
  await main().catch((error: unknown) => {
    console.error(`[keyboardPath] the run failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }),
);
