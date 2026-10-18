// The photo match: an outside judge for the hero ship's shape. It segments Eagle S from the public-domain side
// photograph "Eagle S Emasalo 2025-01-12 1" (Wikimedia Commons, by MKFI, 6000 x 4000, Canon EOS 80D at 150 mm),
// matches a camera to it from the ship's known length (228.6 m) and the lens, draws the generator's Eagle S from that
// camera, and scores the intersection over union of the two silhouettes. The photograph is a reference only: nothing
// of it reaches the model or its textures.
//
// Usage: bun scripts/lookdev/photo-match/photo-match.ts --photo <path to the JPEG> [--out <dir>] [--chromium <path>]
// Writes <out>/photo-match-overlay.png (green: both, magenta: photograph only, blue: model only, yellow: void) and
// <out>/photo-match.json. Exit codes: 0 scored at or above the 0.92 target, 1 scored under it, 2 could not score.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type { Result } from "../../../src/lib/result";
import { resolveChromiumPath } from "../../perf/chromium-path";
import { encodePng, type RgbaImage } from "../png";
import { TIER_LAUNCH } from "../tier-launch";
import { bundleTurntable } from "../turntable";
import { loadPhoto } from "./load-photo";
import type { PhotoCamera } from "./photo-camera";
import { measureIntersectionOverUnion, segmentShip, type Mask } from "./segment-photo";

// The target the brief sets for the silhouette's intersection over union.
const TARGET_SCORE = 0.92;
// The photograph is judged at 1,500 px wide (a quarter of the original); the camera search runs at half that.
const JUDGE_WIDTH = 1500;
const SEARCH_SCALE = 2;
// Canon EOS 80D: APS-C sensor 22.3 by 14.9 mm (Canon's specification); the photograph's EXIF gives 150 mm.
const SENSOR_HEIGHT_MM = 14.9;
const FOCAL_LENGTH_MM = 150;
// The segmentation's box and thresholds for this photograph (segment-photo.ts explains each): the ship lies between
// 13% and 95.5% of the width and 47% to 70% of the height, with background on both sides of it on every row.
const SEGMENT_OPTIONS = {
  shipBox: [0.13, 0.47, 0.955, 0.7],
  seedDistance: 40,
  shipMargin: 4,
  voidMargin: 8,
  darkBackgroundLuminance: 150,
  minComponentPixels: 400,
  hullGapShare: 0.06,
  hullReachShare: 0.07,
} as const;
// The camera search: a start from the photograph's geometry (the ship spans 79% of the frame's width, its waterline
// 19% of the height below the centre, the camera at a marina's eye height) and the first step of each parameter.
const START_CAMERA: PhotoCamera = {
  distanceMetres: 1950,
  heightMetres: 3,
  yawDegrees: 0,
  panDegrees: 0.36,
  tiltDegrees: 1.05,
  rollDegrees: 0,
  verticalFovDegrees: (2 * Math.atan(SENSOR_HEIGHT_MM / 2 / FOCAL_LENGTH_MM) * 180) / Math.PI,
  draughtMetres: 11.5,
};
// The lens's field of view may move too: the sensor's crop and the lens's focus breathing are not in the EXIF.
const START_STEPS: Record<keyof PhotoCamera, number> = { distanceMetres: 40, heightMetres: 2, yawDegrees: 4, panDegrees: 0.04, tiltDegrees: 0.04, rollDegrees: 0.1, verticalFovDegrees: 0.1, draughtMetres: 0.8 };
// Bounds a real camera and loading condition stay inside: a marina's eye height, a tanker's draughts.
const BOUNDS: Partial<Record<keyof PhotoCamera, [number, number]>> = { heightMetres: [1, 12], draughtMetres: [8, 14.5], yawDegrees: [-40, 40], distanceMetres: [1200, 3000], verticalFovDegrees: [5.1, 6.3] };
const SEARCH_ROUNDS = 7;
// The headings the search starts from (degrees), and the refinement at the judged size: its first steps as a share of
// the search's, and its rounds.
const START_YAWS_DEGREES = [-6, 0, 6];
const REFINE_STEP_SHARE = 1 / 16;
const REFINE_ROUNDS = 3;

