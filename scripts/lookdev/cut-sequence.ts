// The cut sequence in the close-up as motion: frames of the At the cut view every few seconds of replay time, drawn
// through the viewer's lookdev time override (data-time-override, scene/viewer.ts), so moments between the URL's whole
// minutes can be drawn; then encoded with ffmpeg as an H.264 MP4 and a GIF. With --playback it instead presses Play in
// the console and records the replay moment of every frame the close-up draws, to show the app's own clock drives the
// same sequence frame by frame.
// Usage: bun scripts/lookdev/cut-sequence.ts <baseUrl> [--tier hardware|software] [--from 10:20:00] [--to 10:28:00]
//        [--step-seconds 10] [--fps 10] [--query "&water=b"] [--out <dir>] [--playback]
// Writes <out>/frames/frame-NNN.png, <out>/cut-sequence.mp4 and <out>/cut-sequence.gif (default out: .scratch/cut-sequence).
// Exit codes: 0 done, 2 the frames could not be drawn or encoded.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { resolveChromiumPath } from "../perf/chromium-path";
import { TIER_LAUNCH, type PlaywrightTierName } from "./tier-launch";

const VIEWPORT = { width: 1440, height: 900 };
const FRAME_TIMEOUT_MS = 120_000;
// The Eagle S case's day (UTC) and the replay URL's minute-resolution moment the page opens on.
const CASE_PATH = "/cases/eagle-s-2024";
const CASE_DAY = "2024-12-25";
// The GIF's width (px) and colours: about 1 MB for 49 frames of the close-up.
const GIF_WIDTH_PX = 880;
const GIF_COLOURS = 128;
// How long the playback check records once Play is pressed (ms).
const PLAYBACK_RECORD_MS = 4000;

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

function readMoment(clock: string): number {
  return Date.parse(`${CASE_DAY}T${clock}Z`);
}

async function openCloseUp(page: Page, baseUrl: string, atMs: number, query: string) {
  const minute = new Date(atMs).toISOString().slice(0, 16);
  await page.goto(`${baseUrl}${CASE_PATH}?t=${minute}Z&view=closeup${query}`, { waitUntil: "load", timeout: FRAME_TIMEOUT_MS });
  await page.waitForSelector('[data-testid="seabed-view"][data-state="ready"]', { timeout: FRAME_TIMEOUT_MS });
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector("canvas[data-renderer]");
      return canvas instanceof HTMLCanvasElement && (canvas.dataset.pendingAssets ?? "0") === "0" && canvas.dataset.drawnView === "closeup";
    },
    null,
    { timeout: FRAME_TIMEOUT_MS, polling: 100 },
  );
}

/** Draws each moment through the time override and saves the 3D view (its canvas and labels, no page chrome). */
async function renderFrames(page: Page, moments: readonly number[], framesDirectory: string) {
  // The page's own overlays follow the replay clock, not the override, so only the scene and its labels stay visible.
  await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas[data-renderer], canvas[data-renderer] ~ div, canvas[data-renderer] ~ div * { visibility: visible !important; }" });
  for (const [index, atMs] of moments.entries()) {
    await page.evaluate((momentMs) => document.querySelector("canvas[data-renderer]")?.setAttribute("data-time-override", String(momentMs)), atMs);
    await page.waitForFunction((momentMs) => Number(document.querySelector("canvas[data-renderer]")?.getAttribute("data-drawn-at-ms")) === Math.round(momentMs), atMs, { timeout: FRAME_TIMEOUT_MS, polling: 50 });
    await page.waitForTimeout(150);
    await page.locator("canvas[data-renderer]").screenshot({ path: path.join(framesDirectory, `frame-${String(index).padStart(3, "0")}.png`), animations: "disabled" });
  }
}

function encode(framesDirectory: string, outDirectory: string, fps: number): boolean {
  const input = path.join(framesDirectory, "frame-%03d.png");
  const mp4Path = path.join(outDirectory, "cut-sequence.mp4");
  const gifPath = path.join(outDirectory, "cut-sequence.gif");
  const mp4 = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", String(fps), "-i", input, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", mp4Path]);
  const paletteFilter = `scale=${GIF_WIDTH_PX}:-1:flags=lanczos,split[left][right];[left]palettegen=max_colors=${GIF_COLOURS}[palette];[right][palette]paletteuse=dither=bayer:bayer_scale=4`;
  const gif = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", String(fps), "-i", input, "-vf", paletteFilter, "-loop", "0", gifPath]);
  if (mp4.status !== 0 || gif.status !== 0) {
    console.error(`[encodeCutSequence] ffmpeg failed: ${mp4.stderr.toString()} ${gif.stderr.toString()}`);
    return false;
  }
  console.log(`[encodeCutSequence] ${mp4Path} ${statSync(mp4Path).size} B, ${gifPath} ${statSync(gifPath).size} B`);
  return true;
}

