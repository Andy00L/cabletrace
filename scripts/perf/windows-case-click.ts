// Click to ready on Windows Chrome, the browser most readers (and the judges) use: headless Windows Chrome on the
// machine's GPU, driven through the lookdev harness's WebGPU capture (scripts/lookdev/webgpu-capture.ts, the only
// way this repository starts it). Each run starts from a profile whose HTTP, code and GPU caches are emptied, opens
// /cases, clicks one case (cold), goes back and clicks the other (warm: same tab, the first case's code, renderer and
// files in hand). The two cases swap order every run, so each is measured cold and warm. "Ready" is the visible
// seabed-view's data-state, and "first frame" its canvas's first drawn frame, both from a MutationObserver in the
// page, in ms from the click.
// Usage: bun scripts/perf/windows-case-click.ts <baseUrl> [--runs 5] [--windows-chrome <path>] [--port 3329]
// Exit codes: 0 measured, 2 could not measure.
import path from "node:path";
import { createSessionTokenSource } from "../lookdev/session-token";
import { canRunWindowsChrome, captureWithWindowsChrome, DEFAULT_PROXY_PORT, DEFAULT_WINDOWS_CHROME, startLookdevProxy, type CaseClickTiming } from "../lookdev/webgpu-capture";

const CASE_SLUGS = ["eagle-s-2024", "yi-peng-3-2024"] as const;
// The agent's whole budget for one run: two clicks, their waits and the way back (ms).
const RUN_TIMEOUT_MS = 120_000;
const VIEWPORT = { width: 1440, height: 900 };

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

/** Median and range of a list of ms values, as "median (min-max)". */
function describeSpread(values: readonly number[]): string {
  if (values.length === 0) return "n/a";
  const sorted = [...values].sort((first, second) => first - second);
  return `${Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0)} (${Math.round(sorted[0] ?? 0)}-${Math.round(sorted[sorted.length - 1] ?? 0)})`;
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const baseUrl = argumentList.find((argument) => !argument.startsWith("--") && URL.canParse(argument))?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("[windowsCaseClick] pass the base URL, for example http://localhost:3141");
    return 2;
  }
  const runCount = Number(readFlagValue(argumentList, "--runs") ?? "5");
  const chrome = canRunWindowsChrome(readFlagValue(argumentList, "--windows-chrome") ?? DEFAULT_WINDOWS_CHROME);
  if (!chrome.ok) {
    console.error(`[windowsCaseClick] ${chrome.reason}`);
    return 2;
  }
  const sessionTokens = createSessionTokenSource();
  if (!sessionTokens.ok) {
    console.error(`[windowsCaseClick] cannot sign in: ${sessionTokens.reason}`);
    return 2;
  }
  const proxy = startLookdevProxy(baseUrl, null, Number(readFlagValue(argumentList, "--port") ?? DEFAULT_PROXY_PORT), sessionTokens.value);
  const samples: { timing: CaseClickTiming; isCold: boolean }[] = [];
  try {
    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const clickSlugs = runIndex % 2 === 0 ? [...CASE_SLUGS] : [...CASE_SLUGS].reverse();
      proxy.setAgentConfig({ mode: "case-click", view: "", atMs: 0, settleMs: 0, timeoutMs: RUN_TIMEOUT_MS, scrubSteps: 0, lookCss: "", canvasCss: "", viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height, clickSlugs });
      const captured = await captureWithWindowsChrome({
        chromePath: chrome.value,
        pageUrl: `http://localhost:${proxy.port}/cases`,
        screenshotPath: path.join(".scratch", "windows-case-click", `run-${runIndex + 1}.png`),
        releaseAll: proxy.releaseAll,
        viewport: VIEWPORT,
        isColdCache: true,
      });
      if (!captured.ok) {
        console.error(`[windowsCaseClick] run ${runIndex + 1}: ${captured.reason}`);
        return 2;
      }
      const timings = captured.value.report.clickTimings;
      timings.forEach((timing, index) => samples.push({ timing, isCold: index === 0 }));
      console.log(`[windowsCaseClick] run ${runIndex + 1}: ${timings.map((timing, index) => `${timing.slug} ${index === 0 ? "cold" : "warm"} ready ${Math.round(timing.readyMs)} ms, first frame ${timing.firstFrameMs === null ? "n/a" : Math.round(timing.firstFrameMs)} ms on ${timing.renderer} [${timing.steps}]`).join("; ")}`);
    }
  } finally {
    proxy.releaseAll();
    proxy.stop();
  }
  for (const slug of CASE_SLUGS) {
    for (const isCold of [true, false]) {
      const chosen = samples.filter((sample) => sample.timing.slug === slug && sample.isCold === isCold);
      console.log(`[windowsCaseClick] ${slug} ${isCold ? "cold" : "warm"}: ready ${describeSpread(chosen.map((sample) => sample.timing.readyMs))} ms, first frame ${describeSpread(chosen.flatMap((sample) => (sample.timing.firstFrameMs === null ? [] : [sample.timing.firstFrameMs])))} ms over ${chosen.length} clicks`);
    }
  }
  return 0;
}

if (import.meta.main) process.exit(await main());
