// Measures load and runtime cost of the CableTrace pages in headless Chromium and checks them against the budgets below.
// Usage: bun scripts/perf/measure-pages.ts <baseUrl> [--runs 5] [--chromium /path/to/chrome] [--profile desktop|3g-phone]
// Every run opens a fresh browser context (cold HTTP cache). The desktop profile is 1440 x 900 with no throttling; the
// 3g-phone profile is a 390 x 844 phone at device pixel ratio 3 on a throttled 3G link with the CPU slowed 4 times.
// Exit codes: 0 every budget met, 1 a budget broken, 2 the pages could not be measured.
// Headless Chromium draws WebGL with SwiftShader (on the CPU), so the 3D numbers are a slow-machine bound, not a GPU result.
import { chromium, type Browser, type Page, type Request } from "playwright";
import type { Result } from "../../src/lib/result";
import { signInTestUser } from "../auth/sign-in-test-user";
import { resolveChromiumPath } from "./chromium-path";

// Budgets (desktop, broadband). Sources: docs/PERFORMANCE.md, Budgets.
const LCP_BUDGET_MS = 1500;
const CLS_BUDGET = 0.05;
const HOME_JS_BUDGET_BYTES = 200 * 1024;
const SCENE_MEASURED_BUDGET_MS = 6000;
// Budgets on the 3g-phone profile (plan/prompts/landing-and-sign-in.md and ui-console-2.md, section 5 and 6): the first
// screen readable under 2.5 s with under 250 KB transferred before it; the console's shell under 3 s and its first 3D
// frame under 6 s with under 1 MB transferred before that frame.
const PHONE_FIRST_SCREEN_BUDGET_MS = 2500;
const PHONE_FIRST_SCREEN_BUDGET_BYTES = 250 * 1024;
const PHONE_CONSOLE_SHELL_BUDGET_MS = 3000;
const PHONE_FIRST_3D_FRAME_BUDGET_MS = 6000;
const PHONE_FIRST_3D_FRAME_BUDGET_BYTES = 1024 * 1024;

const DEFAULT_RUN_COUNT = 5;
const NAVIGATION_TIMEOUT_MS = 30_000;
// The 3D probe waits for the map, then times up to 3.5 s of frames; a busy machine stretches both. A throttled phone
// gets three times as long before a page counts as unmeasurable rather than slow.
const PROBE_TIMEOUT_MS = 60_000;
const PHONE_TIMEOUT_FACTOR = 3;
// Quiet time after the page is done, so late layout shifts and LCP candidates are counted.
const SETTLE_MS = 1000;
// Prefix of the performance marks the init script writes when a [data-testid][data-state] element changes state.
const STATE_MARK_PREFIX = "perf-state:";

type ProfileName = "desktop" | "3g-phone";
type CliOptions = { baseUrl: string; runCount: number; chromiumPath: string | null; profile: MeasureProfile };

type PageKind = "home" | "diagnostics" | "console";
type PageTarget = { kind: PageKind; route: string };
/** A throttled link, in the units Chromium's Network.emulateNetworkConditions takes (bytes per second). */
type NetworkConditions = { latencyMs: number; downloadBytesPerSecond: number; uploadBytesPerSecond: number };
type MeasureProfile = {
  name: ProfileName;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  network: NetworkConditions | null;
  cpuSlowdown: number;
  targets: PageTarget[];
};
const PROFILES: Record<ProfileName, MeasureProfile> = {
  desktop: {
    name: "desktop",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    network: null,
    cpuSlowdown: 1,
    targets: [
      { kind: "home", route: "/" },
      { kind: "diagnostics", route: "/diagnostics" },
    ],
  },
  // 1.6 Mbps down, 750 kbps up, 300 ms round trip (the prompts' 3G phone), a mid-range phone's CPU as 4x slower.
  "3g-phone": {
    name: "3g-phone",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    network: { latencyMs: 300, downloadBytesPerSecond: (1.6 * 1_000_000) / 8, uploadBytesPerSecond: (750 * 1_000) / 8 },
    cpuSlowdown: 4,
    targets: [
      { kind: "home", route: "/" },
      { kind: "console", route: "/cases/eagle-s-2024" },
    ],
  },
};
const HEALTH_ROUTE = "/api/health";

