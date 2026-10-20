// The data lines' continuity and the anchor's contrast on the Vessel views. For each frame the viewer hands over every
// shown data line's drawn path in canvas px (scene/viewer.ts, recordLineTraces), each point marked in sight or not
// (behind relief, the hull or a cut marker); this walks the path one pixel at a time on the frame, with the page's labels and panels
// hidden, and measures the longest run of pixels that do not hold the line's exact colour (deviation 2 or less within
// 1 px). A pixel where another data line crosses over it (it holds that line's exact colour) is skipped, not a gap. Where the anchor is drawn it draws the frame again without it: the pixels that change are the anchor, a ring
// 8 px around them the water it lies in, and their mean relative luminances give the WCAG contrast ratio.
// Usage: bun scripts/lookdev/line-continuity.ts <baseUrl> [--tier hardware|software] [--only <text>] [--query "&water=b"]
//        [--out <dir>]
// Writes <out>/line-continuity.json and one marked frame per shot (gaps in magenta). Exit codes: 0 every frame has no
// gap over 4 px, 1 a gap over 4 px, 2 the frames could not be drawn.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { formatMinute } from "../../src/lib/console/console-state";
import { WEBGL_COLORS } from "../../src/lib/design/webgl-colors";
import type { DataTone } from "../../src/lib/seabed/scene/overview";
import { resolveChromiumPath } from "../perf/chromium-path";
import { matchColorNear, parseHexColor } from "./compare";
import { decodePng, encodePng, type RgbaImage } from "./png";
import { listLookdevShots, type LookdevShot } from "./shots";
import { TIER_LAUNCH, type PlaywrightTierName } from "./tier-launch";

const VIEWPORT = { width: 1440, height: 900 };
const FRAME_TIMEOUT_MS = 120_000;
// A pixel of the path holds the line when a pixel within this radius (of the drawn frame: the software tier draws at
// 0.75 and is scaled up, so 2 page px there) is within this deviation of the exact colour.
const MATCH_RADIUS_PX = 1;
const MATCH_TOLERANCE = 2;
// The judge: no gap longer than this many px.
const MAX_GAP_PX = 4;
// A pixel belongs to the anchor when hiding it changes a channel by more than this; the water around it is a ring
// this many px wide.
const ANCHOR_CHANGE_THRESHOLD = 8;
const ANCHOR_RING_PX = 8;
const TONE_HEX: Record<DataTone, string> = { cable: WEBGL_COLORS.cable, pipeline: WEBGL_COLORS.pipeline, suspect: WEBGL_COLORS.ink, alarm: WEBGL_COLORS.alarm };

type TracePoint = [number, number, number] | null;
type LineTraces = { traces: { tone: DataTone; points: TracePoint[] }[]; anchor: [number, number] | null };
/** Per tone: pixels of path checked, the longest gap and where it starts (canvas px), and how many gaps pass the limit. */
type ToneContinuity = { tone: DataTone; checkedPx: number; longestGapPx: number; longestGapAt: [number, number] | null; gapsOverLimit: number };
type ShotReport = { shot: string; tones: ToneContinuity[]; anchorContrast: number | null; anchorPixels: number };

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

const DATA_TONES: readonly DataTone[] = ["cable", "pipeline", "suspect", "alarm"];

function isDataTone(value: unknown): value is DataTone {
  return DATA_TONES.some((tone) => tone === value);
}

function readTracePoint(value: unknown): TracePoint {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [pointX, pointY, inSight]: unknown[] = value;
  return typeof pointX === "number" && typeof pointY === "number" && typeof inSight === "number" ? [pointX, pointY, inSight] : null;
}

function readCanvasPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [pointX, pointY]: unknown[] = value;
  return typeof pointX === "number" && typeof pointY === "number" ? [pointX, pointY] : null;
}

/** The viewer's data-line-traces attribute (scene/viewer.ts, recordLineTraces), or null when it is malformed. */
function parseLineTraces(text: string): LineTraces | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const traces: unknown = Reflect.get(parsed, "traces");
  if (!Array.isArray(traces)) return null;
  return {
    traces: traces.flatMap((trace: unknown) => {
      if (typeof trace !== "object" || trace === null) return [];
      const tone: unknown = Reflect.get(trace, "tone");
      const points: unknown = Reflect.get(trace, "points");
      return isDataTone(tone) && Array.isArray(points) ? [{ tone, points: points.map(readTracePoint) }] : [];
    }),
    anchor: readCanvasPoint(Reflect.get(parsed, "anchor")),
  };
}

