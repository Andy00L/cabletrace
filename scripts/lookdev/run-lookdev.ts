// The lookdev harness: renders fixed frames of every case's 3D replay on each renderer tier, compares them with the
// approved baselines and checks that the data colours reach the screen exactly. docs/LOOKDEV.md explains how to run it.
// Usage: bun scripts/lookdev/run-lookdev.ts <baseUrl> [--tier software|hardware|all] [--only <text>] [--update]
//        [--out <dir>] [--chromium /path/to/chrome]
// Exit codes: 0 every frame matches and every data colour is exact, 1 a regression (or a missing baseline),
// 2 the frames could not be rendered (server down, browser or tier unavailable when asked for by name).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { formatMinute } from "../../src/lib/console/console-state";
import { WEBGL_COLORS } from "../../src/lib/design/webgl-colors";
import type { Result } from "../../src/lib/result";
import type { DataTone } from "../../src/lib/seabed/scene/overview";
import { resolveChromiumPath } from "../perf/chromium-path";
import { compareImages, downscaleImage, formatHexColor, matchColorNear, parseHexColor, type RgbColor } from "./compare";
import { decodePng, encodePng, type RgbaImage } from "./png";
import { listLookdevShots, type LookdevShot } from "./shots";
import { buildTurntablePage } from "./turntable";

type TierName = "software" | "hardware";

// The console's desktop layout at device pixel ratio 1, the size docs/PERFORMANCE.md measures.
const VIEWPORT = { width: 1440, height: 900 };
// Baselines are stored at a third of the frame's size (a 3 x 3 box filter, about 50 KB a frame) to keep the
// repository small; the comparison runs on the frame downscaled the same way. Colour probes run on the full frame.
const BASELINE_SCALE = 3;
// A pixel differs when its YIQ difference passes 0.03, about 8 levels of luma: pixelmatch's default of 0.1 lets a
// whole-frame shift of 10 levels (a regraded seabed) pass as a match. A frame regresses when more than 0.5% of its
// pixels differ. Repeated renders of an unchanged build differ by 0 pixels on both tiers (docs/LOOKDEV.md).
const PIXEL_THRESHOLD = 0.03;
const MAX_DIFFERING_SHARE = 0.005;
// Data colours: within 2 per channel (plan: ambition pass 3.3), searched within 2 px of each probe point.
const COLOR_TOLERANCE = 2;
const PROBE_RADIUS_PX = 2;
// A tone needs this many probes on screen to be judged, and this share of them exact: terrain ridges, the hull and
// crossing lines hide some probe points.
const MIN_PROBES_PER_TONE = 3;
const MIN_EXACT_PROBE_SHARE = 0.6;
// The picture counts as settled when no frame was drawn for this long (a calm scene draws only on change).
const SETTLE_MS = 800;
const FRAME_TIMEOUT_MS = 120_000;
// Scrub steps timed per overview shot for the frame-time figure.
const SCRUB_STEPS = 6;
const TURNTABLE_SHOT_NAME = "ships-turntable";

const TONE_HEX: Record<DataTone, string> = { cable: WEBGL_COLORS.cable, pipeline: WEBGL_COLORS.pipeline, suspect: WEBGL_COLORS.ink, alarm: WEBGL_COLORS.alarm };

// Chromium flags per tier. Software: SwiftShader, as the test browsers draw (M139 and later need the unsafe flag).
// Hardware: ANGLE on OpenGL; on WSL2 Mesa's d3d12 driver reaches the Windows GPU through /dev/dxg. On a laptop with
// two adapters the integrated one lost its contexts and failed to link three.js shaders, so the driver is pointed at
// the adapter named in LOOKDEV_GPU_ADAPTER (default NVIDIA; Mesa matches part of the name).
const TIER_LAUNCH: Record<TierName, { args: string[]; env: Record<string, string> }> = {
  software: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], env: {} },
  hardware: {
    args: ["--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu", "--enable-unsafe-webgpu", "--enable-features=Vulkan"],
    env: existsSync("/usr/lib/wsl/lib")
      ? { GALLIUM_DRIVER: "d3d12", MESA_D3D12_DEFAULT_ADAPTER_NAME: process.env.LOOKDEV_GPU_ADAPTER ?? "NVIDIA", LD_LIBRARY_PATH: "/usr/lib/wsl/lib" }
      : {},
  },
};

