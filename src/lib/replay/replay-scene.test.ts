import { describe, expect, test } from "bun:test";
import { describeVesselPosition, findHeldStretch, positionAtTime, progressToTimeMs, timeMsToProgress } from "./replay-scene";

const WINDOW = { windowStartMs: 1_000, windowEndMs: 5_000 };
const TRACK = [
  { atMs: 2_000, longitude: 26, latitude: 60, recordedSpeedKnots: null },
  { atMs: 4_000, longitude: 25, latitude: 59.8, recordedSpeedKnots: null },
];

describe("progress and time", () => {
  test("map both ways across the window and clamp outside it", () => {
    expect(progressToTimeMs(WINDOW, 0.5)).toBe(3_000);
    expect(timeMsToProgress(WINDOW, 3_000)).toBe(0.5);
    expect(timeMsToProgress(WINDOW, 9_000)).toBe(1);
    expect(timeMsToProgress({ windowStartMs: 5, windowEndMs: 5 }, 5)).toBe(0);
  });
});

describe("positionAtTime", () => {
  test("hides the vessel before its first published position", () => {
    expect(positionAtTime(TRACK, 1_500)).toBeNull();
    expect(positionAtTime([], 1_500)).toBeNull();
  });

  test("interpolates between published positions and holds the last one", () => {
    const halfway = positionAtTime(TRACK, 3_000);
    expect(halfway?.longitude).toBeCloseTo(25.5, 6);
    expect(halfway?.latitude).toBeCloseTo(59.9, 6);
    expect(positionAtTime(TRACK, 9_000)).toEqual({ longitude: 25, latitude: 59.8 });
  });
});

describe("describeVesselPosition", () => {
  // A reconstructed stretch that hands over to two recorded AIS positions.
  const MIXED = [
    { atMs: 1_000, longitude: 18, latitude: 56.5, recordedSpeedKnots: null },
    { atMs: 2_000, longitude: 17, latitude: 56, recordedSpeedKnots: 7.3 },
    { atMs: 3_000, longitude: 16.5, latitude: 55.9, recordedSpeedKnots: 10.4 },
  ];

  test("labels a stretch reconstructed when either end was placed from statements", () => {
    expect(describeVesselPosition(MIXED, 1_500)).toBe("reconstructed position");
    expect(describeVesselPosition(TRACK, 3_000)).toBe("reconstructed position");
  });

  test("gives the recorded speed between two AIS positions and after the last one", () => {
    expect(describeVesselPosition(MIXED, 2_000)).toBe("AIS position, 7.3 knots");
    expect(describeVesselPosition(MIXED, 2_500)).toBe("AIS position, 7.3 knots");
    expect(describeVesselPosition(MIXED, 9_000)).toBe("AIS position, 10.4 knots");
  });
});

describe("findHeldStretch", () => {
  // Under way, then three placed positions on one point (as Hong Tai 58 waits in its area), then under way again.
  const WAITING = [
    { atMs: 1_000, longitude: 120, latitude: 25, recordedSpeedKnots: null },
    { atMs: 2_000, longitude: 121, latitude: 25, recordedSpeedKnots: null },
    { atMs: 3_000, longitude: 121, latitude: 25, recordedSpeedKnots: null },
    { atMs: 4_000, longitude: 121, latitude: 25, recordedSpeedKnots: null },
    { atMs: 5_000, longitude: 122, latitude: 25, recordedSpeedKnots: null },
  ];

  test("spans the whole run of positions on one point, ends included", () => {
    const run = { fromMs: 2_000, toMs: 4_000, firstIndex: 1, lastIndex: 3 };
    expect(findHeldStretch(WAITING, 2_000)).toEqual(run);
    expect(findHeldStretch(WAITING, 3_500)).toEqual(run);
    expect(findHeldStretch(WAITING, 4_000)).toEqual(run);
  });

  test("is null while the ship moves, and before or after the track, where no positions bound the moment", () => {
    expect(findHeldStretch(WAITING, 1_500)).toBeNull();
    expect(findHeldStretch(WAITING, 4_500)).toBeNull();
    expect(findHeldStretch(WAITING, 500)).toBeNull();
    expect(findHeldStretch(WAITING, 9_000)).toBeNull();
    expect(findHeldStretch([], 1_000)).toBeNull();
  });

  test("labels the still ship in the 3D view", () => {
    expect(describeVesselPosition(WAITING, 3_500)).toBe("reconstructed, held at one point");
    expect(describeVesselPosition(WAITING, 1_500)).toBe("reconstructed position");
  });
});