/** Waits until the canvas has drawn the shot's view and moment with every asset loaded. */
async function waitForShot(page: Page, shot: LookdevShot) {
  await page.waitForSelector('[data-testid="seabed-view"][data-state="ready"]', { timeout: FRAME_TIMEOUT_MS });
  await page.waitForFunction(
    ({ view, atMs }) => {
      const canvas = document.querySelector("canvas[data-renderer]");
      return canvas instanceof HTMLCanvasElement && (canvas.dataset.pendingAssets ?? "0") === "0" && canvas.dataset.drawnView === view && Math.abs(Number(canvas.dataset.drawnAtMs) - atMs) < 1000;
    },
    { view: shot.view, atMs: shot.atMs },
    { timeout: FRAME_TIMEOUT_MS, polling: 100 },
  );
  await page.waitForTimeout(1500);
}

/** Sets a canvas attribute and waits for the next drawn frame. */
async function setCanvasAttribute(page: Page, name: string, value: string) {
  await page.evaluate(
    ({ attributeName, attributeValue }) => {
      const canvas = document.querySelector("canvas[data-renderer]");
      if (!(canvas instanceof HTMLCanvasElement)) return;
      Reflect.set(window, "lookdevFrameBefore", canvas.dataset.frameCount ?? "");
      canvas.setAttribute(attributeName, attributeValue);
    },
    { attributeName: name, attributeValue: value },
  );
  await page.waitForFunction(() => document.querySelector("canvas[data-renderer]")?.getAttribute("data-frame-count") !== Reflect.get(window, "lookdevFrameBefore"), null, { timeout: FRAME_TIMEOUT_MS, polling: 50 });
  await page.waitForTimeout(300);
}

async function captureCanvas(page: Page): Promise<RgbaImage | null> {
  const decoded = decodePng(await page.locator("canvas[data-renderer]").screenshot({ animations: "disabled" }));
  return decoded.ok ? decoded.value : null;
}

/** Walks each trace one pixel at a time and measures, per tone, the longest run of pixels that miss the exact colour. */
function measureContinuity(image: RgbaImage, traces: LineTraces["traces"], marked: RgbaImage, frame: { cornerRadiusPx: number; matchRadiusPx: number }): ToneContinuity[] {
  const { cornerRadiusPx, matchRadiusPx } = frame;
  const byTone = new Map<DataTone, ToneContinuity>();
  // The stage's rounded corners clip the canvas: a point there shows the page, not the scene.
  const isInsideCorners = (pointX: number, pointY: number) => {
    if (cornerRadiusPx <= 2) return true;
    const cornerX = Math.min(Math.max(pointX, cornerRadiusPx), image.width - cornerRadiusPx);
    const cornerY = Math.min(Math.max(pointY, cornerRadiusPx), image.height - cornerRadiusPx);
    return Math.hypot(pointX - cornerX, pointY - cornerY) <= cornerRadiusPx - 2;
  };
  const isOnFrame = (point: TracePoint): point is [number, number, number] =>
    point !== null && point[2] === 1 && point[0] >= 0 && point[1] >= 0 && point[0] < image.width && point[1] < image.height && isInsideCorners(point[0], point[1]);
  for (const trace of traces) {
    const expected = parseHexColor(TONE_HEX[trace.tone]);
    const otherTones = DATA_TONES.filter((tone) => tone !== trace.tone).map((tone) => parseHexColor(TONE_HEX[tone]));
    const verdict = byTone.get(trace.tone) ?? { tone: trace.tone, checkedPx: 0, longestGapPx: 0, longestGapAt: null, gapsOverLimit: 0 };
    byTone.set(trace.tone, verdict);
    let gapPx = 0;
    let gapStart: [number, number] = [0, 0];
    const closeGap = () => {
      if (gapPx > verdict.longestGapPx) {
        verdict.longestGapPx = gapPx;
        verdict.longestGapAt = gapStart;
      }
      if (gapPx > MAX_GAP_PX) verdict.gapsOverLimit += 1;
      gapPx = 0;
    };
    for (let index = 1; index < trace.points.length; index += 1) {
      const start = trace.points[index - 1] ?? null;
      const end = trace.points[index] ?? null;
      if (!isOnFrame(start) || !isOnFrame(end)) {
        closeGap();
        continue;
      }
      const steps = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1])));
      for (let step = 0; step < steps; step += 1) {
        const pixelX = start[0] + ((end[0] - start[0]) * step) / steps;
        const pixelY = start[1] + ((end[1] - start[1]) * step) / steps;
        const match = matchColorNear(image, pixelX, pixelY, expected, matchRadiusPx);
        verdict.checkedPx += 1;
        if (match && match.deviation <= MATCH_TOLERANCE) {
          closeGap();
          continue;
        }
        // Where another data line crosses over this one, the pixel holds that line's exact colour: the data is still
        // drawn there, so it is not a gap (and not counted as the line either).
        if (otherTones.some((other) => (matchColorNear(image, pixelX, pixelY, other, matchRadiusPx)?.deviation ?? Number.POSITIVE_INFINITY) <= MATCH_TOLERANCE)) {
          verdict.checkedPx -= 1;
          continue;
        }
        if (gapPx === 0) gapStart = [Math.round(pixelX), Math.round(pixelY)];
        gapPx += 1;
        const offset = (Math.round(pixelY) * marked.width + Math.round(pixelX)) * 4;
        marked.data.set([255, 0, 255, 255], offset);
      }
    }
    closeGap();
  }
  return [...byTone.values()];
}

