// Round-2 design board (branch explore/natural-look only): the frames Andy picks the natural palette from, the Eagle S
// director storyboard and the anchor cam, all drawn by the real engine through the lookdev harness's own launch flags,
// hiding rules and probe judges (run-lookdev.ts).
// Usage: bun scripts/lookdev/board-round2.ts <baseUrl> --out <dir> [--only palette|storyboard|anchor|proof]
// Writes the PNGs and results.json into <dir>; prints one line per frame.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import * as THREE from "three";
import { formatMinute } from "../../src/lib/console/console-state";
import type { Result } from "../../src/lib/result";
import type { DataTone } from "../../src/lib/seabed/scene/overview";
import type { SceneLookName } from "../../src/lib/seabed/scene/scene-look";
import type { SeabedViewName } from "../../src/lib/seabed/scene/viewer";
import { resolveChromiumPath } from "../perf/chromium-path";
import { parseHexColor, type RgbColor } from "./compare";
import { decodePng, encodePng, type RgbaImage } from "./png";
import {
  CANVAS_ONLY_CSS,
  drawProbeOverlay,
  isProbePoint,
  isSeabedProbe,
  judgeSeabed,
  judgeTones,
  LOOK_ONLY_CSS,
  markLookdevCanvas,
  TIER_LAUNCH,
  TONE_HEX,
  VIEWPORT,
  waitForSettledFrame,
  type PlaywrightTierName,
  type SeabedVerdict,
  type ToneVerdict,
} from "./run-lookdev";
import { listLookdevShots } from "./shots";

const FRAME_TIMEOUT_MS = 120_000;
const SETTLE_MS = 800;
// The safe area of the stage (CSS px): view controls on the left, stage controls at the bottom, the card column on
// the right (the brief of the round-2 storyboard).
const SAFE_LEFT_PX = 72;
const SAFE_BOTTOM_PX = 72;
const SAFE_RIGHT_PX = 360;
// Framing keeps subjects this far inside the safe area (CSS px).
const FRAMING_MARGIN_PX = 24;
// Background around a probe for the contrast figure: a ring this many px from the probe, leaving out pixels within
// this much per channel of any data colour (the line itself, a crossing line).
const RING_INNER_PX = 5;
const RING_OUTER_PX = 9;
const DATA_COLOR_EXCLUSION = 24;
// The anchor cam's picture-in-picture size (CSS px).
const ANCHOR_CAM_SIZE = { width: 640, height: 400 };
const EAGLE_S = "eagle-s-2024";

type CameraPose = { position: THREE.Vector3; target: THREE.Vector3; fovDegrees: number };

type FrameRequest = {
  fileName: string;
  caseSlug: string;
  view: SeabedViewName;
  atMs: number;
  look: SceneLookName;
  tier: PlaywrightTierName;
  /** Computes the override camera from the subjects drawn at the moment; null keeps the view's own camera. */
  frameCamera: ((subjects: SubjectReport[], canvas: { width: number; height: number }, pose: PoseReport) => CameraPose) | null;
  /** Renders the stage at this size instead of the console's layout (the anchor cam). */
  stageSize: { width: number; height: number } | null;
};

type SubjectReport = { name: string; scene: [number, number, number]; x: number | null; y: number | null; isHidden: boolean };
type PoseReport = { view: string; position: [number, number, number]; target: [number, number, number]; fovDegrees: number; aspect: number };

type ToneContrast = { tone: DataTone; backgroundHex: string | null; contrastRatio: number | null };

type FrameResult = {
  fileName: string;
  look: SceneLookName;
  tier: PlaywrightTierName;
  drawnLook: string;
  renderer: string;
  canvas: { left: number; top: number; width: number; height: number };
  pose: PoseReport | null;
  tones: ToneVerdict[];
  seabed: SeabedVerdict | null;
  contrasts: ToneContrast[];
  subjects: (SubjectReport & { isInSafeArea: boolean; isInFrame: boolean })[];
  anchorFacts: unknown;
};

function readFlag(argumentList: string[], flag: string): string | null {
  const index = argumentList.indexOf(flag);
  return index === -1 ? null : (argumentList[index + 1] ?? null);
}

function minuteMs(isoMinute: string): number {
  return Date.parse(`${isoMinute}:00Z`);
}