type ToneVerdict = { tone: DataTone; probeCount: number; exactCount: number; medianDeviation: number; worstFound: string | null; isPass: boolean; reason: string };

type ShotOutcome = {
  shot: string;
  tier: TierName;
  rendererName: string;
  renderMs: number;
  scrubFrameMs: number | null;
  differingShare: number | null;
  meanDelta: number | null;
  baselineNote: string;
  tones: ToneVerdict[];
  isPass: boolean;
};

type CliOptions = { baseUrl: string; tiers: TierName[]; isTierExplicit: boolean; only: string | null; shouldUpdate: boolean; outDirectory: string; chromiumPath: string | null };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

function parseCliOptions(argumentList: string[]): Result<CliOptions> {
  const baseUrl = argumentList.find((argument) => !argument.startsWith("--") && URL.canParse(argument));
  if (!baseUrl) return { ok: false, reason: "pass the base URL, for example http://localhost:3106" };
  const tierFlag = readFlagValue(argumentList, "--tier") ?? "all";
  if (tierFlag !== "all" && tierFlag !== "software" && tierFlag !== "hardware") return { ok: false, reason: `--tier must be software, hardware or all, got ${tierFlag}` };
  return {
    ok: true,
    value: {
      baseUrl: baseUrl.replace(/\/$/, ""),
      tiers: tierFlag === "all" ? ["software", "hardware"] : [tierFlag],
      isTierExplicit: tierFlag !== "all",
      only: readFlagValue(argumentList, "--only"),
      shouldUpdate: argumentList.includes("--update"),
      outDirectory: readFlagValue(argumentList, "--out") ?? path.join(".scratch", "lookdev"),
      chromiumPath: readFlagValue(argumentList, "--chromium") ?? process.env.PERF_CHROMIUM_PATH ?? null,
    },
  };
}

// Runs in the page before its scripts: marks the 3D canvas for the viewer's lookdev hook as soon as it is inserted,
// before its first frame (scene/viewer.ts, recordColorProbes).
function markLookdevCanvas() {
  const mark = () => {
    for (const canvas of document.querySelectorAll("canvas[data-renderer]")) {
      if (canvas instanceof HTMLCanvasElement && canvas.dataset.lookdev !== "on") canvas.dataset.lookdev = "on";
    }
  };
  new MutationObserver(mark).observe(document, { subtree: true, childList: true });
}

function buildShotUrl(baseUrl: string, shot: LookdevShot): string {
  const params = new URLSearchParams({ t: formatMinute(shot.atMs) });
  if (shot.view !== "overview") params.set("view", shot.view);
  return `${baseUrl}/cases/${shot.caseSlug}?${params.toString().replaceAll("%3A", ":")}`;
}

