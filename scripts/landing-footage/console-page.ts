// Opens the real replay console in headless Chromium for the landing footage (build-footage.ts) and draws chosen
// frames on it through the viewer's lookdev hooks (src/lib/seabed/scene/viewer.ts): `data-time-override` draws any
// replay moment, to the millisecond, and `data-camera-override` holds any camera pose. The console's own overlays (the
// anchor status pill, the anchor cam's figures) follow the replay clock, which the page moves to the frame's minute
// through its scrubber, so every frame is a pure function of the moment and the pose, whatever the render speed.
import type { BrowserContext, Page } from "playwright";
import * as THREE from "three";
import type { Result } from "../../src/lib/result";
import type { CameraPose } from "../../src/lib/seabed/scene/director/viewer-port";
import type { SignedInState } from "../lookdev/tier-launch";

// How long the page may take to load, settle or draw one frame (ms): a cold production server compiles nothing, but the
// seabed area and the refinement take several seconds on the first load.
const LOAD_TIMEOUT_MS = 120_000;
const FRAME_TIMEOUT_MS = 30_000;
// A page counts as settled once its canvas has drawn no new frame for this long (ms), as in run-lookdev.ts.
const SETTLE_MS = 800;
// The warm-up the viewer runs on a quiet page (viewer.ts, WARM_UP_QUIET_MS is 1.5 s) must be over before the first
// frame is taken: it builds objects and marks the picture dirty.
const WARM_UP_WAIT_MS = 2500;
const MS_PER_MINUTE = 60_000;

/** How the page is laid out for a capture: its CSS size and device pixel ratio. */
export type PageLayout = { width: number; height: number; deviceScaleFactor: number };

/** A subject the viewer's lookdev hook names (overview.ts, readSubjects), at its scene position (km). */
export type NamedSubject = { name: string; scene: [number, number, number] };

// The stage fills the window, and of the console's chrome only the overlays that belong to the picture stay: the 3D
// labels, the anchor status pill (moved up into the band the hidden view switcher leaves) and the anchor cam with its
// figures. `display: none`, not `visibility`, so the hidden controls stop blocking labels (viewer.ts, readLabelRoom).
const STAGE_ONLY_CSS = `
  [data-testid="case-replay"] { position: fixed !important; inset: 0 !important; z-index: 2147483000 !important; border-radius: 0 !important; box-shadow: none !important; }
  [data-testid="case-replay"] > div:has([data-testid="view-switch"]),
  [data-testid="case-replay"] > div:has([data-testid="scale-info"]),
  [data-testid="case-replay"] > [role="group"][aria-label="Camera"],
  [data-testid="case-replay"] > button,
  [data-overlays-stage="true"],
  [data-testid="console-panel"],
  [data-testid="anchor-cam-open"],
  [data-testid="anchor-cam-swap"],
  [data-testid="anchor-cam-expand"],
  [data-testid="anchor-cam-fold"],
  [data-testid="stage-hover-readout"] { display: none !important; }
  [data-testid="case-replay"] > div:has(> div > [data-testid="replay-anchor-status"]) { top: 16px !important; }
`;

// Runs in the page before its scripts: turns the viewer's lookdev hook on for the 3D canvas as soon as it is inserted,
// so its first frame writes the subjects' scene positions (data-subjects) the camera path is planned from.
function markLookdevCanvas() {
  const mark = () => {
    for (const canvas of document.querySelectorAll("canvas[data-renderer]")) {
      if (canvas instanceof HTMLCanvasElement && canvas.dataset.lookdev === undefined) canvas.dataset.lookdev = "on";
    }
  };
  new MutationObserver(mark).observe(document, { subtree: true, childList: true });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNamedSubject(value: unknown): value is NamedSubject {
  if (typeof value !== "object" || value === null) return false;
  const name: unknown = Reflect.get(value, "name");
  const scene: unknown = Reflect.get(value, "scene");
  return typeof name === "string" && Array.isArray(scene) && scene.length === 3 && scene.every((coordinate) => typeof coordinate === "number");
}

function readVector(value: unknown): THREE.Vector3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [pointX, pointY, pointZ]: unknown[] = value;
  return typeof pointX === "number" && typeof pointY === "number" && typeof pointZ === "number" ? new THREE.Vector3(pointX, pointY, pointZ) : null;
}

