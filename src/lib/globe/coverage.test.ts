import { describe, expect, test } from "bun:test";
import { COORDINATE_UNITS_PER_DEGREE } from "@/lib/live/snapshot-codec";
import { addFrameToCoverage, COVERAGE_HEIGHT, COVERAGE_WIDTH, coverageCellIndex, createCoverage, renderCoverageMask } from "./coverage";

function frameAt(frameTimeMs: number, positions: [number, number][]) {
  return {
    frameTimeMs,
    shipCount: positions.length,
    longitudeUnits: Int32Array.from(positions.map(([longitude]) => Math.round(longitude * COORDINATE_UNITS_PER_DEGREE))),
    latitudeUnits: Int32Array.from(positions.map(([, latitude]) => Math.round(latitude * COORDINATE_UNITS_PER_DEGREE))),
  };
}

function maskAt(mask: Uint8Array, longitude: number, latitude: number): number {
  return mask[coverageCellIndex(longitude, latitude)] ?? -1;
}

describe("coverageCellIndex", () => {
  test("puts row 0 at the north pole and column 0 at 180 W, and folds 180 E onto 180 W", () => {
    expect(coverageCellIndex(-180, 90)).toBe(0);
    expect(coverageCellIndex(-179.9, 89.9)).toBe(0);
    expect(coverageCellIndex(180, 0)).toBe(coverageCellIndex(-180, 0));
    expect(coverageCellIndex(179.9, -90)).toBe(COVERAGE_WIDTH * COVERAGE_HEIGHT - 1);
  });
});

describe("coverage", () => {
  test("marks a heard ship's cell and its neighbours, and leaves open ocean blind", () => {
    const coverage = createCoverage();
    expect(addFrameToCoverage(coverage, frameAt(1, [[24.9, 60.1]]))).toBe(true);
    const mask = renderCoverageMask(coverage);
    expect(maskAt(mask, 24.9, 60.1)).toBe(255);
    expect(maskAt(mask, 24.3, 60.6)).toBe(255);
    expect(maskAt(mask, 26.1, 60.1)).toBe(0);
    expect(maskAt(mask, -35, 40)).toBe(0);
  });

  test("counts a frame once and grows with each new frame", () => {
    const coverage = createCoverage();
    addFrameToCoverage(coverage, frameAt(1, [[0.2, 0.2]]));
    expect(addFrameToCoverage(coverage, frameAt(1, [[50.2, 10.2]]))).toBe(false);
    expect(maskAt(renderCoverageMask(coverage), 50.2, 10.2)).toBe(0);
    addFrameToCoverage(coverage, frameAt(2, [[50.2, 10.2]]));
    expect(maskAt(renderCoverageMask(coverage), 50.2, 10.2)).toBe(255);
  });

  test("wraps across the 180th meridian and stops at the poles", () => {
    const coverage = createCoverage();
    addFrameToCoverage(coverage, frameAt(1, [[179.8, -89.8]]));
    const mask = renderCoverageMask(coverage);
    expect(maskAt(mask, -179.8, -89.8)).toBe(255);
    expect(maskAt(mask, -179.8, -89.2)).toBe(255);
  });
});