/** Waits until the canvas has drawn the asked view and moment, then until it stops drawing. Returns the renderer kind. */
async function waitForSettledFrame(page: Page, shot: LookdevShot): Promise<string> {
  await page.waitForSelector('[data-testid="seabed-view"][data-state="ready"]', { timeout: FRAME_TIMEOUT_MS });
  await page.waitForFunction(
    ({ view, atMs }) => {
      const canvas = document.querySelector("canvas[data-renderer]");
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const isLoaded = (canvas.dataset.pendingAssets ?? "0") === "0";
      return isLoaded && canvas.dataset.drawnView === view && Math.abs(Number(canvas.dataset.drawnAtMs) - atMs) < 1000;
    },
    { view: shot.view, atMs: shot.atMs },
    { timeout: FRAME_TIMEOUT_MS, polling: 100 },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(
    (settleMs) => {
      const canvas = document.querySelector("canvas[data-renderer]");
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const count = canvas.dataset.frameCount ?? "";
      const seenCount: unknown = Reflect.get(window, "lookdevSeenCount");
      const seenSinceMs: unknown = Reflect.get(window, "lookdevSeenSinceMs");
      if (seenCount !== count || typeof seenSinceMs !== "number") {
        Reflect.set(window, "lookdevSeenCount", count);
        Reflect.set(window, "lookdevSeenSinceMs", performance.now());
        return false;
      }
      return performance.now() - seenSinceMs >= settleMs;
    },
    SETTLE_MS,
    { timeout: FRAME_TIMEOUT_MS, polling: 100 },
  );
  return page.evaluate(() => document.querySelector("canvas[data-renderer]")?.getAttribute("data-renderer") ?? "unknown");
}

/** Median time (ms) from a one-minute scrub on the timeline to the 3D frame that shows it. */
async function measureScrubFrameMs(page: Page): Promise<number | null> {
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas[data-renderer]");
    const scrubber = document.querySelector('[data-testid="replay-scrubber"]');
    if (!(canvas instanceof HTMLCanvasElement) || !(scrubber instanceof HTMLInputElement)) return;
    const timing = { startedAt: 0, durations: [] as number[] };
    Object.assign(window, { lookdevScrubTiming: timing });
    scrubber.addEventListener("input", () => {
      timing.startedAt = performance.now();
    });
    new MutationObserver(() => {
      if (timing.startedAt > 0) {
        timing.durations.push(performance.now() - timing.startedAt);
        timing.startedAt = 0;
      }
    }).observe(canvas, { attributes: true, attributeFilter: ["data-frame-count"] });
  });
  const scrubber = page.locator('[data-testid="replay-scrubber"]').first();
  if ((await scrubber.count()) === 0) return null;
  await scrubber.focus();
  for (let step = 0; step < SCRUB_STEPS; step += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
  }
  const durations = await page.evaluate(() => {
    const timing: unknown = Reflect.get(window, "lookdevScrubTiming");
    return typeof timing === "object" && timing !== null && "durations" in timing && Array.isArray(timing.durations) ? timing.durations.filter((value): value is number => typeof value === "number") : [];
  });
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

// Hides everything but the 3D view (and, for the colour probes, its labels too), so the rail and the stage controls
// do not enter the frame and DOM text in a data colour cannot pass for a drawn line.
const LOOK_ONLY_CSS = `body * { visibility: hidden !important; } [data-testid="seabed-view"], [data-testid="seabed-view"] * { visibility: visible !important; }`;
const CANVAS_ONLY_CSS = `[data-testid="seabed-view"] canvas ~ div, [data-testid="seabed-view"] canvas ~ div * { visibility: hidden !important; }`;

type ProbePoint = { tone: DataTone; x: number; y: number };

function isProbePoint(value: unknown): value is ProbePoint {
  if (typeof value !== "object" || value === null) return false;
  const tone: unknown = Reflect.get(value, "tone");
  return (tone === "cable" || tone === "pipeline" || tone === "suspect" || tone === "alarm") && typeof Reflect.get(value, "x") === "number" && typeof Reflect.get(value, "y") === "number";
}

