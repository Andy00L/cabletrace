import { describe, expect, test } from "bun:test";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { SeabedData } from "@/lib/seabed/seabed-data";
import { buildCaseSketch, SKETCH_HEIGHT, SKETCH_WIDTH } from "./case-sketch";

// Test fixture only: a 1 by 1 degree block, land in its north-west quarter, one cable across it.
const GRID = { width: 11, height: 11 };
const SEABED: SeabedData = {
  features: {
    region: { west: 20, east: 21, south: 56, north: 57 },
    grid: GRID,
    lines: [{ name: "Cable", kind: "telecom", points: [[20, 56.5], [21, 56.5]] }],
    places: [],
    sources: { depth: "d", land: "l", cables: "c", pipelines: "p" },
  },
  elevations: Float32Array.from({ length: GRID.width * GRID.height }, (_slot, index) => (index % GRID.width < 5 && index < GRID.width * 5 ? 10 : -30)),
};
const INPUT: ReplaySceneInput = {
  seabedArea: "fixture",
  windowStartMs: 0,
  windowEndMs: 4_000,
  track: [
    { atMs: 1_000, longitude: 20.3, latitude: 56.7, recordedSpeedKnots: null },
    { atMs: 3_000, longitude: 20.7, latitude: 56.3, recordedSpeedKnots: 7.3 },
  ],
  dragWindow: { startMs: 0, endMs: 2_000 },
  cuts: [{ cableName: "Cable", label: "Cable", atMs: 2_000, longitude: 20.5, latitude: 56.5 }],
  vessel: { name: "Vessel", kind: "tanker", lengthMetres: 200 },
};

describe("buildCaseSketch", () => {
  test("frames the track and the cuts inside the sketch", () => {
    const sketch = buildCaseSketch(SEABED, INPUT);
    const [cut] = sketch.cuts;
    expect(cut?.x).toBeGreaterThan(0);
    expect(cut?.x).toBeLessThan(SKETCH_WIDTH);
    expect(cut?.y).toBeGreaterThan(0);
    expect(cut?.y).toBeLessThan(SKETCH_HEIGHT);
    expect(sketch.landPath.length).toBeGreaterThan(0);
    expect(sketch.lines).toHaveLength(1);
  });

  test("draws the drag stretch from the first position to the interpolated end of the window", () => {
    const sketch = buildCaseSketch(SEABED, INPUT);
    const trackStart = sketch.trackPath.split("L")[0];
    expect(sketch.dragPath?.startsWith(trackStart ?? "")).toBe(true);
    expect(sketch.dragPath?.split("L")).toHaveLength(2);
    expect(buildCaseSketch(SEABED, { ...INPUT, dragWindow: null }).dragPath).toBeNull();
  });
});
