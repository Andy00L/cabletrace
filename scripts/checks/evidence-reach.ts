// Checks that nothing the old case page showed got lost in the console: from the console's first state, every
// source (title, link, archived copy), quote, translation, placement note, aftermath step, scale sentence and data
// credit must be on screen after two interactions or fewer (plan/prompts/ui-console.md, section 6).
// Usage: bun scripts/checks/evidence-reach.ts <baseUrl> [--case <slug>] [--viewport 1440x900] [--workers 3] [--chromium <path>]
// An interaction is one click on a visible control or one key press of a console shortcut. The search runs
// breadth first: the first state, every single interaction, then two interactions, starting with the controls the
// first one revealed; it stops as soon as every item has been seen.
// Exit codes: 0 everything reachable, 1 something is not, 2 the run itself failed.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { formatPublishedDate } from "../../src/lib/cases/case-view";
import type { CableCase, Citation } from "../../src/lib/cases/case-file";
import type { Result } from "../../src/lib/result";
import { chooseSceneExaggeration, CLOSE_UP_SCALE_NOTES, describeOverviewScale } from "../../src/lib/seabed/scene-scales";
import { LAND_CREDIT } from "../../src/lib/seabed/scene-credits";
import { parseSeabedFeatures } from "../../src/lib/seabed/seabed-data";
import { describeError, LAYER_SETTLE_MS, launchBrowser, openConsole, parseCheckArguments, type Viewport } from "./console-page";

// Single-key shortcuts the console listens for (src/components/console/ReplayConsole.tsx).
const SHORTCUT_KEYS = ["?", "1", "2", "3", "4", "f", "Space", "ArrowLeft", "ArrowRight"] as const;
// Controls that cannot reveal evidence, left out to keep the search short: they act on the camera, the clipboard
// or the window only. The Watch buttons (data-testid "watch-*", src/components/watchlist/WatchButton.tsx) are left
// out too: they write to the reader's watchlist or send a signed-out reader to sign in.
const SKIPPED_CONTROL_NAMES = new Set(["Copy link", "Reset the view", "Full screen", "Leave full screen"]);
const DEFAULT_WORKERS = 3;
const ACTION_TIMEOUT_MS = 3000;

type EvidenceKind = "source title" | "source link" | "archived copy" | "quote" | "translation" | "placement" | "aftermath step" | "scale sentence" | "data credit";
type EvidenceItem = { kind: EvidenceKind; label: string; match: { kind: "text"; text: string } | { kind: "href"; href: string } };

type Action = { kind: "click"; controlKey: string } | { kind: "press"; key: string };
type Control = { key: string; reachId: string; isFresh: boolean };
type Observation = { signature: string; controls: Control[]; text: string; hrefs: string[] };
type ExploredState = { actions: Action[]; observation: Observation };

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function shorten(text: string): string {
  const normalized = normalizeText(text);
  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
}

function describeAction(action: Action): string {
  return action.kind === "click" ? `click "${action.controlKey.split("|")[2] ?? action.controlKey}"` : `press ${action.key}`;
}

type SceneFacts = { overviewScale: string; depthCredit: string; lineCredit: string };

/**
 * The overview's scale sentence and the depth, cable and pipeline credits as the scale popover writes them from the
 * case's seabed file (the case page reads the same file and picks the exaggeration with chooseSceneExaggeration; the
 * credit sentences are built in src/components/console/StageOverlays.tsx).
 */
function readSceneFacts(seabedArea: string): Result<SceneFacts> {
  try {
    const features = parseSeabedFeatures(JSON.parse(readFileSync(path.join(process.cwd(), "public", "seabed", `${seabedArea}-seabed.json`), "utf8")));
    if (!features.ok) return features;
    const { depth, cables, pipelines } = features.value.sources;
    return {
      ok: true,
      value: {
        overviewScale: describeOverviewScale(chooseSceneExaggeration(features.value.elevationRange)),
        depthCredit: `Depth: ${depth}.`,
        lineCredit: `Cables: ${cables}. Pipelines: ${pipelines}. OpenStreetMap data is under the ODbL.`,
      },
    };
  } catch (error) {
    return { ok: false, reason: `seabed file for ${seabedArea}: ${describeError(error)}` };
  }
}

