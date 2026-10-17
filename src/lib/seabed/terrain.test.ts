import { describe, expect, test } from "bun:test";
import {
  downsampleElevations,
  clipToBlock,
  createElevationSampler,
  createProjection,
  decodeElevations,
  densifyScenePoints,
  elevationToSceneY,
  smoothElevations,
  chooseSmoothingPasses,
} from "./terrain";

const REGION = { west: 25.45, east: 26.45, south: 59.75, north: 60.3 };

describe("decodeElevations", () => {
  test("reads little-endian int16 decimetres as metres", () => {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setInt16(0, -523, true);
    view.setInt16(2, 120, true);
    expect(Array.from(decodeElevations(buffer))).toEqual([-52.29999923706055, 12]);
  });
});

describe("chooseSmoothingPasses", () => {
  test("rounds off GEBCO's whole-metre terraces and keeps EMODnet's relief", () => {
    expect(chooseSmoothingPasses("GEBCO Compilation Group (2026) GEBCO 2026 Grid, public domain")).toBe(3);
    expect(chooseSmoothingPasses("EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry (DTM 2024), CC BY 4.0")).toBe(1);
  });
});

describe("smoothElevations", () => {
  test("averages a sea spike with its sea neighbours but never with land", () => {
    const grid = { width: 3, height: 3 };
    const elevations = new Float32Array([-10, -10, 5, -10, -100, 5, -10, -10, 5]);
    const smoothed = smoothElevations(elevations, grid, 1);
    expect(smoothed[4]).toBeCloseTo(-150 / 6, 4);
    expect(smoothed[2]).toBe(5);
  });
});

describe("downsampleElevations", () => {
  test("keeps every second row and column and still reaches both edges", () => {
    // 5 x 3 grid holding its own index.
    const elevations = Float32Array.from({ length: 15 }, (_slot, index) => index);
    const reduced = downsampleElevations(elevations, { width: 5, height: 3 }, 2);
    expect(reduced.grid).toEqual({ width: 3, height: 2 });
    expect(Array.from(reduced.elevations)).toEqual([0, 2, 4, 10, 12, 14]);
  });

  test("returns an uneven grid unchanged", () => {
    const elevations = new Float32Array(12);
    expect(downsampleElevations(elevations, { width: 4, height: 3 }, 2).grid).toEqual({ width: 4, height: 3 });
  });
});

describe("elevationToSceneY", () => {
  test("exaggerates water and land by the area's own factors, in kilometres", () => {
    expect(elevationToSceneY(-100, { water: 20, land: 10 })).toBeCloseTo(-2, 6);
    expect(elevationToSceneY(50, { water: 20, land: 10 })).toBeCloseTo(0.5, 6);
    expect(elevationToSceneY(-3200, { water: 2, land: 2 })).toBeCloseTo(-6.4, 6);
  });
});

describe("createProjection", () => {
  test("centres the region on the origin with north at negative z", () => {
    const projection = createProjection(REGION);
    expect(projection.widthKm).toBeCloseTo(55.6, 1);
    expect(projection.depthKm).toBeCloseTo(60.8, 1);
    const center = projection.toScene(25.95, 60.025);
    expect(center.x).toBeCloseTo(0, 6);
    expect(center.z).toBeCloseTo(0, 6);
    expect(projection.toScene(25.45, 60.3).z).toBeCloseTo(-projection.depthKm / 2, 6);
  });
});

describe("createElevationSampler", () => {
  test("interpolates between grid cells and clamps outside the grid", () => {
    const projection = createProjection(REGION);
    const sample = createElevationSampler(new Float32Array([0, -10, -20, -30]), { width: 2, height: 2 }, projection);
    expect(sample(0, 0)).toBeCloseTo(-15, 6);
    expect(sample(-1000, -1000)).toBe(0);
  });
});

describe("densifyScenePoints and clipToBlock", () => {
  test("adds points every step and keeps the end point", () => {
    const points = densifyScenePoints([{ x: 0, z: 0 }, { x: 1, z: 0 }], 0.3);
    expect(points).toHaveLength(5);
    expect(points[points.length - 1]).toEqual({ x: 1, z: 0 });
  });

  test("splits a line where it leaves the block and drops short runs", () => {
    const projection = createProjection(REGION);
    const inside = Array.from({ length: 4 }, (_unused, index) => ({ x: index, z: 0 }));
    const outside = { x: 500, z: 0 };
    const runs = clipToBlock([...inside, outside, { x: 1, z: 1 }, ...inside], projection);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(4);
  });
});