function judgeTones(image: RgbaImage, probes: readonly ProbePoint[], requiredTones: readonly DataTone[]): ToneVerdict[] {
  const tones = [...new Set<DataTone>([...requiredTones, ...probes.map((probe) => probe.tone)])];
  return tones.map((tone) => {
    const expected: RgbColor = parseHexColor(TONE_HEX[tone]);
    const matches = probes.filter((probe) => probe.tone === tone).flatMap((probe) => matchColorNear(image, probe.x, probe.y, expected, PROBE_RADIUS_PX) ?? []);
    const exactCount = matches.filter((match) => match.deviation <= COLOR_TOLERANCE).length;
    const deviations = matches.map((match) => match.deviation).sort((first, second) => first - second);
    const worst = matches.reduce<(typeof matches)[number] | null>((current, match) => (current === null || match.deviation > current.deviation ? match : current), null);
    const isRequired = requiredTones.includes(tone);
    let isPass = true;
    let reason = "exact";
    if (matches.length < MIN_PROBES_PER_TONE) {
      isPass = !isRequired;
      reason = isRequired ? `only ${matches.length} probe(s) on screen` : "too few probes to judge";
    } else if (exactCount / matches.length < MIN_EXACT_PROBE_SHARE) {
      isPass = false;
      reason = `${exactCount} of ${matches.length} probes exact`;
    }
    return {
      tone,
      probeCount: matches.length,
      exactCount,
      medianDeviation: deviations[Math.floor(deviations.length / 2)] ?? Number.NaN,
      worstFound: worst ? formatHexColor(worst.found) : null,
      isPass,
      reason,
    };
  });
}

type BaselineVerdict = { differingShare: number | null; meanDelta: number | null; baselineNote: string; isBaselinePass: boolean };

/** Writes the frame to the run's folder, then compares it with its baseline (or writes the baseline with --update). */
function judgeAgainstBaseline(input: { tier: TierName; name: string; framePng: Uint8Array; frame: RgbaImage; options: CliOptions }): Result<BaselineVerdict> {
  const { tier, name, framePng, frame, options } = input;
  const tierOut = path.join(options.outDirectory, tier);
  mkdirSync(tierOut, { recursive: true });
  writeFileSync(path.join(tierOut, `${name}.png`), framePng);
  const scaled = downscaleImage(frame, BASELINE_SCALE);
  const baselinePath = path.join("scripts", "lookdev", "baselines", tier, `${name}.png`);
  if (options.shouldUpdate) {
    mkdirSync(path.dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, encodePng(scaled));
    return { ok: true, value: { differingShare: null, meanDelta: null, baselineNote: "baseline written", isBaselinePass: true } };
  }
  if (!existsSync(baselinePath)) return { ok: true, value: { differingShare: null, meanDelta: null, baselineNote: "no baseline", isBaselinePass: false } };
  const baseline = decodePng(readFileSync(baselinePath));
  if (!baseline.ok) return { ok: false, reason: `baseline ${baselinePath}: ${baseline.reason}` };
  const difference = compareImages(baseline.value, scaled, PIXEL_THRESHOLD);
  if (difference === null) {
    const baselineNote = `size changed: baseline ${baseline.value.width} x ${baseline.value.height}, frame ${scaled.width} x ${scaled.height}`;
    return { ok: true, value: { differingShare: null, meanDelta: null, baselineNote, isBaselinePass: false } };
  }
  writeFileSync(path.join(tierOut, `${name}.diff.png`), encodePng(difference.diffImage));
  const isBaselinePass = difference.differingShare <= MAX_DIFFERING_SHARE;
  return { ok: true, value: { differingShare: difference.differingShare, meanDelta: difference.meanDelta, baselineNote: isBaselinePass ? "matches" : "regressed", isBaselinePass } };
}