function readFlagValue(argumentList: string[], flag: string): string | null {
  const flagIndex = argumentList.indexOf(flag);
  return flagIndex === -1 ? null : (argumentList[flagIndex + 1] ?? null);
}

/** Every `factor`th pixel of a mask (nearest, as the search only needs a coarse score). */
function shrinkMask(mask: Mask, factor: number): Mask {
  const width = Math.floor(mask.width / factor);
  const height = Math.floor(mask.height / factor);
  const data = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) data[row * width + column] = mask.data[row * factor * mask.width + column * factor] ?? 0;
  return { width, height, data };
}

async function scoreCamera(page: Page, camera: PhotoCamera): Promise<number> {
  return page.evaluate((tried) => {
    const score: unknown = Reflect.get(window, "photoMatchScore");
    return typeof score === "function" ? Number(score(tried)) : 0;
  }, camera);
}

type Extent = { left: number; right: number; bottom: number };

/** The extent of a mask: leftmost and rightmost set columns, and its waterline (the median of each column's lowest set row). */
function measurePhotoExtent(mask: Mask): Extent {
  let left = mask.width;
  let right = -1;
  const lowestRows: number[] = [];
  for (let column = 0; column < mask.width; column += 1) {
    for (let row = mask.height - 1; row >= 0; row -= 1) {
      if (mask.data[row * mask.width + column] !== 1) continue;
      left = Math.min(left, column);
      right = Math.max(right, column);
      lowestRows.push(row);
      break;
    }
  }
  lowestRows.sort((first, second) => first - second);
  return { left, right, bottom: lowestRows[Math.floor(lowestRows.length * 0.6)] ?? 0 };
}

async function measureModel(page: Page, camera: PhotoCamera, width: number, height: number): Promise<Extent> {
  return page.evaluate(
    ({ tried, maskWidth, maskHeight }) => {
      const measure: unknown = Reflect.get(window, "photoMatchMeasure");
      const measured: unknown = typeof measure === "function" ? measure(tried, maskWidth, maskHeight) : null;
      const readNumber = (key: string) => (typeof measured === "object" && measured !== null ? Number(Reflect.get(measured, key)) : 0);
      return { left: readNumber("left"), right: readNumber("right"), bottom: readNumber("bottom") };
    },
    { tried: camera, maskWidth: width, maskHeight: height },
  );
}

/**
 * Lines the model up with the photograph before the search: the distance from the ship's length in the frame, then
 * pan and tilt so its ends and waterline land where the photograph's do (a few secant steps, each read off a render).
 */
async function alignCamera(page: Page, photoExtent: Extent, width: number, height: number, yawDegrees: number): Promise<PhotoCamera> {
  let camera = { ...START_CAMERA, yawDegrees };
  const degreesPerPixel = camera.verticalFovDegrees / height;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const model = await measureModel(page, camera, width, height);
    if (model.right < 0) break;
    const lengthRatio = (model.right - model.left) / Math.max(1, photoExtent.right - photoExtent.left);
    const centerShiftPx = (photoExtent.left + photoExtent.right) / 2 - (model.left + model.right) / 2;
    const waterShiftPx = photoExtent.bottom - model.bottom;
    // A camera turned right moves the picture left; tilted up, it moves the picture down.
    camera = { ...camera, distanceMetres: camera.distanceMetres * lengthRatio, panDegrees: camera.panDegrees - centerShiftPx * degreesPerPixel, tiltDegrees: camera.tiltDegrees + waterShiftPx * degreesPerPixel };
  }
  return camera;
}

/**
 * Coordinate descent on the camera: each parameter tries a step either way, steps halve when nothing improves.
 * `stepShare` scales the first steps (1 for the search, smaller for the refinement at the judged size).
 */