/** What the page's own performance timeline reports, read in the browser after the page settles. */
type PageVitals = {
  ttfbMs: number;
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number;
  longTaskCount: number;
  longestTaskMs: number;
  stateMarks: { name: string; startTime: number }[];
};

type TransferTotals = { jsBytes: number; cssBytes: number; fontBytes: number; requestCount: number };

type PageSample = {
  vitals: PageVitals;
  transfer: TransferTotals;
  /** Bytes (compressed bodies) whose response ended before the LCP, and before the console's 3D view was ready. */
  bytesBeforeLcp: number | null;
  bytesBeforeSceneReady: number | null;
  consoleShellMs: number | null;
  sceneReadyMs: number | null;
  errorCount: number;
  contentEncoding: string;
  recorderCardMs: number | null;
  mapRenderedMs: number | null;
  sceneMeasuredMs: number | null;
  sceneAverageFrame: string | null;
  sceneRendererKind: string | null;
};

type HealthSample = { status: number; ttfbMs: number; totalMs: number; reportedStatus: string };

type Spread = { median: number; min: number; max: number };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  if (flagIndex === -1) return null;
  return argumentList[flagIndex + 1] ?? null;
}

function isProfileName(value: string): value is ProfileName {
  return value === "desktop" || value === "3g-phone";
}

function parseCliOptions(argumentList: string[]): Result<CliOptions> {
  const baseUrl = argumentList.find((argument) => !argument.startsWith("--") && URL.canParse(argument));
  if (!baseUrl) return { ok: false, reason: "pass the base URL, for example http://localhost:3200" };
  const runFlag = readFlagValue(argumentList, "--runs");
  const runCount = runFlag === null ? DEFAULT_RUN_COUNT : Number(runFlag);
  if (!Number.isInteger(runCount) || runCount < 1) return { ok: false, reason: `--runs must be a positive integer, got ${runFlag}` };
  const chromiumPath = readFlagValue(argumentList, "--chromium") ?? process.env.PERF_CHROMIUM_PATH ?? null;
  const profileFlag = readFlagValue(argumentList, "--profile") ?? "desktop";
  if (!isProfileName(profileFlag)) return { ok: false, reason: `--profile must be desktop or 3g-phone, got ${profileFlag}` };
  return { ok: true, value: { baseUrl: baseUrl.replace(/\/$/, ""), runCount, chromiumPath, profile: PROFILES[profileFlag] } };
}

// Runs in the page before any of its scripts: marks the first time each probe reaches each state, so the timing
// comes from the page's own clock instead of from polling.
function recordStateChanges(markPrefix: string) {
  const recordedMarks = new Set<string>();
  const markStates = () => {
    for (const element of document.querySelectorAll("[data-testid][data-state]")) {
      if (!(element instanceof HTMLElement)) continue;
      const markName = `${markPrefix}${element.dataset.testid}:${element.dataset.state}`;
      if (recordedMarks.has(markName)) continue;
      recordedMarks.add(markName);
      performance.mark(markName);
    }
  };
  new MutationObserver(markStates).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
}