/** Every piece of evidence the case holds, as text or a link that must appear on screen. */
function listEvidence(cableCase: CableCase, sceneFacts: SceneFacts): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const seenTexts = new Set<string>();
  const addText = (kind: EvidenceKind, label: string, text: string) => {
    const normalized = normalizeText(text);
    if (seenTexts.has(`${kind}|${normalized}`)) return;
    seenTexts.add(`${kind}|${normalized}`);
    items.push({ kind, label, match: { kind: "text", text: normalized } });
  };
  cableCase.sources.forEach((source) => {
    addText("source title", `source ${source.id} "${shorten(source.title)}" (${formatPublishedDate(source.publishedOn)})`, source.title);
    items.push({ kind: "source link", label: `source ${source.id} ${source.url}`, match: { kind: "href", href: source.url } });
    if (source.archivedUrl) items.push({ kind: "archived copy", label: `source ${source.id} ${source.archivedUrl}`, match: { kind: "href", href: source.archivedUrl } });
  });
  const addCitations = (citations: readonly Citation[]) =>
    citations.forEach((citation) => {
      addText("quote", `quote from source ${citation.sourceId} "${shorten(citation.quote)}"`, citation.quote);
      if (citation.translation) addText("translation", `translation from source ${citation.sourceId} "${shorten(citation.translation)}"`, citation.translation);
    });
  addCitations(cableCase.vessel.citations);
  cableCase.track.forEach((position) => {
    addText("placement", `placement of ${position.atUtc} "${shorten(position.placement)}"`, position.placement);
    addCitations(position.citations);
  });
  if (cableCase.recordedTrack) {
    addText("placement", `recorded track selection "${shorten(cableCase.recordedTrack.selection)}"`, cableCase.recordedTrack.selection);
    addCitations(cableCase.recordedTrack.citations);
  }
  if (cableCase.dragWindow) addCitations(cableCase.dragWindow.citations);
  cableCase.cuts.forEach((cut) => {
    addText("placement", `placement of the ${cut.label} cut "${shorten(cut.placement)}"`, cut.placement);
    addCitations(cut.citations);
  });
  cableCase.events.forEach((event) => addCitations(event.citations));
  cableCase.aftermath.forEach((step) => {
    addText("aftermath step", `aftermath "${shorten(step.title)}"`, step.title);
    addCitations(step.citations);
  });
  addText("scale sentence", "overview scale sentence", sceneFacts.overviewScale);
  addText("scale sentence", "close-up scale sentence (illustrated)", CLOSE_UP_SCALE_NOTES.illustrated);
  addText("scale sentence", "close-up scale sentence (measured)", CLOSE_UP_SCALE_NOTES.measured);
  addText("data credit", "depth credit", sceneFacts.depthCredit);
  addText("data credit", "land credit with its liability sentence", LAND_CREDIT);
  addText("data credit", "cable and pipeline credit", sceneFacts.lineCredit);
  return items;
}

/**
 * Runs in the page: tags every control a person can use right now with `data-reach-id` and reads the visible text
 * and links. Controls behind a modal layer (aria-hidden by Radix) or hidden do not count. `previousKeys` marks the
 * controls that were not there before the last interaction.
 */
function observeInPage(input: { skippedNames: string[]; previousKeys: string[] | null }) {
  const isShown = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && rect.width > 0 && rect.height > 0;
  };
  const skipped = new Set(input.skippedNames);
  const previous = input.previousKeys === null ? null : new Set(input.previousKeys);
  const counts = new Map<string, number>();
  const controls: { key: string; reachId: string; isFresh: boolean }[] = [];
  document.querySelectorAll("[data-reach-id]").forEach((element) => element.removeAttribute("data-reach-id"));
  const selector = "button, summary, input:not([type='hidden']), select, [role='button'], [role='tab'], [role='menuitem'], [role='option']";
  document.querySelectorAll(selector).forEach((element, index) => {
    if (!(element instanceof HTMLElement) || !isShown(element)) return;
    if (element.closest("[aria-hidden='true'], [inert]") || element.matches(":disabled")) return;
    const name = (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (skipped.has(name) || element.getAttribute("data-testid")?.startsWith("watch-")) return;
    const baseKey = `${element.tagName.toLowerCase()}|${element.getAttribute("role") ?? ""}|${name}|${element.getAttribute("aria-expanded") ?? ""}|${element.getAttribute("aria-pressed") ?? ""}`;
    const occurrence = counts.get(baseKey) ?? 0;
    counts.set(baseKey, occurrence + 1);
    const key = `${baseKey}|${occurrence}`;
    const reachId = String(index);
    element.setAttribute("data-reach-id", reachId);
    controls.push({ key, reachId, isFresh: previous !== null && !previous.has(key) });
  });
  const hrefs = [...document.querySelectorAll("a[href]")].flatMap((anchor) => (anchor instanceof HTMLAnchorElement && isShown(anchor) ? [anchor.href, anchor.getAttribute("href") ?? ""] : []));
  const query = new URLSearchParams(window.location.search);
  // The replay minute moves on its own while playing; the state is the same card, view and mode at any minute.
  query.delete("t");
  return { controls, text: document.body.innerText, hrefs, query: query.toString() };
}