/** sRGB channel (0 to 255) to linear light. */
function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function readRelativeLuminance(image: RgbaImage, pixelIndex: number): number {
  const offset = pixelIndex * 4;
  return 0.2126 * toLinear(image.data[offset] ?? 0) + 0.7152 * toLinear(image.data[offset + 1] ?? 0) + 0.0722 * toLinear(image.data[offset + 2] ?? 0);
}

/** The WCAG contrast between the anchor's pixels (those that change when it is hidden) and a ring of water around them. */
function measureAnchorContrast(withAnchor: RgbaImage, withoutAnchor: RgbaImage): { contrast: number | null; anchorPixels: number } {
  const { width, height } = withAnchor;
  const isAnchor = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const change = Math.max(...[0, 1, 2].map((channel) => Math.abs((withAnchor.data[offset + channel] ?? 0) - (withoutAnchor.data[offset + channel] ?? 0))));
    if (change > ANCHOR_CHANGE_THRESHOLD) isAnchor[pixel] = 1;
  }
  let anchorSum = 0;
  let anchorCount = 0;
  let ringSum = 0;
  let ringCount = 0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const pixel = row * width + column;
      if (isAnchor[pixel]) {
        anchorSum += readRelativeLuminance(withAnchor, pixel);
        anchorCount += 1;
        continue;
      }
      let isNearAnchor = false;
      for (let rowOffset = -ANCHOR_RING_PX; rowOffset <= ANCHOR_RING_PX && !isNearAnchor; rowOffset += 2) {
        for (let columnOffset = -ANCHOR_RING_PX; columnOffset <= ANCHOR_RING_PX; columnOffset += 2) {
          const neighbourRow = row + rowOffset;
          const neighbourColumn = column + columnOffset;
          if (neighbourRow >= 0 && neighbourRow < height && neighbourColumn >= 0 && neighbourColumn < width && isAnchor[neighbourRow * width + neighbourColumn]) {
            isNearAnchor = true;
            break;
          }
        }
      }
      if (!isNearAnchor) continue;
      ringSum += readRelativeLuminance(withAnchor, pixel);
      ringCount += 1;
    }
  }
  if (anchorCount === 0 || ringCount === 0) return { contrast: null, anchorPixels: anchorCount };
  const anchorLuminance = anchorSum / anchorCount;
  const ringLuminance = ringSum / ringCount;
  const lighter = Math.max(anchorLuminance, ringLuminance);
  const darker = Math.min(anchorLuminance, ringLuminance);
  return { contrast: (lighter + 0.05) / (darker + 0.05), anchorPixels: anchorCount };
}

