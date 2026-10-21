// The lookdev harness's WebGPU tier: frames drawn by Windows Chrome on the machine's real GPU, driven from WSL through
// the command line, because headless Chromium inside WSL only gets a software WebGPU adapter and the Windows Chrome's
// DevTools port is not reachable from WSL (docs/LOOKDEV.md, WebGPU). Without DevTools there is no Playwright, so:
//   - a small proxy in front of the app injects a page agent into each HTML page. The agent waits for the frame the
//     shot asks for exactly as the Playwright tiers wait (canvas test hooks, then 0.8 s without a new frame), hides
//     what the shot hides, and prints the colour probes and the 3D view's box on the console, which Chrome's logging
//     writes to stderr;
//   - the proxy also injects an async script whose response it holds until the agent releases it. The load event
//     waits for that script and headless Chrome takes its screenshot at the load event, so the screenshot is taken
//     after the agent saw the settled frame, in real time (Chrome's virtual time ran ahead of the GPU's work);
//   - Chrome always runs headless, with a profile and its temporary files inside .scratch, and only processes started
//     with that profile are ever stopped.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Result } from "../../src/lib/result";
import { decodePng, type RgbaImage } from "./png";

export const DEFAULT_WINDOWS_CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
// The profile lives here whatever --out says, so a run never writes a Chrome profile outside the repository's scratch.
const PROFILE_DIRECTORY = path.resolve(".scratch", "lookdev-webgpu-profile");
// Chrome's temporary files go here instead of Windows %TEMP%, and each run starts it empty. On 17 and 18 Oct 2026 the
// runs left about 1,400 extension downloads (6 to 27 MB each) in %TEMP%: programs installed on Windows (Acrobat, NordVPN)
// register extensions Chrome adds to every profile, and each run quit at its screenshot before the install finished,
// so the next run started over. With this folder, whatever Chrome stages stays in the repository's scratch.
const TEMP_DIRECTORY = path.resolve(".scratch", "lookdev-webgpu-temp");
// One Chrome run per frame: long enough for a cold profile, the build's chunks and the GPU pipelines on a laptop.
const RUN_TIMEOUT_MS = 150_000;
// WSL forwards a port Windows can reach on localhost a moment after something starts listening on it; a run that
// meets a refused connection waits this long and tries again, this many times.
const CONNECTION_RETRY_MS = 3000;
const CONNECTION_ATTEMPTS = 4;
export const DEFAULT_PROXY_PORT = 3329;
// The agent's console lines carry this prefix; anything else Chrome logs is ignored.
const RESULT_PREFIX = "[runLookdevAgent] result ";
const HOLD_PATH = "/__lookdev/hold.js";
const RELEASE_PATH = "/__lookdev/release";
/** Where the proxy serves the WebGPU ship turntable (turntable-webgpu-page.ts) from. */
export const TURNTABLE_PATH = "/__lookdev/turntable/";

/**
 * What the page shows when its screenshot is taken: the 3D view with its labels, or the bare canvas. `case-click`
 * opens /cases and times clicks on cases instead (scripts/perf/windows-case-click.ts), and `frame-pacing` records the
 * replay's frame intervals while it idles, plays, changes view and scrubs (scripts/perf/windows-frame-pacing.ts);
 * neither screenshot is judged.
 */
export type CaptureMode = "look" | "canvas" | "timing" | "turntable" | "case-click" | "frame-pacing";

export type AgentConfig = {
  mode: CaptureMode;
  view: string;
  atMs: number;
  settleMs: number;
  timeoutMs: number;
  scrubSteps: number;
  lookCss: string;
  canvasCss: string;
  /** The viewport the screenshot is taken at (Chrome's --window-size). */
  viewportWidth: number;
  viewportHeight: number;
  /** The `case-click` mode's cases, clicked in this order from /cases, back to /cases between two. */
  clickSlugs: string[];
};

/**
 * One scene of the `frame-pacing` mode: the page's animation frames per second, the 3D view's drawn frames per second,
 * the frame interval's percentiles (ms), how many intervals passed 25 ms (a dropped frame at 60 Hz) and 50 ms, and the
 * scripts that ran longest inside long animation frames (ms summed per script). `topSelf` and `topTotal` are the
 * functions the JS sampling profiler (JS Self-Profiling API, allowed by the proxy's Document-Policy header) found
 * running themselves and on the stack, as "ms name file:line:column"; empty where the browser offers no profiler.
 */
export type FrameScene = { name: string; startedAtMs: number; fps: number; drawnFps: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number; over25: number; over50: number; topScripts: string[]; topSelf: string[]; topTotal: string[] };

/** One timed click in the `case-click` mode, in ms from the click. */
export type CaseClickTiming = { slug: string; readyMs: number; firstFrameMs: number | null; renderer: string; steps: string };

type BoxRect = { left: number; top: number; width: number; height: number };