// Runs in the page once it has settled. LCP, layout shifts and long tasks are only exposed to observers, so each is
// read from its buffer through a buffered observer. CLS uses the Core Web Vitals session windows (1 s gap, 5 s cap).
async function readPageVitals(markPrefix: string): Promise<PageVitals> {
  const readBufferedEntries = (entryType: string) =>
    new Promise<PerformanceEntry[]>((resolve) => {
      if (!PerformanceObserver.supportedEntryTypes.includes(entryType)) {
        resolve([]);
        return;
      }
      const observer = new PerformanceObserver((entryList) => {
        observer.disconnect();
        resolve(entryList.getEntries());
      });
      observer.observe({ type: entryType, buffered: true });
      // An empty buffer never calls the observer back.
      setTimeout(() => {
        observer.disconnect();
        resolve([]);
      }, 250);
    });

  const [lcpEntries, shiftEntries, longTaskEntries] = await Promise.all([
    readBufferedEntries("largest-contentful-paint"),
    readBufferedEntries("layout-shift"),
    readBufferedEntries("longtask"),
  ]);

  let largestSessionValue = 0;
  let sessionValue = 0;
  let sessionStart = 0;
  let previousShiftTime = 0;
  for (const shiftEntry of shiftEntries) {
    if (!("value" in shiftEntry) || typeof shiftEntry.value !== "number") continue;
    if ("hadRecentInput" in shiftEntry && shiftEntry.hadRecentInput === true) continue;
    const isSameSession = sessionValue > 0 && shiftEntry.startTime - previousShiftTime < 1000 && shiftEntry.startTime - sessionStart < 5000;
    if (isSameSession) {
      sessionValue += shiftEntry.value;
    } else {
      sessionValue = shiftEntry.value;
      sessionStart = shiftEntry.startTime;
    }
    previousShiftTime = shiftEntry.startTime;
    largestSessionValue = Math.max(largestSessionValue, sessionValue);
  }

  const navigationEntry = performance.getEntriesByType("navigation")[0];
  const paintEntry = performance.getEntriesByName("first-contentful-paint")[0];
  const lastLcpEntry = lcpEntries[lcpEntries.length - 1];
  return {
    ttfbMs: navigationEntry instanceof PerformanceNavigationTiming ? navigationEntry.responseStart : -1,
    fcpMs: paintEntry ? paintEntry.startTime : null,
    lcpMs: lastLcpEntry ? lastLcpEntry.startTime : null,
    cls: largestSessionValue,
    longTaskCount: longTaskEntries.length,
    longestTaskMs: longTaskEntries.reduce((longest, taskEntry) => Math.max(longest, taskEntry.duration), 0),
    stateMarks: performance
      .getEntriesByType("mark")
      .filter((markEntry) => markEntry.name.startsWith(markPrefix))
      .map((markEntry) => ({ name: markEntry.name.slice(markPrefix.length), startTime: markEntry.startTime })),
  };
}

type TransferRecord = { category: "js" | "css" | "font" | "other"; encodedBytes: number; contentEncoding: string; finishedAtEpochMs: number | null };
// What Chromium sends, so a re-fetch gets the same compression the browser got.
const BROWSER_ACCEPT_ENCODING = "gzip, deflate, br, zstd";

function categorizeRequest(request: Request, contentType: string): TransferRecord["category"] {
  const resourceType = request.resourceType();
  if (resourceType === "script" || contentType.includes("javascript")) return "js";
  if (resourceType === "stylesheet" || contentType.includes("text/css")) return "css";
  if (resourceType === "font" || contentType.startsWith("font/")) return "font";
  return "other";
}

// Fetches a URL again without decompressing it and counts the bytes, for responses Chromium reports no size for.
async function fetchEncodedSize(url: string): Promise<number> {
  try {
    const response = await fetch(url, { headers: { "accept-encoding": BROWSER_ACCEPT_ENCODING }, decompress: false });
    return (await response.arrayBuffer()).byteLength;
  } catch (error) {
    console.error(`[fetchEncodedSize] ${url}: ${describeError(error)}`);
    return 0;
  }
}

// The encoded (compressed, on the wire) body size, without headers.
async function readTransfer(request: Request): Promise<TransferRecord> {
  const [sizes, response] = await Promise.all([request.sizes(), request.response()]);
  const headers = response ? await response.allHeaders() : {};
  // A dedicated worker's script (MapLibre's) loads outside the page's network session, so Chromium reports 0 bytes for it.
  const isUnsizedSuccess = sizes.responseBodySize === 0 && response !== null && response.status() === 200 && request.method() === "GET";
  // Playwright gives the request's start on the wall clock and the response's end relative to it (-1 when unknown).
  const timing = request.timing();
  return {
    category: categorizeRequest(request, headers["content-type"] ?? ""),
    encodedBytes: isUnsizedSuccess ? await fetchEncodedSize(request.url()) : sizes.responseBodySize,
    contentEncoding: headers["content-encoding"] ?? "none",
    finishedAtEpochMs: timing.responseEnd >= 0 ? timing.startTime + timing.responseEnd : null,
  };
}