/** The ship turntable (every hull kind side by side), judged on its look only. */
async function captureTurntable(browser: Browser, tier: TierName, pageUrl: string, options: CliOptions): Promise<Result<ShotOutcome>> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    const startedAt = performance.now();
    await page.goto(pageUrl, { waitUntil: "load", timeout: FRAME_TIMEOUT_MS });
    await page.waitForSelector("body[data-state]", { state: "attached", timeout: FRAME_TIMEOUT_MS });
    const pageState = await page.evaluate(() => document.body.dataset.state ?? "");
    if (pageState !== "ready") return { ok: false, reason: "the turntable page failed to draw (see its console)" };
    const renderMs = performance.now() - startedAt;
    const rendererKind = await page.evaluate(() => document.querySelector("canvas[data-renderer]")?.getAttribute("data-renderer") ?? "unknown");
    if (rendererKind !== tier) return { ok: false, reason: `asked for the ${tier} tier, the page drew on ${rendererKind}` };
    const framePng = await page.locator("body").screenshot({ animations: "disabled" });
    const frame = decodePng(framePng);
    if (!frame.ok) return { ok: false, reason: `turntable frame: ${frame.reason}` };
    const judged = judgeAgainstBaseline({ tier, name: TURNTABLE_SHOT_NAME, framePng, frame: frame.value, options });
    if (!judged.ok) return judged;
    const { differingShare, meanDelta, baselineNote, isBaselinePass } = judged.value;
    return { ok: true, value: { shot: TURNTABLE_SHOT_NAME, tier, rendererName: rendererKind, renderMs, scrubFrameMs: null, differingShare, meanDelta, baselineNote, tones: [], isPass: isBaselinePass } };
  } catch (error) {
    return { ok: false, reason: describeError(error) };
  } finally {
    await context.close();
  }
}

async function captureShot(browser: Browser, tier: TierName, shot: LookdevShot, options: CliOptions): Promise<Result<ShotOutcome>> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript(markLookdevCanvas);
  const page = await context.newPage();
  try {
    const startedAt = performance.now();
    await page.goto(buildShotUrl(options.baseUrl, shot), { waitUntil: "load", timeout: FRAME_TIMEOUT_MS });
    const rendererKind = await waitForSettledFrame(page, shot);
    const renderMs = performance.now() - startedAt;
    if (rendererKind !== tier) return { ok: false, reason: `asked for the ${tier} tier, the page drew on ${rendererKind}` };
    const rendererName = await page.evaluate(() => {
      const probeContext = document.createElement("canvas").getContext("webgl2");
      const extension = probeContext?.getExtension("WEBGL_debug_renderer_info");
      return probeContext && extension ? String(probeContext.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : "unknown";
    });

    const lookStyle = await page.addStyleTag({ content: LOOK_ONLY_CSS });
    const lookPng = await page.locator('[data-testid="seabed-view"]').screenshot({ animations: "disabled" });
    await page.addStyleTag({ content: CANVAS_ONLY_CSS });
    const canvasPng = await page.locator("canvas[data-renderer]").screenshot({ animations: "disabled" });
    const rawProbes = await page.evaluate(() => document.querySelector("canvas[data-renderer]")?.getAttribute("data-color-probes") ?? "[]");
    await lookStyle.evaluate((element) => element.parentNode?.removeChild(element));

    const look = decodePng(lookPng);
    const canvasImage = decodePng(canvasPng);
    if (!look.ok) return { ok: false, reason: `frame: ${look.reason}` };
    if (!canvasImage.ok) return { ok: false, reason: `canvas frame: ${canvasImage.reason}` };
    const parsedProbes: unknown = JSON.parse(rawProbes);
    const probes = Array.isArray(parsedProbes) ? parsedProbes.filter(isProbePoint) : [];
    const tones = shot.view === "closeup" ? [] : judgeTones(canvasImage.value, probes, shot.requiredTones);

    const judged = judgeAgainstBaseline({ tier, name: shot.name, framePng: lookPng, frame: look.value, options });
    if (!judged.ok) return judged;
    const scrubFrameMs = shot.view === "overview" ? await measureScrubFrameMs(page) : null;
    const { differingShare, meanDelta, baselineNote, isBaselinePass } = judged.value;
    return {
      ok: true,
      value: { shot: shot.name, tier, rendererName, renderMs, scrubFrameMs, differingShare, meanDelta, baselineNote, tones, isPass: isBaselinePass && tones.every((tone) => tone.isPass) },
    };
  } catch (error) {
    return { ok: false, reason: describeError(error) };
  } finally {
    await context.close();
  }
}

function formatPercent(share: number | null): string {
  return share === null ? "-" : `${(share * 100).toFixed(2)}%`;
}