async function fitCamera(page: Page, start: PhotoCamera, stepShare: number, rounds: number): Promise<{ camera: PhotoCamera; score: number; evaluations: number }> {
  let camera = { ...start };
  let best = await scoreCamera(page, camera);
  let evaluations = 1;
  const steps = { ...START_STEPS };
  const keys = Object.keys(steps).filter((key): key is keyof PhotoCamera => key in START_CAMERA && steps[key as keyof PhotoCamera] > 0);
  for (const key of keys) steps[key] *= stepShare;
  for (let round = 0; round < rounds; round += 1) {
    let hasImproved = true;
    while (hasImproved) {
      hasImproved = false;
      for (const key of keys) {
        for (const direction of [1, -1]) {
          const bounds = BOUNDS[key];
          const value = camera[key] + direction * steps[key];
          if (bounds && (value < bounds[0] || value > bounds[1])) continue;
          const tried = { ...camera, [key]: value };
          const score = await scoreCamera(page, tried);
          evaluations += 1;
          if (score > best + 1e-5) {
            best = score;
            camera = tried;
            hasImproved = true;
            break;
          }
        }
      }
    }
    for (const key of keys) steps[key] /= 2;
    console.log(`[photoMatch] round ${round + 1}: intersection over union ${best.toFixed(4)}`);
  }
  return { camera, score: best, evaluations };
}

function drawOverlay(photo: RgbaImage, photoShip: Mask, model: Mask, voidMask: Mask): RgbaImage {
  const data = new Uint8Array(photo.data.length);
  for (let index = 0; index < photoShip.data.length; index += 1) {
    const isPhoto = photoShip.data[index] === 1;
    const isModel = model.data[index] === 1;
    const gray = Math.round(0.6 * (0.2126 * (photo.data[index * 4] ?? 0) + 0.7152 * (photo.data[index * 4 + 1] ?? 0) + 0.0722 * (photo.data[index * 4 + 2] ?? 0)) + 90);
    let color: [number, number, number] = [gray, gray, gray];
    if (voidMask.data[index] === 1) color = [230, 200, 40];
    else if (isPhoto && isModel) color = [46, 158, 91];
    else if (isPhoto) color = [214, 60, 200];
    else if (isModel) color = [50, 100, 220];
    data.set([...color, 255], index * 4);
  }
  return { width: photo.width, height: photo.height, data };
}