/** Parses the viewer's `data-camera-pose` hook (viewer.ts, recordStoryboardHooks); null when absent or malformed. */
function parseCameraPose(text: string): CameraPose | null {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) return null;
  const position = readVector(Reflect.get(parsed, "position"));
  const target = readVector(Reflect.get(parsed, "target"));
  const fovDegrees: unknown = Reflect.get(parsed, "fovDegrees");
  return position && target && typeof fovDegrees === "number" ? { position, target, fovDegrees } : null;
}

/** The console page at one layout, with what a capture needs: frames, screenshots and the subjects. */
export type ConsolePage = {
  page: Page;
  /** The subjects as the last drawn frame placed them. */
  readSubjects: () => Promise<NamedSubject[]>;
  /** The overview camera's pose on the last drawn frame (the viewer's `data-camera-pose` hook); null before one. */
  readCameraPose: () => Promise<CameraPose | null>;
  /** The canvas size in CSS px. */
  readCanvasSize: () => Promise<{ widthPx: number; heightPx: number }>;
  /** Draws the replay at `atMs` from `pose` (null: the view's own camera), with the console's clock on that minute. */
  drawFrame: (atMs: number, pose: CameraPose | null) => Promise<Result<null>>;
  /** Screenshots the window: the scene with the stage overlays. */
  takeScreenshot: () => Promise<Buffer>;
  close: () => Promise<void>;
};

/** The minute `atMs` falls in, as the console's URL writes it (`2024-12-25T16:44Z`). */
function formatUrlMinute(atMs: number): string {
  return `${new Date(Math.floor(atMs / MS_PER_MINUTE) * MS_PER_MINUTE).toISOString().slice(0, 16)}Z`;
}

/**
 * Opens `/cases/<slug>` on `view` at the minute of `openAtMs`, signed in, lays the stage over the whole window and
 * waits until the 3D view has loaded everything, warmed up and stopped drawing.
 */