function isTuple3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number");
}

function parseSubjects(text: string): SubjectReport[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry: unknown): SubjectReport[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const name: unknown = Reflect.get(entry, "name");
    const scene: unknown = Reflect.get(entry, "scene");
    const pointX: unknown = Reflect.get(entry, "x");
    const pointY: unknown = Reflect.get(entry, "y");
    const isHidden: unknown = Reflect.get(entry, "isHidden");
    if (typeof name !== "string" || !isTuple3(scene) || typeof isHidden !== "boolean") return [];
    return [{ name, scene, x: typeof pointX === "number" ? pointX : null, y: typeof pointY === "number" ? pointY : null, isHidden }];
  });
}

function parsePose(text: string): PoseReport | null {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) return null;
  const view: unknown = Reflect.get(parsed, "view");
  const position: unknown = Reflect.get(parsed, "position");
  const target: unknown = Reflect.get(parsed, "target");
  const fovDegrees: unknown = Reflect.get(parsed, "fovDegrees");
  const aspect: unknown = Reflect.get(parsed, "aspect");
  if (typeof view !== "string" || !isTuple3(position) || !isTuple3(target) || typeof fovDegrees !== "number" || typeof aspect !== "number") return null;
  return { view, position, target, fovDegrees, aspect };
}

function toVector([pointX, pointY, pointZ]: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(pointX, pointY, pointZ);
}

function readSubject(subjects: readonly SubjectReport[], name: string): THREE.Vector3 {
  const found = subjects.find((subject) => subject.name === name);
  if (!found) throw new Error(`[readSubject] no subject named ${name} (have: ${subjects.map((subject) => subject.name).join(", ")})`);
  return toVector(found.scene);
}

/** A unit vector from a target toward a camera: compass azimuth (degrees, 0 = north, 90 = east) and elevation. */
function directionFrom(azimuthDegrees: number, elevationDegrees: number): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(azimuthDegrees);
  const elevation = THREE.MathUtils.degToRad(elevationDegrees);
  // Scene x runs east and z runs south.
  return new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
}

/** Compass azimuth (degrees) of a horizontal scene direction. */
function azimuthOf(direction: THREE.Vector3): number {
  return (THREE.MathUtils.radToDeg(Math.atan2(direction.x, -direction.z)) + 360) % 360;
}

/**
 * The camera that looks from `direction` and fits every point inside the safe area with a margin: the distance by
 * bisection, then the target slid in the picture plane until the points' box sits in the middle of the safe area.
 */
function fitCamera(points: readonly THREE.Vector3[], direction: THREE.Vector3, fovDegrees: number, canvas: { width: number; height: number }): CameraPose {
  const safe = { left: SAFE_LEFT_PX + FRAMING_MARGIN_PX, top: FRAMING_MARGIN_PX, right: canvas.width - SAFE_RIGHT_PX - FRAMING_MARGIN_PX, bottom: canvas.height - SAFE_BOTTOM_PX - FRAMING_MARGIN_PX };
  const camera = new THREE.PerspectiveCamera(fovDegrees, canvas.width / canvas.height, 0.01, 100000);
  const target = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(Math.max(1, points.length));
  const projectBox = (distance: number) => {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const projected = points.map((point) => {
      const inView = point.clone().applyMatrix4(camera.matrixWorldInverse);
      const ndc = point.clone().project(camera);
      return { x: ((ndc.x + 1) / 2) * canvas.width, y: ((1 - ndc.y) / 2) * canvas.height, isInFront: inView.z < -camera.near };
    });
    return {
      isAllInFront: projected.every((point) => point.isInFront),
      left: Math.min(...projected.map((point) => point.x)),
      right: Math.max(...projected.map((point) => point.x)),
      top: Math.min(...projected.map((point) => point.y)),
      bottom: Math.max(...projected.map((point) => point.y)),
    };
  };
  let distance = 1;
  for (let round = 0; round < 6; round += 1) {
    let near = 0.01;
    let far = 5000;
    for (let step = 0; step < 60; step += 1) {
      const middle = (near + far) / 2;
      const box = projectBox(middle);
      const fits = box.isAllInFront && box.right - box.left <= safe.right - safe.left && box.bottom - box.top <= safe.bottom - safe.top;
      if (fits) far = middle;
      else near = middle;
    }
    distance = far;
    const box = projectBox(distance);
    const offsetX = (box.left + box.right) / 2 - (safe.left + safe.right) / 2;
    const offsetY = (box.top + box.bottom) / 2 - (safe.top + safe.bottom) / 2;
    const unitsPerPx = (2 * distance * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2)) / canvas.height;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    // Sliding the camera and its target right moves the picture's content left.
    target.addScaledVector(right, offsetX * unitsPerPx).addScaledVector(up, -offsetY * unitsPerPx);
  }
  return { position: target.clone().addScaledVector(direction, distance), target, fovDegrees };
}

