// Captures the Eagle S time-lapse frame by frame for one crop, in both looks, into PNG files: every frame draws its own
// replay moment and camera pose (console-page.ts), so the video is smooth whatever the render speed.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser } from "playwright";
import * as THREE from "three";
import { EAGLE_S_2024 } from "../../src/data/cases/eagle-s-2024";
import { toReplaySceneInput } from "../../src/lib/cases/case-file";
import { findReplayTimeForVideoSeconds, type FootageCrop, type ReplayFootage } from "../../src/lib/landing/replay-footage";
import { positionAtTime } from "../../src/lib/replay/replay-scene";
import type { Result } from "../../src/lib/result";
import type { SafeArea } from "../../src/lib/seabed/scene/director/viewer-port";
import type { SignedInState } from "../lookdev/tier-launch";
import { planCameraMove, type CameraMove } from "./camera-path";
import { describeContextOptions, openConsolePage, type NamedSubject, type PageLayout } from "./console-page";


/** How one crop is rendered: the page layout whose screenshot is the crop, and the camera's move. */
type CropCapture = { layout: PageLayout; move: CameraMove; readSafeArea: (canvas: { widthPx: number; heightPx: number }) => SafeArea };

// Desktop: a 1,280 x 800 window at 1.25 device pixels, 1,600 x 1,000; the labels and the pill keep the size they have
// in a laptop's console. The camera opens on the console's own overview (the whole seabed block from the south-south-
// east), turns to the south-west while the ship crosses and, from 12:06, pushes in with the ship, ending on the ship
// and the C-Lion1 cut, the drag running back up the frame toward Estlink 2.
// Phone: a 450 x 563 window at 2 device pixels (900 x 1,126, cut to 1,124), the console's phone layout and labels. The
// camera stands west of the drag and looks along it, so the track runs down the tall frame toward the cut and the ship
// sails at the viewer. Looking east, away from the scene's sun, keeps its glint on the water out of the frame (looking
// west it sat in the middle of the picture).
// The safe area keeps the subjects clear of the pill's band (72 px from the top, StageOverlays) and of the edges.
const CROP_CAPTURES: Readonly<Record<FootageCrop, CropCapture>> = {
  desktop: {
    layout: { width: 1280, height: 800, deviceScaleFactor: 1.25 },
    move: {
      start: { kind: "overview" },
      end: { kind: "framed", subjectNames: ["C-Lion1 cut point", "vessel"], azimuthDegrees: 240, elevationDegrees: 42, fovDegrees: 32, pullBack: 5 },
      pushDelayShare: 0.3,
    },
    readSafeArea: (canvas) => ({ left: 16, top: 72, right: canvas.widthPx - 16, bottom: canvas.heightPx - 16 }),
  },
  phone: {
    layout: { width: 450, height: 563, deviceScaleFactor: 2 },
    move: {
      start: { kind: "framed", subjectNames: ["Estlink 2 cut point", "C-Lion1 cut point", "track 0%", "track 50%", "track 90%"], azimuthDegrees: 275, elevationDegrees: 45, fovDegrees: 45, pullBack: 1.05 },
      end: { kind: "framed", subjectNames: ["C-Lion1 cut point", "vessel"], azimuthDegrees: 255, elevationDegrees: 50, fovDegrees: 45, pullBack: 12 },
      pushDelayShare: 0.4,
    },
    readSafeArea: (canvas) => ({ left: 16, top: 72, right: canvas.widthPx - 16, bottom: canvas.heightPx - 16 }),
  },
};

// The followed ship point is averaged over this many replay minutes either side (triangle weights), so the camera
// eases through the track's turns (16:44 at C-Lion1, where the ship slows from 13 to 1.4 km/h) instead of jerking.
const FOCUS_SMOOTHING_MINUTES = 30;
const MS_PER_MINUTE = 60_000;

/**
 * The ship's drawn position (scene km) at any share of the time-lapse, smoothed: the case's placed positions,
 * interpolated as the replay does (positionAtTime), carried into the scene by the affine map the two cut points give
 * (the overview's projection is linear in longitude and latitude, terrain.ts). Before the first position the ship's
 * first point stands in.
 */
function buildShipFocus(subjects: readonly NamedSubject[], footage: ReplayFootage): Result<(share: number) => THREE.Vector3> {
  const sceneInput = toReplaySceneInput(EAGLE_S_2024);
  const firstCut = sceneInput.cuts[0];
  const lastCut = sceneInput.cuts[sceneInput.cuts.length - 1] ?? firstCut;
  const firstPoint = subjects.find((subject) => subject.name === `${firstCut.label} cut point`);
  const lastPoint = subjects.find((subject) => subject.name === `${lastCut.label} cut point`);
  if (!firstPoint || !lastPoint || firstCut.longitude === lastCut.longitude || firstCut.latitude === lastCut.latitude) return { ok: false, reason: "two cut points at distinct places are needed to place the ship" };
  const kmPerLongitude = (lastPoint.scene[0] - firstPoint.scene[0]) / (lastCut.longitude - firstCut.longitude);
  const kmPerLatitude = (lastPoint.scene[2] - firstPoint.scene[2]) / (lastCut.latitude - firstCut.latitude);
  const firstPosition = sceneInput.track[0];
  if (!firstPosition) return { ok: false, reason: "the case has no track" };
  const readShipPoint = (atMs: number) => {
    const position = positionAtTime(sceneInput.track, atMs) ?? firstPosition;
    return new THREE.Vector3(firstPoint.scene[0] + (position.longitude - firstCut.longitude) * kmPerLongitude, 0, firstPoint.scene[2] + (position.latitude - firstCut.latitude) * kmPerLatitude);
  };
  return {
    ok: true,
    value: (share) => {
      const atMs = footage.replayStartMs + share * (footage.replayEndMs - footage.replayStartMs);
      const sum = new THREE.Vector3();
      let weightSum = 0;
      for (let offset = -FOCUS_SMOOTHING_MINUTES; offset <= FOCUS_SMOOTHING_MINUTES; offset += 1) {
        const weight = FOCUS_SMOOTHING_MINUTES + 1 - Math.abs(offset);
        sum.addScaledVector(readShipPoint(atMs + offset * MS_PER_MINUTE), weight);
        weightSum += weight;
      }
      return sum.divideScalar(weightSum);
    },
  };
}