export async function openConsolePage(input: {
  context: BrowserContext;
  baseUrl: string;
  caseSlug: string;
  /** The case's replay window start: the scrubber's minute 0. */
  windowStartMs: number;
  view: "overview" | "vessel" | "closeup";
  openAtMs: number;
  expectedRenderer: string;
}): Promise<Result<ConsolePage>> {
  const { context, baseUrl, caseSlug, windowStartMs, view, openAtMs, expectedRenderer } = input;
  await context.addInitScript(markLookdevCanvas);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[openConsolePage] page error: ${error.message}`));
  try {
    await page.goto(`${baseUrl}/cases/${caseSlug}?t=${formatUrlMinute(openAtMs)}&view=${view}`, { waitUntil: "load", timeout: LOAD_TIMEOUT_MS });
    await page.waitForSelector('[data-testid="seabed-view"][data-state="ready"]', { timeout: LOAD_TIMEOUT_MS });
    await page.addStyleTag({ content: STAGE_ONLY_CSS });
    await page.waitForFunction(
      (expectedView) => {
        const canvas = document.querySelector("canvas[data-renderer]");
        return canvas instanceof HTMLCanvasElement && (canvas.dataset.pendingAssets ?? "0") === "0" && canvas.dataset.drawnView === expectedView;
      },
      view,
      { timeout: LOAD_TIMEOUT_MS, polling: 100 },
    );
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(WARM_UP_WAIT_MS);
    await waitForStillCanvas(page);
    const renderer = await page.evaluate(() => document.querySelector("canvas[data-renderer]")?.getAttribute("data-renderer") ?? "none");
    if (renderer !== expectedRenderer) {
      await page.close();
      return { ok: false, reason: `the page drew on the ${renderer} tier, not ${expectedRenderer}` };
    }
  } catch (error) {
    await page.close();
    return { ok: false, reason: `the console did not load: ${describeError(error)}` };
  }
  return {
    ok: true,
    value: {
      page,
      readSubjects: async () => {
        const text = await page.evaluate(() => document.querySelector("canvas[data-renderer]")?.getAttribute("data-subjects") ?? "[]");
        const parsed: unknown = JSON.parse(text);
        return Array.isArray(parsed) ? parsed.filter(isNamedSubject) : [];
      },
      readCameraPose: async () => parseCameraPose(await page.evaluate(() => document.querySelector("canvas[data-renderer]")?.getAttribute("data-camera-pose") ?? "null")),
      readCanvasSize: () =>
        page.evaluate(() => {
          const canvas = document.querySelector("canvas[data-renderer]");
          return { widthPx: canvas?.clientWidth ?? 0, heightPx: canvas?.clientHeight ?? 0 };
        }),
      drawFrame: (atMs, pose) => drawConsoleFrame(page, windowStartMs, atMs, pose),
      takeScreenshot: () => page.screenshot({ animations: "disabled", caret: "hide" }),
      close: () => page.close(),
    },
  };
}

/** Waits until the canvas has drawn no new frame for SETTLE_MS. */
async function waitForStillCanvas(page: Page) {
  await page.waitForFunction(
    (settleMs) => {
      const count = document.querySelector("canvas[data-renderer]")?.getAttribute("data-frame-count") ?? "";
      const seenCount: unknown = Reflect.get(window, "footageSeenCount");
      const seenSinceMs: unknown = Reflect.get(window, "footageSeenSinceMs");
      if (seenCount !== count || typeof seenSinceMs !== "number") {
        Reflect.set(window, "footageSeenCount", count);
        Reflect.set(window, "footageSeenSinceMs", performance.now());
        return false;
      }
      return performance.now() - seenSinceMs >= settleMs;
    },
    SETTLE_MS,
    { timeout: LOAD_TIMEOUT_MS, polling: 100 },
  );
}

/**
 * Moves the console's clock to the frame's minute (its scrubber steps whole minutes), sets the time and camera
 * overrides, and waits for the frame that draws them plus two animation frames, so the labels, the anchor cam and the
 * overlays React re-rendered are on screen when the screenshot is taken.
 */
async function drawConsoleFrame(page: Page, windowStartMs: number, atMs: number, pose: CameraPose | null): Promise<Result<null>> {
  const poseJson = pose ? JSON.stringify({ position: pose.position.toArray(), target: pose.target.toArray(), fovDegrees: pose.fovDegrees }) : null;
  try {
    const startCount = await page.evaluate(
      ({ frameAtMs, cameraJson, msPerMinute, startMs }) => {
        const canvas = document.querySelector("canvas[data-renderer]");
        const scrubber = document.querySelector('[data-testid="replay-scrubber"]');
        if (!(canvas instanceof HTMLCanvasElement) || !(scrubber instanceof HTMLInputElement)) return null;
        const minutesFromStart = Math.floor((frameAtMs - startMs) / msPerMinute);
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (minutesFromStart >= 0 && valueSetter && scrubber.value !== String(minutesFromStart)) {
          valueSetter.call(scrubber, String(minutesFromStart));
          scrubber.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const count = Number(canvas.dataset.frameCount ?? "0");
        if (cameraJson === null) delete canvas.dataset.cameraOverride;
        else canvas.dataset.cameraOverride = cameraJson;
        canvas.dataset.timeOverride = String(frameAtMs);
        return count;
      },
      { frameAtMs: atMs, cameraJson: poseJson, msPerMinute: MS_PER_MINUTE, startMs: windowStartMs },
    );
    if (startCount === null) return { ok: false, reason: "the page has no 3D canvas or scrubber" };
    await page.waitForFunction(
      ({ frameAtMs, previousCount }) => {
        const canvas = document.querySelector("canvas[data-renderer]");
        return canvas instanceof HTMLCanvasElement && Number(canvas.dataset.frameCount) > previousCount && Number(canvas.dataset.drawnAtMs) === Math.round(frameAtMs);
      },
      { frameAtMs: atMs, previousCount: startCount },
      { timeout: FRAME_TIMEOUT_MS, polling: "raf" },
    );
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    return { ok: true, value: null };
  } catch (error) {
    return { ok: false, reason: `the frame at ${new Date(atMs).toISOString()} was not drawn: ${describeError(error)}` };
  }
}

/** A browser context for a capture: the layout, reduced motion (the viewer's calm, deterministic scene) and the session. */
export function describeContextOptions(layout: PageLayout, signedIn: SignedInState) {
  return { viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: layout.deviceScaleFactor, reducedMotion: "reduce" as const, storageState: signedIn };
}