async function checkShot(page: Page, baseUrl: string, shot: LookdevShot, query: string, outDirectory: string): Promise<ShotReport | null> {
  const params = new URLSearchParams({ t: formatMinute(shot.atMs), view: shot.view });
  await page.goto(`${baseUrl}/cases/${shot.caseSlug}?${params.toString().replaceAll("%3A", ":")}${query}`, { waitUntil: "load", timeout: FRAME_TIMEOUT_MS });
  await waitForShot(page, shot);
  // Only the canvas stays visible: labels, panels and the timeline would read as gaps over the lines.
  await page.addStyleTag({ content: "body * { visibility: hidden !important; } canvas[data-renderer] { visibility: visible !important; }" });
  await setCanvasAttribute(page, "data-lookdev-traces", "request");
  const tracesText = await page.evaluate(() => document.querySelector("canvas[data-renderer]")?.getAttribute("data-line-traces") ?? "");
  const lineTraces = parseLineTraces(tracesText);
  if (!lineTraces) return null;
  const frame = await captureCanvas(page);
  if (!frame) return null;
  const marked: RgbaImage = { width: frame.width, height: frame.height, data: frame.data.slice() };
  // The largest corner radius among the canvas's ancestors (the stage card that clips it).
  const cornerRadiusPx = await page.evaluate(() => {
    let largest = 0;
    for (let element = document.querySelector("canvas[data-renderer]")?.parentElement ?? null; element; element = element.parentElement) {
      largest = Math.max(largest, Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0);
    }
    return largest;
  });
  // A canvas drawn at fewer device pixels than CSS pixels (the software tier's 0.75) is scaled up in steps, so the
  // radius grows by the same factor: 1 px of the drawn frame.
  const drawnScale = await page.evaluate(() => {
    const canvas = document.querySelector("canvas[data-renderer]");
    return canvas instanceof HTMLCanvasElement && canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  });
  const matchRadiusPx = Math.ceil(MATCH_RADIUS_PX / Math.min(1, drawnScale));
  const tones = measureContinuity(frame, lineTraces.traces, marked, { cornerRadiusPx, matchRadiusPx });
  writeFileSync(path.join(outDirectory, `${shot.name}-continuity.png`), encodePng(marked));
  let anchorContrast: number | null = null;
  let anchorPixels = 0;
  if (lineTraces.anchor) {
    await setCanvasAttribute(page, "data-lookdev-hide", "anchor");
    const withoutAnchor = await captureCanvas(page);
    if (withoutAnchor) ({ contrast: anchorContrast, anchorPixels } = measureAnchorContrast(frame, withoutAnchor));
  }
  return { shot: shot.name, tones, anchorContrast, anchorPixels };
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const baseUrl = argumentList.find((argument) => !argument.startsWith("--") && URL.canParse(argument))?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("[lineContinuity] pass the base URL, for example http://localhost:3141");
    return 2;
  }
  const tier: PlaywrightTierName = readFlagValue(argumentList, "--tier") === "software" ? "software" : "hardware";
  const only = readFlagValue(argumentList, "--only");
  const query = readFlagValue(argumentList, "--query") ?? "";
  const outDirectory = path.join(readFlagValue(argumentList, "--out") ?? path.join(".scratch", "line-continuity"), tier);
  mkdirSync(outDirectory, { recursive: true });
  const chromiumPath = resolveChromiumPath(process.env.PERF_CHROMIUM_PATH ?? null);
  if (!chromiumPath.ok) {
    console.error(`[lineContinuity] ${chromiumPath.reason}`);
    return 2;
  }
  const shots = listLookdevShots().filter((shot) => shot.view === "vessel" && (only === null || shot.name.includes(only)));
  const browser = await chromium.launch({ executablePath: chromiumPath.value, args: TIER_LAUNCH[tier].args, env: { ...process.env, ...TIER_LAUNCH[tier].env } });
  const reports: ShotReport[] = [];
  let hasFailure = false;
  try {
    for (const shot of shots) {
      const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce" });
      const page = await context.newPage();
      const report = await checkShot(page, baseUrl, shot, query, outDirectory);
      await context.close();
      if (!report) {
        console.error(`[lineContinuity] ${shot.name}: the frame could not be read`);
        return 2;
      }
      reports.push(report);
      const toneText = report.tones.map((tone) => `${tone.tone} longest gap ${tone.longestGapPx} px${tone.longestGapAt ? ` at (${tone.longestGapAt.join(", ")})` : ""}, ${tone.gapsOverLimit} over ${MAX_GAP_PX} px (${tone.checkedPx} px checked)`).join("; ");
      const anchorText = report.anchorContrast === null ? "" : `; anchor contrast ${report.anchorContrast.toFixed(2)}:1 over ${report.anchorPixels} px`;
      console.log(`[lineContinuity] ${tier} ${shot.name}: ${toneText || "no data line in sight"}${anchorText}`);
      if (report.tones.some((tone) => tone.gapsOverLimit > 0)) hasFailure = true;
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(outDirectory, "line-continuity.json"), JSON.stringify(reports, null, 2));
  return hasFailure ? 1 : 0;
}

if (import.meta.main) process.exit(await main());
