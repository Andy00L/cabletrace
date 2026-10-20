import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { azimuthOf, chooseLeastHiddenPose, directionFrom, fitCameraToPoints, FRAMING_MARGIN_PX, planShotFraming, poseAnchorCam, projectThroughPose } from "@/lib/seabed/scene/director/framing";
import type { DirectorSubjects, SafeArea } from "@/lib/seabed/scene/director/viewer-port";

// The board's stage: 1408 x 602 px, a 72 px band on the left and at the bottom, the 360 px card column on the right.
const CANVAS = { widthPx: 1408, heightPx: 602 };
const SAFE_AREA: SafeArea = { left: 72, top: 0, right: 1408 - 360, bottom: 602 - 72 };
const TRACK = [new THREE.Vector3(48, 0, -9), new THREE.Vector3(20, 0, -1), new THREE.Vector3(-28, 0, 2)];

function measureBox(points: readonly THREE.Vector3[], pose: NonNullable<ReturnType<typeof fitCameraToPoints>>) {
  const projected = points.map((point) => projectThroughPose(pose, CANVAS, point));
  const onCanvas = projected.filter((point): point is { x: number; y: number } => point !== null);
  return {
    count: onCanvas.length,
    left: Math.min(...onCanvas.map((point) => point.x)),
    right: Math.max(...onCanvas.map((point) => point.x)),
    top: Math.min(...onCanvas.map((point) => point.y)),
    bottom: Math.max(...onCanvas.map((point) => point.y)),
  };
}

describe("directionFrom and azimuthOf", () => {
  test("measure compass azimuths with x east and z south", () => {
    expect(azimuthOf(directionFrom(90, 30))).toBeCloseTo(90, 6);
    expect(azimuthOf(directionFrom(225, 40))).toBeCloseTo(225, 6);
    expect(directionFrom(0, 0).z).toBeCloseTo(-1, 6);
    expect(directionFrom(0, 90).y).toBeCloseTo(1, 6);
  });
});

describe("fitCameraToPoints", () => {
  test("keeps every point inside the safe area with the margin, and fills it on one axis", () => {
    const pose = fitCameraToPoints({ points: TRACK, direction: directionFrom(225, 40), fovDegrees: 32, canvas: CANVAS, safeArea: SAFE_AREA });
    if (!pose) throw new Error("no pose");
    const box = measureBox(TRACK, pose);
    expect(box.count).toBe(TRACK.length);
    expect(box.left).toBeGreaterThanOrEqual(SAFE_AREA.left + FRAMING_MARGIN_PX - 0.5);
    expect(box.right).toBeLessThanOrEqual(SAFE_AREA.right - FRAMING_MARGIN_PX + 0.5);
    expect(box.top).toBeGreaterThanOrEqual(SAFE_AREA.top + FRAMING_MARGIN_PX - 0.5);
    expect(box.bottom).toBeLessThanOrEqual(SAFE_AREA.bottom - FRAMING_MARGIN_PX + 0.5);
    const widthShare = (box.right - box.left) / (SAFE_AREA.right - SAFE_AREA.left - 2 * FRAMING_MARGIN_PX);
    const heightShare = (box.bottom - box.top) / (SAFE_AREA.bottom - SAFE_AREA.top - 2 * FRAMING_MARGIN_PX);
    expect(Math.max(widthShare, heightShare)).toBeGreaterThan(0.97);
  });

  test("centres the subjects' box in the safe area, not in the canvas", () => {
    const pose = fitCameraToPoints({ points: TRACK, direction: directionFrom(180, 75), fovDegrees: 32, canvas: CANVAS, safeArea: SAFE_AREA });
    if (!pose) throw new Error("no pose");
    const box = measureBox(TRACK, pose);
    expect((box.left + box.right) / 2).toBeCloseTo((SAFE_AREA.left + SAFE_AREA.right) / 2, 0);
    expect((box.top + box.bottom) / 2).toBeCloseTo((SAFE_AREA.top + SAFE_AREA.bottom) / 2, 0);
  });

  test("has nothing to frame without points or without a canvas", () => {
    expect(fitCameraToPoints({ points: [], direction: directionFrom(0, 45), fovDegrees: 32, canvas: CANVAS, safeArea: SAFE_AREA })).toBeNull();
    expect(fitCameraToPoints({ points: TRACK, direction: directionFrom(0, 45), fovDegrees: 32, canvas: { widthPx: 0, heightPx: 0 }, safeArea: SAFE_AREA })).toBeNull();
  });
});

