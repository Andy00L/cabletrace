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
    elevationRange: { lowestMetres: -30, highestMetres: 10 },
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
  placements: [{ longitude: 20.3, latitude: 56.7 }],
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

  test("widens a frame that shows almost no land until the coast is in it", () => {
    // Test fixture only: a 3 by 2 degree block, open sea except a land strip along its west edge, and a story 10 km
    // across in the east, far from that coast.
    const wideGrid = { width: 61, height: 41 };
    const openSea: SeabedData = {
      features: { ...SEABED.features, region: { west: 20, east: 23, south: 56, north: 58 }, grid: wideGrid },
      elevations: Float32Array.from({ length: wideGrid.width * wideGrid.height }, (_slot, index) => (index % wideGrid.width < 4 ? 10 : -30)),
    };
    const eastStory: ReplaySceneInput = {
      ...INPUT,
      track: [
        { atMs: 1_000, longitude: 22.4, latitude: 57.0, recordedSpeedKnots: null },
        { atMs: 3_000, longitude: 22.5, latitude: 57.0, recordedSpeedKnots: null },
      ],
      cuts: [{ cableName: "Cable", label: "Cable", atMs: 2_000, longitude: 22.45, latitude: 57.0 }],
    };
    const sketch = buildCaseSketch(openSea, eastStory);
    expect(sketch.landPath.length).toBeGreaterThan(0);
    const [cut] = sketch.cuts;
    expect(cut?.x).toBeGreaterThan(0);
    expect(cut?.x).toBeLessThan(SKETCH_WIDTH);
  });

  test("draws the drag stretch from the first position to the interpolated end of the window", () => {
    const sketch = buildCaseSketch(SEABED, INPUT);
    const trackStart = sketch.trackPath.split("L")[0];
    expect(sketch.dragPath?.startsWith(trackStart ?? "")).toBe(true);
    expect(sketch.dragPath?.split("L")).toHaveLength(2);
    expect(buildCaseSketch(SEABED, { ...INPUT, dragWindow: null }).dragPath).toBeNull();
  });
});
