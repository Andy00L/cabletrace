// Frame pacing of the replay on Windows Chrome and the machine's own GPU, which is what a reader's laptop draws with:
// the GPU tier inside WSL goes through Mesa's d3d12 translation and holds about 20 frames a second even when idle, so
// it cannot judge smoothness. Driven through the lookdev harness's agent (scripts/lookdev/webgpu-capture.ts, mode
// `frame-pacing`) with motion allowed: the case page idles 3 s, plays 8 s, moves through four views and is scrubbed.
// Usage: bun scripts/perf/windows-frame-pacing.ts <baseUrl> [--slug eagle-s-2024] [--runs 2] [--scale 1.25]
//        [--size 1440x900] [--webgl] [--windows-chrome <path>] [--port 3329]
// A slug carrying a query that opens the Vessel view (--slug "eagle-s-2024?t=2024-12-25T16:24Z&view=vessel") also
// records the motion while it plays: per drawn frame the replay moment, the camera and the ship's and anchor's place
// on screen, summarised in the output and saved as .scratch/windows-frame-pacing/motion-run-N.json.
// --webgl hands the page Chrome's CPU WebGPU adapter (--use-webgpu-adapter=swiftshader), which the app refuses as a
// fallback, so it draws on WebGL on the GPU, as Safari and Firefox do. --profile prints each scene's busiest functions.
// --chrome-arg <flag> passes one more flag to Chrome (repeatable), for example --disable-frame-rate-limit.
// Exit codes: 0 measured, 2 could not measure.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSessionTokenSource } from "../lookdev/session-token";
import { canRunWindowsChrome, captureWithWindowsChrome, DEFAULT_PROXY_PORT, DEFAULT_WINDOWS_CHROME, startLookdevProxy } from "../lookdev/webgpu-capture";

// The agent's budget for one run: the cold case load, the refinement and the four scenes (ms).
const RUN_TIMEOUT_MS = 120_000;

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

/** "1440x900" as a viewport, or null when it does not read as two whole numbers. */
function parseSize(text: string): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/u.exec(text);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const baseUrl = argumentList.find((argument) => !argument.startsWith("--") && URL.canParse(argument))?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("[windowsFramePacing] pass the base URL, for example http://localhost:3150");
    return 2;
  }
  const slug = readFlagValue(argumentList, "--slug") ?? "eagle-s-2024";
  const runCount = Number(readFlagValue(argumentList, "--runs") ?? "2");
  const scaleText = readFlagValue(argumentList, "--scale");
  const viewport = parseSize(readFlagValue(argumentList, "--size") ?? "1440x900");
  if (!viewport) {
    console.error("[windowsFramePacing] --size takes WIDTHxHEIGHT, for example 1440x900");
    return 2;
  }
  const chrome = canRunWindowsChrome(readFlagValue(argumentList, "--windows-chrome") ?? DEFAULT_WINDOWS_CHROME);
  if (!chrome.ok) {
    console.error(`[windowsFramePacing] ${chrome.reason}`);
    return 2;
  }
  const sessionTokens = createSessionTokenSource();
  if (!sessionTokens.ok) {
    console.error(`[windowsFramePacing] cannot sign in: ${sessionTokens.reason}`);
    return 2;
  }
  const proxy = startLookdevProxy(baseUrl, null, Number(readFlagValue(argumentList, "--port") ?? DEFAULT_PROXY_PORT), sessionTokens.value);
  try {
    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      proxy.setAgentConfig({ mode: "frame-pacing", view: "", atMs: 0, settleMs: 0, timeoutMs: RUN_TIMEOUT_MS, scrubSteps: 0, lookCss: "", canvasCss: "", viewportWidth: viewport.width, viewportHeight: viewport.height, clickSlugs: [] });
      const captured = await captureWithWindowsChrome({
        chromePath: chrome.value,
        pageUrl: `http://localhost:${proxy.port}/cases/${slug}`,
        screenshotPath: path.join(".scratch", "windows-frame-pacing", `run-${runIndex + 1}.png`),
        releaseAll: proxy.releaseAll,
        viewport,
        isMotionAllowed: true,
        // A warm profile can hand back a cached page with an older agent in it.
        isColdCache: true,
        deviceScaleFactor: scaleText ? Number(scaleText) : undefined,
        extraArgs: [...(argumentList.includes("--webgl") ? ["--use-webgpu-adapter=swiftshader"] : []), ...argumentList.flatMap((argument, index) => (argument === "--chrome-arg" ? [argumentList[index + 1] ?? ""] : []))],
      });
      if (!captured.ok) {
        console.error(`[windowsFramePacing] run ${runIndex + 1}: ${captured.reason}`);
        return 2;
      }
      const { report } = captured.value;
      console.log(`[windowsFramePacing] run ${runIndex + 1}: ${slug} on ${report.renderer}, ${viewport.width}x${viewport.height} at DPR ${report.devicePixelRatio}`);
      report.slowSteps.forEach((line) => console.log(`  ${line}`));
      report.motionLines.forEach((line) => console.log(`  motion: ${line}`));
      if (report.motionSeries.length > 0) {
        const motionPath = path.join(".scratch", "windows-frame-pacing", `motion-run-${runIndex + 1}.json`);
        mkdirSync(path.dirname(motionPath), { recursive: true });
        writeFileSync(motionPath, JSON.stringify(report.motionSeries));
        console.log(`  motion: ${report.motionSeries.length} frames saved to ${motionPath}`);
      }
      for (const scene of report.frameScenes) {
        console.log(`  ${scene.name}: ${scene.fps} fps, drawn ${scene.drawnFps}/s, p50 ${scene.p50Ms} p95 ${scene.p95Ms} p99 ${scene.p99Ms} max ${scene.maxMs} ms, over 25 ms ${scene.over25}, over 50 ms ${scene.over50}`);
        scene.topScripts.forEach((script) => console.log(`      ${script}`));
        if (argumentList.includes("--profile")) {
          console.log("    self:");
          scene.topSelf.forEach((line) => console.log(`      ${line}`));
          console.log("    on the stack:");
          scene.topTotal.forEach((line) => console.log(`      ${line}`));
        }
      }
    }
  } finally {
    proxy.releaseAll();
    proxy.stop();
  }
  return 0;
}

if (import.meta.main) process.exit(await main());