describe("chooseLeastHiddenPose", () => {
  const framing = { points: TRACK, directions: [directionFrom(225, 40), directionFrom(45, 40)] };

  test("keeps the preferred angle when nothing is hidden", () => {
    const chosen = chooseLeastHiddenPose({ framing, fovDegrees: 32, canvas: CANVAS, safeArea: SAFE_AREA, isHidden: () => false });
    expect(chosen?.directionIndex).toBe(0);
    expect(chosen?.hiddenCount).toBe(0);
  });

  test("turns to the angle the relief hides least", () => {
    // A ridge on the south-west side hides the first track point from any camera standing west of the track.
    const isHidden = (point: THREE.Vector3, cameraPosition: THREE.Vector3) => point === TRACK[0] && cameraPosition.x < 0;
    const chosen = chooseLeastHiddenPose({ framing, fovDegrees: 32, canvas: CANVAS, safeArea: SAFE_AREA, isHidden });
    expect(chosen?.directionIndex).toBe(1);
    expect(chosen?.hiddenCount).toBe(0);
  });
});

describe("planShotFraming", () => {
  const vessel = { position: new THREE.Vector3(48, 0, -9), heading: new THREE.Vector3(-1, 0, 0), drawnLengthKm: 1.37 };
  const anchor = { position: new THREE.Vector3(48.3, -1.5, -9), hawse: new THREE.Vector3(47.4, 0, -9), chainMiddle: new THREE.Vector3(47.9, -0.9, -9) };
  const subjects: DirectorSubjects = { vessel, anchor, cutPoints: [new THREE.Vector3(48, -1.6, -9), new THREE.Vector3(-28, -1.2, 2)], trackPoints: TRACK };

  test("frames the ship from bow to stern with its chain and anchor while following", () => {
    const framing = planShotFraming({ kind: "follow", startMs: 0, endMs: 1 }, subjects);
    expect(framing?.points.length).toBe(7);
    // The preferred angle stands off the port quarter: the ship heads west (270), so the camera looks from 135, the south-east.
    expect(azimuthOf(framing?.directions[0] ?? new THREE.Vector3())).toBeCloseTo(135, 6);
  });

  test("frames the anchor, its chain and the approached cable's cut point on the approach", () => {
    const framing = planShotFraming({ kind: "approach", cutIndex: 1, startMs: 0, endMs: 1 }, subjects);
    expect(framing?.points.some((point) => point.equals(subjects.cutPoints[1] ?? new THREE.Vector3()))).toBe(true);
    expect(framing?.points.some((point) => point.equals(anchor.position))).toBe(true);
  });

  test("leaves the close-up its own camera, and falls back to the whole story before the ship is drawn", () => {
    expect(planShotFraming({ kind: "cut", cutIndex: 0, startMs: 0, endMs: 1 }, subjects)).toBeNull();
    const framing = planShotFraming({ kind: "follow", startMs: 0, endMs: 1 }, { ...subjects, vessel: null, anchor: null });
    expect(framing?.points.length).toBe(TRACK.length + subjects.cutPoints.length);
  });
});

describe("poseAnchorCam", () => {
  test("stands behind the anchor along the drag and looks past it", () => {
    const anchor = { position: new THREE.Vector3(0, -1.5, 0), hawse: new THREE.Vector3(-0.3, 0, 0), chainMiddle: new THREE.Vector3(-0.15, -0.8, 0) };
    const pose = poseAnchorCam(anchor);
    expect(pose.position.x).toBeGreaterThan(anchor.position.x);
    expect(pose.position.y).toBeGreaterThan(anchor.position.y);
    expect(pose.target.x).toBeLessThan(anchor.position.x);
  });
});
