import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createCameraDriver } from "@/lib/seabed/scene/director/camera-driver";
import type { ShotList } from "@/lib/seabed/scene/director/shots";
import type { CameraPose, DirectorViewerPort, SecondView, ViewerFrame } from "@/lib/seabed/scene/director/viewer-port";

const SHOTS: ShotList = [
  { kind: "establishing", startMs: 0, endMs: 100 },
  { kind: "follow", startMs: 100, endMs: 200 },
  { kind: "cut", cutIndex: 0, startMs: 200, endMs: 300 },
];

/** A viewer port that records what the driver asks of it, with one ship, its anchor and a cut. */
function createFakePort() {
  const calls: { poses: (CameraPose | null)[]; orbits: (number | null)[]; secondViews: (SecondView | null)[]; directions: (string | null)[] } = { poses: [], orbits: [], secondViews: [], directions: [] };
  let frameListener: ((frame: ViewerFrame) => void) | null = null;
  const port: DirectorViewerPort = {
    readSubjects: () => ({
      vessel: { position: new THREE.Vector3(10, 0, 0), heading: new THREE.Vector3(1, 0, 0), drawnLengthKm: 1.37 },
      anchor: { position: new THREE.Vector3(9.7, -1.5, 0), hawse: new THREE.Vector3(10.5, 0, 0), chainMiddle: new THREE.Vector3(10.1, -0.8, 0) },
      cutPoints: [new THREE.Vector3(30, -1.5, 0)],
      trackPoints: [new THREE.Vector3(10, 0, 0), new THREE.Vector3(30, 0, 0)],
    }),
    isHiddenByRelief: () => false,
    projectToCanvas: () => ({ x: 0, y: 0, isInFront: true }),
    readCanvasSize: () => ({ widthPx: 1408, heightPx: 602 }),
    readCameraPose: () => ({ position: new THREE.Vector3(0, 50, 50), target: new THREE.Vector3(), fovDegrees: 32 }),
    readOverviewFovDegrees: () => 32,
    setCameraPose: (pose) => calls.poses.push(pose),
    setCloseUpOrbit: (degrees) => calls.orbits.push(degrees),
    readAnchorFacts: () => null,
    setSecondView: (view) => calls.secondViews.push(view),
    onBeforeFrame(listener) {
      frameListener = listener;
      return () => {
        frameListener = null;
      };
    },
    readGroundAt: () => null,
    recordDirection: (direction) => calls.directions.push(direction ? `${direction.shotKind}: ${direction.subjectNames.join(", ")}` : null),
  };
  return { port, calls, drawFrame: (frame: ViewerFrame) => frameListener?.(frame), hasListener: () => frameListener !== null };
}

function createDriver(port: DirectorViewerPort) {
  return createCameraDriver({ port, shots: SHOTS, prefersReducedMotion: true, cutLabels: ["C-Lion1"], readSafeInsets: () => ({ left: 16, top: 72, right: 392, bottom: 72 }) });
}

describe("createCameraDriver", () => {
  test("leaves the camera alone until the director is handed it, then frames each shot", () => {
    const fake = createFakePort();
    const driver = createDriver(fake.port);
    fake.drawFrame({ atMs: 150, nowMs: 0 });
    expect(fake.calls.poses).toEqual([]);
    driver.setMode({ kind: "director" });
    fake.drawFrame({ atMs: 150, nowMs: 16 });
    expect(fake.calls.poses.at(-1)).not.toBeNull();
    expect(fake.calls.directions.at(-1)).toBe("follow: vessel, anchor");
    fake.drawFrame({ atMs: 250, nowMs: 32 });
    expect(fake.calls.poses.at(-1)).toBeNull();
    expect(fake.calls.orbits.at(-1)).toBe(35);
    expect(fake.calls.directions.at(-1)).toBe("cut: anchor, torn end west, torn end east");
  });

  test("puts the camera on the bridge or behind the anchor for the ship cameras, and hands it back for the user", () => {
    const fake = createFakePort();
    const driver = createDriver(fake.port);
    driver.setMode({ kind: "ship", camera: "bridge" });
    fake.drawFrame({ atMs: 150, nowMs: 0 });
    const bridgePose = fake.calls.poses.at(-1);
    expect(bridgePose?.position.x).toBeLessThan(10);
    expect(bridgePose?.target.x).toBeGreaterThan(10);
    driver.setMode({ kind: "ship", camera: "anchor" });
    fake.drawFrame({ atMs: 150, nowMs: 16 });
    expect(fake.calls.poses.at(-1)?.position.y).toBeLessThan(0);
    driver.setMode({ kind: "user" });
    expect(fake.calls.poses.at(-1)).toBeNull();
    expect(fake.calls.directions.at(-1)).toBeNull();
  });

  test("draws the anchor cam's second view only while its window is open, and the ship in it when swapped", () => {
    const fake = createFakePort();
    const driver = createDriver(fake.port);
    expect(fake.calls.secondViews).toEqual([]);
    // The window's canvas as the viewer reads it (viewer-port.ts, SecondViewCanvas); no page here.
    driver.setAnchorWindow({ canvas: { width: 0, height: 0, getContext: () => null }, widthPx: 360, heightPx: 225 });
    const opened = fake.calls.secondViews.at(-1);
    expect(opened?.readPose()?.position.y).toBeLessThan(0);
    driver.setMode({ kind: "ship", camera: "anchor" });
    expect(opened?.readPose()?.position.y).toBeGreaterThan(0);
    driver.setAnchorWindow(null);
    expect(fake.calls.secondViews.at(-1)).toBeNull();
    driver.dispose();
    expect(fake.hasListener()).toBe(false);
  });
});