/** What the agent reports once the frame has settled (or why it gave up). */
export type AgentReport = {
  error: string | null;
  renderer: string;
  adapterName: string;
  devicePixelRatio: number;
  readyMs: number;
  viewRect: BoxRect | null;
  canvasRect: BoxRect | null;
  colorProbes: unknown;
  seabedProbes: unknown;
  scrubFrameMs: number | null;
  /** The `case-click` mode's timings, in click order; empty in the other modes. */
  clickTimings: CaseClickTiming[];
  /** The `frame-pacing` mode's scenes, as the agent summarised them; empty in the other modes. */
  frameScenes: FrameScene[];
  /** The `frame-pacing` mode's scene start times and the viewer's slow one-off steps, as lines to print. */
  slowSteps: string[];
  /** The viewport when the agent reported: the screenshot's, or the report does not describe the screenshot. */
  viewportWidth: number;
  viewportHeight: number;
};

/**
 * Runs in the page before its scripts (serialized into a script tag by the proxy). Browser code: it reads the
 * viewer's canvas hooks (src/lib/seabed/scene/viewer.ts) and the console's scrubber, never the app's modules.
 */
function runLookdevAgent(config: AgentConfig, resultPrefix: string, releaseUrl: string) {
  const startedAt = performance.now();
  const markCanvas = () => {
    for (const canvas of document.querySelectorAll("canvas[data-renderer]")) {
      if (canvas instanceof HTMLCanvasElement && canvas.dataset.lookdev !== "on") canvas.dataset.lookdev = "on";
    }
  };
  // The frame-pacing mode times the page as a reader has it: the lookdev hooks (probes, raycasts each frame) stay off.
  if (config.mode !== "frame-pacing") new MutationObserver(markCanvas).observe(document, { subtree: true, childList: true });
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const readCanvas = () => {
    const canvas = document.querySelector("canvas[data-renderer]");
    return canvas instanceof HTMLCanvasElement ? canvas : null;
  };
  const waitUntil = async (isDone: () => boolean, what: string) => {
    while (!isDone()) {
      if (performance.now() - startedAt > config.timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await pause(100);
    }
  };
  const readBox = (element: Element | null) => {
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  };
  const log = (fields: Record<string, unknown>) => console.log(resultPrefix + JSON.stringify({ ...fields, viewportWidth: innerWidth, viewportHeight: innerHeight }));
  const release = () => void fetch(releaseUrl).catch(() => undefined);
  const report = (fields: Record<string, unknown>) => {
    log(fields);
    release();
  };
  // Headless Chrome lays the page out in a viewport smaller than --window-size (it keeps room for a window frame that
  // is not there) and resizes it to the window size right after the load event, draws, and takes the screenshot. So
  // the agent releases the load first, waits for that resize and for the viewer's frame at the new size, and only
  // then reports the boxes and probes, which are the screenshot's. Checked every frame: the screenshot comes soon. Up
  // to 20 s: once the case page drew on WebGPU without a WebGL context opened beside it, 5 s was too short on two runs
  // in three (the resize waits behind the scene's staged shader compile, most likely).
  const releaseThenReport = async (buildReport: () => Record<string, unknown>, needsNewFrame: boolean) => {
    const isAtScreenshotSize = () => innerWidth === config.viewportWidth && innerHeight === config.viewportHeight;
    const wasAtScreenshotSize = isAtScreenshotSize();
    const countAtRelease = readCanvas()?.dataset.frameCount;
    release();
    const deadline = performance.now() + 20000;
    while (performance.now() < deadline) {
      await nextFrame();
      const hasNewFrame = wasAtScreenshotSize || !needsNewFrame || readCanvas()?.dataset.frameCount !== countAtRelease;
      if (isAtScreenshotSize() && hasNewFrame) break;
    }
    log(buildReport());
  };
  const readAdapterName = async () => {
    const gpu: unknown = Reflect.get(navigator, "gpu");
    if (typeof gpu !== "object" || gpu === null) return "no WebGPU";
    const requestAdapter: unknown = Reflect.get(gpu, "requestAdapter");
    if (typeof requestAdapter !== "function") return "no WebGPU";
    const adapter: unknown = await Reflect.apply(requestAdapter, gpu, []);
    const info: unknown = typeof adapter === "object" && adapter !== null ? Reflect.get(adapter, "info") : null;
    if (typeof info !== "object" || info === null) return "unknown adapter";
    return ["vendor", "architecture", "description"]
      .map((key) => Reflect.get(info, key))
      .filter((part) => typeof part === "string" && part !== "")
      .join(" ");
  };
  // One-minute steps on the replay's scrubber, timed from the input event to the next drawn frame (the Playwright
  // tiers press ArrowRight; stepUp plus an input event is the same change for React's range input).
  const measureScrub = async (canvas: HTMLCanvasElement) => {
    const scrubber = document.querySelector('[data-testid="replay-scrubber"]');
    if (!(scrubber instanceof HTMLInputElement)) return null;
    const durations: number[] = [];
    for (let step = 0; step < config.scrubSteps; step += 1) {
      const countBefore = canvas.dataset.frameCount;
      const inputAt = performance.now();
      scrubber.stepUp();
      scrubber.dispatchEvent(new Event("input", { bubbles: true }));
      while (canvas.dataset.frameCount === countBefore && performance.now() - inputAt < 5000) await nextFrame();
      if (canvas.dataset.frameCount !== countBefore) durations.push(performance.now() - inputAt);
      await pause(400);
    }
    const sorted = [...durations].sort((first, second) => first - second);
    return sorted[Math.floor(sorted.length / 2)] ?? null;
  };
  // The ship turntable page draws once and marks its body; the harness screenshots the body, as on the WebGL tiers.
  const runTurntable = async () => {
    // The agent runs in <head>, before <body> exists: the body is looked up, never assumed.
    const readPageState = () => document.querySelector("body")?.dataset.state;
    await waitUntil(() => readPageState() !== undefined, "the turntable");
    if (readPageState() !== "ready") throw new Error("the turntable page failed to draw (see its console)");
    for (let frame = 0; frame < 3; frame += 1) await nextFrame();
    const canvas = readCanvas();
    const adapterName = await readAdapterName();
    const readyMs = performance.now();
    await releaseThenReport(() => ({ error: null, renderer: canvas?.dataset.renderer ?? "unknown", adapterName, devicePixelRatio: window.devicePixelRatio, readyMs, viewRect: readBox(document.body), canvasRect: readBox(canvas), colorProbes: [], seabedProbes: [], scrubFrameMs: null }), false);
  };
  // From /cases: waits until the page is idle, clicks a case card and times until that case's 3D view (the visible
  // one: Next keeps a page it left mounted and hidden) says ready, and its canvas's first frame; then back to /cases
  // for the next case. The times come from a MutationObserver, so they do not wait for a polling tick.
  const runCaseClicks = async () => {
    const isShown = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
    const findShownView = () => [...document.querySelectorAll('[data-testid="seabed-view"]')].find(isShown) ?? null;
    const timings: { slug: string; readyMs: number; firstFrameMs: number | null; renderer: string; steps: string }[] = [];
    for (const slug of config.clickSlugs) {
      const findCard = () => [...document.querySelectorAll(`a[href="/cases/${slug}"]`)].find(isShown) ?? null;
      // Clicked before React has hydrated it, a card is a plain link and the browser loads the case as a new page: wait
      // for the props React attaches to a hydrated element.
      const isHydrated = (element: Element) => Object.keys(element).some((key) => key.startsWith("__reactProps"));
      await waitUntil(() => location.pathname === "/cases" && findCard() !== null && isHydrated(findCard() ?? document.body), `the ${slug} card`);
      await pause(1500);
      const card = findCard();
      if (!(card instanceof HTMLElement)) throw new Error(`the ${slug} card went away`);
      let readyAt: number | null = null;
      let firstFrameAt: number | null = null;
      const clickAt = performance.now();
      const watcher = new MutationObserver(() => {
        if (location.pathname !== `/cases/${slug}`) return;
        const view = findShownView();
        if (!view) return;
        if (readyAt === null && view.getAttribute("data-state") === "ready") readyAt = performance.now();
        if (firstFrameAt === null && view.querySelector("canvas[data-frame-count]")) firstFrameAt = performance.now();
      });
      watcher.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state", "data-frame-count"] });
      card.click();
      await waitUntil(() => readyAt !== null && firstFrameAt !== null, `${slug} to be ready`);
      watcher.disconnect();
      timings.push({ slug, readyMs: (readyAt ?? clickAt) - clickAt, firstFrameMs: firstFrameAt === null ? null : firstFrameAt - clickAt, renderer: findShownView()?.querySelector("canvas[data-renderer]")?.getAttribute("data-renderer") ?? "unknown", steps: performance.getEntriesByType("mark").filter((mark) => mark.name.startsWith("seabed:") && mark.startTime >= clickAt).map((mark) => `${mark.name.slice("seabed:".length)} ${Math.round(mark.startTime - clickAt)}`).join(", ") });
      await pause(2500);
      history.back();
    }
    await waitUntil(() => location.pathname === "/cases", "the way back to /cases");
    await releaseThenReport(() => ({ error: null, renderer: timings[0]?.renderer ?? "unknown", adapterName: "", devicePixelRatio: window.devicePixelRatio, readyMs: 0, viewRect: null, canvasRect: null, colorProbes: [], seabedProbes: [], scrubFrameMs: null, clickTimings: timings }), false);
  };
  // Records one scene: every animation frame's interval, the canvas's drawn frames, and the long animation frames with
  // their scripts, while `act` runs; then summarises it, so the report line stays short.
  const recordScene = async (name: string, act: () => Promise<void>) => {
    const intervals: number[] = [];
    const scriptTotals = new Map<string, number>();
    let isRecording = true;
    let lastAt = 0;
    const onFrame = (now: number) => {
      if (!isRecording) return;
      if (lastAt > 0) intervals.push(now - lastAt);
      lastAt = now;
      requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const scripts: unknown = Reflect.get(entry, "scripts");
        if (!Array.isArray(scripts)) continue;
        for (const script of scripts) {
          const label = [Reflect.get(script, "invoker"), Reflect.get(script, "sourceFunctionName"), String(Reflect.get(script, "sourceURL") ?? "").split("/").pop()].filter((part) => part).join(" ");
          scriptTotals.set(label, (scriptTotals.get(label) ?? 0) + Number(Reflect.get(script, "duration") ?? 0));
        }
      }
    });
    observer.observe({ type: "long-animation-frame", buffered: false });
    // The JS Self-Profiling API: a sample of the stack every PROFILE_SAMPLE_MS.
    const PROFILE_SAMPLE_MS = 2;
    const ProfilerClass: unknown = Reflect.get(window, "Profiler");
    let profiler: unknown = null;
    try {
      profiler = typeof ProfilerClass === "function" ? Reflect.construct(ProfilerClass, [{ sampleInterval: PROFILE_SAMPLE_MS, maxBufferSize: 200000 }]) : null;
    } catch {
      profiler = null;
    }
    const framesBefore = Number(readCanvas()?.dataset.frameCount ?? 0);
    const sceneStartedAt = performance.now();
    await act();
    const seconds = (performance.now() - sceneStartedAt) / 1000;
    isRecording = false;
    observer.disconnect();
    const selfTotals = new Map<string, number>();
    const inclusiveTotals = new Map<string, number>();
    const stopProfiler: unknown = typeof profiler === "object" && profiler !== null ? Reflect.get(profiler, "stop") : null;
    if (typeof profiler === "object" && profiler !== null && typeof stopProfiler === "function") {
      // The trace is plain data (frames, stacks, samples, resources), read field by field.
      const readField = (value: unknown, key: string): unknown => (typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined);
      const readList = (value: unknown, key: string): unknown[] => {
        const list = readField(value, key);
        return Array.isArray(list) ? list : [];
      };
      const trace: unknown = await Reflect.apply(stopProfiler, profiler, []);
      const frames = readList(trace, "frames");
      const stacks = readList(trace, "stacks");
      const resources = readList(trace, "resources");
      const labelFrame = (frameId: number) => {
        const frame = frames[frameId];
        const resourceId = readField(frame, "resourceId");
        const resource = typeof resourceId === "number" ? String(resources[resourceId] ?? "").split("/").pop() : "";
        return `${String(readField(frame, "name") || "(anonymous)")} ${resource}:${String(readField(frame, "line") ?? "")}:${String(readField(frame, "column") ?? "")}`;
      };
      for (const sample of readList(trace, "samples")) {
        let stackId = readField(sample, "stackId");
        if (typeof stackId !== "number") continue;
        const topFrameId = readField(stacks[stackId], "frameId");
        if (typeof topFrameId === "number") selfTotals.set(labelFrame(topFrameId), (selfTotals.get(labelFrame(topFrameId)) ?? 0) + PROFILE_SAMPLE_MS);
        const seen = new Set<string>();
        while (typeof stackId === "number") {
          const frameId = readField(stacks[stackId], "frameId");
          if (typeof frameId === "number") seen.add(labelFrame(frameId));
          stackId = readField(stacks[stackId], "parentId");
        }
        seen.forEach((label) => inclusiveTotals.set(label, (inclusiveTotals.get(label) ?? 0) + PROFILE_SAMPLE_MS));
      }
    }
    const topOf = (totals: Map<string, number>, count: number) => [...totals].sort((first, second) => second[1] - first[1]).slice(0, count).map(([label, total]) => `${Math.round(total)} ms ${label}`);
    const drawnFrames = Number(readCanvas()?.dataset.frameCount ?? 0) - framesBefore;
    const sorted = [...intervals].sort((first, second) => first - second);
    const pick = (share: number) => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0) * 10) / 10;
    return {
      name,
      fps: Math.round((intervals.length / seconds) * 10) / 10,
      drawnFps: Math.round((drawnFrames / seconds) * 10) / 10,
      p50Ms: pick(0.5),
      p95Ms: pick(0.95),
      p99Ms: pick(0.99),
      maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
      over25: intervals.filter((interval) => interval > 25).length,
      over50: intervals.filter((interval) => interval > 50).length,
      topScripts: [...scriptTotals].sort((first, second) => second[1] - first[1]).slice(0, 4).map(([label, total]) => `${Math.round(total)} ms ${label}`),
      startedAtMs: sceneStartedAt,
      topSelf: topOf(selfTotals, 14),
      topTotal: topOf(inclusiveTotals, 30),
    };
  };
  // On a case page, once the 3D view is ready and its refinement shown: the replay idling, playing, moving between
  // views, and scrubbed, as a reader does; each scene's frame pacing goes into the report.
  const runFramePacing = async () => {
    await waitUntil(() => document.querySelector('[data-testid="seabed-view"][data-state="ready"]') !== null, "the 3D view");
    await waitUntil(() => readCanvas()?.dataset.pendingAssets === "0", "the refinement");
    await pause(1500);
    const clickButton = (selector: string) => {
      const button = document.querySelector(selector);
      if (button instanceof HTMLElement) button.click();
    };
    const clickView = (label: string) => {
      const button = [...document.querySelectorAll('[data-testid="view-switch"] button')].find((candidate) => candidate.textContent?.trim() === label);
      if (button instanceof HTMLElement) button.click();
    };
    const scenes: Awaited<ReturnType<typeof recordScene>>[] = [];
    scenes.push(await recordScene("idle 3 s", () => pause(3000)));
    scenes.push(
      await recordScene("playing 8 s", async () => {
        clickButton('[data-testid="replay-play"]');
        await pause(8000);
        clickButton('[data-testid="replay-play"]');
      }),
    );
    await pause(500);
    scenes.push(
      await recordScene("view changes 6 s", async () => {
        for (const label of ["From above", "Vessel", "At the cut", "Overview"]) {
          clickView(label);
          await pause(1500);
        }
      }),
    );
    scenes.push(
      await recordScene("scrub 2 s", async () => {
        const scrubber = document.querySelector('[data-testid="replay-scrubber"]');
        if (!(scrubber instanceof HTMLInputElement)) return;
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        const low = Number(scrubber.min || 0);
        const high = Number(scrubber.max || 100);
        for (let step = 0; step <= 60; step += 1) {
          setValue?.call(scrubber, String(low + ((high - low) * (0.2 + (0.6 * step) / 60))));
          scrubber.dispatchEvent(new Event("input", { bubbles: true }));
          await pause(33);
        }
      }),
    );
    // The viewer's one-off steps after its first frame that held the page over 50 ms (its seabed:* measures), and when.
    const slowSteps = performance
      .getEntriesByType("measure")
      .filter((entry) => entry.name.startsWith("seabed:") && entry.duration > 50)
      .map((entry) => `${entry.name} at ${Math.round(entry.startTime)} ms: ${Math.round(entry.duration)} ms${entry instanceof PerformanceMeasure && entry.detail ? ` (${String(entry.detail)})` : ""}`);
    const sceneTimes = scenes.map((scene) => `${scene.name} from ${Math.round(scene.startedAtMs)} ms`);
    const canvas = readCanvas();
    await releaseThenReport(() => ({ error: null, renderer: canvas?.dataset.renderer ?? "unknown", adapterName: "", devicePixelRatio: window.devicePixelRatio, readyMs: 0, viewRect: null, canvasRect: null, colorProbes: [], seabedProbes: [], scrubFrameMs: null, frameScenes: scenes, slowSteps: [...sceneTimes, ...slowSteps] }), false);
  };
  const run = async () => {
    if (config.mode === "turntable") return runTurntable();
    // Only the page the run opened: Chrome may prerender a case the /cases page links to, and that document gets an
    // agent too, which would report a run that never happened.
    if (config.mode === "case-click") return location.pathname === "/cases" ? runCaseClicks() : undefined;
    if (config.mode === "frame-pacing") return runFramePacing();
    await waitUntil(() => document.querySelector('[data-testid="seabed-view"][data-state="ready"]') !== null, "the 3D view");
    await waitUntil(() => {
      const canvas = readCanvas();
      if (!canvas) return false;
      const isLoaded = (canvas.dataset.pendingAssets ?? "0") === "0";
      return isLoaded && canvas.dataset.drawnView === config.view && Math.abs(Number(canvas.dataset.drawnAtMs) - config.atMs) < 1000;
    }, "the asked view and moment");
    await document.fonts.ready;
    let seenCount = readCanvas()?.dataset.frameCount ?? "";
    let seenSince = performance.now();
    await waitUntil(() => {
      const count = readCanvas()?.dataset.frameCount ?? "";
      if (count !== seenCount) {
        seenCount = count;
        seenSince = performance.now();
        return false;
      }
      return performance.now() - seenSince >= config.settleMs;
    }, "the frame to settle");
    const readyMs = performance.now();
    const canvas = readCanvas();
    if (!canvas) throw new Error("the canvas went away");
    const adapterName = await readAdapterName();
    const buildReport = (scrubFrameMs: number | null) => ({
      error: null,
      renderer: canvas.dataset.renderer ?? "unknown",
      adapterName,
      devicePixelRatio: window.devicePixelRatio,
      readyMs,
      viewRect: readBox(document.querySelector('[data-testid="seabed-view"]')),
      canvasRect: readBox(canvas),
      colorProbes: JSON.parse(canvas.dataset.colorProbes ?? "[]"),
      seabedProbes: JSON.parse(canvas.dataset.seabedProbes ?? "[]"),
      scrubFrameMs,
    });
    // The timing run's screenshot is not judged: it reports first and lets the page load.
    if (config.mode === "timing") {
      report(buildReport(await measureScrub(canvas)));
      return;
    }
    const style = document.createElement("style");
    style.textContent = config.mode === "canvas" ? config.lookCss + config.canvasCss : config.lookCss;
    document.head.append(style);
    for (let frame = 0; frame < 3; frame += 1) await nextFrame();
    await releaseThenReport(() => buildReport(null), true);
  };
  run().catch((error: unknown) => report({ error: error instanceof Error ? error.message : String(error) }));
}

