import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildTerrainGrid } from "@/lib/seabed/scene/terrain-grid";

// A small grid with land, shallows and a trench, so the normals, colours and index order all have something to show.
const GRID = { width: 7, height: 5 };
const ELEVATIONS = Float32Array.from({ length: GRID.width * GRID.height }, (_slot, index) => Math.sin(index * 1.7) * 40 - 15);
const REQUEST = {
  elevations: ELEVATIONS,
  grid: GRID,
  step: 1,
  smoothingPasses: 1,
  exaggeration: { water: 20, land: 10 },
  widthKm: 12,
  depthKm: 8,
  depthRamp: [
    [5, "#8EAF9D"],
    [100, "#49695A"],
  ] as [number, string][],
  landRamp: [
    [0, "#94AF8D"],
    [30, "#253022"],
  ] as [number, string][],
};

/** The terrain as the overview built it before the worker: three.js's plane, its heights set, its normals computed. */
function buildWithThree(heights: Float32Array) {
  const geometry = new THREE.PlaneGeometry(REQUEST.widthKm, REQUEST.depthKm, GRID.width - 1, GRID.height - 1);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index += 1) positions.setY(index, heights[index] ?? 0);
  geometry.computeVertexNormals();
  return geometry;
}

describe("buildTerrainGrid", () => {
  test("lays out positions, uvs, index order and normals as three.js's plane does", () => {
    const terrain = buildTerrainGrid(REQUEST);
    const heights = Float32Array.from({ length: terrain.positions.length / 3 }, (_slot, index) => terrain.positions[index * 3 + 1] ?? 0);
    const reference = buildWithThree(heights);
    const closeTo = (actual: ArrayLike<number>, expected: ArrayLike<number>) => {
      expect(actual.length).toBe(expected.length);
      for (let index = 0; index < expected.length; index += 1) expect(actual[index] ?? Number.NaN).toBeCloseTo(expected[index] ?? Number.NaN, 5);
    };
    closeTo(terrain.positions, reference.getAttribute("position").array);
    closeTo(terrain.uvs, reference.getAttribute("uv").array);
    closeTo(terrain.normals, reference.getAttribute("normal").array);
    expect(Array.from(terrain.indices)).toEqual(Array.from(reference.getIndex()?.array ?? []));
  });

  test("colours a vertex from its ramp in linear light, as THREE.Color would", () => {
    const terrain = buildTerrainGrid({ ...REQUEST, smoothingPasses: 0, elevations: new Float32Array(GRID.width * GRID.height).fill(-52.5) });
    const expected = new THREE.Color("#8EAF9D").lerp(new THREE.Color("#49695A"), 0.5);
    expect(terrain.colors[0]).toBeCloseTo(expected.r, 6);
    expect(terrain.colors[1]).toBeCloseTo(expected.g, 6);
    expect(terrain.colors[2]).toBeCloseTo(expected.b, 6);
  });

  test("keeps every second row and column on the software tier's step", () => {
    const terrain = buildTerrainGrid({ ...REQUEST, step: 2 });
    expect(terrain.grid).toEqual({ width: 4, height: 3 });
    expect(terrain.positions.length).toBe(4 * 3 * 3);
  });
});