async function observe(page: Page, previousKeys: string[] | null): Promise<Observation> {
  const seen = await page.evaluate(observeInPage, { skippedNames: [...SKIPPED_CONTROL_NAMES], previousKeys });
  const signature = `${seen.query}#${seen.controls.map((control) => control.key).join(",")}`;
  return { signature, controls: seen.controls, text: normalizeText(seen.text), hrefs: seen.hrefs };
}

/**
 * Clicks a control with the mouse at its centre, after checking in the page that the centre is the control itself
 * and not something covering it. Playwright's own click also waits for two animation frames with the control
 * standing still, which the software renderer can starve for seconds; a person does not wait for that.
 */
async function clickLikeAPerson(page: Page, reachId: string): Promise<Result<null>> {
  const target = await page.evaluate((id) => {
    const element = document.querySelector(`[data-reach-id="${id}"]`);
    if (!(element instanceof HTMLElement)) return { kind: "gone" as const };
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const pointX = rect.left + rect.width / 2;
    const pointY = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(pointX, pointY);
    if (hit === null || (hit !== element && !element.contains(hit))) return { kind: "covered" as const, by: hit?.outerHTML.slice(0, 80) ?? "nothing" };
    return { kind: "clear" as const, pointX, pointY };
  }, reachId);
  switch (target.kind) {
    case "gone":
      return { ok: false, reason: "control gone" };
    case "covered":
      return { ok: false, reason: `covered by ${target.by}` };
    case "clear":
      await page.mouse.click(target.pointX, target.pointY);
      return { ok: true, value: null };
    default: {
      const unhandledTarget: never = target;
      return unhandledTarget;
    }
  }
}

/**
 * Brings an open console back to its first state without a reload, the way a person would undo their clicks: Esc
 * closes the open layer, the address goes back to the case's own (the console restores view, mode, layer and time
 * from it on popstate, src/components/console/ReplayConsole.tsx), and the toggles the address does not carry are
 * set back (the status island, the folded rail, the phone panel, playing). The state counts as reset only when its
 * controls, address and every word on screen match the first state; anything else reloads the page.
 */
async function resetInPlace(page: Page, firstState: Observation): Promise<boolean> {
  try {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.history.replaceState(null, "", window.location.pathname);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    const toggles = [
      page.getByTestId("replay-anchor-status").and(page.locator("[aria-expanded='true']")),
      page.getByTestId("replay-play").and(page.getByRole("button", { name: "Pause replay" })),
      page.getByRole("button", { name: "Show panel" }),
    ];
    for (const toggle of toggles) {
      if ((await toggle.filter({ visible: true }).count()) > 0) await toggle.first().click({ timeout: ACTION_TIMEOUT_MS });
    }
    const panelHandle = page.getByRole("button", { name: /^(Open|Fold) case panel$/ }).filter({ visible: true }).first();
    if ((await panelHandle.count()) > 0 && !firstState.signature.includes(`|${await panelHandle.getAttribute("aria-label")}|`)) await panelHandle.click({ timeout: ACTION_TIMEOUT_MS });
    await page.waitForTimeout(LAYER_SETTLE_MS);
    const observation = await observe(page, null);
    return observation.signature === firstState.signature && observation.text === firstState.text;
  } catch {
    return false;
  }
}

type ResetCounts = { inPlace: number; reloads: number };

/**
 * Starts from the console's first state (in place when the page already shows the console, by a reload otherwise),
 * performs the actions in order, and reads what is on screen after the last one.
 */