async function runPhotoMatch(photoPath: string, outDirectory: string, chromiumPath: string): Promise<Result<{ score: number; scoreWithVoidAsBackground: number }>> {
  const photo = await loadPhoto(photoPath, JUDGE_WIDTH);
  if (!photo.ok) return photo;
  const segmentation = segmentShip(photo.value, SEGMENT_OPTIONS);
  console.log(`[photoMatch] photograph segmented: ${segmentation.shipPixelCount} ship pixels, ${segmentation.voidPixelCount} void pixels at ${photo.value.width} x ${photo.value.height}`);
  const pagePath = await bundleTurntable("photo-match/silhouette-page.ts", path.resolve(outDirectory, "photo-match-page"));
  if (!pagePath.ok) return pagePath;
  const browser = await chromium.launch({ executablePath: chromiumPath, args: TIER_LAUNCH.hardware.args, env: { ...process.env, ...TIER_LAUNCH.hardware.env } });
  try {
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") console.error(`[photoMatch] page: ${message.text()}`);
    });
    await page.goto(`file://${pagePath.value}`);
    await page.waitForSelector("body[data-state='ready']", { state: "attached" });
    const searchShip = shrinkMask(segmentation.ship, SEARCH_SCALE);
    const searchVoid = shrinkMask(segmentation.voidMask, SEARCH_SCALE);
    const loadMasks = async (ship: Mask, voidMask: Mask) =>
      page.evaluate(
        ({ width, height, shipBase64, voidBase64 }) => {
          const load: unknown = Reflect.get(window, "photoMatchLoadMasks");
          if (typeof load === "function") load(width, height, shipBase64, voidBase64);
        },
        { width: ship.width, height: ship.height, shipBase64: Buffer.from(ship.data).toString("base64"), voidBase64: Buffer.from(voidMask.data).toString("base64") },
      );
    await loadMasks(searchShip, searchVoid);
    // The ship's heading against the camera is ambiguous from a side view (a few degrees either way look alike), so the
    // search starts from each of a few headings and keeps the best; then refines at the judged size, where the
    // waterline and the thin gear are resolved.
    let searched: { camera: PhotoCamera; score: number; evaluations: number } | null = null;
    let evaluations = 0;
    for (const yawDegrees of START_YAWS_DEGREES) {
      const aligned = await alignCamera(page, measurePhotoExtent(searchShip), searchShip.width, searchShip.height, yawDegrees);
      console.log(`[photoMatch] aligned from yaw ${yawDegrees}: distance ${aligned.distanceMetres.toFixed(0)} m, pan ${aligned.panDegrees.toFixed(3)}, tilt ${aligned.tiltDegrees.toFixed(3)} degrees`);
      const candidate = await fitCamera(page, aligned, 1, SEARCH_ROUNDS);
      evaluations += candidate.evaluations;
      if (!searched || candidate.score > searched.score) searched = candidate;
    }
    if (!searched) return { ok: false, reason: "no camera start to search from" };
    await loadMasks(segmentation.ship, segmentation.voidMask);
    const refined = await fitCamera(page, searched.camera, REFINE_STEP_SHARE, REFINE_ROUNDS);
    const fitted = { camera: refined.camera, score: searched.score, evaluations: evaluations + refined.evaluations };
    const modelBase64 = await page.evaluate(
      ({ camera, width, height }) => {
        const render: unknown = Reflect.get(window, "photoMatchRender");
        return typeof render === "function" ? String(render(camera, width, height)) : "";
      },
      { camera: fitted.camera, width: photo.value.width, height: photo.value.height },
    );
    const model: Mask = { width: photo.value.width, height: photo.value.height, data: new Uint8Array(Buffer.from(modelBase64, "base64")) };
    const score = measureIntersectionOverUnion(segmentation.ship, model, segmentation.voidMask) ?? 0;
    const scoreWithVoidAsBackground = measureIntersectionOverUnion(segmentation.ship, model, null) ?? 0;
    mkdirSync(outDirectory, { recursive: true });
    writeFileSync(path.join(outDirectory, "photo-match-overlay.png"), encodePng(drawOverlay(photo.value, segmentation.ship, model, segmentation.voidMask)));
    const report = { photoPath, judgeWidth: photo.value.width, score, scoreWithVoidAsBackground, target: TARGET_SCORE, camera: fitted.camera, searchScore: fitted.score, evaluations: fitted.evaluations, shipPixels: segmentation.shipPixelCount, voidPixels: segmentation.voidPixelCount };
    writeFileSync(path.join(outDirectory, "photo-match.json"), `${JSON.stringify(report, null, 2)}\n`);
    return { ok: true, value: { score, scoreWithVoidAsBackground } };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<number> {
  const argumentList = process.argv.slice(2);
  const photoPath = readFlagValue(argumentList, "--photo");
  if (!photoPath) {
    console.error("[photoMatch] pass --photo <path to Eagle_S_Emasalo_2025-01-12_1.JPG>");
    return 2;
  }
  const outDirectory = readFlagValue(argumentList, "--out") ?? path.join(".scratch", "photo-match");
  const chromiumPath = resolveChromiumPath(readFlagValue(argumentList, "--chromium") ?? process.env.PERF_CHROMIUM_PATH ?? null);
  if (!chromiumPath.ok) {
    console.error(`[photoMatch] ${chromiumPath.reason}`);
    return 2;
  }
  const result = await runPhotoMatch(photoPath, outDirectory, chromiumPath.value);
  if (!result.ok) {
    console.error(`[photoMatch] ${result.reason}`);
    return 2;
  }
  console.log(`[photoMatch] intersection over union ${result.value.score.toFixed(4)} (void left out), ${result.value.scoreWithVoidAsBackground.toFixed(4)} (void counted as background); target ${TARGET_SCORE}`);
  return result.value.score >= TARGET_SCORE ? 0 : 1;
}

process.exit(await main());
