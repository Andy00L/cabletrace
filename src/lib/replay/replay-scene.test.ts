import { describe, expect, test } from "bun:test";
import { positionAtTime, progressToTimeMs, timeMsToProgress } from "./replay-scene";

const WINDOW = { windowStartMs: 1_000, windowEndMs: 5_000 };
const TRACK = [
  { atMs: 2_000, longitude: 26, latitude: 60 },
  { atMs: 4_000, longitude: 25, latitude: 59.8 },
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