async function runActions(page: Page, input: { firstUrl: string; firstState: Observation | null; actions: readonly Action[]; resets: ResetCounts }): Promise<Result<Observation>> {
  const { firstUrl, firstState, actions, resets } = input;
  const isOnConsole = page.url().split("?")[0] === firstUrl;
  if (firstState !== null && isOnConsole && (await resetInPlace(page, firstState))) {
    resets.inPlace += 1;
  } else {
    const opened = await openConsole(page, firstUrl);
    if (!opened.ok) return opened;
    resets.reloads += 1;
  }
  try {
    let observation = await observe(page, null);
    for (const action of actions) {
      const previousKeys = observation.controls.map((control) => control.key);
      if (action.kind === "press") {
        await page.keyboard.press(action.key);
      } else {
        const control = observation.controls.find((candidate) => candidate.key === action.controlKey);
        if (!control) return { ok: false, reason: `${describeAction(action)}: control not found` };
        const clicked = await clickLikeAPerson(page, control.reachId);
        if (!clicked.ok) return { ok: false, reason: `${describeAction(action)}: ${clicked.reason}` };
      }
      await page.waitForTimeout(LAYER_SETTLE_MS);
      // A control that leads to another page (a case in the switcher) leaves this case's evidence behind.
      if (page.url().split("?")[0] !== firstUrl) return { ok: false, reason: `${describeAction(action)}: left the console for ${page.url()}` };
      observation = await observe(page, previousKeys);
    }
    return { ok: true, value: observation };
  } catch (error) {
    return { ok: false, reason: `${actions.map(describeAction).join(", then ")}: ${describeError(error)}` };
  }
}

/** Runs the tasks on the pages, one task per page at a time; `shouldRun` can drop a task just before it starts. */
async function runOnPages<TTask>(pages: readonly Page[], tasks: readonly TTask[], runTask: (page: Page, task: TTask) => Promise<void>, shouldRun: () => boolean): Promise<void> {
  let nextIndex = 0;
  await Promise.all(
    pages.map(async (page) => {
      while (nextIndex < tasks.length && shouldRun()) {
        const task = tasks[nextIndex];
        nextIndex += 1;
        if (task !== undefined) await runTask(page, task);
      }
    }),
  );
}

type CaseOutcome = { slug: string; itemCount: number; foundAtDepth: [number, number, number]; missing: EvidenceItem[]; actionsRun: number; failedActions: string[]; elapsedSeconds: number };