/** Bytes of the responses that ended at or before `atMs` (ms from the page's time origin). */
function sumBytesBefore(transfers: TransferRecord[], timeOriginEpochMs: number, atMs: number | null): number | null {
  if (atMs === null) return null;
  return transfers
    .filter((transfer) => transfer.finishedAtEpochMs !== null && transfer.finishedAtEpochMs - timeOriginEpochMs <= atMs)
    .reduce((sum, transfer) => sum + transfer.encodedBytes, 0);
}

function totalTransfers(transfers: TransferRecord[]): TransferTotals {
  const sumBytes = (category: TransferRecord["category"]) =>
    transfers.filter((transfer) => transfer.category === category).reduce((sum, transfer) => sum + transfer.encodedBytes, 0);
  return {
    jsBytes: sumBytes("js"),
    cssBytes: sumBytes("css"),
    fontBytes: sumBytes("font"),
    requestCount: transfers.length,
  };
}

// First time an element reached a state whose mark starts with `markPrefix` ("testid:" matches any state).
function findStateMarkMs(vitals: PageVitals, markPrefix: string): number | null {
  return vitals.stateMarks.find((stateMark) => stateMark.name.startsWith(markPrefix))?.startTime ?? null;
}

async function waitForPageDone(page: Page, kind: PageKind, timeoutFactor: number): Promise<void> {
  if (kind === "home") {
    // The live recorder card streams in after the static shell; its placeholder has no data-testid.
    await page.waitForSelector('[data-testid="recorder-status"]', { timeout: NAVIGATION_TIMEOUT_MS * timeoutFactor });
  } else if (kind === "console") {
    await page.waitForSelector('[data-testid="seabed-view"]:is([data-state="ready"], [data-state="failed"])', { timeout: PROBE_TIMEOUT_MS * timeoutFactor });
  } else {
    await page.waitForSelector('[data-testid="map-probe"]:is([data-state="rendered"], [data-state="failed"])', { timeout: PROBE_TIMEOUT_MS * timeoutFactor });
    await page.waitForSelector('[data-testid="scene-probe"]:is([data-state="measured"], [data-state="failed"])', { timeout: PROBE_TIMEOUT_MS * timeoutFactor });
  }
  await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS * timeoutFactor });
  await page.waitForTimeout(SETTLE_MS);
}