/** Presses Play and records, on every animation frame, the replay moment the close-up last drew. */
async function recordPlayback(page: Page, fromMs: number, toMs: number): Promise<{ drawnMoments: number[] }> {
  await page.evaluate(() => {
    const drawn: number[] = [];
    Reflect.set(window, "lookdevDrawnMoments", drawn);
    const record = () => {
      const atMs = Number(document.querySelector("canvas[data-renderer]")?.getAttribute("data-drawn-at-ms"));
      if (drawn[drawn.length - 1] !== atMs) drawn.push(atMs);
      requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  await page.getByRole("button", { name: "Play replay" }).click();
  await page.waitForTimeout(PLAYBACK_RECORD_MS);
  const drawnMoments = await page.evaluate(() => {
    const recorded: unknown = Reflect.get(window, "lookdevDrawnMoments");
    return Array.isArray(recorded) ? recorded.filter((value): value is number => typeof value === "number") : [];
  });
  return { drawnMoments: drawnMoments.filter((atMs) => atMs >= fromMs && atMs <= toMs) };
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const baseUrl = argumentList.find((argument) => !argument.startsWith("--") && URL.canParse(argument))?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("[cutSequence] pass the base URL, for example http://localhost:3141");
    return 2;
  }
  const tier: PlaywrightTierName = readFlagValue(argumentList, "--tier") === "software" ? "software" : "hardware";
  const fromMs = readMoment(readFlagValue(argumentList, "--from") ?? "10:20:00");
  const toMs = readMoment(readFlagValue(argumentList, "--to") ?? "10:28:00");
  const stepMs = Number(readFlagValue(argumentList, "--step-seconds") ?? "10") * 1000;
  const fps = Number(readFlagValue(argumentList, "--fps") ?? "10");
  const query = readFlagValue(argumentList, "--query") ?? "";
  const outDirectory = readFlagValue(argumentList, "--out") ?? path.join(".scratch", "cut-sequence");
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || !(stepMs > 0) || toMs < fromMs) {
    console.error("[cutSequence] --from, --to and --step-seconds must give a forward range");
    return 2;
  }
  const chromiumPath = resolveChromiumPath(process.env.PERF_CHROMIUM_PATH ?? null);
  if (!chromiumPath.ok) {
    console.error(`[cutSequence] ${chromiumPath.reason}`);
    return 2;
  }
  const browser = await chromium.launch({ executablePath: chromiumPath.value, args: TIER_LAUNCH[tier].args, env: { ...process.env, ...TIER_LAUNCH[tier].env } });
  try {
    const page = await (await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce" })).newPage();
    await openCloseUp(page, baseUrl, fromMs, query);
    mkdirSync(outDirectory, { recursive: true });
    if (argumentList.includes("--playback")) {
      const { drawnMoments } = await recordPlayback(page, fromMs, toMs);
      const stepsSeconds = drawnMoments.slice(1).map((atMs, index) => (atMs - (drawnMoments[index] ?? atMs)) / 1000);
      const largestStep = stepsSeconds.reduce((largest, step) => Math.max(largest, step), 0);
      writeFileSync(path.join(outDirectory, "playback.json"), JSON.stringify({ drawnMoments }, null, 2));
      console.log(`[cutSequence] playback drew ${drawnMoments.length} moments between the two ends, largest step ${largestStep.toFixed(1)} s of replay time`);
      return drawnMoments.length > 1 ? 0 : 2;
    }
    const moments = Array.from({ length: Math.floor((toMs - fromMs) / stepMs) + 1 }, (_slot, index) => fromMs + index * stepMs);
    const framesDirectory = path.join(outDirectory, "frames");
    rmSync(framesDirectory, { recursive: true, force: true });
    mkdirSync(framesDirectory, { recursive: true });
    await renderFrames(page, moments, framesDirectory);
    console.log(`[cutSequence] ${tier}: ${moments.length} frames in ${framesDirectory}`);
    return encode(framesDirectory, outDirectory, fps) ? 0 : 2;
  } finally {
    await browser.close();
  }
}

if (import.meta.main) process.exit(await main());
