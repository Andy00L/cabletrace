import { describe, expect, test } from "bun:test";
import { buildCaseSeries, SERIES_SAMPLE_COUNT } from "./case-series";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { SeabedData } from "@/lib/seabed/seabed-data";

// Test fixture only: a 1 by 1 degree block, 40 m deep everywhere except a land column on its west edge,
// with one cable running north to south through 25.5 E.
const GRID = { width: 11, height: 11 };
const ELEVATIONS = new Float32Array(GRID.width * GRID.height).map((_unused, index) => (index % GRID.width === 0 ? 5 : -40));
const SEABED: SeabedData = {
  features: {
    region: { west: 25, east: 26, south: 59, north: 60 },
    grid: GRID,
    lines: [{ name: "Fixture cable", kind: "telecom", points: [[25.5, 59], [25.5, 60]] }],
    places: [],
    sources: { depth: "Fixture", land: "Fixture", cables: "Fixture", pipelines: "Fixture" },
  },
  elevations: ELEVATIONS,
};
const HOUR_MS = 3_600_000;
const START_MS = Date.parse("2024-12-25T10:00:00Z");

function makeInput(track: ReplaySceneInput["track"]): ReplaySceneInput {
  return {
    seabedArea: "fixture",
    windowStartMs: START_MS,
    windowEndMs: START_MS + 4 * HOUR_MS,
    track,
    dragWindow: null,
    cuts: [{ cableName: "Fixture cable", label: "Fixture cable", atMs: START_MS, longitude: 25.5, latitude: 59.5 }],
    vessel: { name: "Vessel", kind: "tanker", lengthMetres: 200 },
  };
}

describe("buildCaseSeries", () => {
  test("is empty outside the track and labels placed stretches as interpolated", () => {
    // Placed positions an hour apart on the same latitude, 0.2 degrees of longitude apart.
    const series = buildCaseSeries(
      SEABED,
      makeInput([
        { atMs: START_MS + HOUR_MS, longitude: 25.3, latitude: 59.5, recordedSpeedKnots: null },
        { atMs: START_MS + 2 * HOUR_MS, longitude: 25.5, latitude: 59.5, recordedSpeedKnots: null },
      ]),
    );
    expect(series.samples).toHaveLength(SERIES_SAMPLE_COUNT);
    expect(series.samples[0]).toBeNull();
    expect(series.samples[SERIES_SAMPLE_COUNT - 1]).toBeNull();
    const firstPlaced = series.samples.find((sample) => sample !== null);
    expect(firstPlaced?.basis).toBe("interpolated");
    // 0.2 degrees of longitude at 59.5 N is about 11.3 km, so about 6.1 knots over the hour.
    expect(firstPlaced?.speedKnots).toBeGreaterThan(5.9);
    expect(firstPlaced?.speedKnots).toBeLessThan(6.3);
  });

  test("reads recorded speed, distance to the nearest line and the depth under the vessel", () => {
    const series = buildCaseSeries(
      SEABED,
      makeInput([
        { atMs: START_MS, longitude: 25.4, latitude: 59.5, recordedSpeedKnots: 7.3 },
        { atMs: START_MS + 4 * HOUR_MS, longitude: 25.4, latitude: 59.6, recordedSpeedKnots: 7.1 },
      ]),
    );
    const sample = series.samples[0];
    expect(sample?.basis).toBe("recorded");
    expect(sample?.speedKnots).toBe(7.3);
    expect(sample?.nearestLine?.name).toBe("Fixture cable");
    // 0.1 degrees of longitude at 59.5 N is about 5.65 km.
    expect(sample?.nearestLine?.distanceKm).toBeGreaterThan(5.5);
    expect(sample?.nearestLine?.distanceKm).toBeLessThan(5.8);
    expect(sample?.depthMetres).toBe(40);
  });

  test("reads the course over ground, and none while the ship holds still", () => {
    const eastbound = buildCaseSeries(SEABED, makeInput([{ atMs: START_MS, longitude: 25.3, latitude: 59.5, recordedSpeedKnots: 6 }, { atMs: START_MS + 4 * HOUR_MS, longitude: 25.7, latitude: 59.5, recordedSpeedKnots: 6 }]));
    expect(eastbound.samples[100]?.courseDegrees).toBeCloseTo(90, 0);
    const southbound = buildCaseSeries(SEABED, makeInput([{ atMs: START_MS, longitude: 25.4, latitude: 59.8, recordedSpeedKnots: 6 }, { atMs: START_MS + 4 * HOUR_MS, longitude: 25.4, latitude: 59.2, recordedSpeedKnots: 6 }]));
    expect(southbound.samples[100]?.courseDegrees).toBeCloseTo(180, 0);
    const anchored = buildCaseSeries(SEABED, makeInput([{ atMs: START_MS, longitude: 25.4, latitude: 59.5, recordedSpeedKnots: 0 }, { atMs: START_MS + 4 * HOUR_MS, longitude: 25.4, latitude: 59.5, recordedSpeedKnots: 0 }]));
    expect(anchored.samples[100]?.courseDegrees).toBeNull();
  });

  test("gives no depth where the grid says land", () => {
    const series = buildCaseSeries(SEABED, makeInput([{ atMs: START_MS, longitude: 25, latitude: 59.5, recordedSpeedKnots: 0 }, { atMs: START_MS + HOUR_MS, longitude: 25, latitude: 59.5, recordedSpeedKnots: 0 }]));
    expect(series.samples[0]?.depthMetres).toBeNull();
  });
});
