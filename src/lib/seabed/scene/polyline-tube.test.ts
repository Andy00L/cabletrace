import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildPolylineTube, type TubePoint } from "@/lib/seabed/scene/polyline-tube";

const RADIAL_SEGMENTS = 8;

describe("buildPolylineTube", () => {
  test("lays out its arrays as TubeGeometry does, and matches it on a straight line", () => {
    const points: TubePoint[] = [0, 1, 2, 3, 4].map((step) => ({ x: step, y: 0.5, z: -step * 0.5 }));
    const built = buildPolylineTube(points, 0.2, RADIAL_SEGMENTS);
    const reference = new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(4, 0.5, -2)), points.length - 1, 0.2, RADIAL_SEGMENTS, false);
    expect(built.positions.length).toBe(reference.getAttribute("position").array.length);
    expect(built.indices.length).toBe(reference.getIndex()?.array.length ?? -1);
    const referencePositions = reference.getAttribute("position").array;
    const largestGap = built.positions.reduce((largest, value, index) => Math.max(largest, Math.abs(value - (referencePositions[index] ?? Number.NaN))), 0);
    expect(largestGap).toBeLessThan(1e-5);
    expect([...built.indices]).toEqual([...(reference.getIndex()?.array ?? [])]);
  });

  test("puts each ring around its point, with unit normals across the line", () => {
    const points: TubePoint[] = Array.from({ length: 30 }, (_unused, index) => ({ x: index * 0.3, y: Math.sin(index / 4), z: Math.cos(index / 5) * 2 }));
    const radius = 0.15;
    const built = buildPolylineTube(points, radius, RADIAL_SEGMENTS);
    const ringSize = RADIAL_SEGMENTS + 1;
    points.forEach((point, ring) => {
      for (let around = 0; around < ringSize; around += 1) {
        const vertex = (ring * ringSize + around) * 3;
        const normal = [built.normals[vertex] ?? 0, built.normals[vertex + 1] ?? 0, built.normals[vertex + 2] ?? 0];
        expect(Math.hypot(...normal)).toBeCloseTo(1, 5);
        expect(built.positions[vertex] ?? 0).toBeCloseTo(point.x + radius * (normal[0] ?? 0), 5);
        expect(built.positions[vertex + 1] ?? 0).toBeCloseTo(point.y + radius * (normal[1] ?? 0), 5);
        expect(built.positions[vertex + 2] ?? 0).toBeCloseTo(point.z + radius * (normal[2] ?? 0), 5);
      }
    });
  });
});
