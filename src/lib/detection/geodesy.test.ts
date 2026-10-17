import { describe, expect, test } from "bun:test";
import { distanceMetres, intersectSegments, knotsFromMetres, median, quantile, signedAngleDifferenceDegrees } from "./geodesy";

describe("geodesy", () => {
  test("a degree of latitude is about 111.2 km", () => {
    expect(distanceMetres({ longitude: 25, latitude: 60 }, { longitude: 25, latitude: 61 })).toBeCloseTo(111_195, -1);
  });

  test("angle differences wrap across north", () => {
    expect(signedAngleDifferenceDegrees(2, 358)).toBeCloseTo(4, 9);
    expect(signedAngleDifferenceDegrees(358, 2)).toBeCloseTo(-4, 9);
    expect(signedAngleDifferenceDegrees(90, 270)).toBe(180);
  });

  test("1852 m in an hour is one knot", () => {
    expect(knotsFromMetres(1852, 3_600_000)).toBeCloseTo(1, 9);
  });

  test("crossing segments meet where expected; parallel and separate ones do not", () => {
    const hit = intersectSegments({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: -5 }, { x: 4, y: 5 });
    expect(hit?.alongA).toBeCloseTo(0.4, 9);
    expect(hit?.alongB).toBeCloseTo(0.5, 9);
    expect(intersectSegments({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull();
    expect(intersectSegments({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 12, y: -5 }, { x: 12, y: 5 })).toBeNull();
  });

  test("median and quantile handle empty, odd and even lists", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(quantile([10, 20, 30, 40, 50], 0.75)).toBe(40);
  });
});