type LookdevProxy = { port: number; stop: () => void };

/**
 * Serves `upstreamUrl` on a free port, with the agent and the held script injected into every HTML page. Each page
 * load gets its own hold token; `agentConfig` for the next page is set before each Chrome run.
 */
/**
 * `readSessionToken` gives a Clerk session token the proxy sends upstream as `Authorization: Bearer`: the app sits
 * behind sign-in (src/proxy.ts), and this Chrome cannot sign in through the form (session-token.ts).
 */
export function startLookdevProxy(
  upstreamUrl: string,
  turntableDirectory: string | null,
  port: number,
  readSessionToken: () => Promise<Result<string>>,
): LookdevProxy & { setAgentConfig: (config: AgentConfig) => void; releaseAll: () => void } {
  let agentConfig: AgentConfig | null = null;
  let nextToken = 0;
  const holds = new Map<string, () => void>();
  // The agent and the held script, first in <head> so the agent runs before the page's own scripts.
  const injectAgent = (html: string) => {
    const token = String(nextToken);
    nextToken += 1;
    const agentCall = `(${runLookdevAgent.toString()})(${JSON.stringify(agentConfig)}, ${JSON.stringify(RESULT_PREFIX)}, ${JSON.stringify(`${RELEASE_PATH}?token=${token}`)});`;
    return html.replace("<head>", `<head><script>${agentCall}</script><script async src="${HOLD_PATH}?token=${token}"></script>`);
  };
  const server = Bun.serve({
    port,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === HOLD_PATH) {
        const token = url.searchParams.get("token") ?? "";
        await new Promise<void>((resolve) => holds.set(token, resolve));
        return new Response("", { headers: { "content-type": "text/javascript" } });
      }
      if (url.pathname.startsWith(TURNTABLE_PATH) && turntableDirectory !== null) {
        const fileName = path.basename(url.pathname.slice(TURNTABLE_PATH.length) || "index.html");
        const filePath = path.join(turntableDirectory, fileName);
        if (!existsSync(filePath)) return new Response("not found", { status: 404 });
        if (!fileName.endsWith(".html") || agentConfig === null) return new Response(Bun.file(filePath));
        return new Response(injectAgent(await Bun.file(filePath).text()), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === RELEASE_PATH) {
        const token = url.searchParams.get("token") ?? "";
        holds.get(token)?.();
        holds.delete(token);
        return new Response("released");
      }
      const sessionToken = await readSessionToken();
      if (!sessionToken.ok) console.error(`[startLookdevProxy] no session token, the page will ask to sign in: ${sessionToken.reason}`);
      // The browser's own headers go along (Next's router sends RSC, Next-Router-State-Tree and Next-Url with a client
      // navigation; without them the app answers HTML and the router falls back to loading a new page), but not its
      // host, and nothing compressed, so the agent can be written into the HTML.
      const upstreamHeaders = new Headers(request.headers);
      upstreamHeaders.delete("host");
      upstreamHeaders.set("accept-encoding", "identity");
      if (sessionToken.ok) upstreamHeaders.set("authorization", `Bearer ${sessionToken.value}`);
      const hasBody = request.method !== "GET" && request.method !== "HEAD";
      const upstreamResponse = await fetch(`${upstreamUrl}${url.pathname}${url.search}`, { method: request.method, headers: upstreamHeaders, body: hasBody ? await request.arrayBuffer() : undefined, redirect: "manual" });
      const contentType = upstreamResponse.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") || agentConfig === null) return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: upstreamResponse.headers });
      const html = injectAgent(await upstreamResponse.text());
      const headers = new Headers(upstreamResponse.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      // The frame-pacing agent samples the page's JavaScript; Chrome offers the profiler only to a document that asks.
      if (agentConfig.mode === "frame-pacing") headers.set("Document-Policy", "js-profiling");
      return new Response(html, { status: upstreamResponse.status, headers });
    },
  });
  return {
    port: server.port ?? 0,
    stop: () => server.stop(true),
    setAgentConfig(config) {
      agentConfig = config;
    },
    releaseAll() {
      holds.forEach((release) => release());
      holds.clear();
    },
  };
}