async function checkCase(browser: Browser, input: { baseUrl: string; cableCase: CableCase; viewport: Viewport; workerCount: number }): Promise<Result<CaseOutcome>> {
  const { baseUrl, cableCase, viewport, workerCount } = input;
  const startedMs = performance.now();
  const firstUrl = `${baseUrl}/cases/${cableCase.slug}`;
  const sceneFacts = readSceneFacts(cableCase.seabedArea);
  if (!sceneFacts.ok) return sceneFacts;
  const items = listEvidence(cableCase, sceneFacts.value);
  const depthByItem = new Map<EvidenceItem, number>();
  const failedActions: string[] = [];
  const resets: ResetCounts = { inPlace: 0, reloads: 0 };
  let actionsRun = 0;
  const record = (observation: Observation, depth: number) => {
    items.forEach((item) => {
      if (depthByItem.has(item)) return;
      const isSeen = item.match.kind === "text" ? observation.text.includes(item.match.text) : observation.hrefs.includes(item.match.href);
      if (isSeen) depthByItem.set(item, depth);
    });
  };
  const isAnythingMissing = () => depthByItem.size < items.length;

  const contexts = await Promise.all(Array.from({ length: workerCount }, () => browser.newContext({ viewport })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const [firstPage] = pages;
    if (!firstPage) return { ok: false, reason: "no browser page" };
    const firstState = await runActions(firstPage, { firstUrl, firstState: null, actions: [], resets });
    if (!firstState.ok) return firstState;
    record(firstState.value, 0);

    const keyActions: Action[] = SHORTCUT_KEYS.map((key) => ({ kind: "press", key }));
    const firstActions: Action[] = [...firstState.value.controls.map((control): Action => ({ kind: "click", controlKey: control.key })), ...keyActions];
    const statesBySignature = new Map<string, ExploredState>();
    const runTask = async (page: Page, actions: Action[]) => {
      actionsRun += 1;
      const outcome = await runActions(page, { firstUrl, firstState: firstState.value, actions, resets });
      if (!outcome.ok) {
        failedActions.push(`${actions.map(describeAction).join(", then ")}: ${outcome.reason}`);
        return;
      }
      record(outcome.value, actions.length);
      if (actions.length === 1 && outcome.value.signature !== firstState.value.signature && !statesBySignature.has(outcome.value.signature)) {
        statesBySignature.set(outcome.value.signature, { actions, observation: outcome.value });
      }
    };
    const reportPhase = (phase: string) =>
      console.log(`[evidenceReach] ${cableCase.slug}: ${phase} done, ${actionsRun} paths in ${Math.round((performance.now() - startedMs) / 1000)} s, ${items.length - depthByItem.size} item(s) not seen yet (${resets.inPlace} resets in place, ${resets.reloads} reloads)`);
    await runOnPages(pages, firstActions.map((action) => [action]), runTask, isAnythingMissing);
    reportPhase("one interaction");

    // Second interactions: first on the controls the first one revealed (a card's citations, a sheet's rows), then,
    // only while something is still missing, on every other control and shortcut.
    const states = [...statesBySignature.values()];
    const toTasks = (isFresh: boolean) =>
      states.flatMap((state) => [
        ...state.observation.controls.filter((control) => control.isFresh === isFresh).map((control): Action[] => [...state.actions, { kind: "click", controlKey: control.key }]),
        ...(isFresh ? [] : keyActions.map((action): Action[] => [...state.actions, action])),
      ]);
    await runOnPages(pages, toTasks(true), runTask, isAnythingMissing);
    reportPhase(`two interactions on revealed controls (${states.length} distinct states after one)`);
    await runOnPages(pages, toTasks(false), runTask, isAnythingMissing);
    reportPhase("two interactions on every control");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }

  const foundAtDepth: [number, number, number] = [0, 0, 0];
  depthByItem.forEach((depth) => {
    if (depth === 0 || depth === 1 || depth === 2) foundAtDepth[depth] += 1;
  });
  return {
    ok: true,
    value: {
      slug: cableCase.slug,
      itemCount: items.length,
      foundAtDepth,
      missing: items.filter((item) => !depthByItem.has(item)),
      actionsRun,
      failedActions,
      elapsedSeconds: Math.round((performance.now() - startedMs) / 1000),
    },
  };
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const parsed = parseCheckArguments(argumentList);
  if (!parsed.ok) {
    console.error(`[evidenceReach] ${parsed.reason}`);
    return 2;
  }
  const workersFlagIndex = argumentList.indexOf("--workers");
  const workerCount = workersFlagIndex === -1 ? DEFAULT_WORKERS : Number(argumentList[workersFlagIndex + 1]);
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 8) {
    console.error("[evidenceReach] --workers takes a whole number from 1 to 8");
    return 2;
  }
  const { baseUrl, chromiumPath, viewport, cases } = parsed.value;
  const browser = await launchBrowser(chromiumPath);
  if (!browser.ok) {
    console.error(`[evidenceReach] ${browser.reason}`);
    return 2;
  }
  console.log(`[evidenceReach] ${baseUrl} at ${viewport.width}x${viewport.height}, ${cases.length} case(s), ${workerCount} page(s) at a time`);
  let missingCount = 0;
  try {
    for (const cableCase of cases) {
      const outcome = await checkCase(browser.value, { baseUrl, cableCase, viewport, workerCount });
      if (!outcome.ok) {
        console.error(`[evidenceReach] ${cableCase.slug}: ${outcome.reason}`);
        return 2;
      }
      const { itemCount, foundAtDepth, missing, actionsRun, failedActions, elapsedSeconds } = outcome.value;
      console.log(
        `[evidenceReach] ${cableCase.slug}: ${itemCount - missing.length} of ${itemCount} items reachable (${foundAtDepth[0]} on the first screen, ${foundAtDepth[1]} after one interaction, ${foundAtDepth[2]} after two); ${actionsRun} interaction paths tried in ${elapsedSeconds} s`,
      );
      missing.forEach((item) => console.log(`[evidenceReach]   not reachable in two interactions: ${item.kind}: ${item.label}`));
      if (failedActions.length > 0) console.log(`[evidenceReach]   ${failedActions.length} path(s) could not be followed (a control covered or gone), first: ${failedActions[0]}`);
      missingCount += missing.length;
    }
  } finally {
    await browser.value.close();
  }
  console.log(missingCount === 0 ? "[evidenceReach] every item is reachable in two interactions or fewer" : `[evidenceReach] ${missingCount} item(s) not reachable in two interactions`);
  return missingCount === 0 ? 0 : 1;
}

// Anything thrown past main is a broken run, not a finding: exit 2.
process.exit(
  await main().catch((error: unknown) => {
    console.error(`[evidenceReach] the run failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }),
);