async function measurePage(browser: Browser, url: string, kind: PageKind, profile: MeasureProfile): Promise<Result<PageSample>> {
  const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobile: profile.isMobile, hasTouch: profile.isMobile });
  // Every page but the landing sits behind sign-in (src/proxy.ts). The context signs in first, unthrottled and on its
  // own tab, so the measured load is a signed-in reader's.
  if (kind !== "home") {
    const signInPage = await context.newPage();
    const signedIn = await signInTestUser(signInPage, new URL(url).origin);
    await signInPage.close();
    if (!signedIn.ok) {
      await context.close();
      return signedIn;
    }
  }
  const page = await context.newPage();
  // Throttling goes through the DevTools protocol, before the first request, so the whole load runs on the slow link.
  if (profile.network !== null || profile.cpuSlowdown > 1) {
    const devtools = await context.newCDPSession(page);
    if (profile.network !== null) {
      await devtools.send("Network.enable");
      await devtools.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: profile.network.latencyMs,
        downloadThroughput: profile.network.downloadBytesPerSecond,
        uploadThroughput: profile.network.uploadBytesPerSecond,
      });
    }
    if (profile.cpuSlowdown > 1) await devtools.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuSlowdown });
  }
  const timeoutFactor = profile.network === null ? 1 : PHONE_TIMEOUT_FACTOR;
  const pendingTransfers: Promise<TransferRecord>[] = [];
  let errorCount = 0;
  page.on("requestfinished", (request) => pendingTransfers.push(readTransfer(request)));
  page.on("requestfailed", () => (errorCount += 1));
  page.on("response", (response) => {
    if (response.status() >= 400) errorCount += 1;
  });
  page.on("pageerror", () => (errorCount += 1));
  try {
    await page.addInitScript(recordStateChanges, STATE_MARK_PREFIX);
    const response = await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS * timeoutFactor });
    if (!response || !response.ok()) return { ok: false, reason: `${url} answered ${response ? response.status() : "nothing"}` };
    await waitForPageDone(page, kind, timeoutFactor);
    const vitals = await page.evaluate(readPageVitals, STATE_MARK_PREFIX);
    const timeOriginEpochMs = await page.evaluate(() => performance.timeOrigin);
    const transfers = await Promise.all(pendingTransfers);
    const sceneReadyMs = findStateMarkMs(vitals, "seabed-view:ready");
    const sceneProbe = page.locator('[data-testid="scene-probe"]');
    const isDiagnostics = kind === "diagnostics";
    return {
      ok: true,
      value: {
        vitals,
        transfer: totalTransfers(transfers),
        bytesBeforeLcp: sumBytesBefore(transfers, timeOriginEpochMs, vitals.lcpMs),
        bytesBeforeSceneReady: sumBytesBefore(transfers, timeOriginEpochMs, sceneReadyMs),
        // The console's shell is up when the 3D view's frame exists, still loading: header, stage, rail and dock are drawn.
        consoleShellMs: findStateMarkMs(vitals, "seabed-view:"),
        sceneReadyMs,
        errorCount,
        contentEncoding: transfers.find((transfer) => transfer.category === "js")?.contentEncoding ?? "none",
        recorderCardMs: findStateMarkMs(vitals, "recorder-status:"),
        mapRenderedMs: findStateMarkMs(vitals, "map-probe:rendered"),
        sceneMeasuredMs: findStateMarkMs(vitals, "scene-probe:measured"),
        sceneAverageFrame: isDiagnostics ? await page.locator('[data-testid="scene-average-frame"]').textContent() : null,
        sceneRendererKind: isDiagnostics ? await sceneProbe.getAttribute("data-renderer-kind") : null,
      },
    };
  } catch (error) {
    return { ok: false, reason: `${url}: ${describeError(error)}` };
  } finally {
    await context.close();
  }
}

// Times the health endpoint from this process: TTFB is when the headers arrive, total when the body is read.
async function measureHealth(url: string): Promise<Result<HealthSample>> {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(NAVIGATION_TIMEOUT_MS) });
    const ttfbMs = performance.now() - startedAt;
    const payload: unknown = await response.json();
    const totalMs = performance.now() - startedAt;
    const reportedStatus =
      typeof payload === "object" && payload !== null && "status" in payload && typeof payload.status === "string" ? payload.status : "unreadable";
    return { ok: true, value: { status: response.status, ttfbMs, totalMs, reportedStatus } };
  } catch (error) {
    return { ok: false, reason: `${url}: ${describeError(error)}` };
  }
}