/** The Windows path of a WSL path (wslpath -w). */
function toWindowsPath(wslPath: string): string {
  return execFileSync("wslpath", ["-w", wslPath]).toString().trim();
}

/** Stops only the Chrome processes started with this harness's profile (a run that hung), never any other Chrome. */
function stopProfileChrome() {
  const profileName = path.basename(PROFILE_DIRECTORY);
  const command = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${profileName}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { timeout: 30_000 });
  } catch (error) {
    console.error(`[stopProfileChrome] could not stop the harness's Chrome: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Chrome's environment: TEMP and TMP point at TEMP_DIRECTORY, which WSLENV's /p flag hands over as a Windows path. */
function buildChromeEnvironment(): Record<string, string | undefined> {
  const passedVariables = [process.env.WSLENV, "TEMP/p", "TMP/p"].filter((entry) => entry !== undefined && entry !== "").join(":");
  return { ...process.env, TEMP: TEMP_DIRECTORY, TMP: TEMP_DIRECTORY, WSLENV: passedVariables };
}

/** Whether this machine can run the tier: WSL with a Windows Chrome at `chromePath`. */
export function canRunWindowsChrome(chromePath: string): Result<string> {
  if (!existsSync(chromePath)) return { ok: false, reason: `no Windows Chrome at ${chromePath}` };
  try {
    toWindowsPath(process.cwd());
  } catch {
    return { ok: false, reason: "wslpath is not available: the WebGPU tier needs WSL" };
  }
  return { ok: true, value: chromePath };
}

export type WindowsCapture = { report: AgentReport; screenshot: RgbaImage; screenshotPng: Uint8Array };

function isBoxRect(value: unknown): value is BoxRect {
  return typeof value === "object" && value !== null && ["left", "top", "width", "height"].every((key) => typeof Reflect.get(value, key) === "number");
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** The `frame-pacing` scenes in a parsed report, keeping only well-formed entries. */
function readFrameScenes(value: unknown): FrameScene[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const readNumber = (key: string) => {
      const field: unknown = Reflect.get(entry, key);
      return typeof field === "number" ? field : 0;
    };
    const topScripts: unknown = Reflect.get(entry, "topScripts");
    return [
      {
        name: String(Reflect.get(entry, "name") ?? ""),
        startedAtMs: readNumber("startedAtMs"),
        fps: readNumber("fps"),
        drawnFps: readNumber("drawnFps"),
        p50Ms: readNumber("p50Ms"),
        p95Ms: readNumber("p95Ms"),
        p99Ms: readNumber("p99Ms"),
        maxMs: readNumber("maxMs"),
        over25: readNumber("over25"),
        over50: readNumber("over50"),
        topScripts: Array.isArray(topScripts) ? topScripts.map(String) : [],
        topSelf: readStrings(Reflect.get(entry, "topSelf")),
        topTotal: readStrings(Reflect.get(entry, "topTotal")),
      },
    ];
  });
}

/** The `case-click` timings in a parsed report, keeping only well-formed entries. */
function readClickTimings(value: unknown): CaseClickTiming[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const slug: unknown = Reflect.get(entry, "slug");
    const readyMs: unknown = Reflect.get(entry, "readyMs");
    const firstFrameMs: unknown = Reflect.get(entry, "firstFrameMs");
    const renderer: unknown = Reflect.get(entry, "renderer");
    if (typeof slug !== "string" || typeof readyMs !== "number" || typeof renderer !== "string") return [];
    return [{ slug, readyMs, firstFrameMs: typeof firstFrameMs === "number" ? firstFrameMs : null, renderer, steps: String(Reflect.get(entry, "steps") ?? "") }];
  });
}

/** Reads the agent's line from Chrome's stderr into a report, or the reason there is none. */
export function parseAgentReport(stderr: string): Result<AgentReport> {
  const line = stderr.split("\n").find((candidate) => candidate.includes(RESULT_PREFIX));
  if (!line) return { ok: false, reason: "the page agent never reported (the frame did not settle before Chrome stopped)" };
  // Chrome logs `[...:INFO:CONSOLE:n] "<message>", source: <url> (n)` with the message's own quotes left as they are.
  const json = line.slice(line.indexOf(RESULT_PREFIX) + RESULT_PREFIX.length, line.lastIndexOf('", source:'));
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, reason: `the agent's line did not parse: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "the agent's line holds no report" };
  const error: unknown = Reflect.get(parsed, "error");
  if (typeof error === "string") return { ok: false, reason: `the page agent gave up: ${error}` };
  const readNumber = (key: string) => {
    const value: unknown = Reflect.get(parsed, key);
    return typeof value === "number" ? value : null;
  };
  const readString = (key: string) => {
    const value: unknown = Reflect.get(parsed, key);
    return typeof value === "string" ? value : "unknown";
  };
  const viewRect: unknown = Reflect.get(parsed, "viewRect");
  const canvasRect: unknown = Reflect.get(parsed, "canvasRect");
  return {
    ok: true,
    value: {
      error: null,
      renderer: readString("renderer"),
      adapterName: readString("adapterName"),
      devicePixelRatio: readNumber("devicePixelRatio") ?? 0,
      readyMs: readNumber("readyMs") ?? 0,
      viewRect: isBoxRect(viewRect) ? viewRect : null,
      canvasRect: isBoxRect(canvasRect) ? canvasRect : null,
      colorProbes: Reflect.get(parsed, "colorProbes"),
      seabedProbes: Reflect.get(parsed, "seabedProbes"),
      scrubFrameMs: readNumber("scrubFrameMs"),
      clickTimings: readClickTimings(Reflect.get(parsed, "clickTimings")),
      frameScenes: readFrameScenes(Reflect.get(parsed, "frameScenes")),
      slowSteps: readStrings(Reflect.get(parsed, "slowSteps")),
      viewportWidth: readNumber("viewportWidth") ?? 0,
      viewportHeight: readNumber("viewportHeight") ?? 0,
    },
  };
}

/**
 * One headless Windows Chrome run: loads `pageUrl` (served by the proxy, so the agent is in it) at 1,440 x 900 with
 * reduced motion and WebGPU on, waits for the agent, and returns its report and the screenshot.
 */
export async function captureWithWindowsChrome(input: CaptureInput): Promise<Result<WindowsCapture>> {
  for (let attempt = 1; attempt <= CONNECTION_ATTEMPTS; attempt += 1) {
    const captured = await captureOnce(input);
    if (captured.ok || !captured.reason.includes(CONNECTION_REFUSED) || attempt === CONNECTION_ATTEMPTS) return captured;
    await Bun.sleep(CONNECTION_RETRY_MS);
  }
  return { ok: false, reason: "unreachable" };
}

const CONNECTION_REFUSED = "ERR_CONNECTION_REFUSED";

/**
 * `isColdCache` empties the profile's HTTP, code and GPU caches before the run, so nothing of an earlier run is reused.
 * `isMotionAllowed` lets the page animate as a reader's does (no forced reduced motion, frames drawn at the display's
 * pace), for timing frames; the screenshots of the other modes need the still page. `deviceScaleFactor` draws at that
 * many device pixels per CSS pixel (a laptop at 125% or a phone at 3). `extraArgs` go to Chrome as they are (for
 * example --disable-blink-features=WebGPU, which leaves the page on WebGL).
 */
type CaptureInput = { chromePath: string; pageUrl: string; screenshotPath: string; releaseAll: () => void; viewport: { width: number; height: number }; isColdCache?: boolean; isMotionAllowed?: boolean; deviceScaleFactor?: number; extraArgs?: string[] };

// The profile parts that hold what a first visit does not have: the HTTP cache, V8's code cache, the GPU's compiled
// shaders and pipelines (ANGLE's GPUCache, Dawn's DawnGraphiteCache and DawnWebGPUCache), and the earlier runs'
// cookies, storage and tabs (with them, a run on /cases came back on the case an earlier run had opened).
const CACHE_FOLDERS = [
  "Default/Cache",
  "Default/Code Cache",
  "GPUCache",
  "Default/GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "GrShaderCache",
  "ShaderCache",
  "Default/Cookies",
  "Default/Network/Cookies",
  "Default/Local Storage",
  "Default/Session Storage",
  "Default/Sessions",
  "Default/Sessions_Encrypted",
  "Default/IndexedDB",
];

async function captureOnce(input: CaptureInput): Promise<Result<WindowsCapture>> {
  const { chromePath, pageUrl, screenshotPath, releaseAll, viewport } = input;
  mkdirSync(PROFILE_DIRECTORY, { recursive: true });
  if (input.isColdCache) for (const folder of CACHE_FOLDERS) rmSync(path.join(PROFILE_DIRECTORY, folder), { recursive: true, force: true });
  rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
  mkdirSync(TEMP_DIRECTORY, { recursive: true });
  mkdirSync(path.dirname(screenshotPath), { recursive: true });
  const args = [
    "--headless=new",
    `--user-data-dir=${toWindowsPath(PROFILE_DIRECTORY)}`,
    "--no-first-run",
    // No extension is ever fetched or installed (see TEMP_DIRECTORY).
    "--disable-extensions",
    "--enable-unsafe-webgpu",
    `--window-size=${viewport.width},${viewport.height}`,
    "--hide-scrollbars",
    ...(input.isMotionAllowed ? [] : ["--force-prefers-reduced-motion", "--run-all-compositor-stages-before-draw"]),
    ...(input.deviceScaleFactor ? [`--force-device-scale-factor=${input.deviceScaleFactor}`] : []),
    ...(input.extraArgs ?? []),
    "--enable-logging=stderr",
    "--v=0",
    `--screenshot=${toWindowsPath(path.resolve(screenshotPath))}`,
    pageUrl,
  ];
  const child = Bun.spawn([chromePath, ...args], { stdout: "ignore", stderr: "pipe", env: buildChromeEnvironment() });
  const timer = setTimeout(() => {
    console.error(`[captureWithWindowsChrome] no screenshot after ${RUN_TIMEOUT_MS} ms; stopping the harness's Chrome`);
    releaseAll();
    stopProfileChrome();
    child.kill();
  }, RUN_TIMEOUT_MS);
  const stderr = await new Response(child.stderr).text();
  await child.exited;
  clearTimeout(timer);
  // Chrome's log beside the frame: the page's console (the agent's line among it) for a person to read on a failure.
  writeFileSync(`${screenshotPath}.chrome.log`, stderr);
  if (stderr.includes(CONNECTION_REFUSED)) return { ok: false, reason: `Windows Chrome could not reach ${pageUrl} (${CONNECTION_REFUSED})` };
  const report = parseAgentReport(stderr);
  if (!report.ok) return report;
  if (!existsSync(screenshotPath)) return { ok: false, reason: "Chrome wrote no screenshot" };
  const screenshotPng = readFileSync(screenshotPath);
  const screenshot = decodePng(screenshotPng);
  if (!screenshot.ok) return { ok: false, reason: `screenshot: ${screenshot.reason}` };
  return { ok: true, value: { report: report.value, screenshot: screenshot.value, screenshotPng } };
}

/** The part of a screenshot inside a CSS box (device pixel ratio 1), rounded to whole pixels as Playwright crops. */
export function cropToBox(image: RgbaImage, box: BoxRect): RgbaImage {
  const left = Math.max(0, Math.round(box.left));
  const top = Math.max(0, Math.round(box.top));
  const width = Math.min(image.width - left, Math.round(box.width));
  const height = Math.min(image.height - top, Math.round(box.height));
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((top + row) * image.width + left) * 4;
    data.set(image.data.subarray(sourceStart, sourceStart + width * 4), row * width * 4);
  }
  return { width, height, data };
}
