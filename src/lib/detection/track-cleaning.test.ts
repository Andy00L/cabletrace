import { describe, expect, test } from "bun:test";
import type { TrackPoint } from "./detection-types";
import { sailLegs, steadySpeed } from "./synthetic-tracks";
import { MAX_REPORT_GAP_MS, cleanTrack } from "./track-cleaning";

const START = { longitude: 25, latitude: 59.9 };
const START_MS = Date.parse("2026-10-01T06:00:00Z");

function passage(minutes: number): TrackPoint[] {
  return sailLegs(START, START_MS, [{ minutes, speedKnots: steadySpeed(10), courseDegrees: 90, headingOffsetDegrees: 0, navigationStatus: 0 }]);
}

describe("cleanTrack", () => {
  test("drops malformed and duplicate-time reports and sorts the rest", () => {
    const track = passage(10);
    const [first, second] = track;
    if (!first || !second) throw new Error("passage too short");
    const messy = [second, { ...first, latitude: Number.NaN }, first, { ...first, longitude: 200 }, { ...second }, ...track.slice(2)];
    const clean = cleanTrack(messy);
    expect(clean.points).toHaveLength(10);
    expect(clean.points.map((point) => point.atMs)).toEqual(track.map((point) => point.atMs));
  });

  test("a single spoofed position is removed and shown as a position-jump gap", () => {
    const track = passage(30);
    const spoofed = track.map((point, minute) => (minute === 15 ? { ...point, latitude: point.latitude + 0.3 } : point));
    const clean = cleanTrack(spoofed);
    expect(clean.points).toHaveLength(29);
    expect(clean.gaps).toEqual([{ fromMs: START_MS + 14 * 60_000, toMs: START_MS + 16 * 60_000, cause: "position-jump" }]);
  });

  test("three agreeing reports after a jump are accepted as the ship's real position", () => {
    const before = passage(10);
    const after = sailLegs({ longitude: 26, latitude: 59.9 }, START_MS + 10 * 60_000, [
      { minutes: 10, speedKnots: steadySpeed(10), courseDegrees: 90, headingOffsetDegrees: 0, navigationStatus: 0 },
    ]);
    const clean = cleanTrack([...before, ...after]);
    expect(clean.points).toHaveLength(20);
    expect(clean.gaps.map((gap) => gap.cause)).toEqual(["position-jump"]);
  });

  test("a silence longer than the report gap is listed as a silence gap", () => {
    const track = passage(60);
    const withSilence = track.filter((point) => point.atMs < START_MS + 20 * 60_000 || point.atMs > START_MS + 20 * 60_000 + MAX_REPORT_GAP_MS);
    const clean = cleanTrack(withSilence);
    expect(clean.gaps).toHaveLength(1);
    expect(clean.gaps[0]?.cause).toBe("silence");
    expect((clean.gaps[0]?.toMs ?? 0) - (clean.gaps[0]?.fromMs ?? 0)).toBeGreaterThan(MAX_REPORT_GAP_MS);
  });
});