function summarizeSpread(values: number[]): Spread | null {
  if (values.length === 0) return null;
  const sortedValues = [...values].sort((first, second) => first - second);
  const middleIndex = Math.floor(sortedValues.length / 2);
  const median = sortedValues.length % 2 === 1 ? sortedValues[middleIndex] : (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
  return { median, min: sortedValues[0], max: sortedValues[sortedValues.length - 1] };
}

function collectNumbers(values: (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

function formatSpread(spread: Spread | null, formatValue: (value: number) => string): string {
  if (!spread) return "n/a";
  if (spread.min === spread.max) return formatValue(spread.median);
  return `${formatValue(spread.median)} (${formatValue(spread.min)}-${formatValue(spread.max)})`;
}

const formatMs = (value: number) => `${Math.round(value)}`;
const formatKb = (value: number) => (value / 1024).toFixed(1);
const formatShift = (value: number) => value.toFixed(3);

type PageReport = { target: PageTarget; samples: PageSample[] };
type BudgetCheck = { label: string; isMet: boolean; measured: string };

/** A check that the median of a per-run value stays under its limit; a run without the value fails the check. */
function checkMedianUnder(report: PageReport, label: string, limit: number, readValue: (sample: PageSample) => number | null, formatValue: (value: number) => string): BudgetCheck {
  const values = report.samples.map(readValue);
  const spread = summarizeSpread(collectNumbers(values));
  const hasEveryRun = values.every((value) => value !== null);
  return { label, isMet: hasEveryRun && spread !== null && spread.median < limit, measured: formatSpread(spread, formatValue) };
}

function checkPhoneBudgets(report: PageReport): BudgetCheck[] {
  const { route, kind } = report.target;
  const errorTotal = report.samples.reduce((sum, sample) => sum + sample.errorCount, 0);
  const checks: BudgetCheck[] = [
    checkMedianUnder(report, `${route} CLS < ${CLS_BUDGET}`, CLS_BUDGET, (sample) => sample.vitals.cls, formatShift),
    { label: `${route} no failed requests or page errors`, isMet: errorTotal === 0, measured: `${errorTotal} over ${report.samples.length} runs` },
  ];
  if (kind === "console") {
    checks.push(
      checkMedianUnder(report, `${route} shell < ${PHONE_CONSOLE_SHELL_BUDGET_MS} ms`, PHONE_CONSOLE_SHELL_BUDGET_MS, (sample) => sample.consoleShellMs, formatMs),
      checkMedianUnder(report, `${route} first 3D frame < ${PHONE_FIRST_3D_FRAME_BUDGET_MS} ms`, PHONE_FIRST_3D_FRAME_BUDGET_MS, (sample) => sample.sceneReadyMs, formatMs),
      checkMedianUnder(report, `${route} < ${formatKb(PHONE_FIRST_3D_FRAME_BUDGET_BYTES)} KB before the 3D frame`, PHONE_FIRST_3D_FRAME_BUDGET_BYTES, (sample) => sample.bytesBeforeSceneReady, formatKb),
    );
  } else {
    checks.push(
      checkMedianUnder(report, `${route} first screen (LCP) < ${PHONE_FIRST_SCREEN_BUDGET_MS} ms`, PHONE_FIRST_SCREEN_BUDGET_MS, (sample) => sample.vitals.lcpMs, formatMs),
      checkMedianUnder(report, `${route} < ${formatKb(PHONE_FIRST_SCREEN_BUDGET_BYTES)} KB before the first screen`, PHONE_FIRST_SCREEN_BUDGET_BYTES, (sample) => sample.bytesBeforeLcp, formatKb),
    );
  }
  return checks;
}

function checkPageBudgets(report: PageReport): BudgetCheck[] {
  const { route, kind } = report.target;
  const lcpSpread = summarizeSpread(collectNumbers(report.samples.map((sample) => sample.vitals.lcpMs)));
  const clsSpread = summarizeSpread(report.samples.map((sample) => sample.vitals.cls));
  const errorTotal = report.samples.reduce((sum, sample) => sum + sample.errorCount, 0);
  const checks: BudgetCheck[] = [
    { label: `${route} LCP < ${LCP_BUDGET_MS} ms`, isMet: lcpSpread !== null && lcpSpread.median < LCP_BUDGET_MS, measured: formatSpread(lcpSpread, formatMs) },
    { label: `${route} CLS < ${CLS_BUDGET}`, isMet: clsSpread !== null && clsSpread.median < CLS_BUDGET, measured: formatSpread(clsSpread, formatShift) },
    { label: `${route} no failed requests or page errors`, isMet: errorTotal === 0, measured: `${errorTotal} over ${report.samples.length} runs` },
  ];
  if (kind === "home") {
    const jsSpread = summarizeSpread(report.samples.map((sample) => sample.transfer.jsBytes));
    checks.push({
      label: `${route} JS < ${formatKb(HOME_JS_BUDGET_BYTES)} KB compressed`,
      isMet: jsSpread !== null && jsSpread.median < HOME_JS_BUDGET_BYTES,
      measured: `${formatSpread(jsSpread, formatKb)} KB`,
    });
  }
  if (kind === "diagnostics") {
    const sceneSpread = summarizeSpread(collectNumbers(report.samples.map((sample) => sample.sceneMeasuredMs)));
    const hasEveryRunMeasured = report.samples.every((sample) => sample.sceneMeasuredMs !== null);
    checks.push({
      label: `${route} 3D probe measured < ${SCENE_MEASURED_BUDGET_MS} ms`,
      isMet: hasEveryRunMeasured && sceneSpread !== null && sceneSpread.median < SCENE_MEASURED_BUDGET_MS,
      measured: `${formatSpread(sceneSpread, formatMs)} ms`,
    });
  }
  return checks;
}

// The report itself goes to stdout as plain text; console calls stay for prefixed log lines.
function printReportLine(text: string) {
  process.stdout.write(`${text}\n`);
}

function printTable(headers: string[], rows: string[][]) {
  const columnWidths = headers.map((header, columnIndex) => Math.max(header.length, ...rows.map((row) => (row[columnIndex] ?? "").length)));
  const formatRow = (cells: string[]) => cells.map((cell, columnIndex) => cell.padEnd(columnWidths[columnIndex])).join("  ");
  printReportLine(formatRow(headers));
  printReportLine(columnWidths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) printReportLine(formatRow(row));
}

function describePageRow(report: PageReport): string[] {
  const { samples, target } = report;
  const spreadOf = (readValue: (sample: PageSample) => number | null) => summarizeSpread(collectNumbers(samples.map(readValue)));
  return [
    target.route,
    formatSpread(spreadOf((sample) => sample.vitals.ttfbMs), formatMs),
    formatSpread(spreadOf((sample) => sample.vitals.fcpMs), formatMs),
    formatSpread(spreadOf((sample) => sample.vitals.lcpMs), formatMs),
    formatSpread(spreadOf((sample) => sample.vitals.cls), formatShift),
    formatSpread(spreadOf((sample) => sample.transfer.jsBytes), formatKb),
    formatSpread(spreadOf((sample) => sample.transfer.cssBytes), formatKb),
    formatSpread(spreadOf((sample) => sample.transfer.fontBytes), formatKb),
    formatSpread(spreadOf((sample) => sample.transfer.requestCount), String),
    `${formatSpread(spreadOf((sample) => sample.vitals.longTaskCount), String)} / ${formatSpread(spreadOf((sample) => sample.vitals.longestTaskMs), formatMs)}`,
  ];
}

async function runMeasurements(options: CliOptions, chromiumPath: string): Promise<Result<{ pages: PageReport[]; health: HealthSample[] }>> {
  const browser = await chromium.launch({ executablePath: chromiumPath });
  const pages: PageReport[] = options.profile.targets.map((target) => ({ target, samples: [] }));
  const health: HealthSample[] = [];
  try {
    // Pages alternate inside each run, so warm-up and drift do not favor one page.
    for (let runIndex = 0; runIndex < options.runCount; runIndex += 1) {
      for (const report of pages) {
        const sample = await measurePage(browser, `${options.baseUrl}${report.target.route}`, report.target.kind, options.profile);
        if (!sample.ok) return sample;
        report.samples.push(sample.value);
      }
      const healthSample = await measureHealth(`${options.baseUrl}${HEALTH_ROUTE}`);
      if (!healthSample.ok) return healthSample;
      health.push(healthSample.value);
      console.log(`[runMeasurements] run ${runIndex + 1} of ${options.runCount} done`);
    }
    return { ok: true, value: { pages, health } };
  } finally {
    await browser.close();
  }
}

async function measurePages(): Promise<number> {
  const options = parseCliOptions(process.argv.slice(2));
  if (!options.ok) {
    console.error(`[measurePages] ${options.reason}`);
    console.error("[measurePages] usage: bun scripts/perf/measure-pages.ts <baseUrl> [--runs 5] [--chromium /path/to/chrome] [--profile desktop|3g-phone]");
    return 2;
  }
  const chromiumPath = resolveChromiumPath(options.value.chromiumPath);
  if (!chromiumPath.ok) {
    console.error(`[measurePages] ${chromiumPath.reason}`);
    return 2;
  }
  console.log(`[measurePages] ${options.value.baseUrl}, profile ${options.value.profile.name}, ${options.value.runCount} runs per page, Chromium ${chromiumPath.value}`);
  const measured = await runMeasurements(options.value, chromiumPath.value);
  if (!measured.ok) {
    console.error(`[measurePages] could not measure: ${measured.reason}`);
    return 2;
  }
  const { pages, health } = measured.value;

  printReportLine("\nMedian (min-max) per page. Times in ms from navigation start, sizes in KB as transferred (compressed body).\n");
  printTable(
    ["Page", "TTFB", "FCP", "LCP", "CLS", "JS KB", "CSS KB", "Font KB", "Requests", "Long tasks / longest ms"],
    pages.map(describePageRow),
  );

  const homeSamples = pages.find((report) => report.target.kind === "home")?.samples ?? [];
  const diagnosticsSamples = pages.find((report) => report.target.kind === "diagnostics")?.samples ?? [];
  const consoleSamples = pages.find((report) => report.target.kind === "console")?.samples ?? [];
  const spreadAcross = (samples: PageSample[], readValue: (sample: PageSample) => number | null) =>
    formatSpread(summarizeSpread(collectNumbers(samples.map(readValue))), formatMs);
  const isPhone = options.value.profile.name === "3g-phone";
  printReportLine("");
  if (isPhone) {
    const kbAcross = (samples: PageSample[], readValue: (sample: PageSample) => number | null) =>
      formatSpread(summarizeSpread(collectNumbers(samples.map(readValue))), formatKb);
    printTable(
      ["On the 3G phone", "Done at ms", "KB before"],
      [
        ["/ first screen (LCP)", spreadAcross(homeSamples, (sample) => sample.vitals.lcpMs), kbAcross(homeSamples, (sample) => sample.bytesBeforeLcp)],
        ["console shell drawn", spreadAcross(consoleSamples, (sample) => sample.consoleShellMs), "n/a"],
        ["console first 3D frame", spreadAcross(consoleSamples, (sample) => sample.sceneReadyMs), kbAcross(consoleSamples, (sample) => sample.bytesBeforeSceneReady)],
      ],
    );
  } else printTable(
    ["Part drawn after the first paint", "Done at ms", "Detail"],
    [
      ["/ live watch card drawn", spreadAcross(homeSamples, (sample) => sample.recorderCardMs), "read once a minute into the cached page"],
      ["/diagnostics map rendered", spreadAcross(diagnosticsSamples, (sample) => sample.mapRenderedMs), "MapLibre first idle"],
      [
        "/diagnostics 3D seabed measured",
        spreadAcross(diagnosticsSamples, (sample) => sample.sceneMeasuredMs),
        `renderer ${diagnosticsSamples[0]?.sceneRendererKind ?? "unknown"}, average frame ${diagnosticsSamples.map((sample) => sample.sceneAverageFrame ?? "n/a").join(", ")}`,
      ],
    ],
  );

  const ttfbSpread = summarizeSpread(health.map((sample) => sample.ttfbMs));
  const totalSpread = summarizeSpread(health.map((sample) => sample.totalMs));
  const healthStatuses = [...new Set(health.map((sample) => `${sample.status} ${sample.reportedStatus}`))].join(", ");
  printReportLine("");
  printTable(["Endpoint", "TTFB", "Total", "Answers"], [[HEALTH_ROUTE, formatSpread(ttfbSpread, formatMs), formatSpread(totalSpread, formatMs), healthStatuses]]);
  const encodings = [...new Set(pages.flatMap((report) => report.samples.map((sample) => sample.contentEncoding)))].join(", ");
  printReportLine(`\nJS content-encoding: ${encodings}`);

  const healthCheck: BudgetCheck = {
    label: `${HEALTH_ROUTE} answers 200`,
    isMet: health.every((sample) => sample.status === 200),
    measured: healthStatuses,
  };
  const budgetChecks = [...pages.flatMap(isPhone ? checkPhoneBudgets : checkPageBudgets), healthCheck];
  printReportLine("");
  printTable(
    ["Budget", "Result", "Measured (median, min-max)"],
    budgetChecks.map((check) => [check.label, check.isMet ? "pass" : "FAIL", check.measured]),
  );
  return budgetChecks.every((check) => check.isMet) ? 0 : 1;
}

process.exit(await measurePages());
