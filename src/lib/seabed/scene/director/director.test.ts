import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { easeStandard, SHOT_FLIGHT_MS } from "@/lib/seabed/scene/director/camera-moves";
import { CLOSE_UP_ORBIT_DEGREES_PER_SECOND, CLOSE_UP_STILL_DEGREES, createShotDirector, type DirectorFrame } from "@/lib/seabed/scene/director/director";
import type { ShotList } from "@/lib/seabed/scene/director/shots";

// Three shots on a made-up clock: establishing to 100, follow to 200, the cut's close-up to 300.
const SHOTS: ShotList = [
  { kind: "establishing", startMs: 0, endMs: 100 },
  { kind: "follow", startMs: 100, endMs: 200 },
  { kind: "cut", cutIndex: 0, startMs: 200, endMs: 300 },
];
const USER_POSE = { position: new THREE.Vector3(0, 80, 80), target: new THREE.Vector3(0, 0, 0), fovDegrees: 32 };

function createFrame(atMs: number, nowMs: number): DirectorFrame {
  return {
    atMs,
    nowMs,
    subjects: {
      vessel: { position: new THREE.Vector3(10, 0, 0), heading: new THREE.Vector3(1, 0, 0), drawnLengthKm: 1.37 },
      anchor: { position: new THREE.Vector3(9.7, -1.5, 0), hawse: new THREE.Vector3(10.5, 0, 0), chainMiddle: new THREE.Vector3(10.1, -0.8, 0) },
      cutPoints: [new THREE.Vector3(30, -1.5, 0)],
      trackPoints: [new THREE.Vector3(10, 0, 0), new THREE.Vector3(30, 0, 0)],
    },
    canvas: { widthPx: 1408, heightPx: 602 },
    safeArea: { left: 72, top: 0, right: 1048, bottom: 530 },
    fovDegrees: 32,
    currentPose: USER_POSE,
    isHidden: () => false,
  };
}

describe("createShotDirector", () => {
  test("starts on its shot with a cut, then flies to the next shot on ease-standard", () => {
    const director = createShotDirector({ shots: SHOTS, prefersReducedMotion: false });
    const first = director.update(createFrame(50, 0));
    expect(first.shot.kind).toBe("establishing");
    expect(first.view).toBe("overview");
    const establishingPose = first.pose;
    if (!establishingPose) throw new Error("no establishing pose");

    // The follow shot starts at 1000 ms of wall time; the flight leaves from the camera as drawn.
    const leaving = director.update({ ...createFrame(150, 1000), currentPose: establishingPose });
    expect(leaving.shot.kind).toBe("follow");
    expect(leaving.pose?.position.distanceTo(establishingPose.position)).toBeCloseTo(0, 6);

    const arrived = director.update({ ...createFrame(150, 1000 + SHOT_FLIGHT_MS), currentPose: establishingPose });
    const halfway = director.update({ ...createFrame(150, 1000 + SHOT_FLIGHT_MS / 2), currentPose: establishingPose });
    if (!arrived.pose || !halfway.pose) throw new Error("no follow pose");
    const travelled = halfway.pose.position.distanceTo(establishingPose.position) / arrived.pose.position.distanceTo(establishingPose.position);
    expect(travelled).toBeCloseTo(easeStandard(0.5), 2);
  });

  test("cuts into the close-up and orbits it slowly, still under reduced motion", () => {
    const director = createShotDirector({ shots: SHOTS, prefersReducedMotion: false });
    director.update(createFrame(150, 0));
    const entering = director.update(createFrame(250, 2000));
    expect(entering).toMatchObject({ view: "closeup", pose: null, closeUpOrbitDegrees: 0 });
    expect(director.update(createFrame(250, 3000)).closeUpOrbitDegrees).toBeCloseTo(CLOSE_UP_ORBIT_DEGREES_PER_SECOND, 6);

    const calmDirector = createShotDirector({ shots: SHOTS, prefersReducedMotion: true });
    expect(calmDirector.update(createFrame(250, 0)).closeUpOrbitDegrees).toBe(CLOSE_UP_STILL_DEGREES);
    expect(calmDirector.update(createFrame(250, 5000)).closeUpOrbitDegrees).toBe(CLOSE_UP_STILL_DEGREES);
  });

  test("cuts between shots under reduced motion", () => {
    const director = createShotDirector({ shots: SHOTS, prefersReducedMotion: true });
    director.update(createFrame(50, 0));
    const followPose = director.update(createFrame(150, 1000)).pose;
    const settled = director.update(createFrame(150, 1000 + SHOT_FLIGHT_MS)).pose;
    expect(followPose?.position.distanceTo(settled?.position ?? new THREE.Vector3())).toBeCloseTo(0, 6);
  });

  test("flies back from wherever the user left the camera when it resumes", () => {
    const director = createShotDirector({ shots: SHOTS, prefersReducedMotion: false });
    director.update(createFrame(150, 0));
    director.resume();
    const resumed = director.update(createFrame(150, 5000));
    expect(resumed.pose?.position.distanceTo(USER_POSE.position)).toBeCloseTo(0, 6);
    const settled = director.update(createFrame(150, 5000 + SHOT_FLIGHT_MS));
    expect(settled.pose?.position.distanceTo(USER_POSE.position)).toBeGreaterThan(1);
  });
});