/** WCAG 2 relative luminance of an 8-bit sRGB colour. */
function readRelativeLuminance(color: RgbColor): number {
  const linear = [color.red, color.green, color.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function formatHex(color: RgbColor): string {
  return `#${[color.red, color.green, color.blue].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Median background around a tone's probes (a ring, data colours left out) and the tone's WCAG contrast against it. */
function measureContrasts(image: RgbaImage, probes: readonly { tone: DataTone; x: number; y: number }[]): ToneContrast[] {
  const dataColors = Object.values(TONE_HEX).map(parseHexColor);
  const tones = [...new Set(probes.map((probe) => probe.tone))];
  return tones.map((tone) => {
    const channels: [number[], number[], number[]] = [[], [], []];
    for (const probe of probes.filter((candidate) => candidate.tone === tone)) {
      for (let offsetY = -RING_OUTER_PX; offsetY <= RING_OUTER_PX; offsetY += 1) {
        for (let offsetX = -RING_OUTER_PX; offsetX <= RING_OUTER_PX; offsetX += 1) {
          const radius = Math.hypot(offsetX, offsetY);
          if (radius < RING_INNER_PX || radius > RING_OUTER_PX) continue;
          const column = Math.round(probe.x) + offsetX;
          const row = Math.round(probe.y) + offsetY;
          if (column < 0 || row < 0 || column >= image.width || row >= image.height) continue;
          const offset = (row * image.width + column) * 4;
          const pixel = { red: image.data[offset] ?? 0, green: image.data[offset + 1] ?? 0, blue: image.data[offset + 2] ?? 0 };
          const isDataPixel = dataColors.some((dataColor) => Math.max(Math.abs(dataColor.red - pixel.red), Math.abs(dataColor.green - pixel.green), Math.abs(dataColor.blue - pixel.blue)) <= DATA_COLOR_EXCLUSION);
          if (isDataPixel) continue;
          channels[0].push(pixel.red);
          channels[1].push(pixel.green);
          channels[2].push(pixel.blue);
        }
      }
    }
    if (channels[0].length === 0) return { tone, backgroundHex: null, contrastRatio: null };
    const [reds, greens, blues] = channels.map((values) => [...values].sort((first, second) => first - second)[Math.floor(values.length / 2)] ?? 0);
    const background = { red: reds ?? 0, green: greens ?? 0, blue: blues ?? 0 };
    const toneLuminance = readRelativeLuminance(parseHexColor(TONE_HEX[tone]));
    const backgroundLuminance = readRelativeLuminance(background);
    const ratio = (Math.max(toneLuminance, backgroundLuminance) + 0.05) / (Math.min(toneLuminance, backgroundLuminance) + 0.05);
    return { tone, backgroundHex: formatHex(background), contrastRatio: Math.round(ratio * 100) / 100 };
  });
}

function buildUrl(baseUrl: string, request: FrameRequest): string {
  const params = new URLSearchParams({ t: formatMinute(request.atMs) });
  if (request.view !== "overview") params.set("view", request.view);
  if (request.look !== "current") params.set("look", request.look);
  return `${baseUrl}/cases/${request.caseSlug}?${params.toString().replaceAll("%3A", ":")}`;
}

/** Waits until the canvas draws a frame after `afterCount`, then until it stops drawing for SETTLE_MS. */
async function waitForNextSettledFrame(page: Page, afterCount: number) {
  await page.waitForFunction((count) => Number(document.querySelector("canvas[data-renderer]")?.getAttribute("data-frame-count") ?? "0") > count, afterCount, { timeout: FRAME_TIMEOUT_MS, polling: 50 });
  await page.waitForFunction(
    (settleMs) => {
      const count = document.querySelector("canvas[data-renderer]")?.getAttribute("data-frame-count") ?? "";
      const seenCount: unknown = Reflect.get(window, "boardSeenCount");
      const seenSinceMs: unknown = Reflect.get(window, "boardSeenSinceMs");
      if (seenCount !== count || typeof seenSinceMs !== "number") {
        Reflect.set(window, "boardSeenCount", count);
        Reflect.set(window, "boardSeenSinceMs", performance.now());
        return false;
      }
      return performance.now() - seenSinceMs >= settleMs;
    },
    SETTLE_MS,
    { timeout: FRAME_TIMEOUT_MS, polling: 100 },
  );
}

const readCanvasAttribute = (page: Page, name: string) => page.evaluate((attribute) => document.querySelector("canvas[data-renderer]")?.getAttribute(attribute) ?? "", name);
const readFrameCount = async (page: Page) => Number(await readCanvasAttribute(page, "data-frame-count"));

async function captureFrame(browser: Browser, baseUrl: string, request: FrameRequest, outDirectory: string): Promise<Result<FrameResult>> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await context.addInitScript(markLookdevCanvas);
  const page = await context.newPage();
  try {
    await page.goto(buildUrl(baseUrl, request), { waitUntil: "load", timeout: FRAME_TIMEOUT_MS });
    const renderer = await waitForSettledFrame(page, { name: request.fileName, caseSlug: request.caseSlug, view: request.view, atMs: request.atMs, requiredTones: [] });
    if (renderer !== request.tier) return { ok: false, reason: `asked for the ${request.tier} tier, the page drew on ${renderer}` };
    const drawnLook = await readCanvasAttribute(page, "data-scene-look");
    if (drawnLook !== request.look) return { ok: false, reason: `asked for the ${request.look} look, the canvas reports ${drawnLook}` };
    if (request.stageSize) {
      const countBefore = await readFrameCount(page);
      await page.addStyleTag({ content: `[data-testid="seabed-view"] { position: fixed !important; left: 0 !important; top: 0 !important; width: ${request.stageSize.width}px !important; height: ${request.stageSize.height}px !important; z-index: 50; }` });
      await waitForNextSettledFrame(page, countBefore);
    }
    if (request.frameCamera) {
      const canvasSize = await page.evaluate(() => {
        const rect = document.querySelector("canvas[data-renderer]")?.getBoundingClientRect();
        return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
      });
      const firstPose = parsePose(await readCanvasAttribute(page, "data-camera-pose"));
      if (!firstPose) return { ok: false, reason: "the canvas reported no camera pose" };
      const pose = request.frameCamera(parseSubjects(await readCanvasAttribute(page, "data-subjects")), canvasSize, firstPose);
      const countBefore = await readFrameCount(page);
      const override = JSON.stringify({ position: pose.position.toArray(), target: pose.target.toArray(), fovDegrees: pose.fovDegrees });
      await page.evaluate((text) => document.querySelector("canvas[data-renderer]")?.setAttribute("data-camera-override", text), override);
      await waitForNextSettledFrame(page, countBefore);
    }
    const lookStyle = await page.addStyleTag({ content: LOOK_ONLY_CSS });
    const framePath = path.join(outDirectory, request.fileName);
    mkdirSync(path.dirname(framePath), { recursive: true });
    if (request.stageSize) await page.locator('[data-testid="seabed-view"]').screenshot({ path: framePath, animations: "disabled" });
    else await page.screenshot({ path: framePath, animations: "disabled" });
    await page.addStyleTag({ content: CANVAS_ONLY_CSS });
    const canvasPng = await page.locator("canvas[data-renderer]").screenshot({ animations: "disabled" });
    const canvasBox = await page.evaluate(() => {
      const rect = document.querySelector("canvas[data-renderer]")?.getBoundingClientRect();
      return { left: rect?.left ?? 0, top: rect?.top ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0 };
    });
    await lookStyle.evaluate((element) => element.parentNode?.removeChild(element));
    const canvasImage = decodePng(canvasPng);
    if (!canvasImage.ok) return { ok: false, reason: `canvas frame: ${canvasImage.reason}` };
    const rawProbes: unknown = JSON.parse((await readCanvasAttribute(page, "data-color-probes")) || "[]");
    const rawSeabed: unknown = JSON.parse((await readCanvasAttribute(page, "data-seabed-probes")) || "[]");
    const probes = Array.isArray(rawProbes) ? rawProbes.filter(isProbePoint) : [];
    const seabedProbes = Array.isArray(rawSeabed) ? rawSeabed.filter(isSeabedProbe) : [];
    const isLookingDown = request.view === "overview" && request.frameCamera === null;
    const probeDirectory = path.join(outDirectory, "probes");
    mkdirSync(probeDirectory, { recursive: true });
    if (probes.length > 0) writeFileSync(path.join(probeDirectory, path.basename(request.fileName).replace(/\.png$/, ".probes.png")), encodePng(drawProbeOverlay(canvasImage.value, probes)));
    const pose = parsePose((await readCanvasAttribute(page, "data-camera-pose")) || "null");
    const safeRight = canvasBox.width - SAFE_RIGHT_PX;
    const safeBottom = canvasBox.height - SAFE_BOTTOM_PX;
    const subjects = parseSubjects((await readCanvasAttribute(page, "data-subjects")) || "[]").map((subject) => {
      const isInFrame = subject.x !== null && subject.y !== null && subject.x >= 0 && subject.x <= canvasBox.width && subject.y >= 0 && subject.y <= canvasBox.height;
      const isInSafeArea = subject.x !== null && subject.y !== null && subject.x >= SAFE_LEFT_PX && subject.x <= safeRight && subject.y >= 0 && subject.y <= safeBottom;
      return { ...subject, isInFrame, isInSafeArea };
    });
    const anchorFactsText = await readCanvasAttribute(page, "data-anchor-facts");
    return {
      ok: true,
      value: {
        fileName: request.fileName,
        look: request.look,
        tier: request.tier,
        drawnLook,
        renderer,
        canvas: canvasBox,
        pose,
        tones: request.view === "closeup" ? [] : judgeTones(canvasImage.value, probes, []),
        seabed: isLookingDown ? judgeSeabed(canvasImage.value, seabedProbes) : null,
        contrasts: measureContrasts(canvasImage.value, probes),
        subjects,
        anchorFacts: anchorFactsText ? JSON.parse(anchorFactsText) : null,
      },
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await context.close();
  }
}

/** The palette frames: every look of each case frame on the hardware tier, and natural-a and natural-c overviews on software. */
function listPaletteFrames(): FrameRequest[] {
  const hongTaiShot = listLookdevShots().find((shot) => shot.name === "hong-tai-58-2025-overview");
  if (!hongTaiShot) throw new Error("[listPaletteFrames] the lookdev shot hong-tai-58-2025-overview is gone");
  const caseFrames = [
    { caseSlug: EAGLE_S, view: "overview" as const, atMs: minuteMs("2024-12-25T10:26") },
    { caseSlug: hongTaiShot.caseSlug, view: "overview" as const, atMs: hongTaiShot.atMs },
    { caseSlug: EAGLE_S, view: "vessel" as const, atMs: minuteMs("2024-12-25T10:40") },
  ];
  const looks: SceneLookName[] = ["current", "natural-a", "natural-b", "natural-c"];
  const hardwareFrames = caseFrames.flatMap((frame) => looks.map((look): FrameRequest => ({ ...frame, look, tier: "hardware", fileName: `${frame.caseSlug}-${frame.view}-${look}-hardware.png`, frameCamera: null, stageSize: null })));
  const softwareLooks: SceneLookName[] = ["natural-a", "natural-c"];
  const softwareFrames = caseFrames
    .filter((frame) => frame.view === "overview")
    .flatMap((frame) => softwareLooks.map((look): FrameRequest => ({ ...frame, look, tier: "software", fileName: `${frame.caseSlug}-${frame.view}-${look}-software.png`, frameCamera: null, stageSize: null })));
  return [...hardwareFrames, ...softwareFrames];
}

/**
 * Proof frames: the harness's own Eagle S overview (16:44, alarm rings and furrow) and after-drag (the ink track)
 * moments in every natural look, so each data tone is judged on enough probes.
 */
function listProofFrames(): FrameRequest[] {
  const shots = listLookdevShots().filter((shot) => shot.name === "eagle-s-2024-overview" || shot.name === "eagle-s-2024-after-drag");
  const looks: SceneLookName[] = ["natural-a", "natural-b", "natural-c"];
  return shots.flatMap((shot) =>
    looks.map((look): FrameRequest => ({
      fileName: `proof/${shot.caseSlug}-${shot.name === "eagle-s-2024-after-drag" ? "after-drag" : `overview-${formatMinute(shot.atMs).slice(11, 16).replace(":", "")}`}-${look}-hardware.png`,
      caseSlug: shot.caseSlug,
      view: shot.view,
      atMs: shot.atMs,
      look,
      tier: "hardware",
      frameCamera: null,
      stageSize: null,
    })),
  );
}

const TRACK_SUBJECTS =Array.from({ length: 11 }, (_slot, index) => `track ${index * 10}%`);

/** The Eagle S storyboard on the current look, each camera computed from the subjects it must show. */
function listStoryboardFrames(): FrameRequest[] {
  const storyboardFrame = (fileName: string, isoMinute: string, view: SeabedViewName, frameCamera: FrameRequest["frameCamera"]): FrameRequest => ({
    fileName,
    caseSlug: EAGLE_S,
    view,
    atMs: minuteMs(isoMinute),
    look: "current",
    tier: "hardware",
    frameCamera,
    stageSize: null,
  });
  return [
    // S1: the gulf from the south-west, high oblique (40 degrees down), the whole track, both cables' cut points, the
    // ship. The engine draws no ship before the track's first position (10:26 UTC): at 10:20 its framing holds the
    // first position (track 0%) instead.
    storyboardFrame("eagle-s-2024-s1-establishing-1020-current-hardware.png", "2024-12-25T10:20", "overview", (subjects, canvas) => {
      const names = [...TRACK_SUBJECTS, "Estlink 2 cut point", "C-Lion1 cut point", ...(subjects.some((subject) => subject.name === "vessel") ? ["vessel"] : [])];
      return fitCamera(names.map((name) => readSubject(subjects, name)), directionFrom(225, 40), 32, canvas);
    }),
    // S2: behind and above the ship's quarter (45 degrees off the stern, 38 degrees down): ship, chain and anchor together.
    storyboardFrame("eagle-s-2024-s2-follow-1040-current-hardware.png", "2024-12-25T10:40", "overview", (subjects, canvas) => {
      const anchor = readSubject(subjects, "anchor");
      const hawse = readSubject(subjects, "hawse (chain top)");
      const vessel = readSubject(subjects, "vessel");
      const heading = new THREE.Vector3(hawse.x - anchor.x, 0, hawse.z - anchor.z).normalize();
      // The drawn hull is 1.37 km long: its bow and stern join the subjects so the whole ship stays in frame.
      const halfHull = 0.69;
      const points = [anchor, hawse, readSubject(subjects, "chain middle"), vessel, vessel.clone().addScaledVector(heading, halfHull), vessel.clone().addScaledVector(heading, -halfHull), vessel.clone().setY(0.25)];
      return fitCamera(points, directionFrom(azimuthOf(heading) + 180 + 45, 38), 32, canvas);
    }),
    // S3: low over the seabed (12 degrees), across the drag line, the anchor closing on C-Lion1, the chain rising.
    storyboardFrame("eagle-s-2024-s3-approach-1638-current-hardware.png", "2024-12-25T16:38", "overview", (subjects, canvas) => {
      const anchor = readSubject(subjects, "anchor");
      const cable = readSubject(subjects, "C-Lion1 cut point");
      const hawse = readSubject(subjects, "hawse (chain top)");
      const drag = new THREE.Vector3(hawse.x - anchor.x, 0, hawse.z - anchor.z).normalize();
      const chainLow = anchor.clone().lerp(readSubject(subjects, "chain middle"), 0.5);
      return fitCamera([anchor, cable, chainLow, readSubject(subjects, "chain middle")], directionFrom(azimuthOf(drag) - 90, 12), 32, canvas);
    }),
    // S4: the At the cut close-up, one frame of a slow orbit: 35 degrees round the torn ends from the view's own camera.
    storyboardFrame("eagle-s-2024-s4-cut-1644-current-hardware.png", "2024-12-25T16:44", "closeup", (_subjects, _canvas, pose) => {
      const target = toVector(pose.target);
      const offset = toVector(pose.position).sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(35));
      return { position: target.clone().add(offset), target, fovDegrees: pose.fovDegrees };
    }),
    // S5: pulled back over the whole track and both cuts, from above (75 degrees down, north up).
    storyboardFrame("eagle-s-2024-s5-aftermath-1700-current-hardware.png", "2024-12-25T17:00", "overview", (subjects, canvas) =>
      fitCamera([...TRACK_SUBJECTS, "Estlink 2 cut point", "C-Lion1 cut point"].map((name) => readSubject(subjects, name)), directionFrom(180, 75), 32, canvas),
    ),
  ];
}

/** The anchor cam at 10:40: low behind the anchor, looking along the drag, the furrow below, the chain rising away. */
function listAnchorFrames(): FrameRequest[] {
  return [
    {
      fileName: "anchor-cam-1040.png",
      caseSlug: EAGLE_S,
      view: "overview",
      atMs: minuteMs("2024-12-25T10:40"),
      look: "current",
      tier: "hardware",
      stageSize: ANCHOR_CAM_SIZE,
      frameCamera: (subjects) => {
        const anchor = readSubject(subjects, "anchor");
        const hawse = readSubject(subjects, "hawse (chain top)");
        const drag = new THREE.Vector3(hawse.x - anchor.x, 0, hawse.z - anchor.z).normalize();
        // 0.45 km behind and 0.16 km above the anchor (drawn 30 times its size, about 0.1 km), aiming just past it.
        const position = anchor.clone().addScaledVector(drag, -0.45).add(new THREE.Vector3(0, 0.16, 0));
        const target = anchor.clone().addScaledVector(drag, 0.12);
        return { position, target, fovDegrees: 50 };
      },
    },
  ];
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const baseUrl = argumentList.find((argument) => URL.canParse(argument))?.replace(/\/$/, "");
  const outDirectory = readFlag(argumentList, "--out");
  const only = readFlag(argumentList, "--only");
  if (!baseUrl || !outDirectory) {
    console.error("[boardRound2] usage: bun scripts/lookdev/board-round2.ts <baseUrl> --out <dir> [--only palette|storyboard|anchor|proof]");
    return 2;
  }
  const chromiumPath = resolveChromiumPath(null);
  if (!chromiumPath.ok) {
    console.error(`[boardRound2] ${chromiumPath.reason}`);
    return 2;
  }
  const requests = [
    ...(only === null || only === "palette" ? listPaletteFrames() : []),
    ...(only === null || only === "storyboard" ? listStoryboardFrames() : []),
    ...(only === null || only === "anchor" ? listAnchorFrames() : []),
    ...(only === null || only === "proof" ? listProofFrames() : []),
  ];
  mkdirSync(outDirectory, { recursive: true });
  const results: FrameResult[] = [];
  let failureCount = 0;
  for (const tier of ["hardware", "software"] as const) {
    const tierRequests = requests.filter((request) => request.tier === tier);
    if (tierRequests.length === 0) continue;
    const launch = TIER_LAUNCH[tier];
    const browser = await chromium.launch({ executablePath: chromiumPath.value, args: launch.args, env: { ...process.env, ...launch.env } });
    for (const request of tierRequests) {
      const captured = await captureFrame(browser, baseUrl, request, outDirectory);
      if (!captured.ok) {
        console.error(`[boardRound2] ${request.fileName}: ${captured.reason}`);
        failureCount += 1;
        continue;
      }
      results.push(captured.value);
      const tones = captured.value.tones.map((tone) => `${tone.tone} ${tone.exactCount}/${tone.probeCount}${tone.isPass ? "" : " FAIL"}`).join(", ");
      const seabed = captured.value.seabed ? `, seabed ${captured.value.seabed.closeCount}/${captured.value.seabed.probeCount}${captured.value.seabed.isPass ? "" : " off"}` : "";
      console.log(`[boardRound2] ${request.fileName}: ${captured.value.renderer}, look ${captured.value.drawnLook}; ${tones || "no tones"}${seabed}`);
    }
    await browser.close();
  }
  const resultsPath = path.join(outDirectory, `results-${only ?? "all"}.json`);
  writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`[boardRound2] ${results.length} frame(s), ${failureCount} failed; results in ${resultsPath}`);
  return failureCount === 0 ? 0 : 1;
}

process.exit(await main());