/** One frame's file in a crop's frame folder. */
export function findFramePath(framesDirectory: string, frameIndex: number): string {
  return path.join(framesDirectory, `frame-${String(frameIndex).padStart(5, "0")}.png`);
}

/** The frames of the whole video, the held end included: each frame's video time, replay moment and camera share. */
export function listFootageFrames(footage: ReplayFootage): { videoSeconds: number; atMs: number; share: number }[] {
  const frameCount = Math.round(footage.durationSeconds * footage.framesPerSecond);
  const lapseSeconds = footage.durationSeconds - footage.holdSeconds;
  return Array.from({ length: frameCount }, (_slot, frameIndex) => {
    const videoSeconds = frameIndex / footage.framesPerSecond;
    return { videoSeconds, atMs: Math.round(findReplayTimeForVideoSeconds(footage, videoSeconds)), share: Math.min(1, videoSeconds / lapseSeconds) };
  });
}

/**
 * Renders every frame of `crop` (or, with `previewShares`, only the frames nearest those shares of the time-lapse) into
 * `<framesDirectory>/frame-NNNNN.png`. A frame whose moment and pose repeat the one before (the held end) is a
 * copy of it. Returns the frame count written.
 */
export async function captureReplayCrop(input: {
  browser: Browser;
  signedIn: SignedInState;
  baseUrl: string;
  footage: ReplayFootage;
  windowStartMs: number;
  crop: FootageCrop;
  framesDirectory: string;
  previewShares: readonly number[] | null;
}): Promise<Result<number>> {
  const { browser, signedIn, baseUrl, footage, windowStartMs, crop, framesDirectory, previewShares } = input;
  const capture = CROP_CAPTURES[crop];
  const context = await browser.newContext(describeContextOptions(capture.layout, signedIn));
  try {
    // Opened on the last moment, so the subjects include the ship where the move ends.
    const opened = await openConsolePage({ context, baseUrl, caseSlug: footage.caseSlug, windowStartMs, view: "overview", openAtMs: footage.replayEndMs, expectedRenderer: "hardware" });
    if (!opened.ok) return opened;
    const consolePage = opened.value;
    const subjects = await consolePage.readSubjects();
    const canvas = await consolePage.readCanvasSize();
    const overviewPose = await consolePage.readCameraPose();
    if (!overviewPose) return { ok: false, reason: "the viewer reported no camera pose" };
    // The subjects are read; the colour probes the hook writes on every frame would only slow the capture.
    await consolePage.page.evaluate(() => document.querySelector("canvas[data-renderer]")?.setAttribute("data-lookdev", "off"));
    const shipFocus = buildShipFocus(subjects, footage);
    if (!shipFocus.ok) return shipFocus;
    const planned = planCameraMove({ move: capture.move, subjects, overviewPose, canvas, safeArea: capture.readSafeArea(canvas), readFocus: shipFocus.value });
    if (!planned.ok) return planned;
    const readPose = planned.value;
    rmSync(framesDirectory, { recursive: true, force: true });
    mkdirSync(framesDirectory, { recursive: true });
    const allFrames = listFootageFrames(footage);
    const frames = previewShares
      ? previewShares.map((share) => allFrames.reduce((nearest, frame) => (Math.abs(frame.share - share) < Math.abs(nearest.share - share) ? frame : nearest)))
      : allFrames;
    const startedAt = performance.now();
    let previous: { atMs: number; share: number; index: number } | null = null;
    for (const [index, frame] of frames.entries()) {
      if (previous && previous.atMs === frame.atMs && previous.share === frame.share) {
        copyFileSync(findFramePath(framesDirectory, previous.index), findFramePath(framesDirectory, index));
        continue;
      }
      const drawn = await consolePage.drawFrame(frame.atMs, readPose(frame.share));
      if (!drawn.ok) return drawn;
      writeFileSync(findFramePath(framesDirectory, index), await consolePage.takeScreenshot());
      previous = { atMs: frame.atMs, share: frame.share, index };
      if (index % 60 === 0) console.log(`[captureReplayCrop] ${crop}: frame ${index} of ${frames.length}, ${new Date(frame.atMs).toISOString().slice(11, 19)} UTC, ${((performance.now() - startedAt) / 1000).toFixed(0)} s`);
    }
    await consolePage.close();
    return { ok: true, value: frames.length };
  } finally {
    await context.close();
  }
}