function printOutcome(outcome: ShotOutcome) {
  const scrub = outcome.scrubFrameMs === null ? "" : `, scrub to frame ${Math.round(outcome.scrubFrameMs)} ms`;
  console.log(
    `[runLookdev] ${outcome.tier.padEnd(8)} ${outcome.shot.padEnd(34)} ${outcome.isPass ? "pass" : "FAIL"}  baseline ${outcome.baselineNote} (${formatPercent(outcome.differingShare)} differ)  ready ${Math.round(outcome.renderMs)} ms${scrub}`,
  );
  for (const tone of outcome.tones) {
    const worst = tone.worstFound ? `, worst ${tone.worstFound}` : "";
    console.log(`[runLookdev]          ${tone.tone.padEnd(9)} ${TONE_HEX[tone.tone]}  ${tone.exactCount}/${tone.probeCount} exact, median deviation ${tone.medianDeviation}${worst}: ${tone.isPass ? "ok" : tone.reason}`);
  }
}

async function main(): Promise<number> {
  const parsed = parseCliOptions(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[runLookdev] ${parsed.reason}`);
    return 2;
  }
  const options = parsed.value;
  const chromiumPath = resolveChromiumPath(options.chromiumPath);
  if (!chromiumPath.ok) {
    console.error(`[runLookdev] ${chromiumPath.reason}`);
    return 2;
  }
  const shots = listLookdevShots().filter((shot) => options.only === null || shot.name.includes(options.only));
  const isTurntableIncluded = options.only === null || TURNTABLE_SHOT_NAME.includes(options.only);
  const turntablePage = isTurntableIncluded ? await buildTurntablePage(options.outDirectory) : null;
  if (turntablePage && !turntablePage.ok) {
    console.error(`[runLookdev] the ship turntable did not bundle: ${turntablePage.reason}`);
    return 2;
  }
  const outcomes: ShotOutcome[] = [];
  let hasRenderFailure = false;
  for (const tier of options.tiers) {
    const launch = TIER_LAUNCH[tier];
    let browser: Browser;
    try {
      browser = await chromium.launch({ executablePath: chromiumPath.value, args: launch.args, env: { ...process.env, ...launch.env } });
    } catch (error) {
      console.error(`[runLookdev] ${tier}: browser did not start: ${describeError(error)}`);
      hasRenderFailure = true;
      continue;
    }
    for (const shot of shots) {
      const captured = await captureShot(browser, tier, shot, options);
      if (!captured.ok) {
        // An unavailable hardware tier in a default run is reported, not failed: most machines that run this have no GPU.
        const isSkippable = tier === "hardware" && !options.isTierExplicit && captured.reason.includes("drew on software");
        console[isSkippable ? "log" : "error"](`[runLookdev] ${tier} ${shot.name}: ${isSkippable ? "skipped, no GPU reached" : "could not render"}: ${captured.reason}`);
        if (!isSkippable) hasRenderFailure = true;
        if (isSkippable) break;
        continue;
      }
      outcomes.push(captured.value);
      printOutcome(captured.value);
    }
    if (turntablePage?.ok) {
      const captured = await captureTurntable(browser, tier, turntablePage.value, options);
      if (captured.ok) {
        outcomes.push(captured.value);
        printOutcome(captured.value);
      } else {
        console.error(`[runLookdev] ${tier} ${TURNTABLE_SHOT_NAME}: could not render: ${captured.reason}`);
        hasRenderFailure = true;
      }
    }
    await browser.close();
  }
  mkdirSync(options.outDirectory, { recursive: true });
  writeFileSync(path.join(options.outDirectory, "report.json"), `${JSON.stringify(outcomes, null, 2)}\n`);
  const failedCount = outcomes.filter((outcome) => !outcome.isPass).length;
  console.log(`[runLookdev] ${outcomes.length} frame(s), ${failedCount} failed; frames and diffs in ${options.outDirectory}`);
  if (hasRenderFailure) return 2;
  return failedCount === 0 ? 0 : 1;
}

process.exit(await main());
